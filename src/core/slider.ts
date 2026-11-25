import { resolveGlassConfig, resolveGlassSharpness } from "./config.js";
import { createLiquidGlassController } from "./controller.js";
import { getMediaQueries, observeSharedElementResize } from "./observer.js";
import {
    acquireSharedSceneCapture,
    captureDomToCanvas,
    subscribeSceneCanvas,
    type CaptureBackdropSource,
} from "./sceneCapture.js";
import { quantizeSpringDtSeconds, stepSpring, type DampedSpringParams } from "./spring.js";
import type {
    GlassOrientation,
    LiquidGlassOptions,
    LiquidGlassSliderInstance,
    LiquidGlassSliderOptions,
    SceneCaptureController,
} from "./types.js";

const POSITION_GLIDE_SPRING: DampedSpringParams = {
    stiffness: 560,
    gamma: 22,
    settleDisplacement: 0.0005,
    settleVelocity: 0.004,
};
const POSITION_DRAG_SPRING: DampedSpringParams = {
    stiffness: 2000,
    gamma: 40,
    settleDisplacement: 0.0005,
    settleVelocity: 0.004,
};
const PRESS_DOWN_SPRING: DampedSpringParams = {
    stiffness: 680,
    gamma: 21,
    settleDisplacement: 0.002,
    settleVelocity: 0.02,
};
const PRESS_RELEASE_SPRING: DampedSpringParams = {
    stiffness: 470,
    gamma: 10,
    settleDisplacement: 0.002,
    settleVelocity: 0.02,
};
const BOUNCE_SPRING: DampedSpringParams = {
    stiffness: 440,
    gamma: 16,
    settleDisplacement: 0.04,
    settleVelocity: 0.4,
};
const DRAG_THRESHOLD_PX = 3;

function computeRangeProgress(input: HTMLInputElement): number {
    const min = input.min !== "" && Number.isFinite(Number(input.min)) ? Number(input.min) : 0;
    const max = input.max !== "" && Number.isFinite(Number(input.max)) ? Number(input.max) : 100;
    const value = input.value !== "" && Number.isFinite(Number(input.value)) ? Number(input.value) : min;
    const span = max - min;
    if (!Number.isFinite(span) || span <= 0) return 0;
    const progress = (value - min) / span;
    return Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
}

const SLIDER_OWN_OPTION_KEYS = new Set(["orientation", "onChange", "onEngineChange", "sceneElement", "sceneCanvas"]);

function stripSliderOwnOptions(
    options: Partial<LiquidGlassSliderOptions>,
): Partial<LiquidGlassOptions> {
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(options)) {
        if (!SLIDER_OWN_OPTION_KEYS.has(key)) {
            patch[key] = value;
        }
    }
    return patch as Partial<LiquidGlassOptions>;
}

function readNumericInputValue(input: HTMLInputElement): number {
    const raw = Number(input.value);
    if (Number.isFinite(raw)) return raw;
    const min = Number(input.min);
    return Number.isFinite(min) ? min : 0;
}

