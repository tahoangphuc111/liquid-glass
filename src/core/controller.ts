import { CSS_FALLBACK_BACKDROP, resolveGlassConfig } from "./config.js";
import {
    elementStateMap,
    registerManagedElement,
    unregisterManagedElement,
} from "./engine.js";
import {
    canUseSvgGlass,
    getMediaQueries,
    resolveGlassEngine,
} from "./observer.js";
import { createSceneCaptureController } from "./sceneCapture.js";
import { createInteractiveSpring, type SpringController } from "./spring.js";
import type {
    GlassConfig,
    GlassEngine,
    LiquidGlassInstance,
    LiquidGlassOptions,
    SceneCaptureController,
} from "./types.js";
import { isWasmReady, onWasmReady } from "./wasm.js";
import { GlassWebglRenderer, parseCssColorToRgb } from "./webglRenderer.js";

function computeCornerRadiusPx(
    el: HTMLElement,
    width: number,
    height: number,
    config: GlassConfig,
): number {
    const halfMin = Math.min(width, height) * 0.5;
    if (config.pill) return halfMin;

    const rawRadius =
        typeof window !== "undefined" && typeof window.getComputedStyle === "function"
            ? window.getComputedStyle(el).borderTopLeftRadius.trim()
            : "";
    const parsed = rawRadius.endsWith("%")
        ? (parseFloat(rawRadius) / 100) * Math.min(width, height)
        : parseFloat(rawRadius);
    if (Number.isFinite(parsed)) {
        return Math.min(Math.max(parsed, 0), halfMin);
    }
    const fallback = config.radius ?? Math.min(Math.round(height * 0.5), 24);
    return Math.min(Math.max(fallback, 0), halfMin);
}

