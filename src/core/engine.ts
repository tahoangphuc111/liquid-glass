import {
    DEFAULT_GLASS_CONFIG,
    MAX_ELEMENT_DEVICE_AREA,
    MAX_TOTAL_DEVICE_AREA,
    formatCssFallbackFilter,
    formatGlassCoreFilter,
    formatGlassFilterStyle,
    parseCssCornerRadiusPx,
    parseElementGlassAttributes,
    pickMapScale,
    resolveChromaticAberration,
    resolveGlassConfig,
} from "./config.js";
import {
    activeBlobUrlCount,
    acquireSharedFilter,
    buildFilterElement,
    clearFilterElementPools,
    clearLruEvictionTimer,
    decrementActiveBlobUrlCount,
    disposeSharedFilter,
    filterArchetypeCache,
    lruUnusedFilterKeys,
    releaseSharedFilter,
    resetActiveBlobUrlCount,
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
    setDprResizeCallback,
    subscribeBatteryChanges,
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
import { resolveRefractionBezel } from "./refractionBounds.js";
import type { GlassConfig, GlassSurface, LiquidGlassStats } from "./types.js";
import { clearDisplacementCache, isWasmReady, onWasmReady, releaseCachedDisplacementBlobUrl } from "./wasm.js";

interface PremeasuredBox {
    w: number;
    h: number;
    rawRadiusStr: string;
}

export interface ElementGlassState {
    config: GlassConfig;
    sharedKey: string | null;
    pendingFilter: { record: SharedFilterRecord; meta: FilterCommitMeta } | null;
    revision: number;
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
const observedElements = new Set<HTMLElement>();
const managedElements = new Map<HTMLElement, GlassConfig>();
const controllerOwnedElements = new WeakSet<HTMLElement>();
let activeGlobalConfigs: GlassConfig[] = [DEFAULT_GLASS_CONFIG];

let currentTotalDeviceArea = 0;
let lastKnownDpr = 1;
let sharedResizeObserver: ResizeObserver | null = null;
let sharedIntersectionObserver: IntersectionObserver | null = null;
let resizeLiquidTimer: ReturnType<typeof setTimeout> | null = null;
let resizeLastScheduleTime = 0;
let cachedSvgDefs: SVGDefsElement | null = null;
let ownedSvgRoot: SVGSVGElement | null = null;
let hasWarnedMissingSvgDefs = false;
let intersectionFlushRafId: number | null = null;
let resizeFlushRafId: number | null = null;
let isEngineInitialized = false;
let lifecycleListenersAttached = false;
let unsubEngineWasmReady: (() => void) | null = null;
let unsubscribeEngineBattery: (() => void) | null = null;

const warnedAreaExceededElements = new WeakSet<HTMLElement>();
const warnedFailedElements = new WeakSet<HTMLElement>();

export function ensureSvgDefs(): SVGDefsElement | null {
    if (cachedSvgDefs && cachedSvgDefs.isConnected) return cachedSvgDefs;
    if (typeof document === "undefined") return null;

    const svgNamespace = "http://www.w3.org/2000/svg";
    let svgDefs = document.querySelector<SVGDefsElement>("svg defs#svg-defs");
    if (svgDefs) {
        cachedSvgDefs = svgDefs;
        return svgDefs;
    }
    if (document.body) {
        const svgEl = document.createElementNS(svgNamespace, "svg");
        svgEl.setAttribute("width", "0");
        svgEl.setAttribute("height", "0");
        svgEl.setAttribute("aria-hidden", "true");
        svgEl.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;overflow:hidden;pointer-events:none";
        svgDefs = document.createElementNS(svgNamespace, "defs");
        svgDefs.id = "svg-defs";
        svgEl.append(svgDefs);
        document.body.append(svgEl);
        ownedSvgRoot = svgEl;
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
            pendingFilter: null,
            revision: 0,
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
                state.appliedRadius = null;
            } else {
                const nextRadiusVal = `${config.radius}px`;
                element.style.setProperty("--lg-radius", nextRadiusVal);
                state.appliedRadius = nextRadiusVal;
            }
        }
        state.config = config;
    }
    return state;
}

