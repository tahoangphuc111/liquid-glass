import {
    CSS_FALLBACK_BACKDROP,
    DEFAULT_GLASS_CONFIG,
    MAX_ELEMENT_DEVICE_AREA,
    MAX_TOTAL_DEVICE_AREA,
    formatGlassFilterStyle,
    pickMapScale,
} from "./config.js";
import {
    activeBlobUrlCount,
    acquireSharedFilter,
    buildFilterElement,
    clearLruEvictionTimer,
    decrementActiveBlobUrlCount,
    disposeSharedFilter,
    filterArchetypeCache,
    lruUnusedFilterKeys,
    releaseSharedFilter,
    resetArchetypeHotSlots,
    sharedFilters,
    startMapPreload,
    type SharedFilterRecord,
} from "./filter.js";
import {
    attachGlobalListeners,
    canUseSvgGlass,
    detachGlobalListeners,
    getMediaQueries,
    setBatteryRefreshCallback,
    setDprResizeCallback,
} from "./observer.js";
import {
    applyQualityTier,
    downgradeLiquidGlass,
    isGlassDowngraded,
    qualityDowngrades,
    qualityTier,
    qualityUpgrades,
    setTierChangeCallback,
} from "./telemetry.js";
import type { GlassConfig, GlassSurface, LiquidGlassStats } from "./types.js";
import { isWasmReady, onWasmReady, revokeBlobUrlSafely } from "./wasm.js";

const QUANTIZE_GRID_W = 2;
const QUANTIZE_GRID_H = 2;

interface PremeasuredBox {
    w: number;
    h: number;
    rawRadiusStr: string;
}

export interface ElementGlassState {
    config: GlassConfig;
    sharedKey: string | null;
    pendingKey: string | null;
    commitToken: number;
    lastW: number;
    lastH: number;
    deviceArea: number;
    observedW: number;
    observedH: number;
    cachedRadiusStr: string | null;
    appliedFilterVal: string | null;
    appliedBezel: string | null;
    appliedRadius: string | null;
    appliedInnerRadius: string | null;
    appliedCoreFilter: string | null;
    isHollow: boolean;
    isIntersecting: boolean;
    rejectionReason: string | null;
    compositorRefreshId: number | null;
    premeasured?: PremeasuredBox;
}

export const elementStateMap = new WeakMap<HTMLElement, ElementGlassState>();
export const activeElements = new Set<HTMLElement>();
export const dirtyElements = new Set<HTMLElement>();
const managedElements = new Map<HTMLElement, GlassConfig>();

let currentTotalDeviceArea = 0;
let lastKnownDpr = 1;
let sharedResizeObserver: ResizeObserver | null = null;
let sharedIntersectionObserver: IntersectionObserver | null = null;
let resizeLiquidTimer: ReturnType<typeof setTimeout> | null = null;
let resizeLastScheduleTime = 0;
let cachedSvgDefs: SVGDefsElement | null = null;
let hasWarnedMissingSvgDefs = false;
let intersectionFlushRafId: number | null = null;
let isEngineInitialized = false;
let lifecycleListenersAttached = false;

const warnedAreaExceededElements = new WeakSet<HTMLElement>();
const warnedFailedElements = new WeakSet<HTMLElement>();

function syncElementFeDimensions(record: SharedFilterRecord, w: number, h: number): void {
    const isWChanged = record.lastFeW !== w;
    const isHChanged = record.lastFeH !== h;
    if (record.feImage && isWChanged) record.feImage.setAttribute("width", String(w));
    if (record.feImage && isHChanged) record.feImage.setAttribute("height", String(h));
    if (record.feImageT1 && isWChanged) record.feImageT1.setAttribute("width", String(w));
    if (record.feImageT1 && isHChanged) record.feImageT1.setAttribute("height", String(h));
    if (isWChanged) {
        record.lastFeW = w;
        record.actualW = w;
    }
    if (isHChanged) {
        record.lastFeH = h;
        record.actualH = h;
    }
}

export function ensureSvgDefs(): SVGDefsElement | null {
    if (cachedSvgDefs && cachedSvgDefs.isConnected) return cachedSvgDefs;
    if (typeof document === "undefined") return null;

    let svgDefs = document.getElementById("svg-defs") as SVGDefsElement | null;
    if (svgDefs) {
        cachedSvgDefs = svgDefs;
        return svgDefs;
    }
    if (document.body) {
        const svgWrapper = document.createElement("div");
        svgWrapper.innerHTML =
            '<svg width="0" height="0" aria-hidden="true" style="position:absolute;overflow:hidden;pointer-events:none;"><defs id="svg-defs"></defs></svg>';
        const svgEl = svgWrapper.firstElementChild;
        if (svgEl) {
            document.body.appendChild(svgEl);
            svgDefs = document.getElementById("svg-defs") as SVGDefsElement | null;
        }
    }
    if (!svgDefs && !hasWarnedMissingSvgDefs) {
        console.warn("[LiquidGlass] Missing #svg-defs and failed to auto-create container.");
        hasWarnedMissingSvgDefs = true;
    }
    cachedSvgDefs = svgDefs;
    return svgDefs;
}