export function createGlassSlider(
    input: HTMLInputElement,
    options: LiquidGlassSliderOptions = {},
): LiquidGlassSliderInstance {
    const parent = input.parentNode;
    const originalAriaOrientation = input.getAttribute("aria-orientation");
    const hadNativeClass = input.classList.contains("lg-slider-native");

    const wrapper = document.createElement("div");
    wrapper.className = "lg-slider";

    const track = document.createElement("div");
    track.className = "lg-slider-track";

    const fill = document.createElement("div");
    fill.className = "lg-slider-fill";
    track.appendChild(fill);

    const thumb = document.createElement("div");
    thumb.className = "lg-slider-thumb";

    wrapper.appendChild(track);
    wrapper.appendChild(thumb);

    if (parent) {
        parent.insertBefore(wrapper, input);
    }
    input.classList.add("lg-slider-native");
    wrapper.appendChild(input);

    let requestedSceneElement: HTMLElement | null = options.sceneElement ?? null;
    let requestedSceneCanvas: HTMLCanvasElement | null = options.sceneCanvas ?? null;
    let requestedPixelRatio: number | undefined = options.pixelRatio;
    let interactiveEnabled = options.interactive !== false;
    let orientation: GlassOrientation = options.orientation === "vertical" ? "vertical" : "horizontal";
    let onChangeCallback = options.onChange;
    let onEngineChangeCallback = options.onEngineChange;
    let syncCaptureOnEngineChange: (() => void) | null = null;
    let compositeCanvas: HTMLCanvasElement | null = null;
    const compositeRange: Range | null =
        typeof document !== "undefined" ? document.createRange() : null;
    let externalCapture: SceneCaptureController | null = null;
    let unsubscribeExternal: (() => void) | null = null;
    let observedSceneCanvas: HTMLCanvasElement | null = null;
    let observedSceneSource: HTMLElement | null = null;
    let unobserveSceneSource: (() => void) | null = null;
    let externalCapturedCanvas: HTMLCanvasElement | null = null;
    let externalCapturedSource: HTMLElement | null = null;
    let sliderDestroyed = false;

    const restoreAriaOrientation = (): void => {
        if (originalAriaOrientation === null) input.removeAttribute("aria-orientation");
        else input.setAttribute("aria-orientation", originalAriaOrientation);
    };

    const syncOrientationAttr = (): void => {
        if (orientation === "vertical") {
            wrapper.setAttribute("data-lg-slider-orientation", "vertical");
            input.setAttribute("aria-orientation", "vertical");
        } else {
            wrapper.removeAttribute("data-lg-slider-orientation");
            restoreAriaOrientation();
        }
    };
    syncOrientationAttr();

    const needsCompositeScene = (): boolean =>
        Boolean(requestedSceneCanvas || requestedSceneElement);

    const ensureCompositeCanvas = (): HTMLCanvasElement => {
        if (!compositeCanvas) {
            compositeCanvas = document.createElement("canvas");
            compositeCanvas.width = 0;
            compositeCanvas.height = 0;
        }
        return compositeCanvas;
    };

    const initialComposite = needsCompositeScene();
    let glassOptions = stripSliderOwnOptions(options);
    const resolveThumbDefaults = () => {
        const useSliderDefaults = glassOptions.preset === undefined;
        return {
            pill: glassOptions.pill ?? true,
            blur: glassOptions.blur ?? (useSliderDefaults ? 0 : undefined),
            bezel: glassOptions.bezel ?? (useSliderDefaults ? 10 : undefined),
            thickness: glassOptions.thickness ?? (useSliderDefaults ? 36 : undefined),
        };
    };
    const resolveSliderSharpness = (): number => {
        const resolvedBlur = resolveGlassConfig({
            ...glassOptions,
            ...resolveThumbDefaults(),
        }).blur;
        return resolveGlassSharpness(glassOptions.sharpness, resolvedBlur);
    };
    const thumbOptions: LiquidGlassOptions = {
        ...glassOptions,
        ...resolveThumbDefaults(),
        interactive: false,
        sceneElement: initialComposite ? wrapper : (requestedSceneElement ?? wrapper),
        sceneCanvas: initialComposite ? ensureCompositeCanvas() : null,
        onEngineChange(engine) {
            syncCaptureOnEngineChange?.();
            onEngineChangeCallback?.(engine);
        },
    };

    const thumbGlass = createLiquidGlassController(thumb, thumbOptions);
    let thumbRefreshRaf: number | null = null;
    let forceThumbRefresh = false;
    let motionRaf: number | null = null;
    let lastMotionTime = 0;
    let targetProgress = computeRangeProgress(input);
    let visualProgress = targetProgress;
    let visualVelocity = 0;
    let pressAmount = 0;
    let pressVelocity = 0;
    let isPressed = false;
    let pressTarget = 0;
    let hasPointerDragged = false;
    let pointerDownX: number | null = null;
    let activePointerId: number | null = null;
    let isHorizontalRtl = false;
    let bouncePos = 0;
    let bounceVel = 0;
    let lastBounceEdge: -1 | 0 | 1 = 0;
    let lastVisualQuant = -999999;
    let lastBounceQuant = -999999;
    let lastBounceIsVert = false;
    let lastScaleXQuant = -999999;
    let lastScaleYQuant = -999999;
    let lastGlowQuant = -999999;
    let lastCompositeVisualProgress = -999999;
    let hasLastBackdropMapping = false;
    let lastBackdropRelX = 0;
    let lastBackdropRelY = 0;
    let lastBackdropWidth = 0;
    let lastBackdropHeight = 0;
    let lastBackdropSourceWidth = 0;
    let lastBackdropSourceHeight = 0;

    const { reducedMotionQuery } = getMediaQueries();
    const isMotionReduced = (): boolean => Boolean(reducedMotionQuery?.matches);
    const syncDisabledState = (): void => {
        wrapper.classList.toggle("is-disabled", Boolean(input.disabled));
    };

    const applyMotionVars = (): boolean => {
        const clampedVisual = Math.min(1, Math.max(0, visualProgress));
        const visualQuant = Math.round(clampedVisual * 10000);
        const positionChanged = visualQuant !== lastVisualQuant;
        if (positionChanged) {
            lastVisualQuant = visualQuant;
            wrapper.style.setProperty("--lg-slider-visual-progress", clampedVisual.toFixed(4));
        }
        const isVert = orientation === "vertical";
        const bounceQuant = Math.round(bouncePos * 100);
        const bounceChanged = bounceQuant !== lastBounceQuant || isVert !== lastBounceIsVert;
        if (bounceChanged) {
            lastBounceQuant = bounceQuant;
            if (isVert !== lastBounceIsVert) {
                lastBounceIsVert = isVert;
                wrapper.style.removeProperty(isVert ? "--lg-slider-bounce-x" : "--lg-slider-bounce-y");
            }
            if (isVert) {
                wrapper.style.setProperty("--lg-slider-bounce-y", `${(-bouncePos).toFixed(2)}px`);
            } else {
                wrapper.style.setProperty("--lg-slider-bounce-x", `${bouncePos.toFixed(2)}px`);
            }
        }

        const pressScaleX = 1 + pressAmount * 0.08;
        const pressScaleY = 1 + pressAmount * 0.025;
        const bounceStretch = Math.min(0.025, Math.abs(bouncePos) * 0.008);
        const glideStretch = Math.min(0.03, Math.abs(visualVelocity) * 0.008);
        const totalStretch = bounceStretch + glideStretch;
        const scaleX = Math.max(0.85, Math.min(1.18, pressScaleX + totalStretch));
        const scaleY = Math.max(0.85, Math.min(1.18, pressScaleY - totalStretch * 0.6));
        const outScaleX = isVert ? scaleY : scaleX;
        const outScaleY = isVert ? scaleX : scaleY;
        const sxQuant = Math.round(outScaleX * 10000);
        const syQuant = Math.round(outScaleY * 10000);

        const scaleXChanged = sxQuant !== lastScaleXQuant;
        const scaleYChanged = syQuant !== lastScaleYQuant;
        if (scaleXChanged) {
            lastScaleXQuant = sxQuant;
            wrapper.style.setProperty("--lg-slider-bounce-scale-x", outScaleX.toFixed(4));
        }
        if (scaleYChanged) {
            lastScaleYQuant = syQuant;
            wrapper.style.setProperty("--lg-slider-bounce-scale-y", outScaleY.toFixed(4));
        }

        const pressGlow = Math.min(0.18, Math.max(0, pressAmount) * 0.12 + totalStretch * 0.8);
        const glowQuant = pressGlow > 0.002 ? Math.round(pressGlow * 1000) : 0;
        if (glowQuant !== lastGlowQuant) {
            lastGlowQuant = glowQuant;
            if (glowQuant > 0) {
                thumb.style.setProperty("--lg-press-glow", pressGlow.toFixed(3));
            } else {
                thumb.style.removeProperty("--lg-press-glow");
            }
        }
        return positionChanged || bounceChanged || scaleXChanged || scaleYChanged;
    };

    const stopMotionLoop = (): void => {
        if (motionRaf !== null && typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(motionRaf);
        }
        motionRaf = null;
        lastMotionTime = 0;
    };

    const snapMotion = (): void => {
        stopMotionLoop();
        visualProgress = targetProgress;
        visualVelocity = 0;
        pressAmount = 0;
        pressVelocity = 0;
        bouncePos = 0;
        bounceVel = 0;
        applyMotionVars();
    };

    const tickMotion = (now: number): void => {
        motionRaf = null;
        if (sliderDestroyed) return;

        if (isMotionReduced()) {
            snapMotion();
            scheduleThumbRefresh();
            return;
        }

        const dtMs = Math.max(1, now - lastMotionTime);
        lastMotionTime = now;
        const dt = quantizeSpringDtSeconds(dtMs);

        const posStep = stepSpring(
            visualProgress,
            visualVelocity,
            targetProgress,
            dt,
            hasPointerDragged ? POSITION_DRAG_SPRING : POSITION_GLIDE_SPRING,
        );
        visualProgress = posStep.value;
        visualVelocity = posStep.velocity;

        const pressStep = stepSpring(
            pressAmount,
            pressVelocity,
            interactiveEnabled && isPressed ? pressTarget : 0,
            dt,
            isPressed ? PRESS_DOWN_SPRING : PRESS_RELEASE_SPRING,
        );
        pressAmount = pressStep.value;
        pressVelocity = pressStep.velocity;

        const bounceStep = stepSpring(bouncePos, bounceVel, 0, dt, BOUNCE_SPRING);
        bouncePos = bounceStep.value;
        bounceVel = bounceStep.velocity;

        const allSettled = posStep.settled && pressStep.settled && bounceStep.settled;
        if (applyMotionVars() && thumbGlass.engine === "webgl") thumbGlass.refreshMotion();
        const compositeThreshold = allSettled ? 0.0001 : 0.004;
        if (needsCompositeScene() && Math.abs(visualProgress - lastCompositeVisualProgress) >= compositeThreshold) {
            paintCompositeScene();
        }

        if (!allSettled && typeof requestAnimationFrame === "function") {
            motionRaf = requestAnimationFrame(tickMotion);
        } else {
            lastMotionTime = 0;
        }
    };

    const ensureMotionLoop = (): void => {
        if (sliderDestroyed || isMotionReduced() || typeof requestAnimationFrame !== "function") return;
        if (motionRaf === null) {
            lastMotionTime = performance.now();
            motionRaf = requestAnimationFrame(tickMotion);
        }
    };

    const triggerEdgeBounce = (direction: -1 | 1): void => {
        if (!interactiveEnabled || isMotionReduced() || lastBounceEdge === direction) return;
        lastBounceEdge = direction;
        bounceVel = direction * 104;
        ensureMotionLoop();
    };

    const detachExternalCapture = (): void => {
        unsubscribeExternal?.();
        unsubscribeExternal = null;
        observedSceneCanvas = null;
        unobserveSceneSource?.();
        unobserveSceneSource = null;
        observedSceneSource = null;
        externalCapture?.destroy();
        externalCapture = null;
        externalCapturedCanvas = null;
        externalCapturedSource = null;
    };

    const paintCompositeScene = (onlyIfBackdropMoved = false): void => {
        if (
            sliderDestroyed ||
            !needsCompositeScene() ||
            thumbGlass.engine !== "webgl" ||
            !compositeCanvas ||
            !compositeRange ||
            !wrapper.isConnected
        ) {
            return;
        }
        const backdropSource: CaptureBackdropSource | null = requestedSceneCanvas
            ? { canvas: requestedSceneCanvas, element: requestedSceneElement }
            : externalCapturedCanvas
              ? {
                    canvas: externalCapturedCanvas,
                    element: externalCapturedSource ?? requestedSceneElement,
                }
              : null;
        const source = backdropSource?.element;
        let hasBackdropMapping = false;
        let nextRelX = 0;
        let nextRelY = 0;
        let nextWidth = 0;
        let nextHeight = 0;
        let nextSourceWidth = 0;
        let nextSourceHeight = 0;
        if (source && source !== wrapper && source.isConnected && backdropSource.canvas.width > 0 &&
            backdropSource.canvas.height > 0) {
            const wrapperRect = wrapper.getBoundingClientRect();
            const sourceRect = source.getBoundingClientRect();
            hasBackdropMapping = true;
            nextRelX = wrapperRect.left - sourceRect.left;
            nextRelY = wrapperRect.top - sourceRect.top;
            nextWidth = wrapperRect.width;
            nextHeight = wrapperRect.height;
            nextSourceWidth = sourceRect.width;
            nextSourceHeight = sourceRect.height;
        }
        if (onlyIfBackdropMoved) {
            if (!hasBackdropMapping && !hasLastBackdropMapping) return;
            if (
                hasBackdropMapping &&
                hasLastBackdropMapping &&
                Math.abs(nextRelX - lastBackdropRelX) < 0.01 &&
                Math.abs(nextRelY - lastBackdropRelY) < 0.01 &&
                Math.abs(nextWidth - lastBackdropWidth) < 0.01 &&
                Math.abs(nextHeight - lastBackdropHeight) < 0.01 &&
                Math.abs(nextSourceWidth - lastBackdropSourceWidth) < 0.01 &&
                Math.abs(nextSourceHeight - lastBackdropSourceHeight) < 0.01
            ) {
                return;
            }
        }

        const sliderSharpness = resolveSliderSharpness();
        if (
            captureDomToCanvas(
                wrapper,
                compositeCanvas,
                compositeRange,
                requestedPixelRatio,
                9999,
                backdropSource,
                scheduleThumbRefresh,
                sliderSharpness > 0 ? sliderSharpness : undefined,
            )
        ) {
            hasLastBackdropMapping = hasBackdropMapping;
            lastBackdropRelX = nextRelX;
            lastBackdropRelY = nextRelY;
            lastBackdropWidth = nextWidth;
            lastBackdropHeight = nextHeight;
            lastBackdropSourceWidth = nextSourceWidth;
            lastBackdropSourceHeight = nextSourceHeight;
            lastCompositeVisualProgress = visualProgress;
            thumbGlass.refreshMotion(true);
        }
    };

    const syncExternalCapture = (): void => {
        if (sliderDestroyed || !needsCompositeScene() || thumbGlass.engine !== "webgl") {
            detachExternalCapture();
            return;
        }
        if (requestedSceneCanvas) {
            if (observedSceneCanvas !== requestedSceneCanvas) {
                detachExternalCapture();
                observedSceneCanvas = requestedSceneCanvas;
                unsubscribeExternal = subscribeSceneCanvas(requestedSceneCanvas, () => paintCompositeScene());
            }
            if (observedSceneSource !== requestedSceneElement) {
                unobserveSceneSource?.();
                observedSceneSource = requestedSceneElement;
                unobserveSceneSource = observedSceneSource && observeSharedElementResize(
                    observedSceneSource,
                    () => scheduleThumbRefresh(false),
                );
            }
            paintCompositeScene();
            return;
        }
        if (!requestedSceneElement || requestedSceneElement === wrapper) {
            detachExternalCapture();
            paintCompositeScene();
            return;
        }
        if (externalCapture?.source !== requestedSceneElement) {
            detachExternalCapture();
            externalCapture = acquireSharedSceneCapture(requestedSceneElement, () => {
                const sliderSharpness = resolveSliderSharpness();
                return {
                    pixelRatio: requestedPixelRatio,
                    radius: 9999,
                    ...(sliderSharpness > 0 ? { sharpness: sliderSharpness } : {}),
                };
            });
            unsubscribeExternal = externalCapture.subscribe((canvas, source) => {
                externalCapturedCanvas = canvas;
                externalCapturedSource = source;
                paintCompositeScene();
            });
            if (externalCapturedCanvas) return;
        }
        paintCompositeScene();
    };
    syncCaptureOnEngineChange = syncExternalCapture;

    const scheduleThumbRefresh = (force = true): void => {
        if (sliderDestroyed || typeof requestAnimationFrame !== "function") return;
        forceThumbRefresh ||= force;
        if (thumbRefreshRaf !== null) return;
        thumbRefreshRaf = requestAnimationFrame(() => {
            thumbRefreshRaf = null;
            const force = forceThumbRefresh;
            forceThumbRefresh = false;
            if (sliderDestroyed) return;
            paintCompositeScene(!force);
            if (force) thumbGlass.refresh();
        });
    };

    const syncProgress = (animate = true): void => {
        syncDisabledState();
        if (input.disabled && isPressed) onPointerUp();
        const progress = computeRangeProgress(input);
        const needsProgressWrite = progress !== targetProgress || !wrapper.style.getPropertyValue("--lg-slider-progress");
        targetProgress = progress;
        if (needsProgressWrite) wrapper.style.setProperty("--lg-slider-progress", progress.toFixed(4));

        if (progress > 0 && progress < 1) {
            lastBounceEdge = 0;
        }

        if (!animate || isMotionReduced() || typeof requestAnimationFrame !== "function") {
            snapMotion();
            if (animate) scheduleThumbRefresh();
            return;
        }

        if (Math.abs(targetProgress - visualProgress) > 0.0005 || Math.abs(visualVelocity) > 0.004) {
            ensureMotionLoop();
        }
    };

    let lastEmittedValue = readNumericInputValue(input);
    let lastEventWasInput = false;

    const onInput = (event: Event): void => {
        if (sliderDestroyed) return;
        syncProgress();
        const numericValue = readNumericInputValue(input);
        const isChangeEvent = event.type === "change";
        if (!isChangeEvent || !lastEventWasInput || numericValue !== lastEmittedValue) {
            lastEmittedValue = numericValue;
            onChangeCallback?.(numericValue, input);
        }
        lastEventWasInput = !isChangeEvent;
        if (motionRaf === null) scheduleThumbRefresh();
    };

    let cachedDragRect: DOMRect | null = null;
    let dragWindowListenersAttached = false;

    const attachDragWindowListeners = (): void => {
        if (dragWindowListenersAttached || typeof window === "undefined") return;
        dragWindowListenersAttached = true;
        window.addEventListener("pointermove", onPointerMove, { passive: true });
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerUp);
        window.addEventListener("blur", onPointerUp);
    };

    const detachDragWindowListeners = (): void => {
        if (!dragWindowListenersAttached || typeof window === "undefined") return;
        dragWindowListenersAttached = false;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
        window.removeEventListener("blur", onPointerUp);
    };

    const onPointerDown = (event: PointerEvent): void => {
        if (sliderDestroyed || input.disabled) return;
        if ("pointerType" in event && event.pointerType === "mouse" && event.button !== 0) return;
        if (activePointerId !== null) return;
        if ("pointerId" in event && typeof event.pointerId === "number") {
            activePointerId = event.pointerId;
        }
        isPressed = true;
        pressTarget = event.pointerType === "touch" || event.pointerType === "pen" ? 1 : 0.7;
        hasPointerDragged = false;
        lastBounceEdge = 0;
        cachedDragRect = null;
        attachDragWindowListeners();
        isHorizontalRtl = orientation === "horizontal" && getComputedStyle(input).direction === "rtl";
        const coord =
            orientation === "vertical"
                ? ("clientY" in event && typeof event.clientY === "number" ? event.clientY : null)
                : ("clientX" in event && typeof event.clientX === "number" ? event.clientX : null);
        pointerDownX = coord;
        wrapper.classList.add("is-active");
        if (interactiveEnabled) {
            ensureMotionLoop();
        }
        scheduleThumbRefresh();
    };

    const onPointerMove = (event: PointerEvent): void => {
        if (sliderDestroyed || !isPressed) return;
        if (activePointerId !== null && "pointerId" in event && event.pointerId !== activePointerId) {
            return;
        }
        const coord =
            orientation === "vertical"
                ? ("clientY" in event && typeof event.clientY === "number" ? event.clientY : null)
                : ("clientX" in event && typeof event.clientX === "number" ? event.clientX : null);
        if (coord === null) return;
        if (pointerDownX !== null && Math.abs(coord - pointerDownX) > DRAG_THRESHOLD_PX) {
            hasPointerDragged = true;
        }
        if (!hasPointerDragged || (targetProgress > 0 && targetProgress < 1)) {
            return;
        }
        const rect = cachedDragRect ?? (cachedDragRect = wrapper.getBoundingClientRect());
        if (orientation === "vertical") {
            if (rect.height <= 0) return;
            if (coord >= rect.bottom && targetProgress <= 0) {
                triggerEdgeBounce(-1);
            } else if (coord <= rect.top && targetProgress >= 1) {
                triggerEdgeBounce(1);
            }
            return;
        }
        if (rect.width <= 0) return;
        const beyondStart = isHorizontalRtl ? coord >= rect.right : coord <= rect.left;
        const beyondEnd = isHorizontalRtl ? coord <= rect.left : coord >= rect.right;
        if (beyondStart && targetProgress <= 0) {
            triggerEdgeBounce(-1);
        } else if (beyondEnd && targetProgress >= 1) {
            triggerEdgeBounce(1);
        }
    };

    const onPointerUp = (event?: Event): void => {
        if (sliderDestroyed) return;
        if (event && "pointerId" in event) {
            const pointerEvent = event as PointerEvent;
            if (
                typeof pointerEvent.pointerId === "number" &&
                activePointerId !== null &&
                pointerEvent.pointerId !== activePointerId
            ) {
                return;
            }
        }
        activePointerId = null;
        cachedDragRect = null;
        detachDragWindowListeners();
        if (!isPressed && !wrapper.classList.contains("is-active")) return;
        const wasPressed = isPressed;
        isPressed = false;
        hasPointerDragged = false;
        pointerDownX = null;
        wrapper.classList.remove("is-active");
        if (interactiveEnabled && wasPressed && !isMotionReduced()) {
            if (event?.type === "pointerup" && pressAmount < pressTarget * 0.4) {
                pressVelocity = Math.max(pressVelocity, pressTarget * 9);
            }
            ensureMotionLoop();
        }
        scheduleThumbRefresh();
    };

    const onLayoutChange = (): void => {
        cachedDragRect = null;
        scheduleThumbRefresh();
    };
    const onReducedMotionChange = (): void => {
        if (isMotionReduced()) syncProgress();
    };
    const onScroll = (): void => {
        cachedDragRect = null;
        if (thumbGlass.engine === "webgl" && requestedSceneElement && requestedSceneElement !== wrapper) {
            scheduleThumbRefresh(false);
        }
    };
    const syncInputAttributes = (): void => {
        if (input.dir) wrapper.dir = input.dir;
        else wrapper.removeAttribute("dir");
        syncProgress();
    };
    const onFormReset = (event: Event): void => {
        if (event.target !== input.form) return;
        queueMicrotask(() => {
            if (!sliderDestroyed && !event.defaultPrevented) syncProgress();
        });
    };
    const unobserveWrapperResize = observeSharedElementResize(wrapper, onLayoutChange);
    const inputObserver = typeof MutationObserver === "function" ? new MutationObserver(() => {
        if (!sliderDestroyed) {
            syncInputAttributes();
            scheduleThumbRefresh();
        }
    }) : null;
    inputObserver?.observe(input, { attributes: true, attributeFilter: ["min", "max", "step", "value", "disabled", "dir"] });

    applyMotionVars();
    syncInputAttributes();
    syncExternalCapture();
    input.addEventListener("input", onInput);
    input.addEventListener("change", onInput);
    input.addEventListener("pointerdown", onPointerDown);
    input.addEventListener("lostpointercapture", onPointerUp);
    reducedMotionQuery?.addEventListener?.("change", onReducedMotionChange);
    input.ownerDocument.addEventListener("reset", onFormReset, true);
    if (typeof window !== "undefined") {
        window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    }

    return {
        get element() {
            return input;
        },
        get engine() {
            return thumbGlass.engine;
        },
        get value() {
            return readNumericInputValue(input);
        },
        setValue(value: number, animate = true) {
            if (sliderDestroyed || !Number.isFinite(value)) return;
            input.value = String(value);
            const animateProgress = animate && !isMotionReduced();
            syncProgress(animateProgress);
            if (!animateProgress) {
                paintCompositeScene();
                thumbGlass.refresh();
            }
            const nextValue = readNumericInputValue(input);
            lastEmittedValue = nextValue;
            lastEventWasInput = false;
            onChangeCallback?.(nextValue, input);
        },
        update(nextOptions: Partial<LiquidGlassSliderOptions>) {
            if (sliderDestroyed || Object.keys(nextOptions).length === 0) return;
            const hadComposite = needsCompositeScene();
            let orientationChanged = false;
            if ("onChange" in nextOptions) {
                onChangeCallback = nextOptions.onChange;
            }
            if ("onEngineChange" in nextOptions) {
                onEngineChangeCallback = nextOptions.onEngineChange;
            }
            if ("orientation" in nextOptions) {
                const nextOrientation: GlassOrientation =
                    nextOptions.orientation === "vertical" ? "vertical" : "horizontal";
                if (nextOrientation !== orientation) {
                    orientationChanged = true;
                    onPointerUp();
                    orientation = nextOrientation;
                    syncOrientationAttr();
                    applyMotionVars();
                }
            }
            const prevRequestedScene = requestedSceneElement;
            const prevRequestedCanvas = requestedSceneCanvas;
            const prevPixelRatio = requestedPixelRatio;
            if ("sceneElement" in nextOptions) {
                requestedSceneElement = nextOptions.sceneElement ?? null;
                if (requestedSceneElement !== prevRequestedScene && !("sceneCanvas" in nextOptions)) {
                    requestedSceneCanvas = null;
                }
            }
            if ("sceneCanvas" in nextOptions) {
                requestedSceneCanvas = nextOptions.sceneCanvas ?? null;
            }
            if ("pixelRatio" in nextOptions) {
                requestedPixelRatio = nextOptions.pixelRatio;
            }
            if ("interactive" in nextOptions) {
                interactiveEnabled = nextOptions.interactive !== false;
                if (!interactiveEnabled) {
                    pressAmount = 0;
                    pressVelocity = 0;
                    bouncePos = 0;
                    bounceVel = 0;
                    applyMotionVars();
                }
            }

            const useComposite = needsCompositeScene();
            const prevEffectiveSharpness = resolveSliderSharpness();
            const thumbPatch = stripSliderOwnOptions(nextOptions);
            // These defaults belong to the slider and must be recomputed when its preset changes.
            glassOptions = { ...glassOptions, ...thumbPatch };
            const defaults = resolveThumbDefaults();
            const nextEffectiveSharpness = resolveSliderSharpness();
            if ("preset" in thumbPatch || "blur" in thumbPatch) thumbPatch.blur = defaults.blur;
            if ("preset" in thumbPatch || "bezel" in thumbPatch) thumbPatch.bezel = defaults.bezel;
            if ("preset" in thumbPatch || "thickness" in thumbPatch) thumbPatch.thickness = defaults.thickness;
            if ("pill" in thumbPatch) thumbPatch.pill = defaults.pill;
            delete thumbPatch.interactive;
            if (useComposite !== hadComposite) {
                thumbPatch.sceneElement = wrapper;
                thumbPatch.sceneCanvas = useComposite ? ensureCompositeCanvas() : null;
            }
            if (Object.keys(thumbPatch).length > 0) thumbGlass.update(thumbPatch);
            syncProgress();
            const sceneCanvasChanged =
                requestedSceneCanvas !== prevRequestedCanvas ||
                ("sceneCanvas" in nextOptions && requestedSceneCanvas !== null);
            const sharpnessChanged = nextEffectiveSharpness !== prevEffectiveSharpness;
            if (
                sceneCanvasChanged ||
                requestedSceneElement !== prevRequestedScene ||
                requestedPixelRatio !== prevPixelRatio ||
                sharpnessChanged ||
                orientationChanged
            ) {
                syncExternalCapture();
                if ((requestedPixelRatio !== prevPixelRatio || sharpnessChanged) && externalCapture) {
                    externalCapture.scheduleCapture();
                }
            }
        },
        refresh() {
            if (sliderDestroyed) return;
            syncProgress();
            if (thumbGlass.engine === "webgl" && needsCompositeScene()) {
                externalCapture?.scheduleCapture();
                paintCompositeScene();
            }
            thumbGlass.refresh();
        },
        setLightTilt(horizontal: number, vertical: number) {
            if (sliderDestroyed) return;
            thumbGlass.setLightTilt?.(horizontal, vertical);
        },
        setSceneCanvas(canvas: HTMLCanvasElement | null, sceneElement?: HTMLElement | null) {
            if (sliderDestroyed) return;
            requestedSceneCanvas = canvas;
            if (sceneElement !== undefined) {
                requestedSceneElement = sceneElement ?? null;
            }
            const useComposite = needsCompositeScene();
            thumbGlass.setSceneCanvas(
                useComposite ? ensureCompositeCanvas() : null,
                useComposite ? wrapper : (requestedSceneElement ?? wrapper),
            );
            syncExternalCapture();
        },
        destroy() {
            if (sliderDestroyed) return;
            sliderDestroyed = true;
            if (thumbRefreshRaf !== null && typeof cancelAnimationFrame === "function") {
                cancelAnimationFrame(thumbRefreshRaf);
                thumbRefreshRaf = null;
            }
            stopMotionLoop();
            detachExternalCapture();
            unobserveWrapperResize();
            inputObserver?.disconnect();
            input.removeEventListener("input", onInput);
            input.removeEventListener("change", onInput);
            input.removeEventListener("pointerdown", onPointerDown);
            input.removeEventListener("lostpointercapture", onPointerUp);
            reducedMotionQuery?.removeEventListener?.("change", onReducedMotionChange);
            input.ownerDocument.removeEventListener("reset", onFormReset, true);
            activePointerId = null;
            detachDragWindowListeners();
            if (typeof window !== "undefined") {
                window.removeEventListener("scroll", onScroll, true);
            }

            thumbGlass.destroy();
            compositeRange?.collapse(true);
            if (compositeCanvas) {
                compositeCanvas.width = 0;
                compositeCanvas.height = 0;
                compositeCanvas = null;
            }
            thumb.style.removeProperty("--lg-press-glow");
            wrapper.classList.remove("is-active", "is-disabled");
            wrapper.removeAttribute("data-lg-slider-orientation");
            restoreAriaOrientation();
            if (!hadNativeClass) input.classList.remove("lg-slider-native");

            if (wrapper.parentNode) {
                if (input.parentNode === wrapper) {
                    wrapper.parentNode.insertBefore(input, wrapper);
                }
                wrapper.remove();
            } else if (input.parentElement === wrapper) {
                wrapper.removeChild(input);
            }
        },
    };
}
