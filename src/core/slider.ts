import { createLiquidGlass } from "./controller.js";
import { getMediaQueries } from "./observer.js";
import {
    captureDomToCanvas,
    createSceneCaptureController,
    type CaptureBackdropSource,
} from "./sceneCapture.js";
import { stepSpring, type DampedSpringParams } from "./spring.js";
import type {
    LiquidGlassInstance,
    LiquidGlassOptions,
    SceneCaptureController,
} from "./types.js";

const POSITION_GLIDE_SPRING: DampedSpringParams = {
    stiffness: 420,
    gamma: 18.5,
    settleDisplacement: 0.0005,
    settleVelocity: 0.004,
};
const POSITION_DRAG_SPRING: DampedSpringParams = {
    stiffness: 1100,
    gamma: 32,
    settleDisplacement: 0.0005,
    settleVelocity: 0.004,
};
const PRESS_DOWN_SPRING: DampedSpringParams = {
    stiffness: 520,
    gamma: 16,
    settleDisplacement: 0.002,
    settleVelocity: 0.02,
};
const PRESS_RELEASE_SPRING: DampedSpringParams = {
    stiffness: 380,
    gamma: 7.2,
    settleDisplacement: 0.002,
    settleVelocity: 0.02,
};
const BOUNCE_SPRING: DampedSpringParams = {
    stiffness: 340,
    gamma: 6.5,
    settleDisplacement: 0.04,
    settleVelocity: 0.4,
};
const DRAG_THRESHOLD_PX = 3;

function computeRangeProgress(input: HTMLInputElement): number {
    const min = input.min !== "" ? Number(input.min) : 0;
    const max = input.max !== "" ? Number(input.max) : 100;
    const value = input.value !== "" ? Number(input.value) : min;
    const span = max - min;
    if (!Number.isFinite(span) || span <= 0) return 0;
    return Math.min(1, Math.max(0, (value - min) / span));
}