export function getElementState(
    element: HTMLElement,
    config: GlassConfig,
): ElementGlassState {
    let state = elementStateMap.get(element);
    if (!state) {
        state = {
            config,
            sharedKey: null,
            pendingKey: null,
            commitToken: 0,
            lastW: 0,
            lastH: 0,
            deviceArea: 0,
            observedW: 0,
            observedH: 0,
            cachedRadiusStr: null,
            appliedFilterVal: null,
            appliedBezel: null,
            appliedRadius: null,
            appliedInnerRadius: null,
            appliedCoreFilter: null,
            isHollow: false,
            isIntersecting: config.alwaysOn,
            rejectionReason: null,
            compositorRefreshId: null,
        };
        elementStateMap.set(element, state);
    } else {
        if (state.config.radius !== config.radius || state.config.pill !== config.pill) {
            state.cachedRadiusStr = null;
            if (config.pill) {
                element.style.removeProperty("--lg-radius");
            } else {
                element.style.setProperty("--lg-radius", `${config.radius}px`);
            }
        }
        state.config = config;
    }
    return state;
}

export function cancelPendingCommit(state: ElementGlassState): void {
    state.commitToken++;
    state.pendingKey = null;
    if (state.compositorRefreshId != null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(state.compositorRefreshId);
        state.compositorRefreshId = null;
    }
}

function scheduleSvgBackdropRefresh(
    element: HTMLElement,
    state: ElementGlassState,
    filterVal: string,
): void {
    if (typeof requestAnimationFrame !== "function") return;
    if (state.compositorRefreshId != null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(state.compositorRefreshId);
    }
    // nudge blink's backdrop-filter cache after svg feimage finishes decoding in chromium
    state.compositorRefreshId = requestAnimationFrame(() => {
        state.compositorRefreshId = null;
        if (!element.isConnected || state.appliedFilterVal !== filterVal) return;
        element.style.setProperty("--lg-filter", `${filterVal} contrast(1)`);
        state.compositorRefreshId = requestAnimationFrame(() => {
            state.compositorRefreshId = null;
            if (!element.isConnected || state.appliedFilterVal !== filterVal) return;
            element.style.setProperty("--lg-filter", filterVal);
        });
    });
}

export function detachElementFilter(element: HTMLElement, state: ElementGlassState): void {
    if (!state) return;

    cancelPendingCommit(state);

    if (state.sharedKey) {
        const keyToRelease = state.sharedKey;
        state.sharedKey = null;
        releaseSharedFilter(keyToRelease);
    }

    if (state.deviceArea) {
        currentTotalDeviceArea = Math.max(0, currentTotalDeviceArea - state.deviceArea);
        state.deviceArea = 0;
    }

    element.classList.remove("lg-on", "lg-hollow");
    element.style.removeProperty("--lg-filter");
    element.style.removeProperty("--lg-bezel");
    element.style.removeProperty("--lg-radius");
    element.style.removeProperty("--lg-inner-radius");
    element.style.removeProperty("--lg-core-filter");
    state.appliedFilterVal = null;
    state.appliedBezel = null;
    state.appliedRadius = null;
    state.appliedInnerRadius = null;
    state.appliedCoreFilter = null;
    state.isHollow = false;
    activeElements.delete(element);
}

export function applyCssFallback(
    element: HTMLElement,
    state: ElementGlassState,
    reason: string,
): void {
    if (!state) return;
    state.rejectionReason = reason;
    cancelPendingCommit(state);

    if (state.sharedKey) {
        const keyToRelease = state.sharedKey;
        state.sharedKey = null;
        releaseSharedFilter(keyToRelease);
    }

    if (state.deviceArea) {
        currentTotalDeviceArea = Math.max(0, currentTotalDeviceArea - state.deviceArea);
        state.deviceArea = 0;
    }

    element.classList.remove("lg-hollow");
    element.style.removeProperty("--lg-bezel");
    element.style.removeProperty("--lg-inner-radius");
    element.style.removeProperty("--lg-core-filter");
    state.appliedBezel = null;
    state.appliedInnerRadius = null;
    state.appliedCoreFilter = null;
    state.isHollow = false;

    if (reason === "too_small") {
        element.classList.remove("lg-on");
        element.style.removeProperty("--lg-filter");
        state.appliedFilterVal = null;
        activeElements.delete(element);
    } else {
        element.style.setProperty("--lg-filter", CSS_FALLBACK_BACKDROP);
        state.appliedFilterVal = CSS_FALLBACK_BACKDROP;
        element.classList.add("lg-on");
        activeElements.add(element);
    }
}

export function cleanupElementState(element: HTMLElement): void {
    const state = elementStateMap.get(element);
    if (!state) return;

    detachElementFilter(element, state);

    state.lastW = 0;
    state.lastH = 0;
    state.observedW = 0;
    state.observedH = 0;
    state.cachedRadiusStr = null;
    state.rejectionReason = null;

    dirtyElements.delete(element);
    activeElements.delete(element);

    sharedResizeObserver?.unobserve(element);
    sharedIntersectionObserver?.unobserve(element);
}