export function createLiquidGlass(
    element: HTMLElement,
    initialOptions: LiquidGlassOptions = {},
): LiquidGlassInstance {
    let options: LiquidGlassOptions = { ...initialOptions };
    let config = resolveGlassConfig(options);
    let activeEngine: GlassEngine = "css";
    let hasInitializedEngine = false;
    let destroyed = false;

    let webglCanvas: HTMLCanvasElement | null = null;
    let webglRenderer: GlassWebglRenderer | null = null;
    let webglResizeObserver: ResizeObserver | null = null;
    let localSceneCapture: SceneCaptureController | null = null;
    let unsubscribeCapture: (() => void) | null = null;
    let externalSceneCanvas: HTMLCanvasElement | null = options.sceneCanvas ?? null;
    let capturedSceneCanvas: HTMLCanvasElement | null = null;
    let sceneEl: HTMLElement | null = options.sceneElement ?? null;
    let scrollFrameId: number | null = null;
    let renderFrameId: number | null = null;
    let lastSceneBackdropKey = "";
    let listenersAttached = false;

    const getSceneBackdropKey = (): string => {
        if (typeof document === "undefined" || typeof window === "undefined") return "";
        const source = sceneEl ?? options.sceneElement;
        const sourceBg =
            source && source.isConnected && typeof window.getComputedStyle === "function"
                ? window.getComputedStyle(source).backgroundColor
                : "";
        return `${document.documentElement.className}|${document.documentElement.getAttribute("data-theme") ?? ""}|${document.body?.className ?? ""}|${sourceBg}`;
    };
    let springController: SpringController | null = null;
    let interactiveListenersAttached = false;
    let pressGlow = 0;

    element.setAttribute("data-lg-surface", "");
    element.classList.add("lg-surface");

    const hasSceneInput = (): boolean =>
        Boolean(externalSceneCanvas || sceneEl || options.sceneElement);

    const setEngine = (engine: GlassEngine) => {
        const changed = !hasInitializedEngine || activeEngine !== engine;
        hasInitializedEngine = true;
        activeEngine = engine;
        element.setAttribute("data-lg-engine", engine);
        if (changed) {
            options.onEngineChange?.(engine);
        }
    };

    const syncPillAttribute = () => {
        if (config.pill) {
            element.setAttribute("data-lg-pill", "true");
            element.style.removeProperty("--lg-radius");
        } else {
            element.removeAttribute("data-lg-pill");
            if (options.radius !== undefined) {
                element.style.setProperty("--lg-radius", `${Math.max(0, config.radius)}px`);
            } else {
                element.style.removeProperty("--lg-radius");
            }
        }
        if (options.highlight !== undefined) {
            element.style.setProperty("--lg-rim-opacity", String(Math.min(1, Math.max(0, options.highlight))));
        } else {
            element.style.removeProperty("--lg-rim-opacity");
        }
        const existingState = elementStateMap.get(element);
        if (existingState) {
            existingState.cachedRadiusStr = null;
        }
    };

    const computeSceneRect = () => {
        const source = sceneEl ?? options.sceneElement;
        if (!source || !source.isConnected) return undefined;
        const sourceRect = source.getBoundingClientRect();
        const elRect = element.getBoundingClientRect();
        if (sourceRect.width < 2 || sourceRect.height < 2) return undefined;
        return {
            relX: (elRect.left - sourceRect.left) / sourceRect.width,
            relY: (elRect.top - sourceRect.top) / sourceRect.height,
            relW: elRect.width / sourceRect.width,
            relH: elRect.height / sourceRect.height,
        };
    };

    const drawWebglFrame = () => {
        renderFrameId = null;
        if (destroyed || activeEngine !== "webgl" || !webglRenderer) return;

        const width = element.offsetWidth || Math.round(element.getBoundingClientRect().width);
        const height = element.offsetHeight || Math.round(element.getBoundingClientRect().height);
        if (width < 2 || height < 2) return;

        const radius = computeCornerRadiusPx(element, width, height, config);
        const halfMin = Math.min(width, height) * 0.5;
        const bezel = Math.max(1, Math.min(config.bezel, halfMin - 1));
        const tintColor = parseCssColorToRgb(options.tintColor);
        const tintOpacity = options.tintOpacity ?? 0.12;
        const highlight = Math.min(1, (options.highlight ?? 0.72) + pressGlow);
        const activeSceneCanvas = externalSceneCanvas ?? capturedSceneCanvas;
        const sceneRect = computeSceneRect();
        const hasSceneTex = Boolean(activeSceneCanvas && activeSceneCanvas.width > 0 && sceneRect);

        element.setAttribute("data-lg-webgl-scene", hasSceneTex ? "1" : "0");
        if (!hasSceneTex && config.coreFilter) {
            element.style.setProperty("--lg-filter", config.coreFilter);
        }

        webglRenderer.render({
            width,
            height,
            radius,
            bezel,
            thickness: config.thickness,
            scaleRatio: config.scaleRatio,
            ior: config.ior,
            blur: config.blur,
            surface: config.surface,
            tintColor,
            tintOpacity,
            highlight,
            pixelRatio: options.pixelRatio,
            chromaticAberration: options.chromaticAberration,
            sceneRect: hasSceneTex ? sceneRect : undefined,
        });
    };

    const scheduleWebglRender = () => {
        if (destroyed || activeEngine !== "webgl") return;
        if (renderFrameId !== null || typeof requestAnimationFrame !== "function") return;
        renderFrameId = requestAnimationFrame(drawWebglFrame);
    };

    const onViewportScrollOrResize = () => {
        if (destroyed || activeEngine !== "webgl") return;
        if (scrollFrameId !== null || typeof requestAnimationFrame !== "function") return;
        scrollFrameId = requestAnimationFrame(() => {
            scrollFrameId = null;
            drawWebglFrame();
        });
    };

    const onWebglContextLost = (event: Event) => {
        event.preventDefault();
    };

    const onWebglContextRestored = () => {
        if (destroyed || activeEngine !== "webgl") return;
        webglRenderer?.dispose();
        webglRenderer = null;
        mountWebgl();
    };

    const teardownWebgl = () => {
        if (renderFrameId !== null && typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(renderFrameId);
            renderFrameId = null;
        }
        if (scrollFrameId !== null && typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(scrollFrameId);
            scrollFrameId = null;
        }
        if (typeof window !== "undefined") {
            window.removeEventListener("scroll", onViewportScrollOrResize);
            window.removeEventListener("resize", onViewportScrollOrResize);
        }
        webglResizeObserver?.disconnect();
        webglResizeObserver = null;
        unsubscribeCapture?.();
        unsubscribeCapture = null;
        localSceneCapture?.destroy();
        localSceneCapture = null;
        capturedSceneCanvas = null;
        webglRenderer?.dispose();
        webglRenderer = null;
        if (webglCanvas) {
            webglCanvas.removeEventListener("webglcontextlost", onWebglContextLost);
            webglCanvas.removeEventListener("webglcontextrestored", onWebglContextRestored);
            if (webglCanvas.parentNode === element) {
                webglCanvas.remove();
            }
        }
        webglCanvas = null;
        element.removeAttribute("data-lg-webgl-scene");
    };

    const mountCss = () => {
        teardownWebgl();
        unregisterManagedElement(element);
        element.classList.add("lg-on");
        const cssFilter =
            options.coreFilter ??
            (options.blur !== undefined
                ? `blur(${Math.max(0, config.blur * 3.5).toFixed(1)}px) saturate(165%)`
                : CSS_FALLBACK_BACKDROP);
        element.style.setProperty("--lg-filter", cssFilter);
        if (options.tintColor) {
            element.style.setProperty("--lg-tint", options.tintColor);
        } else {
            element.style.removeProperty("--lg-tint");
        }
        setEngine("css");
    };

    const mountWebgl = () => {
        unregisterManagedElement(element);

        if (!webglCanvas) {
            webglCanvas = document.createElement("canvas");
            webglCanvas.className = "lg-webgl-canvas";
            webglCanvas.setAttribute("aria-hidden", "true");
            webglCanvas.addEventListener("webglcontextlost", onWebglContextLost);
            webglCanvas.addEventListener("webglcontextrestored", onWebglContextRestored);
            element.insertBefore(webglCanvas, element.firstChild);
        }

        if (!webglRenderer) {
            webglRenderer = GlassWebglRenderer.create(webglCanvas);
            if (!webglRenderer) {
                mountCss();
                return;
            }
        }

        if (!externalSceneCanvas && (sceneEl || options.sceneElement)) {
            const targetSource = sceneEl ?? options.sceneElement ?? null;
            if (targetSource && (!localSceneCapture || localSceneCapture.source !== targetSource)) {
                unsubscribeCapture?.();
                localSceneCapture?.destroy();
                capturedSceneCanvas = null;
                localSceneCapture = createSceneCaptureController(
                    targetSource,
                    () => {
                        const width =
                            element.offsetWidth || Math.round(element.getBoundingClientRect().width);
                        const height =
                            element.offsetHeight || Math.round(element.getBoundingClientRect().height);
                        const radius =
                            width >= 2 && height >= 2
                                ? computeCornerRadiusPx(element, width, height, config)
                                : config.pill
                                  ? 9999
                                  : config.radius;
                        return {
                            pixelRatio: options.pixelRatio,
                            radius,
                        };
                    },
                );
                unsubscribeCapture = localSceneCapture.subscribe((canvas, source) => {
                    capturedSceneCanvas = canvas;
                    sceneEl = source;
                    lastSceneBackdropKey = getSceneBackdropKey();
                    webglRenderer?.setSceneCanvas(canvas);
                    scheduleWebglRender();
                });
            } else if (capturedSceneCanvas && capturedSceneCanvas.width > 0) {
                webglRenderer.setSceneCanvas(capturedSceneCanvas);
            }
        } else if (externalSceneCanvas) {
            unsubscribeCapture?.();
            unsubscribeCapture = null;
            localSceneCapture?.destroy();
            localSceneCapture = null;
            capturedSceneCanvas = null;
            webglRenderer.setSceneCanvas(externalSceneCanvas);
        } else {
            unsubscribeCapture?.();
            unsubscribeCapture = null;
            localSceneCapture?.destroy();
            localSceneCapture = null;
            capturedSceneCanvas = null;
            webglRenderer.setSceneCanvas(null);
        }

        if (!webglResizeObserver && typeof ResizeObserver === "function") {
            webglResizeObserver = new ResizeObserver(scheduleWebglRender);
            webglResizeObserver.observe(element);
        }

        if (typeof window !== "undefined") {
            window.addEventListener("scroll", onViewportScrollOrResize, { passive: true });
            window.addEventListener("resize", onViewportScrollOrResize, { passive: true });
        }

        element.classList.add("lg-on");
        setEngine("webgl");
        scheduleWebglRender();
    };

    const mountSvg = () => {
        teardownWebgl();
        setEngine("wasm-svg");
        registerManagedElement(element, config);
    };

    const isInteractiveElement = (): boolean =>
        options.interactive ??
        (element.tagName === "BUTTON" ||
            element.tagName === "A" ||
            element.getAttribute("role") === "button");

    const onInteractivePointerDown = (event: PointerEvent) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        springController?.press();
    };

    const onInteractivePointerUp = () => {
        springController?.release(true);
    };

    const onInteractivePointerCancel = () => {
        springController?.release(false);
    };

    const onInteractiveKeyDown = (event: KeyboardEvent) => {
        if ((event.key === " " || event.key === "Enter") && !event.repeat) {
            springController?.press();
        }
    };

    const onInteractiveKeyUp = (event: KeyboardEvent) => {
        if (event.key === " " || event.key === "Enter") {
            springController?.release(true);
        }
    };

    const detachInteractive = () => {
        if (interactiveListenersAttached) {
            interactiveListenersAttached = false;
            element.removeEventListener("pointerdown", onInteractivePointerDown);
            element.removeEventListener("pointerup", onInteractivePointerUp);
            element.removeEventListener("pointercancel", onInteractivePointerCancel);
            element.removeEventListener("pointerleave", onInteractivePointerCancel);
            element.removeEventListener("keydown", onInteractiveKeyDown);
            element.removeEventListener("keyup", onInteractiveKeyUp);
            element.removeEventListener("blur", onInteractivePointerCancel);
        }
        springController?.destroy();
        springController = null;
        pressGlow = 0;
        element.classList.remove("lg-interactive");
        element.style.removeProperty("--lg-spring-scale-x");
        element.style.removeProperty("--lg-spring-scale-y");
        element.style.removeProperty("--lg-press-glow");
    };

    const syncInteractive = () => {
        const enabled = isInteractiveElement();
        if (!enabled) {
            detachInteractive();
            return;
        }

        element.classList.add("lg-interactive");
        if (!springController) {
            springController = createInteractiveSpring(
                (frame) => {
                    element.style.setProperty("--lg-spring-scale-x", frame.scaleX.toFixed(4));
                    element.style.setProperty("--lg-spring-scale-y", frame.scaleY.toFixed(4));
                    element.style.setProperty("--lg-press-glow", frame.glow.toFixed(3));
                    const prevGlow = pressGlow;
                    pressGlow = frame.glow;
                    if (activeEngine === "webgl" && Math.abs(frame.glow - prevGlow) > 0.004) {
                        scheduleWebglRender();
                    }
                },
                () => {
                    const prevGlow = pressGlow;
                    pressGlow = 0;
                    element.style.removeProperty("--lg-spring-scale-x");
                    element.style.removeProperty("--lg-spring-scale-y");
                    element.style.removeProperty("--lg-press-glow");
                    if (activeEngine === "webgl" && prevGlow > 0.004) {
                        scheduleWebglRender();
                    }
                },
            );
        }

        const { reducedMotionQuery } = getMediaQueries();
        springController.setReducedMotion(Boolean(reducedMotionQuery?.matches));

        if (!interactiveListenersAttached) {
            interactiveListenersAttached = true;
            element.addEventListener("pointerdown", onInteractivePointerDown, { passive: true });
            element.addEventListener("pointerup", onInteractivePointerUp, { passive: true });
            element.addEventListener("pointercancel", onInteractivePointerCancel, { passive: true });
            element.addEventListener("pointerleave", onInteractivePointerCancel, { passive: true });
            element.addEventListener("keydown", onInteractiveKeyDown);
            element.addEventListener("keyup", onInteractiveKeyUp);
            element.addEventListener("blur", onInteractivePointerCancel, { passive: true });
        }
    };

    const applyEngine = () => {
        if (destroyed) return;
        config = resolveGlassConfig(options);
        syncPillAttribute();
        syncInteractive();
        const targetEngine = resolveGlassEngine(options.engine ?? "auto", hasSceneInput());

        if (targetEngine === "wasm-svg") {
            mountSvg();
        } else if (targetEngine === "webgl") {
            mountWebgl();
        } else {
            mountCss();
        }
    };

    if (typeof window !== "undefined" && !listenersAttached) {
        listenersAttached = true;
        const {
            reducedMotionQuery,
            mobileOrTouchQuery,
            reducedTransparencyQuery,
            highContrastQuery,
        } = getMediaQueries();
        reducedMotionQuery?.addEventListener?.("change", applyEngine);
        mobileOrTouchQuery?.addEventListener?.("change", applyEngine);
        reducedTransparencyQuery?.addEventListener?.("change", applyEngine);
        highContrastQuery?.addEventListener?.("change", applyEngine);
        onWasmReady(() => {
            const mode = options.engine ?? "auto";
            if (!destroyed && (mode === "auto" || mode === "wasm-svg") && canUseSvgGlass()) {
                applyEngine();
            }
        });
    }

    applyEngine();

    return {
        element,
        get engine() {
            return activeEngine;
        },
        update(newOptions) {
            if (destroyed) return;
            const prevPixelRatio = options.pixelRatio;
            const prevRadius = config.radius;
            const prevPill = config.pill;
            options = { ...options, ...newOptions };
            if ("sceneCanvas" in newOptions) {
                externalSceneCanvas = newOptions.sceneCanvas ?? null;
            }
            if ("sceneElement" in newOptions) {
                const nextSource = newOptions.sceneElement ?? null;
                if (nextSource !== sceneEl) {
                    capturedSceneCanvas = null;
                }
                sceneEl = nextSource;
            }
            applyEngine();
            if (
                ("pixelRatio" in newOptions && newOptions.pixelRatio !== prevPixelRatio) ||
                config.radius !== prevRadius ||
                config.pill !== prevPill
            ) {
                localSceneCapture?.scheduleCapture();
            }
        },
        refresh() {
            if (destroyed) return;
            const targetEngine = resolveGlassEngine(options.engine ?? "auto", hasSceneInput());
            if (targetEngine !== activeEngine) {
                applyEngine();
                return;
            }
            if (activeEngine === "webgl") {
                const nextBackdropKey = getSceneBackdropKey();
                if (localSceneCapture && nextBackdropKey !== lastSceneBackdropKey) {
                    lastSceneBackdropKey = nextBackdropKey;
                    localSceneCapture.scheduleCapture();
                }
                scheduleWebglRender();
            } else if (activeEngine === "wasm-svg") {
                const existingState = elementStateMap.get(element);
                if (existingState) existingState.cachedRadiusStr = null;
                registerManagedElement(element, config);
            } else {
                mountCss();
            }
        },
        setSceneCanvas(canvas, nextSceneEl) {
            if (destroyed) return;
            externalSceneCanvas = canvas;
            if (nextSceneEl !== undefined) {
                if (nextSceneEl !== sceneEl) {
                    capturedSceneCanvas = null;
                }
                sceneEl = nextSceneEl;
            }
            if (canvas) {
                unsubscribeCapture?.();
                unsubscribeCapture = null;
                localSceneCapture?.destroy();
                localSceneCapture = null;
                capturedSceneCanvas = null;
            }
            if (activeEngine === "webgl" && webglRenderer) {
                if (!canvas && (sceneEl || options.sceneElement)) {
                    mountWebgl();
                } else {
                    webglRenderer.setSceneCanvas(canvas);
                    scheduleWebglRender();
                }
            } else if ((options.engine ?? "auto") === "auto") {
                applyEngine();
            }
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            if (listenersAttached) {
                const {
                    reducedMotionQuery,
                    mobileOrTouchQuery,
                    reducedTransparencyQuery,
                    highContrastQuery,
                } = getMediaQueries();
                reducedMotionQuery?.removeEventListener?.("change", applyEngine);
                mobileOrTouchQuery?.removeEventListener?.("change", applyEngine);
                reducedTransparencyQuery?.removeEventListener?.("change", applyEngine);
                highContrastQuery?.removeEventListener?.("change", applyEngine);
            }
            detachInteractive();
            teardownWebgl();
            unregisterManagedElement(element);
            element.classList.remove("lg-on", "lg-hollow", "lg-interactive");
            element.removeAttribute("data-lg-surface");
            element.removeAttribute("data-lg-engine");
            element.removeAttribute("data-lg-pill");
            element.removeAttribute("data-lg-webgl-scene");
            element.style.removeProperty("--lg-filter");
            element.style.removeProperty("--lg-tint");
            element.style.removeProperty("--lg-bg");
            element.style.removeProperty("--lg-radius");
            element.style.removeProperty("--lg-rim-opacity");
        },
    };
}

export { isWasmReady };
