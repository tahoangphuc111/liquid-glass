import { createLiquidGlass } from "./controller.js";
import {
    captureDomToCanvas,
    createSceneCaptureController,
    type CaptureBackdropSource,
} from "./sceneCapture.js";
import type {
    LiquidGlassInstance,
    LiquidGlassOptions,
    SceneCaptureController,
} from "./types.js";

const BOUNCE_STIFFNESS = 340;
const BOUNCE_GAMMA = 6.5;
const BOUNCE_OMEGA_D = Math.sqrt(BOUNCE_STIFFNESS - BOUNCE_GAMMA * BOUNCE_GAMMA);
const BOUNCE_INV_OMEGA_D = 1 / BOUNCE_OMEGA_D;

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
        interactive: true,
        blur: 0,
        bezel: 10,
        thickness: 36,
        ...options,
        sceneElement: initialComposite ? wrapper : (requestedSceneElement ?? wrapper),
        sceneCanvas: initialComposite ? ensureCompositeCanvas() : null,
    };

    const thumbGlass = createLiquidGlass(thumb, thumbOptions);
    let dragRefreshRaf: number | null = null;
    let bounceRaf: number | null = null;
    let transitionRaf: number | null = null;
    let transitionDeadline = 0;
    let transitionFrames = 0;
    let prevProgress = computeRangeProgress(input);
    let bouncePos = 0;
    let bounceVel = 0;
    let bounceLastTime = 0;
    let lastBounceEdge: -1 | 0 | 1 = 0;

    const applyBounceVars = (posPx: number): void => {
        const stretch = Math.min(0.06, Math.abs(posPx) * 0.01);
        wrapper.style.setProperty("--lg-slider-bounce-x", `${posPx.toFixed(2)}px`);
        wrapper.style.setProperty("--lg-slider-bounce-scale-x", (1 + stretch).toFixed(4));
        wrapper.style.setProperty("--lg-slider-bounce-scale-y", (1 - stretch * 0.6).toFixed(4));
    };

    const tickBounce = (now: number): void => {
        const dt = Math.min(0.032, Math.max(0.001, (now - bounceLastTime) * 0.001));
        bounceLastTime = now;
        const phase = BOUNCE_OMEGA_D * dt;
        const decay = Math.exp(-BOUNCE_GAMMA * dt);
        const cosPhase = Math.cos(phase);
        const sinOverOmega = Math.sin(phase) * BOUNCE_INV_OMEGA_D;
        const nextPos =
            decay * (bouncePos * (cosPhase + BOUNCE_GAMMA * sinOverOmega) + bounceVel * sinOverOmega);
        const nextVel =
            decay *
            (bounceVel * (cosPhase - BOUNCE_GAMMA * sinOverOmega) -
                BOUNCE_STIFFNESS * bouncePos * sinOverOmega);
        bouncePos = nextPos;
        bounceVel = nextVel;

        if (Math.abs(bouncePos) < 0.04 && Math.abs(bounceVel) < 0.4) {
            bouncePos = 0;
            bounceVel = 0;
            bounceRaf = null;
            applyBounceVars(0);
            scheduleThumbRefresh();
            return;
        }

        applyBounceVars(bouncePos);
        scheduleThumbRefresh();
        bounceRaf = requestAnimationFrame(tickBounce);
    };

    const triggerEdgeBounce = (direction: -1 | 1): void => {
        bounceVel = direction * 155;
        if (bounceRaf === null) {
            bounceLastTime = performance.now();
            bounceRaf = requestAnimationFrame(tickBounce);
        }
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

    const syncProgress = (): void => {
        const progress = computeRangeProgress(input);
        wrapper.style.setProperty("--lg-slider-progress", progress.toFixed(4));

        if (progress <= 0 && prevProgress > 0) {
            lastBounceEdge = -1;
            triggerEdgeBounce(-1);
        } else if (progress >= 1 && prevProgress < 1) {
            lastBounceEdge = 1;
            triggerEdgeBounce(1);
        } else if (progress > 0 && progress < 1) {
            lastBounceEdge = 0;
        }
        prevProgress = progress;
    };

    const scheduleThumbRefresh = (): void => {
        if (sliderDestroyed || dragRefreshRaf !== null) return;
        dragRefreshRaf = requestAnimationFrame(() => {
            dragRefreshRaf = null;
            if (sliderDestroyed) return;
            paintCompositeScene();
            thumbGlass.refresh();
        });
    };

    const stopTransitionSync = (): void => {
        if (transitionRaf !== null) {
            cancelAnimationFrame(transitionRaf);
            transitionRaf = null;
        }
    };

    const stepTransitionSync = (now: number): void => {
        transitionRaf = null;
        if (sliderDestroyed || thumbGlass.engine !== "webgl") return;
        thumbGlass.refresh();
        transitionFrames += 1;
        if (now < transitionDeadline && transitionFrames < 15) {
            transitionRaf = requestAnimationFrame(stepTransitionSync);
        }
    };

    const startTransitionSync = (): void => {
        scheduleThumbRefresh();
        if (sliderDestroyed || thumbGlass.engine !== "webgl" || typeof requestAnimationFrame !== "function") {
            return;
        }
        transitionDeadline = (typeof performance !== "undefined" ? performance.now() : Date.now()) + 200;
        transitionFrames = 0;
        if (transitionRaf === null) {
            transitionRaf = requestAnimationFrame(stepTransitionSync);
        }
    };

    const onThumbTransitionEnd = (): void => {
        stopTransitionSync();
        scheduleThumbRefresh();
    };

    const onInput = (): void => {
        syncProgress();
        paintCompositeScene();
        scheduleThumbRefresh();
    };

    const onPointerDown = (): void => {
        wrapper.classList.add("is-active");
        startTransitionSync();
    };

    const onPointerMove = (event: PointerEvent): void => {
        if (!wrapper.classList.contains("is-active")) return;
        const rect = wrapper.getBoundingClientRect();
        if (rect.width <= 0) return;
        if (event.clientX <= rect.left && prevProgress <= 0 && lastBounceEdge !== -1) {
            lastBounceEdge = -1;
            triggerEdgeBounce(-1);
        } else if (event.clientX >= rect.right && prevProgress >= 1 && lastBounceEdge !== 1) {
            lastBounceEdge = 1;
            triggerEdgeBounce(1);
        }
    };

    const onPointerUp = (): void => {
        if (!wrapper.classList.contains("is-active")) return;
        wrapper.classList.remove("is-active");
        startTransitionSync();
    };

    const wrapperResizeObserver =
        typeof ResizeObserver === "function"
            ? new ResizeObserver(() => {
                  paintCompositeScene();
                  scheduleThumbRefresh();
              })
            : null;
    wrapperResizeObserver?.observe(wrapper);

    syncProgress();
    syncExternalCapture();
    input.addEventListener("input", onInput);
    input.addEventListener("change", onInput);
    input.addEventListener("pointerdown", onPointerDown);
    input.addEventListener("pointermove", onPointerMove);
    thumb.addEventListener("transitionend", onThumbTransitionEnd);
    thumb.addEventListener("transitioncancel", onThumbTransitionEnd);
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

            const useComposite = needsCompositeScene();
            thumbGlass.update({
                pill: true,
                interactive: true,
                blur: 0,
                ...nextOptions,
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
            if (dragRefreshRaf !== null) {
                cancelAnimationFrame(dragRefreshRaf);
                dragRefreshRaf = null;
            }
            if (bounceRaf !== null) {
                cancelAnimationFrame(bounceRaf);
                bounceRaf = null;
            }
            stopTransitionSync();
            detachExternalCapture();
            wrapperResizeObserver?.disconnect();
            input.removeEventListener("input", onInput);
            input.removeEventListener("change", onInput);
            input.removeEventListener("pointerdown", onPointerDown);
            input.removeEventListener("pointermove", onPointerMove);
            thumb.removeEventListener("transitionend", onThumbTransitionEnd);
            thumb.removeEventListener("transitioncancel", onThumbTransitionEnd);
            window.removeEventListener("pointerup", onPointerUp);
            window.removeEventListener("pointercancel", onPointerUp);
            window.removeEventListener("scroll", scheduleThumbRefresh);

            thumbGlass.destroy();
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
