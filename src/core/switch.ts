import { mergeGlassOptions } from "./config.js";
import { createLiquidGlass, createLiquidGlassController, observeSharedElementResize } from "./controller.js";
import { buildSpringPropagator, type SpringPropagator } from "./spring.js";
import type {
    GlassEngine,
    LiquidGlassInstance,
    LiquidGlassOptions,
    LiquidGlassSwitchInstance,
    LiquidGlassSwitchOptions,
} from "./types.js";

const POSITION_STIFFNESS = 380;
const POSITION_DAMPING = 26;

const SWELL_STIFFNESS = 420;
const SWELL_DAMPING = 22;
const SWELL_PEAK = 1.14;
const INV_SWELL_SPAN = 1 / (SWELL_PEAK - 1);
const FLIGHT_SWELL_COEFF = ((SWELL_PEAK - 1) * 0.6) / 800;
const TAP_HOP_DURATION_MS = 60;

const WOBBLE_STIFFNESS = 540;
const WOBBLE_DAMPING = 16;
const WOBBLE_MAX_STRETCH = 0.2;
const WOBBLE_MAX_SQUASH = -0.12;
const WOBBLE_IMPACT_FACTOR = 0.00018;

const DRAG_THRESHOLD_PX = 4;
const RUBBER_OVERDRAG_RANGE_PX = 38;
const CONTAINER_PADDING_PX = 4;
const FALLBACK_ITEM_WIDTH_PX = 96;
const FALLBACK_ITEM_HEIGHT_PX = 40;
const DEFAULT_ITEM_SELECTOR = "[data-switch-item], .lg-switch-item, button, a, [role='tab']";

const LUT_DT_MIN = 0.002;
const LUT_DT_MAX = 0.034;
const LUT_SLOTS = 128;
const LUT_INV_STEP = LUT_SLOTS / (LUT_DT_MAX - LUT_DT_MIN);

const SWITCH_GLASS_OWN_OPTION_KEYS = new Set([
    "value",
    "defaultValue",
    "orientation",
    "itemSelector",
    "gliderElement",
    "trackOptions",
    "gliderOptions",
    "onChange",
]);

interface SwitchItemAnchor {
    element: HTMLElement;
    value: string;
    left: number;
    width: number;
    index: number;
    labelEl: HTMLElement | null;
    labelRelLeft: number;
    labelWidth: number;
    iconEl: SVGElement | null;
    iconRelLeft: number;
    iconWidth: number;
    lastCoverageQuant: number;
    lastHitStartQuant: number;
    lastHitEndQuant: number;
    lastLabelStartQuant: number;
    lastLabelEndQuant: number;
    lastIconCovQuant: number;
    lastLitState: number;
}

function buildOscillatorPropagator(
    stiffness: number,
    damping: number,
    dt: number,
): SpringPropagator {
    return buildSpringPropagator(dt, { stiffness, gamma: damping * 0.5 });
}

type SwitchPropagatorTuple = readonly [SpringPropagator, SpringPropagator, SpringPropagator, number];
const SHARED_SWITCH_PROPAGATOR_LUT: Array<SwitchPropagatorTuple | undefined> = new Array(LUT_SLOTS + 1);
const DEFAULT_SWITCH_PROPAGATOR_TUPLE: SwitchPropagatorTuple = [
    buildOscillatorPropagator(POSITION_STIFFNESS, POSITION_DAMPING, 1 / 60),
    buildOscillatorPropagator(SWELL_STIFFNESS, SWELL_DAMPING, 1 / 60),
    buildOscillatorPropagator(WOBBLE_STIFFNESS, WOBBLE_DAMPING, 1 / 60),
    Math.exp(-12 * (1 / 60)),
];

function getSharedSwitchPropagator(slot: number): SwitchPropagatorTuple {
    let entry = SHARED_SWITCH_PROPAGATOR_LUT[slot];
    if (!entry) {
        const quantizedDt = LUT_DT_MIN + slot / LUT_INV_STEP;
        entry = [
            buildOscillatorPropagator(POSITION_STIFFNESS, POSITION_DAMPING, quantizedDt),
            buildOscillatorPropagator(SWELL_STIFFNESS, SWELL_DAMPING, quantizedDt),
            buildOscillatorPropagator(WOBBLE_STIFFNESS, WOBBLE_DAMPING, quantizedDt),
            Math.exp(-12 * quantizedDt),
        ];
        SHARED_SWITCH_PROPAGATOR_LUT[slot] = entry;
    }
    return entry;
}

function applyRubberResistance(overflow: number, range = RUBBER_OVERDRAG_RANGE_PX): number {
    if (overflow <= 0) {
        return 0;
    }
    return (1 - 1 / ((overflow * 0.55) / range + 1)) * range;
}

function stripSwitchOwnOptions(
    options: Partial<LiquidGlassSwitchOptions>,
): Partial<LiquidGlassOptions> {
    const glassOptions: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(options)) {
        if (!SWITCH_GLASS_OWN_OPTION_KEYS.has(key) && entry !== undefined) {
            glassOptions[key] = entry;
        }
    }
    return glassOptions as Partial<LiquidGlassOptions>;
}

function updateGlassPart(
    instance: LiquidGlassInstance,
    previous: LiquidGlassOptions,
    next: LiquidGlassOptions,
): void {
    const patch: Partial<LiquidGlassOptions> = {};
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)] as (keyof LiquidGlassOptions)[]);
    for (const key of keys) {
        if (!Object.is(previous[key], next[key])) Object.assign(patch, { [key]: next[key] });
    }
    if (Object.keys(patch).length > 0) instance.update(patch);
}

function resolveItemValue(item: HTMLElement, index: number): string {
    const attrValue =
        item.dataset.switchValue ??
        item.dataset.value ??
        item.getAttribute("data-value");
    if (attrValue && attrValue.length > 0) {
        return attrValue;
    }
    const textValue = item.textContent?.trim();
    if (textValue && textValue.length > 0) {
        return textValue;
    }
    return String(index);
}

function findSpatialSegmentIndex(posPx: number, spatialAnchors: SwitchItemAnchor[]): number {
    if (posPx <= spatialAnchors[0]!.left) {
        return 0;
    }
    const maxSegment = spatialAnchors.length - 2;
    if (posPx >= spatialAnchors[maxSegment]!.left) {
        return maxSegment;
    }
    let low = 0;
    let high = maxSegment;
    while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (spatialAnchors[mid]!.left <= posPx) {
            low = mid;
        } else {
            high = mid - 1;
        }
    }
    return low;
}

function computeMidpointDetent(rawPos: number, spatialAnchors: SwitchItemAnchor[]): number {
    if (spatialAnchors.length < 2) {
        return rawPos;
    }

    const segmentIndex = findSpatialSegmentIndex(rawPos, spatialAnchors);
    const segmentStart = spatialAnchors[segmentIndex]!.left;
    const segmentEnd = spatialAnchors[segmentIndex + 1]!.left;
    const segmentSpan = segmentEnd - segmentStart;
    if (segmentSpan <= 0) {
        return rawPos;
    }

    const normSegment = (rawPos - segmentStart) / segmentSpan;
    if (normSegment > 0.35 && normSegment < 0.65) {
        const detentOffset = (normSegment - 0.5) / 0.15;
        const oneMinusSquared = 1 - detentOffset * detentOffset;
        const deflection = segmentSpan * 0.05 * (oneMinusSquared * oneMinusSquared) * detentOffset;
        return rawPos + deflection;
    }

    return rawPos;
}

function interpolateGliderWidth(posPx: number, spatialAnchors: SwitchItemAnchor[]): number {
    if (spatialAnchors.length === 0) {
        return FALLBACK_ITEM_WIDTH_PX;
    }
    if (spatialAnchors.length === 1 || posPx <= spatialAnchors[0]!.left) {
        return spatialAnchors[0]!.width;
    }

    const lastAnchor = spatialAnchors[spatialAnchors.length - 1]!;
    if (posPx >= lastAnchor.left) {
        return lastAnchor.width;
    }

    const segmentIndex = findSpatialSegmentIndex(posPx, spatialAnchors);
    const startAnchor = spatialAnchors[segmentIndex]!;
    const endAnchor = spatialAnchors[segmentIndex + 1]!;
    const span = endAnchor.left - startAnchor.left;
    const fraction = span > 0 ? Math.max(0, Math.min(1, (posPx - startAnchor.left) / span)) : 0;
    return startAnchor.width + (endAnchor.width - startAnchor.width) * fraction;
}