export function cleanupAllTargetStates(): void {
    if (intersectionFlushRafId !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(intersectionFlushRafId);
        intersectionFlushRafId = null;
    }
    if (resizeLiquidTimer !== null) {
        clearTimeout(resizeLiquidTimer);
        resizeLiquidTimer = null;
    }
    clearLruEvictionTimer();

    Array.from(activeElements).forEach((element) => {
        cleanupElementState(element);
    });
    activeElements.clear();

    const allKeys = Array.from(sharedFilters.keys());
    for (let index = 0; index < allKeys.length; index++) {
        disposeSharedFilter(allKeys[index], true);
    }
    for (const arch of filterArchetypeCache.values()) {
        if (arch.blobUrl) {
            revokeBlobUrlSafely(arch.blobUrl);
            arch.blobUrl = null;
            decrementActiveBlobUrlCount();
        }
    }
    filterArchetypeCache.clear();
    lruUnusedFilterKeys.clear();
    resetArchetypeHotSlots();
    currentTotalDeviceArea = 0;
    cachedSvgDefs = null;
}

export function registerTargetElement(
    element: HTMLElement,
    config: GlassConfig,
): ElementGlassState {
    ensureObserversInitialized();
    const state = getElementState(element, config);
    sharedResizeObserver?.observe(element);
    sharedIntersectionObserver?.observe(element);
    return state;
}

export function registerManagedElement(
    element: HTMLElement,
    config: GlassConfig,
): void {
    managedElements.set(element, config);
    initLiquidGlass();
    const measured = measureElement(element);
    rebuildLiquidGlassFilterForElement(element, config, measured);
}

export function unregisterManagedElement(element: HTMLElement): void {
    managedElements.delete(element);
    cleanupElementState(element);
}

function onIntersectionChange(entries: IntersectionObserverEntry[]): void {
    const enabled = canUseSvgGlass();

    let needsFlush = false;
    for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        const element = entry.target as HTMLElement;
        const state = elementStateMap.get(element);
        if (!state || !state.config) continue;

        const wasIntersecting = state.isIntersecting;
        state.isIntersecting = entry.isIntersecting;
        if (!enabled) continue;

        if (entry.isIntersecting) {
            if (!activeElements.has(element)) {
                dirtyElements.add(element);
                needsFlush = true;
            }
        } else if (wasIntersecting && !state.config.alwaysOn) {
            detachElementFilter(element, state);
        }
    }

    if (needsFlush && dirtyElements.size > 0 && intersectionFlushRafId === null) {
        intersectionFlushRafId = requestAnimationFrame(() => {
            intersectionFlushRafId = null;
            void flushDirtyElements();
        });
    }
}

interface FilterCommitMeta {
    w: number;
    h: number;
    radius: number;
    deviceArea: number;
    blur: number;
    clampedBezel: number;
    hasCore: boolean;
    coreFilter: string;
}

function commitFilter(
    element: HTMLElement,
    state: ElementGlassState,
    record: SharedFilterRecord,
    meta: FilterCommitMeta,
    reusedExisting = false,
): void {
    cancelPendingCommit(state);

    const activeFilterId =
        qualityTier >= 1 && record.filterIdT1 ? record.filterIdT1 : record.filterId;
    const filterVal = formatGlassFilterStyle(activeFilterId, meta.blur, qualityTier);
    const filterChanged = state.appliedFilterVal !== filterVal;
    if (filterChanged) {
        element.style.setProperty("--lg-filter", filterVal);
        state.appliedFilterVal = filterVal;
        scheduleSvgBackdropRefresh(element, state, filterVal);
    }

    syncElementFeDimensions(record, meta.w, meta.h);

    if (!element.classList.contains("lg-on")) {
        element.classList.add("lg-on");
    }
    if (state.config.pill) {
        if (state.appliedRadius !== null) {
            element.style.removeProperty("--lg-radius");
            state.appliedRadius = null;
        }
    } else {
        const radiusVal = `${Math.round(meta.radius)}px`;
        if (state.appliedRadius !== radiusVal) {
            element.style.setProperty("--lg-radius", radiusVal);
            state.appliedRadius = radiusVal;
        }
    }
    if (meta.hasCore) {
        if (!state.isHollow) {
            element.classList.add("lg-hollow");
            state.isHollow = true;
        }
        const bezelVal = `${meta.clampedBezel}px`;
        if (state.appliedBezel !== bezelVal) {
            element.style.setProperty("--lg-bezel", bezelVal);
            state.appliedBezel = bezelVal;
        }
        const innerRadiusVal = `${Math.max(0, Math.round(meta.radius - meta.clampedBezel))}px`;
        if (state.appliedInnerRadius !== innerRadiusVal) {
            element.style.setProperty("--lg-inner-radius", innerRadiusVal);
            state.appliedInnerRadius = innerRadiusVal;
        }
        if (meta.coreFilter && state.appliedCoreFilter !== meta.coreFilter) {
            element.style.setProperty("--lg-core-filter", meta.coreFilter);
            state.appliedCoreFilter = meta.coreFilter;
        }
    } else if (state.isHollow) {
        element.classList.remove("lg-hollow");
        element.style.removeProperty("--lg-bezel");
        element.style.removeProperty("--lg-inner-radius");
        element.style.removeProperty("--lg-core-filter");
        state.isHollow = false;
        state.appliedBezel = null;
        state.appliedInnerRadius = null;
        state.appliedCoreFilter = null;
    }

    currentTotalDeviceArea = currentTotalDeviceArea - (state.deviceArea || 0) + meta.deviceArea;
    state.deviceArea = meta.deviceArea;

    const oldKey = state.sharedKey;
    state.sharedKey = record.key;
    state.pendingKey = null;

    state.lastW = meta.w;
    state.lastH = meta.h;
    activeElements.add(element);

    if (oldKey && !(reusedExisting && oldKey === record.key)) {
        releaseSharedFilter(oldKey);
    }
}

