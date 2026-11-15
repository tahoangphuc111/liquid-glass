import { DEFAULT_GLASS_CONFIG } from "./config.js";
import { createLiquidGlass } from "./controller.js";
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

const LUT_DT_MIN = 0.002;
const LUT_DT_MAX = 0.034;
const LUT_SLOTS = 128;
const LUT_INV_STEP = LUT_SLOTS / (LUT_DT_MAX - LUT_DT_MIN);

const SWITCH_GLASS_OWN_OPTION_KEYS = new Set([
    "value",
    "defaultValue",
    "itemSelector",
    "gliderElement",
    "onChange",
]);

interface OscillatorPropagator {
    m00: number;
    m01: number;
    m10: number;
    m11: number;
}

interface SwitchItemAnchor {
    element: HTMLElement;
    value: string;
    left: number;
    width: number;
}

function buildOscillatorPropagator(
    stiffness: number,
    damping: number,
    dt: number,
): OscillatorPropagator {
    const alpha = damping * 0.5;
    const discriminant = stiffness - alpha * alpha;
    const decay = Math.exp(-alpha * dt);

    if (discriminant > 1e-6) {
        const omegaD = Math.sqrt(discriminant);
        const phase = omegaD * dt;
        const cosPhase = Math.cos(phase);
        const sinPhase = Math.sin(phase);
        const invOmegaD = 1 / omegaD;
        const alphaOverOmega = alpha * invOmegaD;
        const m01 = decay * (sinPhase * invOmegaD);
        return {
            m00: decay * (cosPhase + alphaOverOmega * sinPhase),
            m01,
            m10: -stiffness * m01,
            m11: decay * (cosPhase - alphaOverOmega * sinPhase),
        };
    }

    const m01 = decay * dt;
    return {
        m00: decay * (1 + alpha * dt),
        m01,
        m10: -stiffness * m01,
        m11: decay * (1 - alpha * dt),
    };
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

function computeMidpointDetent(rawPos: number, anchors: SwitchItemAnchor[]): number {
    if (anchors.length < 2) {
        return rawPos;
    }

    let segmentIndex = 0;
    for (let idx = 0; idx < anchors.length - 1; idx += 1) {
        if (rawPos >= anchors[idx]!.left) {
            segmentIndex = idx;
        }
    }

    const segmentStart = anchors[segmentIndex]!.left;
    const segmentEnd = anchors[segmentIndex + 1]!.left;
    const segmentSpan = segmentEnd - segmentStart;
    if (segmentSpan <= 0) {
        return rawPos;
    }

    const normSegment = (rawPos - segmentStart) / segmentSpan;
    if (normSegment > 0.35 && normSegment < 0.65) {
        const offsetFromMid = normSegment - 0.5;
        const offsetSquared = offsetFromMid * offsetFromMid;
        return (
            rawPos +
            offsetFromMid *
                (6.283185307 - offsetSquared * (10.33542556 - 5.1003304 * offsetSquared))
        );
    }

    return rawPos;
}

function interpolateGliderWidth(posPx: number, anchors: SwitchItemAnchor[]): number {
    if (anchors.length === 0) {
        return FALLBACK_ITEM_WIDTH_PX;
    }
    if (anchors.length === 1 || posPx <= anchors[0]!.left) {
        return anchors[0]!.width;
    }

    const lastAnchor = anchors[anchors.length - 1]!;
    if (posPx >= lastAnchor.left) {
        return lastAnchor.width;
    }

    for (let idx = 0; idx < anchors.length - 1; idx += 1) {
        const startAnchor = anchors[idx]!;
        const endAnchor = anchors[idx + 1]!;
        if (posPx >= startAnchor.left && posPx <= endAnchor.left) {
            const span = endAnchor.left - startAnchor.left;
            const fraction = span > 0 ? (posPx - startAnchor.left) / span : 0;
            return startAnchor.width + (endAnchor.width - startAnchor.width) * fraction;
        }
    }

    return lastAnchor.width;
}

function findClosestAnchorIndex(posPx: number, anchors: SwitchItemAnchor[]): number {
    if (anchors.length <= 1) {
        return 0;
    }

    let bestIndex = 0;
    let bestDistance = Math.abs(anchors[0]!.left - posPx);
    for (let idx = 1; idx < anchors.length; idx += 1) {
        const distance = Math.abs(anchors[idx]!.left - posPx);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = idx;
        }
    }
    return bestIndex;
}