export function cancelPendingCommit(state: ElementGlassState): void {
    cancelPendingFilter(state);
    if (state.compositorRefreshId != null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(state.compositorRefreshId);
        state.compositorRefreshId = null;
    }
}

function cancelPendingFilter(state: ElementGlassState): void {
    const pending = state.pendingFilter;
    if (!pending) return;
    state.pendingFilter = null;
    releaseSharedFilter(pending.record.key, pending.record);
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
        const filter = formatCssFallbackFilter(state.config.saturation);
        element.style.setProperty("--lg-filter", filter);
        state.appliedFilterVal = filter;
        element.classList.add("lg-on");
        activeElements.add(element);
    }
}

export function cleanupElementState(element: HTMLElement): void {
    const state = elementStateMap.get(element);
    if (!state) return;

    detachElementFilter(element, state);

    elementStateMap.delete(element);
    dirtyElements.delete(element);
    observedElements.delete(element);

    if (!controllerOwnedElements.has(element)) element.removeAttribute("data-lg-refraction-axis");
    sharedResizeObserver?.unobserve(element);
    sharedIntersectionObserver?.unobserve(element);
}

export function cleanupAllTargetStates(): void {
    if (intersectionFlushRafId !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(intersectionFlushRafId);
        intersectionFlushRafId = null;
    }
    if (resizeFlushRafId !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(resizeFlushRafId);
        resizeFlushRafId = null;
    }
    if (resizeLiquidTimer !== null) {
        clearTimeout(resizeLiquidTimer);
        resizeLiquidTimer = null;
    }
    clearLruEvictionTimer();

    for (const element of observedElements) {
        cleanupElementState(element);
    }
    dirtyElements.clear();

    for (const filterKey of sharedFilters.keys()) {
        disposeSharedFilter(filterKey, true);
    }
    clearLruEvictionTimer();
    for (const arch of filterArchetypeCache.values()) {
        if (arch.blobUrl) {
            if (releaseCachedDisplacementBlobUrl(arch.blobUrl)) {
                decrementActiveBlobUrlCount();
            }
            arch.blobUrl = null;
        }
    }
    filterArchetypeCache.clear();
    clearDisplacementCache();
    clearFilterElementPools();
    resetActiveBlobUrlCount();
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
    if (!observedElements.has(element)) {
        observedElements.add(element);
        sharedResizeObserver?.observe(element, { box: "border-box" });
        sharedIntersectionObserver?.observe(element);
    }
    return state;
}

export function registerControllerOwnedElement(element: HTMLElement): void {
    controllerOwnedElements.add(element);
}

export function unregisterControllerOwnedElement(element: HTMLElement): void {
    controllerOwnedElements.delete(element);
}