export function rebuildLiquidGlassFilterForElement(
    element: HTMLElement,
    config: GlassConfig,
    premeasured: PremeasuredBox | null = null,
): void {
    if (!canUseSvgGlass()) {
        cleanupElementState(element);
        return;
    }

    const state = registerTargetElement(element, config);

    // nested backdrop-filters double-displace in chromium's compositor
    if (element.parentElement?.closest(".lg-on")) {
        state.rejectionReason = "nested";
        detachElementFilter(element, state);
        return;
    }
    if (state.rejectionReason === "nested") {
        state.rejectionReason = null;
    }

    if (element.childElementCount > 0) {
        for (const activeEl of activeElements) {
            if (activeEl !== element && element.contains(activeEl)) {
                const childState = elementStateMap.get(activeEl);
                if (childState) {
                    childState.rejectionReason = "nested";
                    detachElementFilter(activeEl, childState);
                }
            }
        }
    }

    const svgDefs = ensureSvgDefs();
    if (!element || !svgDefs) return;

    let w: number;
    let h: number;
    if (premeasured) {
        w = premeasured.w;
        h = premeasured.h;
    } else {
        w = element.offsetWidth;
        h = element.offsetHeight;
        if (!w || !h) {
            const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : null;
            w = w || Math.round(rect ? rect.width : 0);
            h = h || Math.round(rect ? rect.height : 0);
        }
    }
    if (w < 10 || h < 10) {
        state.lastW = w;
        state.lastH = h;
        applyCssFallback(element, state, "too_small");
        return;
    }
    state.rejectionReason = null;

    if (sharedIntersectionObserver && !state.isIntersecting && !config.alwaysOn) {
        detachElementFilter(element, state);
        return;
    }

    const halfMinDim = Math.min(w, h) * 0.5;
    const rawRadiusStr =
        premeasured?.rawRadiusStr ??
        state.cachedRadiusStr ??
        (typeof window !== "undefined" && window.getComputedStyle
            ? window.getComputedStyle(element).borderTopLeftRadius.trim()
            : "");
    state.cachedRadiusStr = rawRadiusStr;

    const parsedRadius = rawRadiusStr.endsWith("%")
        ? (parseFloat(rawRadiusStr) / 100) * Math.min(w, h)
        : parseFloat(rawRadiusStr);

    let radius: number;
    if (config.pill) {
        radius =
            !Number.isFinite(parsedRadius) || parsedRadius <= 0
                ? halfMinDim
                : Math.min(Math.max(parsedRadius, 0), halfMinDim);
    } else if (Number.isFinite(parsedRadius)) {
        radius = Math.min(Math.max(parsedRadius, 0), halfMinDim);
    } else {
        const fallbackRadius = config.radius ?? Math.min(Math.round(h * 0.5), 30);
        radius = Math.min(Math.max(fallbackRadius, 0), halfMinDim);
    }

    const surface = ((element.dataset?.surface as GlassSurface | undefined) ??
        config.surface) as GlassSurface;
    const dpr = typeof window !== "undefined" && typeof window.devicePixelRatio === "number"
        ? window.devicePixelRatio
        : 1;
    const rasterScale = Math.min(dpr, 2);

    const clampedBezel = Math.max(1, Math.min(config.bezel, halfMinDim - 1));
    const hasCore = Boolean(
        config.hollow &&
            !config.axis &&
            w > clampedBezel * 2 + 8 &&
            h > clampedBezel * 2 + 8,
    );
    const coreFilter = config.coreFilter || CSS_FALLBACK_BACKDROP;

    const deviceArea = Math.round(w * h * dpr * dpr);
    const oldElementArea = state.deviceArea || 0;

    if (deviceArea > MAX_ELEMENT_DEVICE_AREA) {
        if (!warnedAreaExceededElements.has(element)) {
            console.warn(
                "[LiquidGlass] Element device area exceeds limit:",
                deviceArea,
                ">",
                MAX_ELEMENT_DEVICE_AREA,
                element,
            );
            warnedAreaExceededElements.add(element);
        }
        applyCssFallback(element, state, "over_element_area");
        return;
    }

    if (currentTotalDeviceArea - oldElementArea + deviceArea > MAX_TOTAL_DEVICE_AREA) {
        if (config.alwaysOn) {
            for (const activeEl of activeElements) {
                const activeState = elementStateMap.get(activeEl);
                if (activeState && !activeState.config.alwaysOn) {
                    applyCssFallback(activeEl, activeState, "budget_evicted");
                    if (currentTotalDeviceArea - oldElementArea + deviceArea <= MAX_TOTAL_DEVICE_AREA) {
                        break;
                    }
                }
            }
        }
        if (currentTotalDeviceArea - oldElementArea + deviceArea > MAX_TOTAL_DEVICE_AREA) {
            if (!warnedAreaExceededElements.has(element)) {
                console.warn(
                    "[LiquidGlass] Total GPU device area exceeds limit:",
                    currentTotalDeviceArea - oldElementArea + deviceArea,
                    ">",
                    MAX_TOTAL_DEVICE_AREA,
                    element,
                );
                warnedAreaExceededElements.add(element);
            }
            applyCssFallback(element, state, "over_total_budget");
            return;
        }
    }

    const quantW = Math.max(QUANTIZE_GRID_W, Math.round(w / QUANTIZE_GRID_W) * QUANTIZE_GRID_W);
    const quantH = Math.max(QUANTIZE_GRID_H, Math.round(h / QUANTIZE_GRID_H) * QUANTIZE_GRID_H);
    const quantRadius = config.pill ? Math.min(quantW, quantH) * 0.5 : Math.round(radius);

    const tierKey = qualityTier === 2 ? "_q2" : "";
    const newSharedKey = `${config.id}|${quantW}_${quantH}_${rasterScale.toFixed(2)}_${quantRadius.toFixed(1)}_${surface}${tierKey}`;

    const matchesSharedKey =
        state.sharedKey === newSharedKey || state.sharedKey === `${newSharedKey}_${w}x${h}`;

    if (
        state.pendingKey &&
        (state.pendingKey === newSharedKey || state.pendingKey === `${newSharedKey}_${w}x${h}`)
    ) {
        return;
    }

    if (matchesSharedKey && state.sharedKey) {
        const rec = sharedFilters.get(state.sharedKey);
        if (rec && rec.node?.isConnected) {
            state.lastW = w;
            state.lastH = h;
            currentTotalDeviceArea = currentTotalDeviceArea - (state.deviceArea || 0) + deviceArea;
            state.deviceArea = deviceArea;

            if (rec.refCount === 1) syncElementFeDimensions(rec, w, h);

            commitFilter(
                element,
                state,
                rec,
                {
                    w,
                    h,
                    radius,
                    deviceArea,
                    blur: config.blur,
                    clampedBezel,
                    hasCore,
                    coreFilter,
                },
                true,
            );
            return;
        }
    }

    const record = acquireSharedFilter(
        {
            sharedKey: newSharedKey,
            config,
            w: quantW,
            h: quantH,
            actualW: w,
            actualH: h,
            radius: quantRadius,
            surface,
            rasterScale,
            halfMinDim: Math.min(quantW, quantH) * 0.5,
            svgDefs,
        },
        qualityTier,
    );
    if (!record) return;

    const meta: FilterCommitMeta = {
        w,
        h,
        radius,
        deviceArea,
        blur: config.blur,
        clampedBezel,
        hasCore,
        coreFilter,
    };

    if (record.ready) {
        commitFilter(element, state, record, meta);
    } else {
        state.pendingKey = newSharedKey;
        const currentToken = ++state.commitToken;
        const readyPromise = record.readyPromise || startMapPreload(record);

        void readyPromise.then(() => {
            if (state.commitToken !== currentToken || !element.isConnected) {
                releaseSharedFilter(record.key, record);
                return;
            }
            commitFilter(element, state, record, meta);
        });
    }
}