export function createGlassSwitch(
    element: HTMLElement,
    options: LiquidGlassSwitchOptions = {},
): LiquidGlassSwitchInstance {
    element.classList.add("lg-switch");
    if (!element.getAttribute("role")) {
        element.setAttribute("role", "tablist");
    }

    const itemSelector =
        options.itemSelector ??
        "[data-switch-item], .lg-switch-item, button, a, [role='tab']";

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
    const baseGlassOptions = stripSwitchOwnOptions(options);
    const trackGlass: LiquidGlassInstance = createLiquidGlass(element, {
        blur: DEFAULT_GLASS_CONFIG.blur,
        ior: 1.42,
        tintOpacity: 0.08,
        highlight: 0.32,
        ...baseGlassOptions,
        pill: true,
        interactive: false,
        draggable: false,
        coalesce: false,
    });
    const gliderGlass: LiquidGlassInstance = createLiquidGlass(gliderEl, {
        blur: DEFAULT_GLASS_CONFIG.blur,
        ior: 1.66,
        thickness: 58,
        scaleRatio: 2.6,
        tintOpacity: 0.16,
        highlight: 0.46,
        ...baseGlassOptions,
        pill: true,
        interactive: false,
        draggable: false,
        coalesce: false,
    });

    const reducedMotionQuery =
        typeof window !== "undefined" && typeof window.matchMedia === "function"
            ? window.matchMedia("(prefers-reduced-motion: reduce)")
            : null;

    const propagatorLut: Array<[OscillatorPropagator, OscillatorPropagator, OscillatorPropagator, number]> =
        new Array(LUT_SLOTS + 1);
    let lastPropagatorDt = -1;
    let posProp: OscillatorPropagator = buildOscillatorPropagator(POSITION_STIFFNESS, POSITION_DAMPING, 1 / 60);
    let swellProp: OscillatorPropagator = buildOscillatorPropagator(SWELL_STIFFNESS, SWELL_DAMPING, 1 / 60);
    let wobbleProp: OscillatorPropagator = buildOscillatorPropagator(WOBBLE_STIFFNESS, WOBBLE_DAMPING, 1 / 60);
    let cachedDragDecay = Math.exp(-12 * (1 / 60));

    function syncPropagator(dt: number): void {
        if (dt === lastPropagatorDt) {
            return;
        }
        lastPropagatorDt = dt;

        if (dt >= LUT_DT_MIN && dt <= LUT_DT_MAX) {
            const slot = ((dt - LUT_DT_MIN) * LUT_INV_STEP + 0.5) | 0;
            let entry = propagatorLut[slot];
            if (!entry) {
                const quantizedDt = LUT_DT_MIN + slot / LUT_INV_STEP;
                entry = [
                    buildOscillatorPropagator(POSITION_STIFFNESS, POSITION_DAMPING, quantizedDt),
                    buildOscillatorPropagator(SWELL_STIFFNESS, SWELL_DAMPING, quantizedDt),
                    buildOscillatorPropagator(WOBBLE_STIFFNESS, WOBBLE_DAMPING, quantizedDt),
                    Math.exp(-12 * quantizedDt),
                ];
                propagatorLut[slot] = entry;
            }
            posProp = entry[0];
            swellProp = entry[1];
            wobbleProp = entry[2];
            cachedDragDecay = entry[3];
            return;
        }

        posProp = buildOscillatorPropagator(POSITION_STIFFNESS, POSITION_DAMPING, dt);
        swellProp = buildOscillatorPropagator(SWELL_STIFFNESS, SWELL_DAMPING, dt);
        wobbleProp = buildOscillatorPropagator(WOBBLE_STIFFNESS, WOBBLE_DAMPING, dt);
        cachedDragDecay = Math.exp(-12 * dt);
    }

    let anchors: SwitchItemAnchor[] = [];
    let currentIndex = 0;
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

    let rafId = 0;
    let lastFrameTime = 0;
    let isDestroyed = false;

    function measureAnchors(): void {
        const candidates = Array.from(element.querySelectorAll<HTMLElement>(itemSelector)).filter(
            (candidate) => candidate !== gliderEl && !gliderEl.contains(candidate),
        );

        if (candidates.length === 0) {
            anchors = [];
            baseOffsetLeft = CONTAINER_PADDING_PX;
            return;
        }

        const firstOffset = candidates[0]!.offsetLeft;
        const firstWidth = candidates[0]!.offsetWidth;
        const hasLayoutGeometry = candidates.some(
            (candidate) => candidate.offsetWidth > 0 || candidate.offsetLeft > 0,
        );

        baseOffsetLeft = hasLayoutGeometry ? firstOffset : CONTAINER_PADDING_PX;
        gliderEl.style.left = `${baseOffsetLeft}px`;

        anchors = candidates.map((item, index) => {
            const width =
                hasLayoutGeometry && item.offsetWidth > 0
                    ? item.offsetWidth
                    : FALLBACK_ITEM_WIDTH_PX;
            const left = hasLayoutGeometry
                ? item.offsetLeft - baseOffsetLeft
                : index * FALLBACK_ITEM_WIDTH_PX;
            return {
                element: item,
                value: resolveItemValue(item, index),
                left,
                width,
            };
        });

        if (!hasLayoutGeometry && firstWidth === 0) {
            for (let idx = 0; idx < anchors.length; idx += 1) {
                anchors[idx]!.left = idx * FALLBACK_ITEM_WIDTH_PX;
            }
        }
    }

    function getTravelSpan(): number {
        if (anchors.length < 2) {
            return anchors[0]?.width ?? FALLBACK_ITEM_WIDTH_PX;
        }
        const span = anchors[anchors.length - 1]!.left - anchors[0]!.left;
        return span > 0 ? span : anchors[0]!.width;
    }

    function syncVisualHighlight(
        visualPosX = posX,
        visualWidth = interpolateGliderWidth(posX, anchors),
        visualScaleX = 1,
        force = false,
    ): void {
        if (anchors.length === 0) {
            return;
        }

        const travelSpan = getTravelSpan();
        const firstLeft = anchors[0]!.left;
        const normalizedPos = travelSpan > 0 ? (visualPosX - firstLeft) / travelSpan : 0;
        const clampedNorm = Math.max(0, Math.min(1, normalizedPos));
        const sweepRaw = -150 + clampedNorm * 1300;
        const sweepQuant = (sweepRaw + (sweepRaw >= 0 ? 0.5 : -0.5)) | 0;

        if (force || sweepQuant !== lastSweepQuant) {
            lastSweepQuant = sweepQuant;
            element.style.setProperty("--sweep", `${(sweepQuant * 0.1).toFixed(1)}%`);
        }

        const closestIndex = findClosestAnchorIndex(visualPosX, anchors);
        if (force || closestIndex !== lastHighlightIndex) {
            lastHighlightIndex = closestIndex;
            for (let idx = 0; idx < anchors.length; idx += 1) {
                const itemEl = anchors[idx]!.element;
                const isActive = idx === closestIndex;
                itemEl.classList.toggle("active", isActive);
                itemEl.setAttribute("aria-selected", isActive ? "true" : "false");
                itemEl.setAttribute("aria-pressed", isActive ? "true" : "false");
            }
        }

        const effectiveScaleX = Math.max(0.5, visualScaleX);
        const gliderCenter = visualPosX + visualWidth * 0.5;
        const halfVisualWidth = visualWidth * effectiveScaleX * 0.5;
        const visualLeft = gliderCenter - halfVisualWidth;
        const visualRight = gliderCenter + halfVisualWidth;
        const fullVisualSpan = Math.max(1, visualRight - visualLeft);

        for (let idx = 0; idx < anchors.length; idx += 1) {
            const anchor = anchors[idx]!;
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

            anchor.element.style.setProperty("--lg-switch-coverage", coverage.toFixed(3));
            anchor.element.style.setProperty(
                "--lg-switch-hit-start",
                `${hitStartPct.toFixed(1)}%`,
            );
            anchor.element.style.setProperty(
                "--lg-switch-hit-end",
                `${hitEndPct.toFixed(1)}%`,
            );
        }
    }

    function renderGliderTransform(forceWidth = false): void {
        if (anchors.length === 0) {
            return;
        }

        const widthPx = interpolateGliderWidth(posX, anchors);
        const widthQuant = (widthPx * 10 + 0.5) | 0;
        const widthChanged = widthQuant !== lastWidthQuant;
        if (forceWidth || widthChanged) {
            lastWidthQuant = widthQuant;
            gliderEl.style.width = `${(widthQuant * 0.1).toFixed(1)}px`;
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
            gliderEl.style.transform = `translate3d(${translatePx}px, 0, 0) scale(${curSx}, ${curSy})`;
            syncVisualHighlight(tx, widthPx, scaleX, forceWidth);
            gliderGlass.refresh();
        }
    }

    function checkSettled(): boolean {
        if (isPointerDown || isDragging) {
            return false;
        }
        if (performance.now() < holdSwellUntil) {
            return false;
        }

        const isPosSettled =
            Math.abs(posX - targetPosX) < 0.2 && Math.abs(velX) < 10;
        const isSwellSettled =
            Math.abs(swell - 1.0) < 0.005 && Math.abs(velSwell) < 0.05;
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
            posX = targetPosX + posProp.m00 * dispPos + posProp.m01 * currentVel;
            velX = posProp.m10 * dispPos + posProp.m11 * currentVel;
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
        swell = desiredSwell + swellProp.m00 * dispSwell + swellProp.m01 * currentVelSwell;
        velSwell = swellProp.m10 * dispSwell + swellProp.m11 * currentVelSwell;

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
                velWobble -= WOBBLE_IMPACT_FACTOR * absVelX;
            }
        }
        prevVelX = velX;

        const dispWobble = wobble - targetWobble;
        const currentVelWobble = velWobble;
        wobble =
            targetWobble +
            wobbleProp.m00 * dispWobble +
            wobbleProp.m01 * currentVelWobble;
        velWobble = wobbleProp.m10 * dispWobble + wobbleProp.m11 * currentVelWobble;

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

        if (checkSettled()) {
            posX = targetPosX;
            velX = 0;
            swell = 1.0;
            velSwell = 0;
            wobble = 0;
            velWobble = 0;
            prevVelX = 0;
            lastP = 0;
            gliderEl.style.setProperty("--p", "0.000");
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
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerEnd);
        window.removeEventListener("pointercancel", handlePointerCancel);
        window.removeEventListener("blur", handleWindowBlur);
    }

    function handlePointerDown(event: PointerEvent): void {
        if (isDestroyed || anchors.length === 0) {
            return;
        }
        if (event.button !== 0 && event.pointerType === "mouse") {
            return;
        }

        measureAnchors();
        isPointerDown = true;
        isDragging = false;
        activePointerId = event.pointerId;
        startPointerX = event.clientX;
        lastPointerX = event.clientX;
        dragStartTime = performance.now();
        lastPointerTime = dragStartTime;
        dragAnchorX = posX;
        smoothedDragVel = 0;

        element.classList.add("is-pressed");

        if (!reducedMotionQuery?.matches) {
            targetSwell = SWELL_PEAK;
            holdSwellUntil = 0;
            wobble = -0.05;
            velWobble = -0.16;
            startLoop();
        }

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerEnd);
        window.addEventListener("pointercancel", handlePointerCancel);
        window.addEventListener("blur", handleWindowBlur);
    }

    function handlePointerMove(event: PointerEvent): void {
        if (!isPointerDown || isDestroyed) {
            return;
        }

        const deltaX = event.clientX - startPointerX;
        const now = performance.now();
        const elapsedMs = now - lastPointerTime;

        if (!isDragging && Math.abs(deltaX) > DRAG_THRESHOLD_PX) {
            isDragging = true;
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
            const rawVel = (event.clientX - lastPointerX) / elapsedMs;
            const clampedRawVel = Math.max(-3.0, Math.min(3.0, rawVel));
            smoothedDragVel = smoothedDragVel * 0.7 + clampedRawVel * 0.3;
            lastPointerX = event.clientX;
            lastPointerTime = now;
        }

        if (isDragging && anchors.length > 0) {
            let rawPos = dragAnchorX + deltaX;
            const minLeft = anchors[0]!.left;
            const maxLeft = anchors[anchors.length - 1]!.left;

            if (rawPos < minLeft) {
                rawPos = minLeft - applyRubberResistance(minLeft - rawPos);
            } else if (rawPos > maxLeft) {
                rawPos = maxLeft + applyRubberResistance(rawPos - maxLeft);
            }

            rawPos = computeMidpointDetent(rawPos, anchors);
            posX = rawPos;
            targetPosX = rawPos;
            renderGliderTransform();
        }
    }

    function releaseActivePointerCapture(): void {
        if (activePointerId < 0) {
            return;
        }
        try {
            if (element.hasPointerCapture?.(activePointerId)) {
                element.releasePointerCapture(activePointerId);
            }
        } catch {
            void 0;
        }
        activePointerId = -1;
    }

    function handlePointerEnd(event: PointerEvent): void {
        cleanupWindowPointerListeners();
        if (!isPointerDown) {
            return;
        }
        isPointerDown = false;
        element.classList.remove("is-pressed");

        if (isDragging) {
            isDragging = false;
            preventClickUntil = performance.now() + 250;
            element.classList.remove("is-dragging");
            releaseActivePointerCapture();

            const deltaX = event.clientX - startPointerX;
            const totalElapsedMs = Math.max(1, performance.now() - dragStartTime);
            const rawReleaseVel =
                Math.abs(smoothedDragVel) > 0.05
                    ? smoothedDragVel
                    : deltaX / totalElapsedMs;
            const releaseVel = Math.max(-3.0, Math.min(3.0, rawReleaseVel));

            const projectedPosX = posX + releaseVel * 1000 * 0.12;
            const nextIndex = findClosestAnchorIndex(projectedPosX, anchors);

            velX = releaseVel * 1000;
            targetSwell = 1.0;
            holdSwellUntil = 0;
            velWobble += Math.abs(releaseVel) * 0.22;

            commitActiveIndex(nextIndex, true, true, false);
        } else {
            releaseActivePointerCapture();
            targetSwell = 1.0;
            startLoop();
        }
    }

    function handlePointerCancel(): void {
        cleanupWindowPointerListeners();
        if (!isPointerDown) {
            return;
        }
        isPointerDown = false;
        isDragging = false;
        element.classList.remove("is-pressed", "is-dragging");
        releaseActivePointerCapture();

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

        const matchedIndex = anchors.findIndex(
            (anchor) =>
                anchor.element === eventTarget || anchor.element.contains(eventTarget),
        );
        if (matchedIndex === -1) {
            return;
        }

        measureAnchors();
        commitActiveIndex(matchedIndex, true, true, true);
    }

    function handleKeyDown(event: KeyboardEvent): void {
        if (anchors.length === 0) {
            return;
        }

        let targetIndex = -1;
        if (event.key === "ArrowRight") {
            targetIndex = Math.min(anchors.length - 1, currentIndex + 1);
        } else if (event.key === "ArrowLeft") {
            targetIndex = Math.max(0, currentIndex - 1);
        } else if (event.key === "Home") {
            targetIndex = 0;
        } else if (event.key === "End") {
            targetIndex = anchors.length - 1;
        }

        if (targetIndex === -1) {
            return;
        }

        event.preventDefault();
        measureAnchors();
        commitActiveIndex(targetIndex, true, true, true);
        anchors[targetIndex]?.element.focus();
    }

    measureAnchors();
    const initialWantedValue = options.value ?? options.defaultValue;
    if (initialWantedValue !== undefined) {
        const matchedInitial = anchors.findIndex(
            (anchor) => anchor.value === initialWantedValue,
        );
        currentIndex = matchedInitial >= 0 ? matchedInitial : 0;
    }

    if (anchors.length > 0) {
        posX = anchors[currentIndex]!.left;
        targetPosX = posX;
        gliderEl.style.setProperty("--p", "0.000");
        renderGliderTransform(true);
    }

    element.addEventListener("pointerdown", handlePointerDown);
    element.addEventListener("click", handleContainerClick);
    element.addEventListener("keydown", handleKeyDown);

    const resizeObserver =
        typeof ResizeObserver !== "undefined"
            ? new ResizeObserver(() => {
                  if (isDestroyed || isPointerDown) {
                      return;
                  }
                  measureAnchors();
                  if (anchors.length > 0 && !rafId) {
                      posX = anchors[currentIndex]?.left ?? 0;
                      targetPosX = posX;
                      renderGliderTransform(true);
                  }
              })
            : null;
    resizeObserver?.observe(element);

    return {
        get element(): HTMLElement {
            return element;
        },
        get engine(): GlassEngine {
            return gliderGlass.engine;
        },
        get value(): string {
            return anchors[currentIndex]?.value ?? "";
        },
        get activeIndex(): number {
            return currentIndex;
        },
        setValue(value: string, animate = true): void {
            measureAnchors();
            const foundIndex = anchors.findIndex((anchor) => anchor.value === value);
            if (foundIndex >= 0) {
                commitActiveIndex(foundIndex, animate, true, true);
            }
        },
        setActiveIndex(index: number, animate = true): void {
            measureAnchors();
            commitActiveIndex(index, animate, true, true);
        },
        update(nextOptions: Partial<LiquidGlassSwitchOptions>): void {
            if (nextOptions.onChange !== undefined) {
                onChangeCallback = nextOptions.onChange;
            }
            if (nextOptions.value !== undefined) {
                measureAnchors();
                const foundIndex = anchors.findIndex(
                    (anchor) => anchor.value === nextOptions.value,
                );
                if (foundIndex >= 0 && foundIndex !== currentIndex) {
                    commitActiveIndex(foundIndex, true, false, true);
                }
            }
            const glassPatch = stripSwitchOwnOptions(nextOptions);
            if (Object.keys(glassPatch).length > 0) {
                trackGlass.update({
                    ...glassPatch,
                    pill: true,
                    interactive: false,
                    draggable: false,
                    coalesce: false,
                });
                gliderGlass.update({
                    ...glassPatch,
                    pill: true,
                    interactive: false,
                    draggable: false,
                    coalesce: false,
                });
            }
        },
        refresh(): void {
            measureAnchors();
            if (!isPointerDown && !rafId && anchors.length > 0) {
                posX = anchors[currentIndex]?.left ?? 0;
                targetPosX = posX;
                renderGliderTransform(true);
            }
            trackGlass.refresh();
            gliderGlass.refresh();
        },
        setSceneCanvas(
            canvas: HTMLCanvasElement | null,
            sceneElement?: HTMLElement | null,
        ): void {
            trackGlass.setSceneCanvas(canvas, sceneElement);
            gliderGlass.setSceneCanvas(canvas, sceneElement);
        },
        destroy(): void {
            isDestroyed = true;
            stopLoop();
            cleanupWindowPointerListeners();
            element.removeEventListener("pointerdown", handlePointerDown);
            element.removeEventListener("click", handleContainerClick);
            element.removeEventListener("keydown", handleKeyDown);
            resizeObserver?.disconnect();
            gliderGlass.destroy();
            trackGlass.destroy();
            if (createdGlider) {
                gliderEl.remove();
            }
            element.classList.remove(
                "lg-switch",
                "is-pressed",
                "is-dragging",
                "is-animating",
            );
            element.style.removeProperty("--sweep");
            for (const anchor of anchors) {
                anchor.element.style.removeProperty("--lg-switch-coverage");
                anchor.element.style.removeProperty("--lg-switch-hit-start");
                anchor.element.style.removeProperty("--lg-switch-hit-end");
            }
        },
    };
}