function isItemDisabled(el?: HTMLElement | null): boolean {
    if (!el) return false;
    if ((el as HTMLButtonElement).disabled === true || el.hasAttribute("disabled")) return true;
    const className = el.className;
    if (
        typeof className === "string" &&
        className.includes("disabled") &&
        (el.classList.contains("disabled") || el.classList.contains("is-disabled"))
    ) {
        return true;
    }
    return el.getAttribute("aria-disabled") === "true";
}

function findClosestAnchorIndex(
    posPx: number,
    spatialAnchors: SwitchItemAnchor[],
    anchors: SwitchItemAnchor[],
    fallbackIndex = 0,
): number {
    const count = spatialAnchors.length;
    if (count === 0) {
        return fallbackIndex;
    }
    if (count === 1) {
        const onlyAnchor = spatialAnchors[0]!;
        return !isItemDisabled(onlyAnchor.element) ? onlyAnchor.index : fallbackIndex;
    }

    let low = 0;
    let high = count;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (spatialAnchors[mid]!.left < posPx) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }

    let leftAnchor: SwitchItemAnchor | null = null;
    for (let leftCursor = low - 1; leftCursor >= 0; leftCursor -= 1) {
        const candidate = spatialAnchors[leftCursor]!;
        if (!isItemDisabled(candidate.element)) {
            leftAnchor = candidate;
            break;
        }
    }

    let rightAnchor: SwitchItemAnchor | null = null;
    for (let rightCursor = low; rightCursor < count; rightCursor += 1) {
        const candidate = spatialAnchors[rightCursor]!;
        if (!isItemDisabled(candidate.element)) {
            rightAnchor = candidate;
            break;
        }
    }

    if (leftAnchor && rightAnchor) {
        const leftDist = Math.abs(leftAnchor.left - posPx);
        const rightDist = Math.abs(rightAnchor.left - posPx);
        if (leftDist < rightDist) {
            return leftAnchor.index;
        }
        if (rightDist < leftDist) {
            return rightAnchor.index;
        }
        return leftAnchor.index <= rightAnchor.index ? leftAnchor.index : rightAnchor.index;
    }
    if (leftAnchor) {
        return leftAnchor.index;
    }
    if (rightAnchor) {
        return rightAnchor.index;
    }

    if (fallbackIndex >= 0 && fallbackIndex < anchors.length && !isItemDisabled(anchors[fallbackIndex]!.element)) {
        return fallbackIndex;
    }
    for (let idx = 0; idx < anchors.length; idx += 1) {
        if (!isItemDisabled(anchors[idx]!.element)) {
            return idx;
        }
    }
    return fallbackIndex;
}