export function measureElement(element: HTMLElement): PremeasuredBox {
    const state = elementStateMap.get(element);
    let w =
        state?.observedW ||
        element.offsetWidth ||
        (state?.lastW && state.lastW > 0 ? state.lastW : 0);
    let h =
        state?.observedH ||
        element.offsetHeight ||
        (state?.lastH && state.lastH > 0 ? state.lastH : 0);
    if (state) {
        state.observedW = 0;
        state.observedH = 0;
    }
    if (!w || !h) {
        const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : null;
        w = w || Math.round(rect ? rect.width : 0);
        h = h || Math.round(rect ? rect.height : 0);
    }
    let rawRadiusStr = state?.cachedRadiusStr ?? null;
    if (rawRadiusStr == null) {
        const computedStyle =
            typeof window !== "undefined" && window.getComputedStyle
                ? window.getComputedStyle(element)
                : null;
        rawRadiusStr = computedStyle ? computedStyle.borderTopLeftRadius.trim() : "";
        if (state) {
            state.cachedRadiusStr = rawRadiusStr;
        }
    }
    if (state) {
        if (!state.premeasured) {
            state.premeasured = { w, h, rawRadiusStr };
        } else {
            state.premeasured.w = w;
            state.premeasured.h = h;
            state.premeasured.rawRadiusStr = rawRadiusStr;
        }
        return state.premeasured;
    }
    return { w, h, rawRadiusStr };
}