export function registerManagedElement(
    element: HTMLElement,
    config: GlassConfig,
): void {
    initLiquidGlass();
    managedElements.set(element, config);
    const existingState = elementStateMap.get(element);
    if (
        existingState &&
        (existingState.config.radius !== config.radius || existingState.config.pill !== config.pill)
    ) {
        existingState.cachedRadiusStr = null;
    }
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
        if (!state || !observedElements.has(element)) continue;

        const wasIntersecting = state.isIntersecting;
        state.isIntersecting = entry.isIntersecting;
        if (!enabled) continue;

        if (entry.isIntersecting) {
            if (!activeElements.has(element) && !state.pendingFilter) {
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
    saturation?: number;
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
    const activeFilterId =
        qualityTier >= 1 && record.filterIdT1 ? record.filterIdT1 : record.filterId;
    const filterVal = formatGlassFilterStyle(activeFilterId, meta.blur, qualityTier, meta.saturation);
    const filterChanged = state.appliedFilterVal !== filterVal;
    if (filterChanged) {
        element.style.setProperty("--lg-filter", filterVal);
        state.appliedFilterVal = filterVal;
        scheduleSvgBackdropRefresh(element, state, filterVal);
    }

    if (!element.classList.contains("lg-on")) {
        element.classList.add("lg-on");
    }
    if (state.config.pill) {
        if (state.appliedRadius !== null) {
            element.style.removeProperty("--lg-radius");
            state.appliedRadius = null;
        }
    } else {
        const radiusVal = `${Number(meta.radius.toFixed(2))}px`;
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

    state.lastW = meta.w;
    state.lastH = meta.h;
    activeElements.add(element);

    if (oldKey && !(reusedExisting && oldKey === record.key)) {
        releaseSharedFilter(oldKey);
    }
}

function hasBlockingGlassAncestor(element: HTMLElement): boolean {
    const parent = element.parentElement?.closest(".lg-on");
    return Boolean(parent && !(parent.classList.contains("lg-switch") && element.classList.contains("lg-switch-glider")));
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
    state.revision++;
    if (!controllerOwnedElements.has(element)) {
        element.setAttribute("data-lg-refraction-axis", config.refractionDirection ?? "all");
    }

    if (hasBlockingGlassAncestor(element)) {
        state.rejectionReason = "nested";
        detachElementFilter(element, state);
        return;
    }

    if (element.childElementCount > 0 && activeElements.size > 0) {
        const detachIfNestedChild = (activeEl: HTMLElement) => {
            if (activeEl === element) return;
            if (
                activeEl.classList.contains("lg-switch-glider") &&
                element.classList.contains("lg-switch")
            ) {
                return;
            }
            const childState = elementStateMap.get(activeEl);
            if (childState) {
                childState.rejectionReason = "nested";
                detachElementFilter(activeEl, childState);
            }
        };
        if (activeElements.size <= 4) {
            for (const activeEl of activeElements) {
                if (element.contains(activeEl)) {
                    detachIfNestedChild(activeEl);
                }
            }
        } else {
            const nestedGlass = element.querySelectorAll<HTMLElement>(".lg-on");
            for (let idx = 0; idx < nestedGlass.length; idx += 1) {
                const candidate = nestedGlass[idx]!;
                if (activeElements.has(candidate)) {
                    detachIfNestedChild(candidate);
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

    const parsedRadius = parseCssCornerRadiusPx(rawRadiusStr, w, h);

    let radius: number;
    if (config.pill) {
        radius =
            parsedRadius === null || !Number.isFinite(parsedRadius) || parsedRadius <= 0
                ? halfMinDim
                : Math.min(Math.max(parsedRadius, 0), halfMinDim);
    } else if (parsedRadius !== null && Number.isFinite(parsedRadius)) {
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
    const rasterScale = radius <= 0 ? Math.min(dpr, 0.5) : Math.min(3, Math.max(1.5, dpr + 0.5));

    const adaptive = config.adaptiveRefraction === true;
    const clampedBezel = resolveRefractionBezel(config.axis === "x" ? w : Math.min(w, h), config.bezel, adaptive);
    const hasCore = Boolean(
        config.hollow &&
            !config.axis &&
            w > clampedBezel * 2 + 8 &&
            h > clampedBezel * 2 + 8,
    );
    const coreFilter = hasCore ? formatGlassCoreFilter(config.coreFilter || undefined, config.saturation) : "";

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

    const chromaAmount = resolveChromaticAberration(config.chromaticAberration, config.abbeNumber);
    const filterTier = qualityTier === 2 || (qualityTier === 1 && chromaAmount > 0) ? qualityTier : 0;
    const newSharedKey = [
        surface, w, h, radius, clampedBezel, config.thickness, config.scaleRatio,
        config.maxScaleMultiplier, config.blur, config.ior, config.pill, config.axis,
        config.colorMatrix, rasterScale, chromaAmount, config.cornerStyle, adaptive, filterTier,
        config.refractionDirection, config.refractionEdgeFade, config.maxRefractionPx,
    ].join("|");
    const meta: FilterCommitMeta = {
        w, h, radius, deviceArea, blur: config.blur, saturation: config.saturation, clampedBezel, hasCore, coreFilter,
    };

    if (state.pendingFilter?.record.key === newSharedKey) {
        state.pendingFilter.meta = meta;
        return;
    }

    cancelPendingFilter(state);
    if (state.sharedKey === newSharedKey) {
        const record = sharedFilters.get(newSharedKey);
        if (record?.node?.isConnected) {
            commitFilter(element, state, record, meta, true);
            return;
        }
    }

    const record = acquireSharedFilter(
        { sharedKey: newSharedKey, config, w, h, radius, surface, rasterScale, halfMinDim, svgDefs },
        qualityTier,
    );
    if (!record) {
        applyCssFallback(element, state, "map_unavailable");
        return;
    }

    if (record.ready) {
        commitFilter(element, state, record, meta);
        return;
    }

    const pending = { record, meta };
    state.pendingFilter = pending;
    void (record.readyPromise ?? startMapPreload(record)).then(() => {
        if (state.pendingFilter !== pending) return;
        state.pendingFilter = null;
        if (!element.isConnected) {
            releaseSharedFilter(record.key, record);
            cleanupElementState(element);
            return;
        }
        if (sharedFilters.get(record.key) !== record || !record.node?.isConnected) {
            releaseSharedFilter(record.key, record);
            return;
        }
        if (hasBlockingGlassAncestor(element)) {
            releaseSharedFilter(record.key, record);
            state.rejectionReason = "nested";
            detachElementFilter(element, state);
            return;
        }
        if (currentTotalDeviceArea - state.deviceArea + pending.meta.deviceArea > MAX_TOTAL_DEVICE_AREA) {
            releaseSharedFilter(record.key, record);
            applyCssFallback(element, state, "over_total_budget");
            return;
        }
        commitFilter(element, state, record, pending.meta);
    });
}

export function measureElement(element: HTMLElement): PremeasuredBox {
    const state = elementStateMap.get(element);
    let w = element.offsetWidth || state?.observedW || 0;
    let h = element.offsetHeight || state?.observedH || 0;
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

    const taskCount = elementsWithConfigs.length;
    const tasks = new Array<{ element: HTMLElement; config: GlassConfig; premeasured: PremeasuredBox }>(taskCount);
    for (const { element, config } of elementsWithConfigs) registerTargetElement(element, config);
    for (let index = 0; index < taskCount; index += 1) {
        const entry = elementsWithConfigs[index]!;
        tasks[index] = {
            element: entry.element,
            config: entry.config,
            premeasured: measureElement(entry.element),
        };
    }

    if (typeof document !== "undefined" && !document.documentElement.classList.contains("liquid-glass-enabled")) {
        document.documentElement.classList.add("liquid-glass-enabled");
    }

    for (let index = 0; index < taskCount; index += 1) {
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

function resolveConfigWithElementAttributes(element: HTMLElement, baseConfig: GlassConfig): GlassConfig {
    const attrOverrides = parseElementGlassAttributes(element);
    if (!attrOverrides) {
        return baseConfig;
    }
    const resolved = resolveGlassConfig({
        surface: baseConfig.surface,
        thickness: baseConfig.thickness,
        bezel: baseConfig.bezel,
        adaptiveRefraction: baseConfig.adaptiveRefraction,
        refractionDirection: baseConfig.refractionDirection,
        refractionEdgeFade: baseConfig.refractionEdgeFade,
        maxRefractionPx: baseConfig.maxRefractionPx,
        scaleRatio: baseConfig.scaleRatio,
        maxScaleMultiplier: baseConfig.maxScaleMultiplier,
        blur: baseConfig.blur,
        saturation: baseConfig.saturation,
        ior: baseConfig.ior,
        coreFilter: baseConfig.coreFilter,
        radius: baseConfig.radius,
        cornerStyle: baseConfig.cornerStyle,
        pill: baseConfig.pill,
        hollow: baseConfig.hollow,
        alwaysOn: baseConfig.alwaysOn,
        chromaticAberration: baseConfig.chromaticAberration,
        abbeNumber: baseConfig.abbeNumber,
        ...attrOverrides,
    });
    return {
        ...baseConfig,
        ...resolved,
        selector: baseConfig.selector,
        id: `${baseConfig.id}_${resolved.id}`,
    };
}

export function rebuildAllLiquidGlassFilters(
    configs: GlassConfig[] = activeGlobalConfigs,
): void {
    if (typeof document === "undefined") return;
    if (configs !== activeGlobalConfigs) {
        activeGlobalConfigs = configs;
    }
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
    const matchedElements = new Map<HTMLElement, number>();

    for (const config of configs) {
        if (!config.selector) continue;
        const elements = document.querySelectorAll<HTMLElement>(config.selector);
        for (let index = 0; index < elements.length; index++) {
            const element = elements[index];
            if (!managedElements.has(element) && !controllerOwnedElements.has(element)) {
                const resolved = resolveConfigWithElementAttributes(element, config);
                const existingIndex = matchedElements.get(element);
                if (existingIndex !== undefined) {
                    elementsWithConfigs[existingIndex] = { element, config: resolved };
                } else {
                    matchedElements.set(element, elementsWithConfigs.length);
                    elementsWithConfigs.push({ element, config: resolved });
                }
            }
        }
    }

    for (const [element, config] of managedElements.entries()) {
        if (element.isConnected) {
            matchedElements.set(element, elementsWithConfigs.length);
            elementsWithConfigs.push({ element, config });
        } else {
            managedElements.delete(element);
        }
    }

    for (const element of observedElements) {
        if (!matchedElements.has(element)) {
            cleanupElementState(element);
        }
    }

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
        state: ElementGlassState;
        revision: number;
        premeasured: PremeasuredBox;
    }> = [];
    for (const el of dirtyElements) {
        if (!el.isConnected) {
            cleanupElementState(el);
            continue;
        }
        const state = elementStateMap.get(el);
        if (!state || !observedElements.has(el)) continue;
        scheduledTasks.push({
            el,
            state,
            revision: state.revision,
            premeasured: { ...measureElement(el) },
        });
    }
    dirtyElements.clear();

    const win = typeof window !== "undefined" ? (window as unknown as { scheduler?: { yield?: () => Promise<void> } }) : null;
    const hasSchedulerYield = Boolean(win?.scheduler && typeof win.scheduler.yield === "function");

    for (let index = 0; index < scheduledTasks.length; index++) {
        if (index > 0 && (index & 3) === 0 && hasSchedulerYield) {
            await win!.scheduler!.yield!();
            if (!isEngineInitialized || !canUseSvgGlass()) return;
        }
        const task = scheduledTasks[index];
        if (elementStateMap.get(task.el) !== task.state || task.state.revision !== task.revision ||
            dirtyElements.has(task.el)) continue;
        if (!task.el.isConnected) {
            cleanupElementState(task.el);
            continue;
        }
        try {
            rebuildLiquidGlassFilterForElement(task.el, task.state.config, task.premeasured);
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
                const w = targetElement.offsetWidth || Math.round(box?.inlineSize ?? entry.contentRect.width);
                const h = targetElement.offsetHeight || Math.round(box?.blockSize ?? entry.contentRect.height);

                if (!state.pendingFilter && state.lastW > 0 && w === state.lastW && h === state.lastH) continue;

                state.observedW = w;
                state.observedH = h;
                dirtyElements.add(targetElement);
            }
        }
    } else {
        observedElements.forEach((targetElement) => {
            if (targetElement.isConnected) {
                const state = elementStateMap.get(targetElement);
                if (!state || (!state.isIntersecting && !state.config.alwaysOn && sharedIntersectionObserver)) return;
                dirtyElements.add(targetElement);
            } else {
                cleanupElementState(targetElement);
            }
        });
    }

    if (dirtyElements.size === 0) return;

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (resizeLiquidTimer !== null) clearTimeout(resizeLiquidTimer);

    const scheduleDirtyFlushRaf = () => {
        if (resizeFlushRafId !== null) return;
        resizeFlushRafId = requestAnimationFrame(() => {
            resizeFlushRafId = null;
            void flushDirtyElements();
        });
    };

    if (now - resizeLastScheduleTime > 250) {
        resizeLastScheduleTime = now;
        scheduleDirtyFlushRaf();
    } else {
        resizeLiquidTimer = setTimeout(() => {
            resizeLiquidTimer = null;
            resizeLastScheduleTime = typeof performance !== "undefined" ? performance.now() : Date.now();
            scheduleDirtyFlushRaf();
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
    } else if (concurrency <= 4 && memory <= 4) {
        applyQualityTier(1);
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
        const rebuildAll = tier === 2 || prevTier === 2;
        let needsFlush = false;
        for (const element of observedElements) {
            const state = elementStateMap.get(element);
            if (!state || (!activeElements.has(element) && !state.pendingFilter)) continue;
            if (rebuildAll || resolveChromaticAberration(state.config.chromaticAberration, state.config.abbeNumber) > 0) {
                dirtyElements.add(element);
                needsFlush = true;
                continue;
            }
            if (!state.sharedKey) continue;
            const record = sharedFilters.get(state.sharedKey);
            if (!record) continue;
            const targetId = qualityTier >= 1 && record.filterIdT1 ? record.filterIdT1 : record.filterId;
            const blur = state.config?.blur || 0;
            const nextFilterVal = formatGlassFilterStyle(targetId, blur, qualityTier, state.config.saturation);
            if (state.appliedFilterVal !== nextFilterVal) {
                element.style.setProperty("--lg-filter", nextFilterVal);
                state.appliedFilterVal = nextFilterVal;
            }
        }
        if (needsFlush) {
            void flushDirtyElements();
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
}

export function initLiquidGlass(configs: GlassConfig[] = activeGlobalConfigs): void {
    const configsChanged = configs !== activeGlobalConfigs;
    activeGlobalConfigs = configs;
    if (typeof window === "undefined" || typeof document === "undefined") return;
    if (isEngineInitialized) {
        if (configsChanged) rebuildAllLiquidGlassFilters();
        return;
    }
    isEngineInitialized = true;

    bindGlobalEngineCallbacks();
    unsubscribeEngineBattery = subscribeBatteryChanges(rebuildAllLiquidGlassFilters);
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

        if (!isWasmReady()) {
            unsubEngineWasmReady = onWasmReady(() => {
                unsubEngineWasmReady = null;
                if (isEngineInitialized && document.readyState !== "loading" && canUseSvgGlass()) {
                    rebuildAllLiquidGlassFilters(activeGlobalConfigs);
                }
            });
        }
    }

    rebuildAllLiquidGlassFilters(activeGlobalConfigs);
}

export function destroyLiquidGlass(): void {
    isEngineInitialized = false;
    unsubEngineWasmReady?.();
    unsubEngineWasmReady = null;
    unsubscribeEngineBattery?.();
    unsubscribeEngineBattery = null;
    setTierChangeCallback(null);
    setDprResizeCallback(null);
    activeGlobalConfigs = [DEFAULT_GLASS_CONFIG];
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
    ownedSvgRoot?.remove();
    ownedSvgRoot = null;
    if (typeof document !== "undefined") document.documentElement.classList.remove("liquid-glass-enabled");
    managedElements.clear();
    sharedResizeObserver?.disconnect();
    sharedResizeObserver = null;
    sharedIntersectionObserver?.disconnect();
    sharedIntersectionObserver = null;
}

export function getLiquidGlassStats(): LiquidGlassStats {
    let filterNodeCount = 0;
    let expectedNodes = 0;
    const uniqueBlobUrls = new Set<string>();
    for (const record of sharedFilters.values()) {
        expectedNodes += record.nodeT1 ? 2 : 1;
        if (record.node?.isConnected) filterNodeCount++;
        if (record.nodeT1?.isConnected) filterNodeCount++;
        const blobUrl = record.blobUrl ?? record.archetype?.blobUrl;
        if (blobUrl) {
            uniqueBlobUrls.add(blobUrl);
        }
    }
    const poolConsistent =
        filterNodeCount === expectedNodes && activeBlobUrlCount >= uniqueBlobUrls.size;

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