export function createGlassSwitch(
    element: HTMLElement,
    options: LiquidGlassSwitchOptions = {},
): LiquidGlassSwitchInstance {
    element.classList.add("lg-switch");
    const assignedRole = !element.getAttribute("role");
    if (assignedRole) {
        element.setAttribute("role", "tablist");
    }

    let itemSelector = options.itemSelector ?? DEFAULT_ITEM_SELECTOR;
    let isVertical = options.orientation === "vertical";
    const syncOrientationAttribute = (): void => {
        if (isVertical) {
            element.setAttribute("data-lg-switch-orientation", "vertical");
            element.setAttribute("aria-orientation", "vertical");
        } else {
            element.removeAttribute("data-lg-switch-orientation");
            element.setAttribute("aria-orientation", "horizontal");
        }
    };
    syncOrientationAttribute();

    const existingTrack = element.querySelector<HTMLElement>(":scope > .lg-switch-track");
    const createdTrack = !existingTrack;
    const trackEl: HTMLElement = existingTrack ?? document.createElement("span");
    trackEl.classList.add("lg-switch-track");
    if (createdTrack) {
        trackEl.setAttribute("aria-hidden", "true");
        element.prepend(trackEl);
    }

    const existingGlider =
        options.gliderElement ??
        element.querySelector<HTMLElement>(":scope > .lg-switch-glider");
    const createdGlider = !existingGlider;
    const gliderEl: HTMLElement = existingGlider ?? document.createElement("span");
    gliderEl.classList.add("lg-switch-glider");
    if (createdGlider) {
        gliderEl.setAttribute("aria-hidden", "true");
        element.prepend(gliderEl);
    }

    let onChangeCallback = options.onChange;
    let userOnEngineChange = options.onEngineChange;
    let isSwitchInitialized = false;
    function syncGlassAttribute(nextEngine: GlassEngine): void {
        if (nextEngine === "css") {
            element.removeAttribute("data-lg-switch-glass");
        } else {
            element.setAttribute("data-lg-switch-glass", "1");
        }
        if (isSwitchInitialized) {
            renderGliderTransform(true);
        }
    }

    let switchOptions = options;
    const onGliderEngineChange = (nextEngine: GlassEngine): void => {
        syncGlassAttribute(nextEngine);
        userOnEngineChange?.(nextEngine);
    };

    function resolvePartOptions(glider: boolean): LiquidGlassOptions {
        const base: LiquidGlassOptions = {
            adaptiveRefraction: true,
            refractionDirection: isVertical ? "vertical" : "horizontal",
            ior: glider ? 1.48 : 1.32,
            bezel: glider ? 10 : 8,
            thickness: glider ? 28 : 20,
            scaleRatio: glider ? 2.1 : 1.05,
            maxScaleMultiplier: glider ? 2.8 : 1.8,
            tintOpacity: glider ? 0.07 : 0.06,
            highlight: glider ? 0.46 : 0.34,
            ...stripSwitchOwnOptions(switchOptions),
            blur: 0,
            pill: true,
        };
        const overrides = glider ? switchOptions.gliderOptions : switchOptions.trackOptions;
        const part = mergeGlassOptions(base, overrides ?? {});
        return {
            ...part,
            sceneElement: glider ? (part.sceneElement ?? element) : part.sceneElement,
            onEngineChange: glider ? onGliderEngineChange : undefined,
            interactive: false,
            draggable: false,
            coalesce: false,
        };
    }

    let trackOptions = resolvePartOptions(false);
    let gliderOptions = resolvePartOptions(true);
    let isGliderHighlightActive = false;
    const trackGlass: LiquidGlassInstance = createLiquidGlass(element, trackOptions);
    const gliderGlass = createLiquidGlassController(gliderEl, gliderOptions);
    if (gliderGlass.engine === "webgl") {
        gliderGlass.update({ highlight: 0 });
    }
    syncGlassAttribute(gliderGlass.engine);

    function syncGliderWebglHighlight(active: boolean): void {
        if (isGliderHighlightActive === active) return;
        isGliderHighlightActive = active;
        if (gliderGlass.engine === "webgl") {
            gliderGlass.update({ highlight: active ? (gliderOptions.highlight ?? 0.46) : 0 });
        }
    }

    const reducedMotionQuery =
        typeof window !== "undefined" && typeof window.matchMedia === "function"
            ? window.matchMedia("(prefers-reduced-motion: reduce)")
            : null;

    let lastPropagatorDt = -1;
    let lastPropagatorSlot = -1;
    let posProp: SpringPropagator = DEFAULT_SWITCH_PROPAGATOR_TUPLE[0];
    let swellProp: SpringPropagator = DEFAULT_SWITCH_PROPAGATOR_TUPLE[1];
    let wobbleProp: SpringPropagator = DEFAULT_SWITCH_PROPAGATOR_TUPLE[2];
    let cachedDragDecay = DEFAULT_SWITCH_PROPAGATOR_TUPLE[3];

    function syncPropagator(dt: number): void {
        if (dt === lastPropagatorDt) {
            return;
        }
        lastPropagatorDt = dt;

        if (dt >= LUT_DT_MIN && dt <= LUT_DT_MAX) {
            const slot = ((dt - LUT_DT_MIN) * LUT_INV_STEP + 0.5) | 0;
            if (slot === lastPropagatorSlot) {
                return;
            }
            lastPropagatorSlot = slot;
            const entry = getSharedSwitchPropagator(slot);
            posProp = entry[0];
            swellProp = entry[1];
            wobbleProp = entry[2];
            cachedDragDecay = entry[3];
            return;
        }

        lastPropagatorSlot = -1;
        posProp = buildOscillatorPropagator(POSITION_STIFFNESS, POSITION_DAMPING, dt);
        swellProp = buildOscillatorPropagator(SWELL_STIFFNESS, SWELL_DAMPING, dt);
        wobbleProp = buildOscillatorPropagator(WOBBLE_STIFFNESS, WOBBLE_DAMPING, dt);
        cachedDragDecay = Math.exp(-12 * dt);
    }

    let anchors: SwitchItemAnchor[] = [];
    let spatialAnchors: SwitchItemAnchor[] = [];
    const anchorByElement = new Map<HTMLElement, SwitchItemAnchor>();
    const anchorIndexByValue = new Map<string, number>();
    const itemResizeSubscriptions = new Map<HTMLElement, () => void>();
    let layoutRefreshRaf: number | null = null;
    let layoutChangedWhilePressed = false;
    let currentIndex = 0;
    let pendingWantedValue: string | undefined = options.value ?? options.defaultValue;
    let baseOffsetLeft = CONTAINER_PADDING_PX;

    let posX = 0;
    let velX = 0;
    let targetPosX = 0;

    let swell = 1.0;
    let velSwell = 0;
    let targetSwell = 1.0;
    let holdSwellUntil = 0;

    let wobble = 0;
    let velWobble = 0;
    let targetWobble = 0;
    let prevVelX = 0;

    let smoothedDragVel = 0;
    let lastPointerX = 0;
    let lastPointerTime = 0;

    let isPointerDown = false;
    let isDragging = false;
    let activePointerId = -1;
    let startPointerX = 0;
    let dragStartTime = 0;
    let dragAnchorX = 0;
    let preventClickUntil = 0;

    let lastP = -1;
    let lastTxQuant = -999999;
    let lastWidthQuant = -1;
    let lastSxQuant = -1;
    let lastSyQuant = -1;
    let lastSweepQuant = -999999;
    let lastHighlightIndex = -1;
    let coveredStart = 0;
    let coveredEnd = 0;
    let rightmostEdges: number[] = [];
    let maxLeftOverflow = 0;
    let cachedTravelSpan = FALLBACK_ITEM_WIDTH_PX;

    let rafId = 0;
    let lastFrameTime = 0;
    let isDestroyed = false;

    function resolveHitAnchor(target: HTMLElement | null): SwitchItemAnchor | null {
        let cursor: HTMLElement | null = target;
        while (cursor && cursor !== element) {
            const found = anchorByElement.get(cursor);
            if (found) {
                return found;
            }
            cursor = cursor.parentElement;
        }
        return null;
    }

    function measureAnchors(): void {
        const previousSelection = anchors[currentIndex]?.element;
        const rawNodeList = element.querySelectorAll<HTMLElement>(itemSelector);
        const candidateSet = new Set<HTMLElement>();
        const candidates: HTMLElement[] = [];
        let hasLayoutGeometry = false;

        for (let idx = 0; idx < rawNodeList.length; idx += 1) {
            const candidate = rawNodeList[idx]!;
            if (
                candidate === gliderEl ||
                candidate === trackEl ||
                gliderEl.contains(candidate) ||
                trackEl.contains(candidate)
            ) {
                continue;
            }
            let ancestor = candidate.parentElement;
            let isNested = false;
            while (ancestor && ancestor !== element) {
                if (candidateSet.has(ancestor)) {
                    isNested = true;
                    break;
                }
                ancestor = ancestor.parentElement;
            }
            if (isNested) continue;
            candidateSet.add(candidate);
            candidates.push(candidate);
            const extent = isVertical ? candidate.offsetHeight : candidate.offsetWidth;
            const coord = isVertical ? candidate.offsetTop : candidate.offsetLeft;
            if (!hasLayoutGeometry && (extent > 0 || coord > 0)) {
                hasLayoutGeometry = true;
            }
        }

        for (const [item, unsubscribe] of itemResizeSubscriptions) {
            if (!candidateSet.has(item)) {
                unsubscribe();
                itemResizeSubscriptions.delete(item);
            }
        }
        if (typeof ResizeObserver === "function") {
            for (const item of candidates) {
                if (!itemResizeSubscriptions.has(item)) {
                    itemResizeSubscriptions.set(item, observeSharedElementResize(item, scheduleLayoutRefresh));
                }
            }
        }

        lastHighlightIndex = -1;
        coveredStart = 0;
        coveredEnd = candidates.length;
        rightmostEdges = [];
        maxLeftOverflow = 0;

        const fallbackItemSpan = isVertical ? FALLBACK_ITEM_HEIGHT_PX : FALLBACK_ITEM_WIDTH_PX;

        if (candidates.length === 0) {
            anchorByElement.clear();
            anchorIndexByValue.clear();
            anchors = [];
            spatialAnchors = [];
            currentIndex = 0;
            targetPosX = 0;
            baseOffsetLeft = CONTAINER_PADDING_PX;
            if (isVertical) {
                gliderEl.style.left = "";
                gliderEl.style.top = `${baseOffsetLeft}px`;
            } else {
                gliderEl.style.top = "";
                gliderEl.style.left = `${baseOffsetLeft}px`;
            }
            gliderEl.style.opacity = "0";
            return;
        }

        const firstOffset = isVertical ? candidates[0]!.offsetTop : candidates[0]!.offsetLeft;
        baseOffsetLeft = hasLayoutGeometry ? firstOffset : CONTAINER_PADDING_PX;

        const nextAnchors = new Array<SwitchItemAnchor>(candidates.length);
        let firstEnabledIndex = -1;
        let isMonotonicLeft = true;
        let previousLeft = -Infinity;

        for (let idx = 0; idx < candidates.length; idx += 1) {
            const item = candidates[idx]!;
            const rawExtent = isVertical ? item.offsetHeight : item.offsetWidth;
            const rawCoord = isVertical ? item.offsetTop : item.offsetLeft;
            const width =
                hasLayoutGeometry && rawExtent > 0
                    ? rawExtent
                    : fallbackItemSpan;
            const left =
                hasLayoutGeometry
                    ? rawCoord - baseOffsetLeft
                    : idx * fallbackItemSpan;
            const resolvedLeft = left;
            const itemValue = resolveItemValue(item, idx);
            const labelEl = item.querySelector<HTMLElement>(":scope > span, span");
            const iconEl = item.querySelector<SVGElement>(":scope > svg, svg");
            let labelRelLeft = 0;
            let labelWidth = 0;
            let iconRelLeft = 0;
            let iconWidth = 0;

            if (hasLayoutGeometry && (labelEl || iconEl)) {
                const itemRect = item.getBoundingClientRect?.();
                const rectExtent = itemRect ? (isVertical ? itemRect.height : itemRect.width) : 0;
                const rectScale = rectExtent > 0 ? width / rectExtent : 1;
                if (labelEl) {
                    const labelExtent = isVertical ? labelEl.offsetHeight : labelEl.offsetWidth;
                    const labelOffsetParent = labelEl.offsetParent;
                    if (labelExtent > 0 && (labelOffsetParent === item || labelOffsetParent === null)) {
                        labelRelLeft = isVertical ? labelEl.offsetTop : labelEl.offsetLeft;
                        labelWidth = labelExtent;
                    } else if (itemRect && rectExtent > 0) {
                        const labelRect = labelEl.getBoundingClientRect?.();
                        const labelRectExtent = labelRect
                            ? isVertical
                                ? labelRect.height
                                : labelRect.width
                            : 0;
                        if (labelRect && labelRectExtent > 0) {
                            const itemOrigin = isVertical ? itemRect.top : itemRect.left;
                            const labelOrigin = isVertical ? labelRect.top : labelRect.left;
                            labelRelLeft = (labelOrigin - itemOrigin) * rectScale;
                            labelWidth = labelRectExtent * rectScale;
                        }
                    }
                }
                if (iconEl && itemRect && rectExtent > 0) {
                    const iconRect = iconEl.getBoundingClientRect?.();
                    const iconRectExtent = iconRect
                        ? isVertical
                            ? iconRect.height
                            : iconRect.width
                        : 0;
                    if (iconRect && iconRectExtent > 0) {
                        const itemOrigin = isVertical ? itemRect.top : itemRect.left;
                        const iconOrigin = isVertical ? iconRect.top : iconRect.left;
                        iconRelLeft = (iconOrigin - itemOrigin) * rectScale;
                        iconWidth = iconRectExtent * rectScale;
                    }
                }
            }

            const prevAnchor = anchorByElement.get(item);
            const sameLabelEl = prevAnchor !== undefined && prevAnchor.labelEl === labelEl;
            const sameIconEl = prevAnchor !== undefined && prevAnchor.iconEl === iconEl;
            const anchor: SwitchItemAnchor = {
                element: item,
                value: itemValue,
                left: resolvedLeft,
                width,
                index: idx,
                labelEl,
                labelRelLeft,
                labelWidth,
                iconEl,
                iconRelLeft,
                iconWidth,
                lastCoverageQuant: prevAnchor ? prevAnchor.lastCoverageQuant : -1,
                lastHitStartQuant: prevAnchor ? prevAnchor.lastHitStartQuant : -1,
                lastHitEndQuant: prevAnchor ? prevAnchor.lastHitEndQuant : -1,
                lastLabelStartQuant: sameLabelEl ? prevAnchor.lastLabelStartQuant : -1,
                lastLabelEndQuant: sameLabelEl ? prevAnchor.lastLabelEndQuant : -1,
                lastIconCovQuant: sameIconEl ? prevAnchor.lastIconCovQuant : -1,
                lastLitState: prevAnchor ? prevAnchor.lastLitState : -1,
            };
            nextAnchors[idx] = anchor;
            if (firstEnabledIndex === -1 && !isItemDisabled(item)) {
                firstEnabledIndex = idx;
            }
            if (resolvedLeft < previousLeft) {
                isMonotonicLeft = false;
            }
            previousLeft = resolvedLeft;
        }

        gliderEl.style.opacity = "";
        if (isVertical) {
            gliderEl.style.left = "";
            gliderEl.style.top = `${baseOffsetLeft}px`;
        } else {
            gliderEl.style.top = "";
            gliderEl.style.left = `${baseOffsetLeft}px`;
        }

        anchorByElement.clear();
        anchorIndexByValue.clear();
        for (let idx = 0; idx < nextAnchors.length; idx += 1) {
            const anchor = nextAnchors[idx]!;
            anchorByElement.set(anchor.element, anchor);
            if (!anchorIndexByValue.has(anchor.value)) {
                anchorIndexByValue.set(anchor.value, idx);
            }
        }

        anchors = nextAnchors;

        const previousIndex = previousSelection ? anchorByElement.get(previousSelection)?.index : undefined;
        currentIndex = previousIndex ?? Math.min(currentIndex, anchors.length - 1);

        if (pendingWantedValue !== undefined) {
            const match = anchorIndexByValue.get(pendingWantedValue);
            if (match !== undefined && !isItemDisabled(anchors[match]!.element)) {
                currentIndex = match;
                pendingWantedValue = undefined;
            }
        }

        if (isItemDisabled(anchors[currentIndex]!.element) && firstEnabledIndex >= 0) {
            currentIndex = firstEnabledIndex;
        }

        spatialAnchors = isMonotonicLeft
            ? anchors
            : [...anchors].sort((first, second) => first.left - second.left);
        if (spatialAnchors.length < 2) {
            cachedTravelSpan = spatialAnchors[0]?.width ?? FALLBACK_ITEM_WIDTH_PX;
        } else {
            const span = spatialAnchors[spatialAnchors.length - 1]!.left - spatialAnchors[0]!.left;
            cachedTravelSpan = span > 0 ? span : spatialAnchors[0]!.width;
        }
        if (spatialAnchors.length > 8) {
            let rightmost = -Infinity;
            for (const anchor of spatialAnchors) {
                maxLeftOverflow = Math.max(maxLeftOverflow, -anchor.labelRelLeft, -anchor.iconRelLeft);
                rightmost = Math.max(
                    rightmost,
                    anchor.left + Math.max(
                        anchor.width,
                        anchor.labelRelLeft + anchor.labelWidth,
                        anchor.iconRelLeft + anchor.iconWidth,
                    ),
                );
                rightmostEdges.push(rightmost);
            }
        }
    }

    function getTravelSpan(): number {
        return cachedTravelSpan;
    }

    function setHighlightSelection(anchor: SwitchItemAnchor | undefined, active: boolean): void {
        if (!anchor) return;
        const item = anchor.element;
        item.classList.toggle("active", active);
        item.setAttribute("aria-selected", active ? "true" : "false");
        item.setAttribute("aria-pressed", active ? "true" : "false");
    }

    function syncVisualHighlight(
        visualPosX = posX,
        visualWidth = interpolateGliderWidth(posX, spatialAnchors),
        visualScaleX = 1,
        force = false,
    ): void {
        if (anchors.length === 0 || spatialAnchors.length === 0) {
            return;
        }

        const travelSpan = getTravelSpan();
        const firstLeft = spatialAnchors[0]!.left;
        const normalizedPos = travelSpan > 0 ? (visualPosX - firstLeft) / travelSpan : 0;
        const clampedNorm = Math.max(0, Math.min(1, normalizedPos));
        const sweepRaw = -150 + clampedNorm * 1300;
        const sweepQuant = (sweepRaw + (sweepRaw >= 0 ? 0.5 : -0.5)) | 0;

        if (force || sweepQuant !== lastSweepQuant) {
            lastSweepQuant = sweepQuant;
            element.style.setProperty("--sweep", `${(sweepQuant * 0.1).toFixed(1)}%`);
        }

        const closestIndex = findClosestAnchorIndex(visualPosX, spatialAnchors, anchors, currentIndex);
        if (lastHighlightIndex === -1) {
            for (let idx = 0; idx < anchors.length; idx += 1) {
                setHighlightSelection(anchors[idx], idx === closestIndex);
            }
        } else if (closestIndex !== lastHighlightIndex) {
            setHighlightSelection(anchors[lastHighlightIndex], false);
            setHighlightSelection(anchors[closestIndex], true);
        }
        lastHighlightIndex = closestIndex;

        const hasLiquidGlass = gliderGlass.engine !== "css";
        const effectiveScaleX = Math.max(0.5, visualScaleX);
        const gliderCenter = visualPosX + visualWidth * 0.5;
        const halfVisualWidth = visualWidth * effectiveScaleX * 0.5;
        const visualLeft = gliderCenter - halfVisualWidth;
        const visualRight = gliderCenter + halfVisualWidth;
        const fullVisualSpan = Math.max(1, visualRight - visualLeft);
        const lensCapInset = Math.min(fullVisualSpan * 0.14, 7);
        const lensLeft = Math.min(gliderCenter, visualLeft + lensCapInset);
        const lensRight = Math.max(gliderCenter, visualRight - lensCapInset);

        let first = 0;
        let end = spatialAnchors.length;
        if (rightmostEdges.length > 0) {
            let low = 0;
            let high = rightmostEdges.length;
            while (low < high) {
                const mid = (low + high) >> 1;
                if (rightmostEdges[mid]! <= visualLeft) low = mid + 1;
                else high = mid;
            }
            first = low;
            high = spatialAnchors.length;
            while (low < high) {
                const mid = (low + high) >> 1;
                if (spatialAnchors[mid]!.left < visualRight + maxLeftOverflow) low = mid + 1;
                else high = mid;
            }
            end = low;
        }
        const repaintFirst = force ? 0 : Math.min(first, coveredStart);
        const repaintEnd = force ? spatialAnchors.length : Math.max(end, coveredEnd);
        const gapStart = Math.min(end, coveredEnd);
        const gapEnd = Math.max(first, coveredStart);
        coveredStart = first;
        coveredEnd = end;
        for (let idx = repaintFirst; idx < repaintEnd; idx += 1) {
            if (!force && idx === gapStart && gapEnd > gapStart) idx = gapEnd;
            if (idx >= repaintEnd) break;
            const anchor = spatialAnchors[idx]!;
            const itemLeft = anchor.left;
            const itemRight = anchor.left + anchor.width;
            const itemWidth = Math.max(1, anchor.width);
            const overlapStart = Math.max(itemLeft, visualLeft);
            const overlapEnd = Math.min(itemRight, visualRight);
            const overlapWidth = Math.max(0, overlapEnd - overlapStart);
            const maxOverlap = Math.min(itemWidth, fullVisualSpan);
            const coverage = Math.max(0, Math.min(1, overlapWidth / maxOverlap));
            const hitStartPct =
                overlapWidth > 0
                    ? Math.max(
                          0,
                          Math.min(100, ((overlapStart - itemLeft) / itemWidth) * 100),
                      )
                    : 0;
            const hitEndPct =
                overlapWidth > 0
                    ? Math.max(
                          hitStartPct,
                          Math.min(100, ((overlapEnd - itemLeft) / itemWidth) * 100),
                      )
                    : 0;

            const covQuant = (coverage * 1000 + 0.5) | 0;
            const startQuant = (hitStartPct * 10 + 0.5) | 0;
            const endQuant = (hitEndPct * 10 + 0.5) | 0;
            if (force || covQuant !== anchor.lastCoverageQuant) {
                anchor.lastCoverageQuant = covQuant;
                anchor.element.style.setProperty("--lg-switch-coverage", (covQuant * 0.001).toFixed(3));
            }
            if (force || startQuant !== anchor.lastHitStartQuant) {
                anchor.lastHitStartQuant = startQuant;
                anchor.element.style.setProperty(
                    "--lg-switch-hit-start",
                    `${(startQuant * 0.1).toFixed(1)}%`,
                );
            }
            if (force || endQuant !== anchor.lastHitEndQuant) {
                anchor.lastHitEndQuant = endQuant;
                anchor.element.style.setProperty(
                    "--lg-switch-hit-end",
                    `${(endQuant * 0.1).toFixed(1)}%`,
                );
            }

            if (anchor.labelEl) {
                if (hasLiquidGlass && anchor.labelWidth > 0) {
                    const labelLeft = itemLeft + anchor.labelRelLeft;
                    const labelRight = labelLeft + anchor.labelWidth;
                    const labelOverlapStart = Math.max(labelLeft, lensLeft);
                    const labelOverlapEnd = Math.min(labelRight, lensRight);
                    const labelOverlap = Math.max(0, labelOverlapEnd - labelOverlapStart);
                    if (labelOverlap > 0.5) {
                        const labelStartPct = Math.max(
                            0,
                            Math.min(100, ((labelOverlapStart - labelLeft) / anchor.labelWidth) * 100),
                        );
                        const labelEndPct = Math.max(
                            labelStartPct,
                            Math.min(100, ((labelOverlapEnd - labelLeft) / anchor.labelWidth) * 100),
                        );
                        const lStartQuant = (labelStartPct * 10 + 0.5) | 0;
                        const lEndQuant = (labelEndPct * 10 + 0.5) | 0;
                        if (force || anchor.lastLitState !== 1) {
                            anchor.lastLitState = 1;
                            anchor.labelEl.setAttribute("data-lg-switch-lit", "1");
                        }
                        if (force || lStartQuant !== anchor.lastLabelStartQuant) {
                            anchor.lastLabelStartQuant = lStartQuant;
                            anchor.labelEl.style.setProperty(
                                "--lg-switch-label-hit-start",
                                `${(lStartQuant * 0.1).toFixed(1)}%`,
                            );
                        }
                        if (force || lEndQuant !== anchor.lastLabelEndQuant) {
                            anchor.lastLabelEndQuant = lEndQuant;
                            anchor.labelEl.style.setProperty(
                                "--lg-switch-label-hit-end",
                                `${(lEndQuant * 0.1).toFixed(1)}%`,
                            );
                        }
                    } else if (force || anchor.lastLitState !== 0) {
                        anchor.lastLitState = 0;
                        anchor.lastLabelStartQuant = 0;
                        anchor.lastLabelEndQuant = 0;
                        anchor.labelEl.removeAttribute("data-lg-switch-lit");
                        anchor.labelEl.style.setProperty("--lg-switch-label-hit-start", "0.0%");
                        anchor.labelEl.style.setProperty("--lg-switch-label-hit-end", "0.0%");
                    }
                } else if (
                    hasLiquidGlass &&
                    lensRight - lensLeft > 0.5 &&
                    Math.min(itemRight, lensRight) - Math.max(itemLeft, lensLeft) > 0.5
                ) {
                    if (force || anchor.lastLitState !== 2) {
                        anchor.lastLitState = 2;
                        anchor.lastLabelStartQuant = -1;
                        anchor.lastLabelEndQuant = -1;
                        anchor.labelEl.setAttribute("data-lg-switch-lit", "1");
                        anchor.labelEl.style.removeProperty("--lg-switch-label-hit-start");
                        anchor.labelEl.style.removeProperty("--lg-switch-label-hit-end");
                    }
                } else if (force || anchor.lastLitState !== 0) {
                    anchor.lastLitState = 0;
                    anchor.lastLabelStartQuant = 0;
                    anchor.lastLabelEndQuant = 0;
                    anchor.labelEl.removeAttribute("data-lg-switch-lit");
                    anchor.labelEl.style.setProperty("--lg-switch-label-hit-start", "0.0%");
                    anchor.labelEl.style.setProperty("--lg-switch-label-hit-end", "0.0%");
                }
            }

            if (anchor.iconEl) {
                let iconCoverage = 0;
                if (hasLiquidGlass) {
                    const rawIconRatio =
                        anchor.iconWidth > 0
                            ? Math.max(
                                  0,
                                  Math.min(
                                      1,
                                      Math.max(
                                          0,
                                          Math.min(itemLeft + anchor.iconRelLeft + anchor.iconWidth, lensRight) -
                                              Math.max(itemLeft + anchor.iconRelLeft, lensLeft),
                                      ) / anchor.iconWidth,
                                  ),
                              )
                            : coverage;
                    iconCoverage =
                        rawIconRatio <= 0.35
                            ? 0
                            : Math.max(0, Math.min(1, (rawIconRatio - 0.35) / 0.5));
                }
                const iconQuant = (iconCoverage * 1000 + 0.5) | 0;
                if (force || iconQuant !== anchor.lastIconCovQuant) {
                    anchor.lastIconCovQuant = iconQuant;
                    anchor.element.style.setProperty(
                        "--lg-switch-icon-coverage",
                        (iconQuant * 0.001).toFixed(3),
                    );
                }
            }
        }
    }

    function renderGliderTransform(forceWidth = false): void {
        if (anchors.length === 0) {
            return;
        }

        const widthPx = interpolateGliderWidth(posX, spatialAnchors);
        const widthQuant = (widthPx * 10 + 0.5) | 0;
        const widthChanged = widthQuant !== lastWidthQuant;
        if (forceWidth || widthChanged) {
            lastWidthQuant = widthQuant;
            const extentCss = `${(widthQuant * 0.1).toFixed(1)}px`;
            if (isVertical) {
                gliderEl.style.width = "";
                gliderEl.style.height = extentCss;
            } else {
                gliderEl.style.height = "";
                gliderEl.style.width = extentCss;
            }
        }

        const rawVel = isDragging ? smoothedDragVel : velX * 0.001;
        const speedMs = Math.abs(rawVel);
        const direction = rawVel > 0 ? 1 : rawVel < 0 ? -1 : 0;
        const stepSpan =
            anchors.length >= 2
                ? getTravelSpan() / Math.max(1, anchors.length - 1)
                : anchors[0]!.width;
        const lead = direction * speedMs * 0.06 * stepSpan;

        const clampedWobble = Math.max(
            WOBBLE_MAX_SQUASH,
            Math.min(WOBBLE_MAX_STRETCH, wobble),
        );
        const onePlusWobble = 1 + clampedWobble;
        const scaleX = swell * onePlusWobble;
        const scaleY = swell / onePlusWobble;

        const rawP =
            (swell - 1) * INV_SWELL_SPAN +
            (clampedWobble > 0 ? clampedWobble * 1.5 : -clampedWobble * 2.0);
        const clampedP = Math.max(0, Math.min(1, rawP));
        if (Math.abs(clampedP - lastP) >= 0.015 || (clampedP === 0 && lastP !== 0)) {
            lastP = clampedP;
            gliderEl.style.setProperty("--p", clampedP.toFixed(3));
        }

        const tx = posX + lead;
        const txQuant = (tx * 100 + (tx >= 0 ? 0.5 : -0.5)) | 0;
        const sxQuant = (scaleX * 10000 + 0.5) | 0;
        const syQuant = (scaleY * 10000 + 0.5) | 0;

        if (
            forceWidth ||
            widthChanged ||
            txQuant !== lastTxQuant ||
            sxQuant !== lastSxQuant ||
            syQuant !== lastSyQuant
        ) {
            lastTxQuant = txQuant;
            lastSxQuant = sxQuant;
            lastSyQuant = syQuant;
            const translatePx = (txQuant * 0.01).toFixed(2);
            const curSx = (sxQuant * 0.0001).toFixed(4);
            const curSy = (syQuant * 0.0001).toFixed(4);
            gliderEl.style.transform = isVertical
                ? `translate3d(0, ${translatePx}px, 0) scale(${curSy}, ${curSx})`
                : `translate3d(${translatePx}px, 0, 0) scale(${curSx}, ${curSy})`;
            syncVisualHighlight(tx, widthPx, scaleX, forceWidth);
            if (gliderGlass.engine === "webgl") {
                gliderGlass.refreshMotion();
            } else if (forceWidth || widthChanged) {
                gliderGlass.refresh();
            }
        }
    }

    function checkSettled(restingSwell: number): boolean {
        if (isDragging && !reducedMotionQuery?.matches && Math.abs(smoothedDragVel) >= 0.005) return false;
        if (performance.now() < holdSwellUntil) {
            return false;
        }

        const isPosSettled =
            Math.abs(posX - targetPosX) < 0.2 && Math.abs(velX) < 10;
        const isSwellSettled =
            Math.abs(swell - restingSwell) < 0.005 && Math.abs(velSwell) < 0.05;
        const isWobbleSettled =
            Math.abs(wobble) < 0.004 && Math.abs(velWobble) < 0.04;
        return isPosSettled && isSwellSettled && isWobbleSettled;
    }

    function stepPhysics(dt: number): void {
        if (anchors.length === 0) {
            return;
        }

        if (reducedMotionQuery?.matches) {
            const lerpFactor = Math.min(1, dt * 18);
            posX += (targetPosX - posX) * lerpFactor;
            velX = 0;
            swell = 1.0;
            velSwell = 0;
            wobble = 0;
            velWobble = 0;
            renderGliderTransform();
            return;
        }

        const clampedDt = Math.min(0.064, Math.max(0.001, dt));
        syncPropagator(clampedDt);
        const isHoldingSwell = performance.now() < holdSwellUntil;

        if (!isDragging) {
            const dispPos = posX - targetPosX;
            const currentVel = velX;
            posX = targetPosX + posProp.c00 * dispPos + posProp.c01 * currentVel;
            velX = posProp.c10 * dispPos + posProp.c11 * currentVel;
        }

        const absVelX = Math.abs(velX);
        const flightSwell =
            1 +
            (absVelX < 800
                ? absVelX * FLIGHT_SWELL_COEFF
                : (SWELL_PEAK - 1) * 0.6);
        const desiredSwell = isHoldingSwell
            ? SWELL_PEAK
            : Math.max(targetSwell, flightSwell);

        const dispSwell = swell - desiredSwell;
        const currentVelSwell = velSwell;
        swell = desiredSwell + swellProp.c00 * dispSwell + swellProp.c01 * currentVelSwell;
        velSwell = swellProp.c10 * dispSwell + swellProp.c11 * currentVelSwell;

        if (isDragging) {
            smoothedDragVel *= cachedDragDecay;
        }

        const rawVel = isDragging ? smoothedDragVel : velX * 0.001;
        const speedMs = Math.abs(rawVel);

        if (isDragging) {
            targetWobble = speedMs * 0.09;
        } else {
            targetWobble = speedMs * 0.08;
            const distToTarget = Math.abs(posX - targetPosX);
            if (
                distToTarget < 14 &&
                absVelX > 25 &&
                (velX * (targetPosX - posX) <= 0 || absVelX < Math.abs(prevVelX))
            ) {
                velWobble -= WOBBLE_IMPACT_FACTOR * absVelX * (clampedDt * 60);
            }
        }
        prevVelX = velX;

        const dispWobble = wobble - targetWobble;
        const currentVelWobble = velWobble;
        wobble =
            targetWobble +
            wobbleProp.c00 * dispWobble +
            wobbleProp.c01 * currentVelWobble;
        velWobble = wobbleProp.c10 * dispWobble + wobbleProp.c11 * currentVelWobble;

        renderGliderTransform();
    }

    function stopLoop(): void {
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = 0;
        }
        element.classList.remove("is-animating");
        gliderEl.style.willChange = "auto";
    }

    function onAnimationFrame(timestamp: number): void {
        if (isDestroyed) {
            return;
        }

        const dt =
            lastFrameTime > 0
                ? Math.min(0.064, Math.max(0.001, (timestamp - lastFrameTime) * 0.001))
                : 1 / 60;
        lastFrameTime = timestamp;

        stepPhysics(dt);

        const restingSwell = reducedMotionQuery?.matches ? 1 : targetSwell;
        if (checkSettled(restingSwell)) {
            posX = targetPosX;
            velX = 0;
            swell = restingSwell;
            velSwell = 0;
            wobble = 0;
            velWobble = 0;
            prevVelX = 0;
            if (isDragging) smoothedDragVel = 0;
            renderGliderTransform(true);
            stopLoop();
            return;
        }

        rafId = requestAnimationFrame(onAnimationFrame);
    }

    function startLoop(): void {
        if (isDestroyed) {
            return;
        }
        element.classList.add("is-animating");
        gliderEl.style.willChange = "transform";
        if (!rafId) {
            lastFrameTime = 0;
            rafId = requestAnimationFrame(onAnimationFrame);
        }
    }

    function commitActiveIndex(
        nextIndex: number,
        animate = true,
        emitChange = true,
        fromTapHop = false,
    ): void {
        if (anchors.length === 0) {
            return;
        }

        const boundedIndex = Math.max(0, Math.min(anchors.length - 1, nextIndex));
        const previousIndex = currentIndex;
        currentIndex = boundedIndex;
        pendingWantedValue = undefined;
        const targetAnchor = anchors[boundedIndex]!;
        targetPosX = targetAnchor.left;

        if (!animate || reducedMotionQuery?.matches) {
            posX = targetPosX;
            velX = 0;
            swell = 1.0;
            velSwell = 0;
            wobble = 0;
            velWobble = 0;
            renderGliderTransform(true);
            stopLoop();
        } else {
            if (fromTapHop) {
                targetSwell = 1.0;
                holdSwellUntil = performance.now() + TAP_HOP_DURATION_MS;
                velWobble += 0.18;
            }
            startLoop();
        }

        if (emitChange && boundedIndex !== previousIndex) {
            onChangeCallback?.(targetAnchor.value, boundedIndex, targetAnchor.element);
        }
    }

    function cleanupWindowPointerListeners(): void {
        if (typeof window === "undefined") {
            return;
        }
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerEnd);
        window.removeEventListener("pointercancel", handlePointerCancel);
        window.removeEventListener("blur", handleWindowBlur);
    }

    function handlePointerDown(event: PointerEvent): void {
        if (isDestroyed || isPointerDown) {
            return;
        }
        if (event.button !== 0 && event.pointerType === "mouse") {
            return;
        }

        measureAnchors();
        if (anchors.length === 0) {
            return;
        }

        const eventTarget = event.target as HTMLElement | null;
        if (eventTarget) {
            const hitAnchor = resolveHitAnchor(eventTarget);
            if (hitAnchor && isItemDisabled(hitAnchor.element)) {
                return;
            }
        }

        isPointerDown = true;
        isDragging = false;
        activePointerId = event.pointerId;
        const pointerCoord = isVertical ? event.clientY : event.clientX;
        startPointerX = pointerCoord;
        lastPointerX = pointerCoord;
        dragStartTime = performance.now();
        lastPointerTime = dragStartTime;
        dragAnchorX = posX;
        smoothedDragVel = 0;

        element.classList.add("is-pressed");
        syncGliderWebglHighlight(true);

        if (!reducedMotionQuery?.matches) {
            targetSwell = SWELL_PEAK;
            holdSwellUntil = 0;
            wobble = -0.05;
            velWobble = -0.16;
            startLoop();
        }

        window.addEventListener("pointermove", handlePointerMove, { passive: true });
        window.addEventListener("pointerup", handlePointerEnd);
        window.addEventListener("pointercancel", handlePointerCancel);
        window.addEventListener("blur", handleWindowBlur);
    }

    function handlePointerMove(event: PointerEvent): void {
        if (!isPointerDown || isDestroyed) {
            return;
        }
        if (activePointerId !== -1 && event.pointerId !== activePointerId) {
            return;
        }

        const pointerCoord = isVertical ? event.clientY : event.clientX;
        const deltaX = pointerCoord - startPointerX;
        const now = performance.now();
        const elapsedMs = now - lastPointerTime;

        if (!isDragging && Math.abs(deltaX) > DRAG_THRESHOLD_PX) {
            isDragging = true;
            velX = 0;
            element.classList.add("is-dragging");
            if (activePointerId >= 0) {
                try {
                    element.setPointerCapture(activePointerId);
                } catch {
                    void 0;
                }
            }
        }

        if (elapsedMs >= 4) {
            const rawVel = (pointerCoord - lastPointerX) / elapsedMs;
            const clampedRawVel = Math.max(-3.0, Math.min(3.0, rawVel));
            const velAlpha = 1 - Math.exp(-elapsedMs / 32);
            smoothedDragVel = smoothedDragVel + (clampedRawVel - smoothedDragVel) * velAlpha;
            lastPointerX = pointerCoord;
            lastPointerTime = now;
        }

        if (isDragging && spatialAnchors.length > 0) {
            let rawPos = dragAnchorX + deltaX;
            const minLeft = spatialAnchors[0]!.left;
            const maxLeft = spatialAnchors[spatialAnchors.length - 1]!.left;

            if (rawPos < minLeft) {
                rawPos = minLeft - applyRubberResistance(minLeft - rawPos);
            } else if (rawPos > maxLeft) {
                rawPos = maxLeft + applyRubberResistance(rawPos - maxLeft);
            }

            rawPos = computeMidpointDetent(rawPos, spatialAnchors);
            posX = rawPos;
            targetPosX = rawPos;
            renderGliderTransform();
            if (!rafId && !reducedMotionQuery?.matches) startLoop();
        }
    }

    function releaseActivePointerCapture(): void {
        if (activePointerId < 0) {
            return;
        }
        try {
            const hasCaptureFn = element.hasPointerCapture;
            if (
                typeof element.releasePointerCapture === "function" &&
                (typeof hasCaptureFn !== "function" || hasCaptureFn.call(element, activePointerId))
            ) {
                element.releasePointerCapture(activePointerId);
            }
        } catch {
            void 0;
        }
        activePointerId = -1;
    }

    function handlePointerEnd(event: PointerEvent): void {
        if (!isPointerDown) {
            return;
        }
        if (activePointerId !== -1 && event.pointerId !== activePointerId) {
            return;
        }
        cleanupWindowPointerListeners();
        isPointerDown = false;
        element.classList.remove("is-pressed");
        syncGliderWebglHighlight(false);
        if (layoutChangedWhilePressed) {
            layoutChangedWhilePressed = false;
            measureAnchors();
        }

        if (isDragging) {
            isDragging = false;
            preventClickUntil = performance.now() + 250;
            element.classList.remove("is-dragging");
            releaseActivePointerCapture();

            const now = performance.now();
            const pauseMs = Math.max(0, now - lastPointerTime);
            const pauseDecay = Math.exp(-pauseMs / 55);
            const decayedSmoothedVel = smoothedDragVel * pauseDecay;
            const pointerCoord = isVertical ? event.clientY : event.clientX;
            const deltaX = pointerCoord - startPointerX;
            const totalElapsedMs = Math.max(1, now - dragStartTime);
            const rawReleaseVel =
                Math.abs(decayedSmoothedVel) > 0.05
                    ? decayedSmoothedVel
                    : (deltaX / totalElapsedMs) * pauseDecay;
            const releaseVel = Math.max(-3.0, Math.min(3.0, rawReleaseVel));

            const projectedPosX = posX + releaseVel * 1000 * 0.12;
            const nextIndex = findClosestAnchorIndex(projectedPosX, spatialAnchors, anchors, currentIndex);

            velX = releaseVel * 1000;
            targetSwell = 1.0;
            holdSwellUntil = 0;
            velWobble += Math.abs(releaseVel) * 0.22;

            commitActiveIndex(nextIndex, true, true, false);
        } else {
            releaseActivePointerCapture();
            targetSwell = 1.0;
            targetPosX = anchors[currentIndex]?.left ?? 0;
            startLoop();
        }
    }

    function handlePointerCancel(event?: PointerEvent): void {
        if (!isPointerDown) {
            return;
        }
        if (event && activePointerId !== -1 && event.pointerId !== activePointerId) {
            return;
        }
        cleanupWindowPointerListeners();
        isPointerDown = false;
        isDragging = false;
        element.classList.remove("is-pressed", "is-dragging");
        syncGliderWebglHighlight(false);
        releaseActivePointerCapture();
        if (layoutChangedWhilePressed) {
            layoutChangedWhilePressed = false;
            measureAnchors();
        }

        targetSwell = 1.0;
        holdSwellUntil = 0;
        commitActiveIndex(currentIndex, true, false, false);
    }

    function handleWindowBlur(): void {
        handlePointerCancel();
    }

    function handleContainerClick(event: MouseEvent): void {
        if (performance.now() < preventClickUntil) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        const eventTarget = event.target as HTMLElement | null;
        if (!eventTarget) {
            return;
        }

        if (anchors.length === 0) {
            measureAnchors();
        }

        let matchedAnchor = resolveHitAnchor(eventTarget);
        if (!matchedAnchor) {
            measureAnchors();
            matchedAnchor = resolveHitAnchor(eventTarget);
        }
        if (!matchedAnchor) {
            return;
        }
        const matchedIndex = matchedAnchor.index;
        if (isItemDisabled(anchors[matchedIndex]!.element)) {
            event.preventDefault();
            return;
        }

        commitActiveIndex(matchedIndex, true, true, true);
    }

    function findEnabledAnchorIndex(startIndex: number, step: 1 | -1): number {
        for (let idx = startIndex; idx >= 0 && idx < anchors.length; idx += step) {
            if (!isItemDisabled(anchors[idx]!.element)) {
                return idx;
            }
        }
        return -1;
    }

    function handleKeyDown(event: KeyboardEvent): void {
        measureAnchors();
        if (anchors.length === 0) {
            return;
        }

        let targetIndex = -1;
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            const rtl = !isVertical && getComputedStyle(element).direction === "rtl";
            const step = (event.key === "ArrowRight") !== rtl ? 1 : -1;
            targetIndex = findEnabledAnchorIndex(currentIndex + step, step);
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            const step = event.key === "ArrowDown" ? 1 : -1;
            targetIndex = findEnabledAnchorIndex(currentIndex + step, step);
        } else if (event.key === "Home") {
            targetIndex = findEnabledAnchorIndex(0, 1);
        } else if (event.key === "End") {
            targetIndex = findEnabledAnchorIndex(anchors.length - 1, -1);
        } else if (event.key === "Enter" || event.key === " ") {
            const matched = resolveHitAnchor(event.target as HTMLElement | null);
            const tagName = (event.target as HTMLElement | null)?.tagName;
            if (
                matched &&
                tagName !== "BUTTON" &&
                tagName !== "A" &&
                tagName !== "INPUT" &&
                !isItemDisabled(matched.element)
            ) {
                targetIndex = matched.index;
            }
        }

        if (targetIndex === -1) {
            return;
        }

        event.preventDefault();
        commitActiveIndex(targetIndex, true, true, true);
        anchors[targetIndex]?.element.focus();
    }

    measureAnchors();

    isSwitchInitialized = true;
    if (anchors.length > 0) {
        posX = anchors[currentIndex]!.left;
        targetPosX = posX;
        gliderEl.style.setProperty("--p", "0.000");
        renderGliderTransform(true);
    }

    element.addEventListener("pointerdown", handlePointerDown);
    element.addEventListener("lostpointercapture", handlePointerCancel);
    element.addEventListener("click", handleContainerClick);
    element.addEventListener("keydown", handleKeyDown);

    function refreshAnchorLayout(): void {
        if (isDestroyed) return;
        if (isPointerDown) {
            layoutChangedWhilePressed = true;
            return;
        }
        measureAnchors();
        if (anchors.length === 0) return;
        targetPosX = anchors[currentIndex]!.left;
        if (!rafId) {
            posX = targetPosX;
            renderGliderTransform(true);
        }
    }

    function scheduleLayoutRefresh(): void {
        if (isDestroyed || layoutRefreshRaf !== null) return;
        layoutRefreshRaf = requestAnimationFrame(() => {
            layoutRefreshRaf = null;
            refreshAnchorLayout();
        });
    }

    const unobserveSwitchResize = observeSharedElementResize(element, scheduleLayoutRefresh);

    let switchMutationObserver: MutationObserver | null = null;
    if (typeof MutationObserver === "function") {
        const isInternalNode = (node: Node): boolean => {
            if (node === gliderEl || node === trackEl) return true;
            if (node instanceof HTMLElement) {
                return node.classList.contains("lg-switch-glider") || node.classList.contains("lg-switch-track");
            }
            return false;
        };
        const hasExternalNode = (nodes: NodeList): boolean => {
            for (let idx = 0; idx < nodes.length; idx += 1) {
                if (!isInternalNode(nodes[idx]!)) return true;
            }
            return false;
        };
        switchMutationObserver = new MutationObserver((records) => {
            if (isDestroyed) return;
            let relevant = false;
            for (const record of records) {
                if (record.type === "attributes") {
                    if (record.target !== element && !isInternalNode(record.target)) {
                        relevant = true;
                        break;
                    }
                    continue;
                }
                if (
                    record.type === "childList" &&
                    (hasExternalNode(record.addedNodes) || hasExternalNode(record.removedNodes))
                ) {
                    relevant = true;
                    break;
                }
            }
            if (relevant) refreshAnchorLayout();
        });
        switchMutationObserver.observe(element, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["disabled", "aria-disabled", "data-value", "data-switch-value", "value"],
        });
    }

    return {
        get element(): HTMLElement {
            return element;
        },
        get engine(): GlassEngine {
            return gliderGlass.engine;
        },
        get value(): string {
            return anchors[currentIndex]?.value ?? pendingWantedValue ?? "";
        },
        get activeIndex(): number {
            return currentIndex;
        },
        setValue(value: string, animate = true): void {
            if (isDestroyed) return;
            pendingWantedValue = undefined;
            measureAnchors();
            const foundIndex = anchorIndexByValue.get(value);
            if (foundIndex !== undefined) {
                if (!isItemDisabled(anchors[foundIndex]!.element)) {
                    commitActiveIndex(foundIndex, animate, true, true);
                }
            } else {
                pendingWantedValue = value;
            }
        },
        setActiveIndex(index: number, animate = true): void {
            if (isDestroyed || !Number.isFinite(index)) return;
            pendingWantedValue = undefined;
            measureAnchors();
            if (anchors.length === 0) return;
            const boundedIndex = Math.max(0, Math.min(anchors.length - 1, Math.round(index)));
            if (isItemDisabled(anchors[boundedIndex]!.element)) return;
            commitActiveIndex(boundedIndex, animate, true, true);
        },
        update(nextOptions: Partial<LiquidGlassSwitchOptions>): void {
            if (isDestroyed) return;
            switchOptions = { ...switchOptions, ...nextOptions };
            if ("onChange" in nextOptions) onChangeCallback = nextOptions.onChange;
            if ("onEngineChange" in nextOptions) userOnEngineChange = nextOptions.onEngineChange;
            if ("orientation" in nextOptions) {
                const nextVertical = nextOptions.orientation === "vertical";
                if (nextVertical !== isVertical) {
                    handlePointerCancel();
                    stopLoop();
                    isVertical = nextVertical;
                    syncOrientationAttribute();
                    lastWidthQuant = -1;
                    lastTxQuant = -999999;
                    measureAnchors();
                    if (anchors.length > 0) {
                        posX = anchors[currentIndex]?.left ?? 0;
                        targetPosX = posX;
                        velX = 0;
                        swell = targetSwell = 1;
                        velSwell = wobble = velWobble = prevVelX = 0;
                        renderGliderTransform(true);
                    }
                }
            }
            if ("itemSelector" in nextOptions) {
                const nextSelector = nextOptions.itemSelector ?? DEFAULT_ITEM_SELECTOR;
                if (nextSelector !== itemSelector) {
                    itemSelector = nextSelector;
                    refreshAnchorLayout();
                }
            }
            if ("value" in nextOptions) pendingWantedValue = undefined;
            if (nextOptions.value !== undefined) {
                measureAnchors();
                const foundIndex = anchorIndexByValue.get(nextOptions.value);
                if (foundIndex !== undefined) {
                    if (
                        !isItemDisabled(anchors[foundIndex]!.element) &&
                        (foundIndex !== currentIndex || posX !== anchors[foundIndex]!.left)
                    ) {
                        commitActiveIndex(foundIndex, true, false, true);
                    }
                } else {
                    pendingWantedValue = nextOptions.value;
                }
            }
            if (
                "orientation" in nextOptions ||
                "trackOptions" in nextOptions ||
                "gliderOptions" in nextOptions ||
                Object.keys(nextOptions).some((key) => !SWITCH_GLASS_OWN_OPTION_KEYS.has(key) && key !== "onEngineChange")
            ) {
                const nextTrack = resolvePartOptions(false);
                const nextGlider = resolvePartOptions(true);
                updateGlassPart(trackGlass, trackOptions, nextTrack);
                updateGlassPart(gliderGlass, gliderOptions, nextGlider);
                trackOptions = nextTrack;
                gliderOptions = nextGlider;
                if (gliderGlass.engine === "webgl" && !isGliderHighlightActive) {
                    gliderGlass.update({ highlight: 0 });
                }
                syncGlassAttribute(gliderGlass.engine);
            }
        },
        refresh(): void {
            if (isDestroyed) return;
            measureAnchors();
            if (!isPointerDown && anchors.length > 0) {
                targetPosX = anchors[currentIndex]?.left ?? 0;
                if (!rafId) {
                    posX = targetPosX;
                    renderGliderTransform(true);
                }
            }
            trackGlass.refresh();
            gliderGlass.refresh();
        },
        setLightTilt(horizontal: number, vertical: number): void {
            if (isDestroyed) return;
            trackGlass.setLightTilt?.(horizontal, vertical);
            gliderGlass.setLightTilt?.(horizontal, vertical);
        },
        setSceneCanvas(
            canvas: HTMLCanvasElement | null,
            sceneElement?: HTMLElement | null,
        ): void {
            if (isDestroyed) return;
            trackGlass.setSceneCanvas(canvas, sceneElement);
            gliderGlass.setSceneCanvas(
                canvas,
                sceneElement !== undefined ? (sceneElement ?? (canvas ? null : element)) : undefined,
            );
            syncGlassAttribute(gliderGlass.engine);
            renderGliderTransform(true);
        },
        destroy(): void {
            if (isDestroyed) return;
            isDestroyed = true;
            stopLoop();
            cleanupWindowPointerListeners();
            releaseActivePointerCapture();
            element.removeEventListener("pointerdown", handlePointerDown);
            element.removeEventListener("lostpointercapture", handlePointerCancel);
            element.removeEventListener("click", handleContainerClick);
            element.removeEventListener("keydown", handleKeyDown);
            unobserveSwitchResize();
            for (const unsubscribe of itemResizeSubscriptions.values()) unsubscribe();
            itemResizeSubscriptions.clear();
            if (layoutRefreshRaf !== null) cancelAnimationFrame(layoutRefreshRaf);
            switchMutationObserver?.disconnect();
            switchMutationObserver = null;
            gliderGlass.destroy();
            trackGlass.destroy();
            if (createdGlider) {
                gliderEl.remove();
            } else {
                gliderEl.style.removeProperty("--p");
                gliderEl.style.removeProperty("transform");
                gliderEl.style.removeProperty("width");
                gliderEl.style.removeProperty("height");
                gliderEl.style.removeProperty("left");
                gliderEl.style.removeProperty("top");
                gliderEl.style.removeProperty("opacity");
                gliderEl.style.removeProperty("will-change");
            }
            if (createdTrack) {
                trackEl.remove();
            }
            if (assignedRole) {
                element.removeAttribute("role");
            }
            element.removeAttribute("aria-orientation");
            element.removeAttribute("data-lg-switch-orientation");
            element.removeAttribute("data-lg-switch-glass");
            element.classList.remove(
                "lg-switch",
                "is-pressed",
                "is-dragging",
                "is-animating",
            );
            element.style.removeProperty("--sweep");
            for (const anchor of anchors) {
                anchor.element.classList.remove("active");
                anchor.element.removeAttribute("aria-selected");
                anchor.element.removeAttribute("aria-pressed");
                anchor.element.style.removeProperty("--lg-switch-coverage");
                anchor.element.style.removeProperty("--lg-switch-hit-start");
                anchor.element.style.removeProperty("--lg-switch-hit-end");
                anchor.element.style.removeProperty("--lg-switch-icon-coverage");
                if (anchor.labelEl) {
                    anchor.labelEl.removeAttribute("data-lg-switch-lit");
                    anchor.labelEl.style.removeProperty("--lg-switch-label-hit-start");
                    anchor.labelEl.style.removeProperty("--lg-switch-label-hit-end");
                }
            }
        },
    };
}