export function batchMeasureAndRebuild(
    elementsWithConfigs: Array<{ element: HTMLElement; config: GlassConfig }>,
): void {
    if (!elementsWithConfigs || elementsWithConfigs.length === 0) return;

    const tasks = elementsWithConfigs.map(({ element, config }) => {
        registerTargetElement(element, config);
        return { element, config, premeasured: measureElement(element) };
    });

    if (typeof document !== "undefined" && !document.documentElement.classList.contains("liquid-glass-enabled")) {
        document.documentElement.classList.add("liquid-glass-enabled");
    }

    for (let index = 0; index < tasks.length; index++) {
        const task = tasks[index];
        try {
            rebuildLiquidGlassFilterForElement(task.element, task.config, task.premeasured);
        } catch (err) {
            if (!warnedFailedElements.has(task.element)) {
                console.warn("[LiquidGlass] rebuild failed:", err);
                warnedFailedElements.add(task.element);
            }
            cleanupElementState(task.element);
        }
    }
}

export function rebuildAllLiquidGlassFilters(
    configs: GlassConfig[] = [DEFAULT_GLASS_CONFIG],
): void {
    if (typeof document === "undefined") return;
    if (!canUseSvgGlass()) {
        document.documentElement.classList.remove("liquid-glass-enabled");
        detachGlobalListeners();
        cleanupAllTargetStates();
        return;
    }
    attachGlobalListeners();

    const elementsWithConfigs: Array<{
        element: HTMLElement;
        config: GlassConfig;
    }> = [];
    const matchedElements = new Set<HTMLElement>();

    for (const config of configs) {
        if (!config.selector) continue;
        const elements = document.querySelectorAll<HTMLElement>(config.selector);
        for (let index = 0; index < elements.length; index++) {
            const element = elements[index];
            if (!managedElements.has(element)) {
                matchedElements.add(element);
                elementsWithConfigs.push({ element, config });
            }
        }
    }

    for (const [element, config] of managedElements.entries()) {
        if (element.isConnected) {
            matchedElements.add(element);
            elementsWithConfigs.push({ element, config });
        } else {
            managedElements.delete(element);
        }
    }

    activeElements.forEach((element) => {
        if (!element.isConnected || !matchedElements.has(element)) {
            cleanupElementState(element);
        }
    });

    batchMeasureAndRebuild(elementsWithConfigs);
}

export async function flushDirtyElements(): Promise<void> {
    if (!canUseSvgGlass()) {
        rebuildAllLiquidGlassFilters();
        dirtyElements.clear();
        return;
    }

    const scheduledTasks: Array<{
        el: HTMLElement;
        config: GlassConfig;
        premeasured: PremeasuredBox;
    }> = [];
    dirtyElements.forEach((el) => {
        if (!el.isConnected) {
            cleanupElementState(el);
            return;
        }
        const state = elementStateMap.get(el);
        if (!state || !state.config) return;
        scheduledTasks.push({
            el,
            config: state.config,
            premeasured: measureElement(el),
        });
    });
    dirtyElements.clear();

    const win = typeof window !== "undefined" ? (window as unknown as { scheduler?: { yield?: () => Promise<void> } }) : null;
    const hasSchedulerYield = Boolean(win?.scheduler && typeof win.scheduler.yield === "function");

    for (let index = 0; index < scheduledTasks.length; index++) {
        if (index > 0 && (index & 3) === 0 && hasSchedulerYield) {
            await win!.scheduler!.yield!();
        }
        const task = scheduledTasks[index];
        try {
            rebuildLiquidGlassFilterForElement(task.el, task.config, task.premeasured);
        } catch (err) {
            if (!warnedFailedElements.has(task.el)) {
                console.warn("[LiquidGlass] rebuild failed:", err);
                warnedFailedElements.add(task.el);
            }
            cleanupElementState(task.el);
        }
    }
}