export function createGlassSlider(
    input: HTMLInputElement,
    options: LiquidGlassOptions = {},
): LiquidGlassInstance {
    const parent = input.parentNode;
    const nextSibling = input.nextSibling;

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
    let compositeCanvas: HTMLCanvasElement | null = null;
    const compositeRange: Range | null =
        typeof document !== "undefined" ? document.createRange() : null;
    let externalCapture: SceneCaptureController | null = null;
    let unsubscribeExternal: (() => void) | null = null;
    let externalCapturedCanvas: HTMLCanvasElement | null = null;
    let externalCapturedSource: HTMLElement | null = null;
    let sliderDestroyed = false;

    const needsCompositeScene = (): boolean =>
        Boolean(requestedSceneCanvas || (requestedSceneElement && !requestedSceneElement.contains(wrapper)));

    const ensureCompositeCanvas = (): HTMLCanvasElement => {
        if (!compositeCanvas) {
            compositeCanvas = document.createElement("canvas");
            compositeCanvas.width = 0;
            compositeCanvas.height = 0;
        }
        return compositeCanvas;
    };

    const initialComposite = needsCompositeScene();
    const thumbOptions: LiquidGlassOptions = {
        pill: true,
        blur: 0,
        bezel: 10,
        thickness: 36,
        ...options,
        // Pointer events hit the transparent native input above the thumb, so slider.ts drives press spring motion.
        interactive: false,
        sceneElement: initialComposite ? wrapper : (requestedSceneElement ?? wrapper),
        sceneCanvas: initialComposite ? ensureCompositeCanvas() : null,
    };

    const thumbGlass = createLiquidGlass(thumb, thumbOptions);
    let dragRefreshRaf: number | null = null;
    let motionRaf: number | null = null;
    let lastMotionTime = 0;
    let targetProgress = computeRangeProgress(input);
    let visualProgress = targetProgress;
    let visualVelocity = 0;
    let pressAmount = 0;
    let pressVelocity = 0;
    let isPressed = false;
    let hasPointerDragged = false;
    let pointerDownX: number | null = null;
    let bouncePos = 0;
    let bounceVel = 0;
    let lastBounceEdge: -1 | 0 | 1 = 0;

    const isMotionReduced = (): boolean => Boolean(getMediaQueries().reducedMotionQuery?.matches);

    const applyMotionVars = (): void => {
        const clampedVisual = Math.min(1, Math.max(0, visualProgress));
        wrapper.style.setProperty("--lg-slider-visual-progress", clampedVisual.toFixed(4));
        wrapper.style.setProperty("--lg-slider-bounce-x", `${bouncePos.toFixed(2)}px`);

        const pressScaleX = 1 + pressAmount * 0.06;
        const pressScaleY = 1 - pressAmount * 0.04;
        const bounceStretch = Math.min(0.06, Math.abs(bouncePos) * 0.01);
        const glideStretch = Math.min(0.05, Math.abs(visualVelocity) * 0.012);
        const totalStretch = Math.min(0.075, bounceStretch + glideStretch);
        const scaleX = Math.max(0.85, Math.min(1.18, pressScaleX + totalStretch));
        const scaleY = Math.max(0.85, Math.min(1.18, pressScaleY - totalStretch * 0.6));

        wrapper.style.setProperty("--lg-slider-bounce-scale-x", scaleX.toFixed(4));
        wrapper.style.setProperty("--lg-slider-bounce-scale-y", scaleY.toFixed(4));

        const pressGlow = Math.min(0.18, Math.max(0, pressAmount) * 0.12 + totalStretch * 0.8);
        if (pressGlow > 0.002) {
            thumb.style.setProperty("--lg-press-glow", pressGlow.toFixed(3));
        } else {
            thumb.style.removeProperty("--lg-press-glow");
        }
    };

    const stopMotionLoop = (): void => {
        if (motionRaf !== null && typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(motionRaf);
        }
        motionRaf = null;
        lastMotionTime = 0;
    };

    const tickMotion = (now: number): void => {
        motionRaf = null;
        if (sliderDestroyed) return;

        if (isMotionReduced()) {
            visualProgress = targetProgress;
            visualVelocity = 0;
            pressAmount = 0;
            pressVelocity = 0;
            bouncePos = 0;
            bounceVel = 0;
            lastMotionTime = 0;
            applyMotionVars();
            scheduleThumbRefresh();
            return;
        }

        const dtMs = lastMotionTime > 0 ? now - lastMotionTime : 16;
        lastMotionTime = now;
        const dt = Math.min(0.032, Math.max(0.001, dtMs * 0.001));

        const posStep = stepSpring(
            visualProgress,
            visualVelocity,
            targetProgress,
            dt,
            hasPointerDragged ? POSITION_DRAG_SPRING : POSITION_GLIDE_SPRING,
        );
        visualProgress = posStep.value;
        visualVelocity = posStep.velocity;

        if (targetProgress <= 0 && visualProgress <= 0.02 && lastBounceEdge !== -1) {
            lastBounceEdge = -1;
            bounceVel = -Math.max(95, Math.min(155, Math.abs(visualVelocity) * 70 || 120));
        } else if (targetProgress >= 1 && visualProgress >= 0.98 && lastBounceEdge !== 1) {
            lastBounceEdge = 1;
            bounceVel = Math.max(95, Math.min(155, Math.abs(visualVelocity) * 70 || 120));
        }

        const pressTarget = interactiveEnabled && isPressed ? 1 : 0;
        const pressStep = stepSpring(
            pressAmount,
            pressVelocity,
            pressTarget,
            dt,
            isPressed ? PRESS_DOWN_SPRING : PRESS_RELEASE_SPRING,
        );
        pressAmount = pressStep.value;
        pressVelocity = pressStep.velocity;

        const bounceStep = stepSpring(bouncePos, bounceVel, 0, dt, BOUNCE_SPRING);
        bouncePos = bounceStep.value;
        bounceVel = bounceStep.velocity;

        applyMotionVars();
        if (thumbGlass.engine === "webgl") {
            paintCompositeScene();
            thumbGlass.refresh();
        }

        const allSettled = posStep.settled && pressStep.settled && bounceStep.settled;
        if (!allSettled && typeof requestAnimationFrame === "function") {
            motionRaf = requestAnimationFrame(tickMotion);
        } else {
            lastMotionTime = 0;
        }
    };

    const ensureMotionLoop = (): void => {
        if (sliderDestroyed || typeof requestAnimationFrame !== "function") return;
        if (isMotionReduced()) {
            visualProgress = targetProgress;
            visualVelocity = 0;
            pressAmount = 0;
            pressVelocity = 0;
            bouncePos = 0;
            bounceVel = 0;
            stopMotionLoop();
            applyMotionVars();
            return;
        }
        if (motionRaf === null) {
            lastMotionTime = 0;
            motionRaf = requestAnimationFrame(tickMotion);
        }
    };

    const triggerEdgeBounce = (direction: -1 | 1): void => {
        if (isMotionReduced()) return;
        bounceVel = direction * 155;
        ensureMotionLoop();
    };

    const detachExternalCapture = (): void => {
        unsubscribeExternal?.();
        unsubscribeExternal = null;
        externalCapture?.destroy();
        externalCapture = null;
        externalCapturedCanvas = null;
        externalCapturedSource = null;
    };

    const paintCompositeScene = (): void => {
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
        if (
            captureDomToCanvas(
                wrapper,
                compositeCanvas,
                compositeRange,
                requestedPixelRatio,
                9999,
                backdropSource,
            )
        ) {
            thumbGlass.setSceneCanvas(compositeCanvas, wrapper);
        }
    };

    const syncExternalCapture = (): void => {
        if (sliderDestroyed || !needsCompositeScene() || thumbGlass.engine !== "webgl") {
            detachExternalCapture();
            return;
        }
        if (requestedSceneCanvas || !requestedSceneElement) {
            unsubscribeExternal?.();
            unsubscribeExternal = null;
            externalCapture?.destroy();
            externalCapture = null;
            paintCompositeScene();
            return;
        }
        if (externalCapture?.source !== requestedSceneElement) {
            detachExternalCapture();
            externalCapture = createSceneCaptureController(requestedSceneElement, () => ({
                pixelRatio: requestedPixelRatio,
                radius: 9999,
            }));
            unsubscribeExternal = externalCapture.subscribe((canvas, source) => {
                externalCapturedCanvas = canvas;
                externalCapturedSource = source;
                paintCompositeScene();
            });
        }
        paintCompositeScene();
    };

    const scheduleThumbRefresh = (): void => {
        if (sliderDestroyed || dragRefreshRaf !== null || typeof requestAnimationFrame !== "function") return;
        dragRefreshRaf = requestAnimationFrame(() => {
            dragRefreshRaf = null;
            if (sliderDestroyed) return;
            paintCompositeScene();
            thumbGlass.refresh();
        });
    };

    const syncProgress = (): void => {
        const progress = computeRangeProgress(input);
        targetProgress = progress;
        wrapper.style.setProperty("--lg-slider-progress", progress.toFixed(4));

        if (progress > 0 && progress < 1) {
            lastBounceEdge = 0;
        }

        if (isMotionReduced() || typeof requestAnimationFrame !== "function") {
            visualProgress = progress;
            visualVelocity = 0;
            pressAmount = 0;
            pressVelocity = 0;
            bouncePos = 0;
            bounceVel = 0;
            stopMotionLoop();
            applyMotionVars();
            return;
        }

        if (progress <= 0 && visualProgress <= 0.02 && lastBounceEdge !== -1) {
            lastBounceEdge = -1;
            triggerEdgeBounce(-1);
        } else if (progress >= 1 && visualProgress >= 0.98 && lastBounceEdge !== 1) {
            lastBounceEdge = 1;
            triggerEdgeBounce(1);
        }

        if (Math.abs(targetProgress - visualProgress) > 0.0005 || Math.abs(visualVelocity) > 0.004) {
            ensureMotionLoop();
        }
    };

    const onInput = (): void => {
        syncProgress();
        if (motionRaf === null) {
            paintCompositeScene();
            scheduleThumbRefresh();
        }
    };

    const onPointerDown = (event: PointerEvent): void => {
        if ("pointerType" in event && event.pointerType === "mouse" && event.button !== 0) return;
        isPressed = true;
        hasPointerDragged = false;
        pointerDownX = "clientX" in event && typeof event.clientX === "number" ? event.clientX : null;
        wrapper.classList.add("is-active");
        if (interactiveEnabled) {
            ensureMotionLoop();
        }
        scheduleThumbRefresh();
    };

    const onPointerMove = (event: PointerEvent): void => {
        if (!isPressed) return;
        const clientX = "clientX" in event && typeof event.clientX === "number" ? event.clientX : null;
        if (clientX === null) return;
        if (pointerDownX !== null && Math.abs(clientX - pointerDownX) > DRAG_THRESHOLD_PX) {
            hasPointerDragged = true;
        }
        const rect = wrapper.getBoundingClientRect();
        if (rect.width <= 0) return;
        if (clientX <= rect.left && targetProgress <= 0 && lastBounceEdge !== -1) {
            lastBounceEdge = -1;
            triggerEdgeBounce(-1);
        } else if (clientX >= rect.right && targetProgress >= 1 && lastBounceEdge !== 1) {
            lastBounceEdge = 1;
            triggerEdgeBounce(1);
        }
    };

    const onPointerUp = (): void => {
        if (!isPressed && !wrapper.classList.contains("is-active")) return;
        const wasPressed = isPressed;
        isPressed = false;
        hasPointerDragged = false;
        pointerDownX = null;
        wrapper.classList.remove("is-active");
        if (interactiveEnabled && wasPressed && !isMotionReduced()) {
            // Ensure even a sub-frame click or tap plays a visible press-and-rebound spring.
            if (pressAmount < 0.45) {
                pressAmount = Math.max(pressAmount, 0.38);
                pressVelocity = Math.max(pressVelocity, 2.2);
            }
            ensureMotionLoop();
        }
        scheduleThumbRefresh();
    };

    const wrapperResizeObserver =
        typeof ResizeObserver === "function"
            ? new ResizeObserver(() => {
                  paintCompositeScene();
                  scheduleThumbRefresh();
              })
            : null;
    wrapperResizeObserver?.observe(wrapper);

    applyMotionVars();
    syncProgress();
    syncExternalCapture();
    input.addEventListener("input", onInput);
    input.addEventListener("change", onInput);
    input.addEventListener("pointerdown", onPointerDown);
    input.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("scroll", scheduleThumbRefresh, { passive: true });

    return {
        get element() {
            return input;
        },
        get engine() {
            return thumbGlass.engine;
        },
        update(nextOptions: Partial<LiquidGlassOptions>) {
            const prevRequestedScene = requestedSceneElement;
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
                    applyMotionVars();
                }
            }

            const useComposite = needsCompositeScene();
            thumbGlass.update({
                pill: true,
                blur: 0,
                ...nextOptions,
                interactive: false,
                sceneElement: useComposite ? wrapper : (requestedSceneElement ?? wrapper),
                sceneCanvas: useComposite ? ensureCompositeCanvas() : null,
            });
            syncProgress();
            syncExternalCapture();
        },
        refresh() {
            syncProgress();
            if (thumbGlass.engine === "webgl" && needsCompositeScene()) {
                externalCapture?.scheduleCapture();
                paintCompositeScene();
            }
            thumbGlass.refresh();
        },
        setSceneCanvas(canvas: HTMLCanvasElement | null, sceneElement?: HTMLElement | null) {
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
            sliderDestroyed = true;
            if (dragRefreshRaf !== null && typeof cancelAnimationFrame === "function") {
                cancelAnimationFrame(dragRefreshRaf);
                dragRefreshRaf = null;
            }
            stopMotionLoop();
            detachExternalCapture();
            wrapperResizeObserver?.disconnect();
            input.removeEventListener("input", onInput);
            input.removeEventListener("change", onInput);
            input.removeEventListener("pointerdown", onPointerDown);
            input.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
            window.removeEventListener("pointercancel", onPointerUp);
            window.removeEventListener("scroll", scheduleThumbRefresh);

            thumbGlass.destroy();
            thumb.style.removeProperty("--lg-press-glow");
            input.classList.remove("lg-slider-native");

            if (wrapper.parentNode) {
                if (nextSibling && nextSibling.parentNode === wrapper.parentNode) {
                    wrapper.parentNode.insertBefore(input, nextSibling);
                } else {
                    wrapper.parentNode.insertBefore(input, wrapper);
                }
                wrapper.remove();
            }
        },
    };
}