export function scheduleRebuildLiquidGlass(entries?: ResizeObserverEntry[] | Event): void {
    if (Array.isArray(entries)) {
        for (let index = 0; index < entries.length; index++) {
            const entry = entries[index];
            const targetElement = entry.target as HTMLElement;
            if (!targetElement.isConnected) {
                cleanupElementState(targetElement);
                continue;
            }
            const state = elementStateMap.get(targetElement);
            if (state) {
                const box = entry.borderBoxSize
                    ? Array.isArray(entry.borderBoxSize)
                        ? entry.borderBoxSize[0]
                        : entry.borderBoxSize
                    : null;
                const w = Math.round(
                    box ? box.inlineSize : entry.contentRect ? entry.contentRect.width : targetElement.offsetWidth,
                );
                const h = Math.round(
                    box ? box.blockSize : entry.contentRect ? entry.contentRect.height : targetElement.offsetHeight,
                );

                if (state.lastW > 0 && w === state.lastW && h === state.lastH) continue;

                if (
                    state.lastW > 0 &&
                    state.sharedKey &&
                    activeElements.has(targetElement) &&
                    sharedFilters.has(state.sharedKey)
                ) {
                    const quantW = Math.max(QUANTIZE_GRID_W, Math.round(w / QUANTIZE_GRID_W) * QUANTIZE_GRID_W);
                    const quantH = Math.max(QUANTIZE_GRID_H, Math.round(h / QUANTIZE_GRID_H) * QUANTIZE_GRID_H);
                    const lastQuantW = Math.max(
                        QUANTIZE_GRID_W,
                        Math.round(state.lastW / QUANTIZE_GRID_W) * QUANTIZE_GRID_W,
                    );
                    const lastQuantH = Math.max(
                        QUANTIZE_GRID_H,
                        Math.round(state.lastH / QUANTIZE_GRID_H) * QUANTIZE_GRID_H,
                    );

                    if (quantW === lastQuantW && quantH === lastQuantH) {
                        const maxBezel = state.config?.bezel ?? 0;
                        const oldBezel = Math.max(1, Math.min(maxBezel, Math.min(state.lastW, state.lastH) * 0.5 - 1));
                        const newBezel = Math.max(1, Math.min(maxBezel, Math.min(w, h) * 0.5 - 1));

                        if (oldBezel === newBezel) {
                            const dpr = typeof window !== "undefined" && typeof window.devicePixelRatio === "number"
                                ? window.devicePixelRatio
                                : 1;
                            const newArea = Math.round(w * h * dpr * dpr);
                            const newTotalArea = currentTotalDeviceArea - (state.deviceArea || 0) + newArea;

                            if (newArea <= MAX_ELEMENT_DEVICE_AREA && newTotalArea <= MAX_TOTAL_DEVICE_AREA) {
                                state.lastW = w;
                                state.lastH = h;
                                state.observedW = w;
                                state.observedH = h;
                                currentTotalDeviceArea = newTotalArea;
                                state.deviceArea = newArea;

                                const rec = sharedFilters.get(state.sharedKey);
                                if (rec && rec.refCount === 1) syncElementFeDimensions(rec, w, h);
                                continue;
                            }
                        }
                    }
                }

                if (w > 0 && h > 0) {
                    state.observedW = w;
                    state.observedH = h;
                }
                dirtyElements.add(targetElement);
            }
        }
    } else {
        activeElements.forEach((targetElement) => {
            if (targetElement.isConnected) {
                dirtyElements.add(targetElement);
            } else {
                cleanupElementState(targetElement);
            }
        });
    }

    if (dirtyElements.size === 0) return;

    const now = performance.now();
    if (resizeLiquidTimer !== null) clearTimeout(resizeLiquidTimer);

    if (now - resizeLastScheduleTime > 250) {
        resizeLastScheduleTime = now;
        requestAnimationFrame(() => void flushDirtyElements());
    } else {
        resizeLiquidTimer = setTimeout(() => {
            resizeLastScheduleTime = performance.now();
            requestAnimationFrame(() => void flushDirtyElements());
        }, 120);
    }
}

function detectDevicePerformance(): void {
    if (typeof navigator === "undefined") return;
    const nav = navigator as Navigator & {
        deviceMemory?: number;
        connection?: { saveData?: boolean };
    };
    const concurrency = typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : 4;
    const memory = typeof nav.deviceMemory === "number" ? nav.deviceMemory : 8;
    const isSaveData = Boolean(nav.connection && nav.connection.saveData);

    if ((concurrency <= 2 && memory <= 2) || isSaveData) {
        applyQualityTier(2);
    }
}

export function downgradeLiquidGlassToCss(): void {
    if (isGlassDowngraded) return;
    downgradeLiquidGlass();
    detachGlobalListeners();

    if (typeof document !== "undefined") {
        document.documentElement.classList.remove("liquid-glass-enabled");
        document.documentElement.classList.add("low-end-device");
    }
    cleanupAllTargetStates();

    sharedResizeObserver?.disconnect();
    sharedResizeObserver = null;
    sharedIntersectionObserver?.disconnect();
    sharedIntersectionObserver = null;
}

function ensureObserversInitialized(): void {
    if (typeof window === "undefined") return;

    if (!sharedResizeObserver) {
        const ResizeObserverClass = window.ResizeObserver;
        if (ResizeObserverClass) {
            sharedResizeObserver = new ResizeObserverClass(scheduleRebuildLiquidGlass);
        } else {
            window.addEventListener("resize", scheduleRebuildLiquidGlass, { passive: true });
        }
    }

    if (!sharedIntersectionObserver && typeof window.IntersectionObserver === "function") {
        sharedIntersectionObserver = new window.IntersectionObserver(onIntersectionChange, {
            rootMargin: "200px 0px 200px 0px",
        });
    }
}

function handleVisibilityChange(): void {
    if (typeof document !== "undefined" && !document.hidden && canUseSvgGlass()) {
        rebuildAllLiquidGlassFilters();
    }
}

function handlePageShow(event: PageTransitionEvent): void {
    if (event.persisted && canUseSvgGlass()) {
        rebuildAllLiquidGlassFilters();
    }
}

function handlePageHide(): void {
    detachGlobalListeners();
    cleanupAllTargetStates();
}

function onMediaQueryChange(): void {
    rebuildAllLiquidGlassFilters();
}

function bindGlobalEngineCallbacks(): void {
    setTierChangeCallback((tier, prevTier) => {
        if (tier === 2 || prevTier === 2) {
            for (const element of activeElements) {
                dirtyElements.add(element);
            }
            void flushDirtyElements();
            return;
        }

        for (const element of activeElements) {
            const state = elementStateMap.get(element);
            if (!state || !state.sharedKey) continue;
            const record = sharedFilters.get(state.sharedKey);
            if (!record) continue;
            const targetId = qualityTier >= 1 && record.filterIdT1 ? record.filterIdT1 : record.filterId;
            const blur = state.config?.blur || 0;
            const nextFilterVal = formatGlassFilterStyle(targetId, blur, qualityTier);
            if (state.appliedFilterVal !== nextFilterVal) {
                element.style.setProperty("--lg-filter", nextFilterVal);
                state.appliedFilterVal = nextFilterVal;
            }
        }
    });

    setDprResizeCallback(() => {
        const dpr = typeof window !== "undefined" && typeof window.devicePixelRatio === "number"
            ? window.devicePixelRatio
            : 1;
        if (Math.abs(dpr - lastKnownDpr) <= 0.01) return;
        lastKnownDpr = dpr;
        scheduleRebuildLiquidGlass();
    });

    setBatteryRefreshCallback(() => {
        rebuildAllLiquidGlassFilters();
    });
}

export function initLiquidGlass(configs: GlassConfig[] = [DEFAULT_GLASS_CONFIG]): void {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    if (isEngineInitialized) return;
    isEngineInitialized = true;

    bindGlobalEngineCallbacks();
    detectDevicePerformance();
    lastKnownDpr = typeof window.devicePixelRatio === "number" ? window.devicePixelRatio : 1;
    ensureObserversInitialized();

    if (!lifecycleListenersAttached) {
        lifecycleListenersAttached = true;
        const {
            reducedMotionQuery,
            mobileOrTouchQuery,
            reducedTransparencyQuery,
            highContrastQuery,
        } = getMediaQueries();
        reducedMotionQuery?.addEventListener?.("change", onMediaQueryChange);
        mobileOrTouchQuery?.addEventListener?.("change", onMediaQueryChange);
        reducedTransparencyQuery?.addEventListener?.("change", onMediaQueryChange);
        highContrastQuery?.addEventListener?.("change", onMediaQueryChange);
        document.addEventListener("visibilitychange", handleVisibilityChange, { passive: true });
        window.addEventListener("pageshow", handlePageShow, { passive: true });
        window.addEventListener("pagehide", handlePageHide, { passive: true });

        onWasmReady(() => {
            if (document.readyState !== "loading" && canUseSvgGlass()) {
                rebuildAllLiquidGlassFilters(configs);
            }
        });
    }

    rebuildAllLiquidGlassFilters(configs);
}

export function destroyLiquidGlass(): void {
    isEngineInitialized = false;
    if (typeof document !== "undefined" && typeof window !== "undefined" && lifecycleListenersAttached) {
        lifecycleListenersAttached = false;
        const {
            reducedMotionQuery,
            mobileOrTouchQuery,
            reducedTransparencyQuery,
            highContrastQuery,
        } = getMediaQueries();
        reducedMotionQuery?.removeEventListener?.("change", onMediaQueryChange);
        mobileOrTouchQuery?.removeEventListener?.("change", onMediaQueryChange);
        reducedTransparencyQuery?.removeEventListener?.("change", onMediaQueryChange);
        highContrastQuery?.removeEventListener?.("change", onMediaQueryChange);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        window.removeEventListener("pageshow", handlePageShow);
        window.removeEventListener("pagehide", handlePageHide);
    }
    if (typeof window !== "undefined") {
        window.removeEventListener("resize", scheduleRebuildLiquidGlass);
    }
    detachGlobalListeners();
    cleanupAllTargetStates();
    managedElements.clear();
    sharedResizeObserver?.disconnect();
    sharedResizeObserver = null;
    sharedIntersectionObserver?.disconnect();
    sharedIntersectionObserver = null;
}

export function getLiquidGlassStats(): LiquidGlassStats {
    const svgDefs = typeof document !== "undefined" ? document.getElementById("svg-defs") : null;
    const filterNodeCount = svgDefs ? svgDefs.querySelectorAll("filter").length : 0;
    const poolConsistent =
        filterNodeCount === sharedFilters.size && activeBlobUrlCount >= sharedFilters.size;

    let tierLabel: LiquidGlassStats["qualityTier"] = "T0";
    if (isGlassDowngraded) {
        tierLabel = "CSS fallback";
    } else if (qualityTier === 1) {
        tierLabel = "T1";
    } else if (qualityTier === 2) {
        tierLabel = "T2";
    }

    return {
        liveFilters: sharedFilters.size,
        filterNodeCount,
        activeBlobUrls: activeBlobUrlCount,
        poolConsistent,
        qualityTier: tierLabel,
        downgrades: qualityDowngrades,
        upgrades: qualityUpgrades,
        activeElements: activeElements.size,
        wasmReady: isWasmReady(),
    };
}

export { pickMapScale, buildFilterElement };
