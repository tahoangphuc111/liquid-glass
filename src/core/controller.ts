import { CSS_FALLBACK_BACKDROP, resolveGlassConfig } from "./config.js";
import {
    collectCoalescenceSnapshot,
    registerCoalescenceParticipant,
    syncCoalescenceGeometry,
} from "./coalescence.js";
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
import {
    acquireWebglSlot,
    isWebglSlotOnStandby,
    releaseWebglSlot,
    updateWebglSlotVisibility,
    type WebglPoolEntry,
} from "./webglPool.js";
import { GlassWebglRenderer, parseCssColorToRgb } from "./webglRenderer.js";

const visibilityHandlers = new WeakMap<Element, (isVisible: boolean) => void>();
let sharedVisibilityObserver: IntersectionObserver | null = null;
let sharedVisibilityCount = 0;

function observeElementVisibility(
    targetElement: Element,
    onVisibilityChange: (isVisible: boolean) => void,
): () => void {
    if (typeof IntersectionObserver !== "function") {
        return () => {};
    }
    if (!sharedVisibilityObserver) {
        sharedVisibilityObserver = new IntersectionObserver(
            (entries) => {
                for (let index = 0; index < entries.length; index++) {
                    const entry = entries[index];
                    const handler = visibilityHandlers.get(entry.target);
                    if (handler) {
                        handler(entry.isIntersecting);
                    }
                }
            },
            { rootMargin: "120px" },
        );
    }
    visibilityHandlers.set(targetElement, onVisibilityChange);
    sharedVisibilityObserver.observe(targetElement);
    sharedVisibilityCount += 1;

    let active = true;
    return () => {
        if (!active) return;
        active = false;
        visibilityHandlers.delete(targetElement);
        sharedVisibilityObserver?.unobserve(targetElement);
        sharedVisibilityCount = Math.max(0, sharedVisibilityCount - 1);
        if (sharedVisibilityCount === 0) {
            sharedVisibilityObserver?.disconnect();
            sharedVisibilityObserver = null;
        }
    };
}

function computeCornerRadiusPx(
    el: HTMLElement,
    width: number,
    height: number,
    config: GlassConfig,
    cachedRadiusStr?: string | null,
): { radius: number; rawRadiusStr: string } {
    const halfMin = Math.min(width, height) * 0.5;
    if (config.pill) return { radius: halfMin, rawRadiusStr: "" };

    const rawRadius =
        cachedRadiusStr ??
        (typeof window !== "undefined" && typeof window.getComputedStyle === "function"
            ? window.getComputedStyle(el).borderTopLeftRadius.trim()
            : "");
    const parsed = rawRadius.endsWith("%")
        ? (parseFloat(rawRadius) / 100) * Math.min(width, height)
        : parseFloat(rawRadius);
    if (Number.isFinite(parsed)) {
        return { radius: Math.min(Math.max(parsed, 0), halfMin), rawRadiusStr: rawRadius };
    }
    const fallback = config.radius ?? Math.min(Math.round(height * 0.5), 24);
    return { radius: Math.min(Math.max(fallback, 0), halfMin), rawRadiusStr: rawRadius };
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

    let cachedRadiusStr: string | null = null;
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
    let isViewportVisible = true;
    let pendingVisibleRender = false;
    let unobserveVisibility: (() => void) | null = null;

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
    let lightTiltHorizontal = 0;
    let lightTiltVertical = 0;
    let dragMotionSpeed = 0;
    let lastSpringDragX = 0;
    let lastSpringDragY = 0;
    let isPointerDragging = false;
    let activeDragPointerId: number | null = null;
    let dragStartClientX = 0;
    let dragStartClientY = 0;
    let lastDragClientX = 0;
    let lastDragClientY = 0;
    let lastDragTimestamp = 0;
    let dragVelocityX = 0;
    let dragVelocityY = 0;
    let hasDraggedBeyondThreshold = false;
    let unregisterCoalescence: (() => void) | null = null;

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
        cachedRadiusStr = null;
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
        const width = element.offsetWidth || elRect.width;
        const height = element.offsetHeight || elRect.height;
        const elCenterX = (elRect.left + elRect.right) * 0.5;
        const elCenterY = (elRect.top + elRect.bottom) * 0.5;
        const unstretchedLeft = elCenterX - width * 0.5;
        const unstretchedTop = elCenterY - height * 0.5;
        return {
            relX: (unstretchedLeft - sourceRect.left) / sourceRect.width,
            relY: (unstretchedTop - sourceRect.top) / sourceRect.height,
            relW: width / sourceRect.width,
            relH: height / sourceRect.height,
        };
    };

    const readCoalescenceBounds = () => {
        if (destroyed || !element.isConnected) return null;
        const rect = element.getBoundingClientRect();
        const width = element.offsetWidth || Math.round(rect.width);
        const height = element.offsetHeight || Math.round(rect.height);
        if (width < 2 || height < 2) return null;
        const radiusResult = computeCornerRadiusPx(element, width, height, config, cachedRadiusStr);
        cachedRadiusStr = radiusResult.rawRadiusStr;
        const radius = radiusResult.radius;
        const halfMin = Math.min(width, height) * 0.5;
        const bezel = Math.max(1, Math.min(config.bezel, halfMin - 1));
        const unstretchedLeft = (rect.left + rect.right) * 0.5 - width * 0.5;
        const unstretchedTop = (rect.top + rect.bottom) * 0.5 - height * 0.5;
        return { left: unstretchedLeft, top: unstretchedTop, width, height, radius, bezel };
    };

    const syncCoalescenceState = (motionImpulse = 0, notifyPeers = true) => {
        if (options.coalesce === false) return;
        const bounds = readCoalescenceBounds();
        if (!bounds) return;
        syncCoalescenceGeometry(
            element,
            bounds.left,
            bounds.top,
            bounds.width,
            bounds.height,
            bounds.radius,
            bounds.bezel,
            motionImpulse,
            notifyPeers,
        );
    };

    const applyCoalescenceVisuals = () => {
        if (options.coalesce === false) {
            element.removeAttribute("data-lg-coalescing");
            element.style.removeProperty("--lg-bleed");
            element.style.removeProperty("--lg-interference");
            return { peers: [], interferenceIntensity: 0, requiredBleedPx: 0 };
        }
        const snapshot = collectCoalescenceSnapshot(element);
        if (snapshot.peers.length > 0) {
            element.setAttribute("data-lg-coalescing", "1");
            element.style.setProperty("--lg-bleed", `${snapshot.requiredBleedPx}px`);
            element.style.setProperty("--lg-interference", snapshot.interferenceIntensity.toFixed(3));
        } else {
            element.removeAttribute("data-lg-coalescing");
            element.style.removeProperty("--lg-bleed");
            element.style.removeProperty("--lg-interference");
        }
        return snapshot;
    };

    const drawWebglFrame = () => {
        renderFrameId = null;
        if (destroyed || activeEngine !== "webgl" || !webglRenderer) return;
        if (!isViewportVisible) {
            pendingVisibleRender = true;
            return;
        }

        const bounds = readCoalescenceBounds();
        if (!bounds) return;
        const { left, top, width, height, radius, bezel } = bounds;
        syncCoalescenceGeometry(element, left, top, width, height, radius, bezel, dragMotionSpeed, false);
        const coalescenceSnapshot = applyCoalescenceVisuals();

        const tintColor = parseCssColorToRgb(options.tintColor);
        const tintOpacity = options.tintOpacity ?? 0.12;
        const highlight = Math.min(1, (options.highlight ?? 0.44) + pressGlow);
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
            lightTilt:
                lightTiltHorizontal !== 0 || lightTiltVertical !== 0
                    ? { horizontal: lightTiltHorizontal, vertical: lightTiltVertical }
                    : undefined,
            sceneRect: hasSceneTex ? sceneRect : undefined,
            coalescePeers: coalescenceSnapshot.peers,
            bleedPx: coalescenceSnapshot.requiredBleedPx,
        });
    };

    const scheduleWebglRender = () => {
        if (destroyed || activeEngine !== "webgl") return;
        if (!isViewportVisible) {
            pendingVisibleRender = true;
            return;
        }
        if (renderFrameId !== null || typeof requestAnimationFrame !== "function") return;
        renderFrameId = requestAnimationFrame(drawWebglFrame);
    };

    const handleVisibilityChange = (nextVisible: boolean) => {
        if (destroyed || isViewportVisible === nextVisible) return;
        isViewportVisible = nextVisible;
        updateWebglSlotVisibility(webglPoolEntry, nextVisible);
        if (activeEngine !== "webgl") return;
        localSceneCapture?.setActive?.(nextVisible);
        if (!nextVisible) {
            if (renderFrameId !== null && typeof cancelAnimationFrame === "function") {
                cancelAnimationFrame(renderFrameId);
                renderFrameId = null;
                pendingVisibleRender = true;
            }
            if (scrollFrameId !== null && typeof cancelAnimationFrame === "function") {
                cancelAnimationFrame(scrollFrameId);
                scrollFrameId = null;
                pendingVisibleRender = true;
            }
            return;
        }
        if (pendingVisibleRender) {
            pendingVisibleRender = false;
            scheduleWebglRender();
        }
    };

    const onViewportScrollOrResize = () => {
        if (destroyed || activeEngine !== "webgl" || !isViewportVisible) return;
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

    const teardownWebgl = (preserveVisibilityObserver = false) => {
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
        if (!preserveVisibilityObserver) {
            unobserveVisibility?.();
            unobserveVisibility = null;
            isViewportVisible = true;
        }
        pendingVisibleRender = false;
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

    const mountCss = (preservePoolStandby = false) => {
        teardownWebgl(preservePoolStandby);
        if (!preservePoolStandby) {
            releaseWebglSlot(webglPoolEntry, true);
        }
        unregisterManagedElement(element);
        element.classList.add("lg-on");
        const cssFilter =
            options.coreFilter ??
            (options.blur !== undefined
                ? `blur(${Math.max(0, config.blur * 3.5).toFixed(1)}px) saturate(220%)`
                : CSS_FALLBACK_BACKDROP);
        element.style.setProperty("--lg-filter", cssFilter);
        if (options.tintColor) {
            element.style.setProperty("--lg-tint", options.tintColor);
        } else {
            element.style.removeProperty("--lg-tint");
        }
        setEngine("css");
        syncCoalescenceState(0, true);
        applyCoalescenceVisuals();
    };

    const webglPoolEntry: WebglPoolEntry = {
        token: Symbol("lg-webgl-slot"),
        isVisible: true,
        lastUsedOrder: 0,
        evictToCss: () => {
            mountCss(true);
        },
        restoreWebgl: () => {
            if (destroyed) return;
            const targetEngine = resolveGlassEngine(options.engine ?? "auto", hasSceneInput());
            if (targetEngine === "webgl") {
                mountWebgl();
            }
        },
    };

    const mountWebgl = () => {
        unregisterManagedElement(element);
        if (!unobserveVisibility) {
            unobserveVisibility = observeElementVisibility(element, handleVisibilityChange);
        }
        webglPoolEntry.isVisible = isViewportVisible;
        if (!acquireWebglSlot(webglPoolEntry)) {
            mountCss(true);
            return;
        }

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
                releaseWebglSlot(webglPoolEntry, true);
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
                        let radius: number;
                        if (width >= 2 && height >= 2) {
                            const res = computeCornerRadiusPx(element, width, height, config, cachedRadiusStr);
                            cachedRadiusStr = res.rawRadiusStr;
                            radius = res.radius;
                        } else {
                            radius = config.pill ? 9999 : config.radius;
                        }
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
                localSceneCapture.setActive?.(isViewportVisible);
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
        if (!unobserveVisibility) {
            unobserveVisibility = observeElementVisibility(element, handleVisibilityChange);
        }

        if (typeof window !== "undefined") {
            window.addEventListener("scroll", onViewportScrollOrResize, { passive: true });
            window.addEventListener("resize", onViewportScrollOrResize, { passive: true });
        }

        element.classList.add("lg-on");
        setEngine("webgl");
        syncCoalescenceState(0, true);
        scheduleWebglRender();
    };

    const mountSvg = () => {
        teardownWebgl();
        releaseWebglSlot(webglPoolEntry, true);
        setEngine("wasm-svg");
        registerManagedElement(element, config);
        syncCoalescenceState(0, true);
        applyCoalescenceVisuals();
    };

    const MAX_BUTTON_DRAG_PX = 9;

    const isButtonElement = (): boolean =>
        element.tagName === "BUTTON" ||
        element.tagName === "A" ||
        element.getAttribute("role") === "button";

    const resolveDragMode = (): "elastic" | null => {
        if (options.interactive === false || options.draggable === false) return null;
        if (
            isButtonElement() &&
            (options.draggable === undefined ||
                options.draggable === true ||
                options.draggable === "elastic")
        ) {
            return "elastic";
        }
        return null;
    };

    const isInteractiveElement = (): boolean =>
        options.interactive ?? isButtonElement();

    const onInteractivePointerDown = (event: PointerEvent) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        hasDraggedBeyondThreshold = false;
        springController?.press();
        const dragMode = resolveDragMode();
        if (dragMode !== null) {
            isPointerDragging = true;
            activeDragPointerId = event.pointerId;
            dragStartClientX = event.clientX;
            dragStartClientY = event.clientY;
            lastDragClientX = event.clientX;
            lastDragClientY = event.clientY;
            lastDragTimestamp = event.timeStamp || (typeof performance !== "undefined" ? performance.now() : Date.now());
            dragVelocityX = 0;
            dragVelocityY = 0;
            try {
                element.setPointerCapture?.(event.pointerId);
            } catch {
            }
        }
    };

    const onInteractivePointerMove = (event: PointerEvent) => {
        if (!springController) return;
        const dragMode = resolveDragMode();
        if (isPointerDragging && dragMode !== null && event.pointerId === activeDragPointerId) {
            const rawDeltaX = event.clientX - dragStartClientX;
            const rawDeltaY = event.clientY - dragStartClientY;
            const dragDistance = Math.hypot(rawDeltaX, rawDeltaY);
            if (!hasDraggedBeyondThreshold && dragDistance > 4) {
                hasDraggedBeyondThreshold = true;
                element.setAttribute("data-lg-dragging", "1");
            }

            let targetX = 0;
            let targetY = 0;
            if (dragDistance > 0.001) {
                const clampedDistance = MAX_BUTTON_DRAG_PX * (dragDistance / (dragDistance + 72));
                targetX = (rawDeltaX / dragDistance) * clampedDistance;
                targetY = (rawDeltaY / dragDistance) * clampedDistance;
            }

            const now = event.timeStamp || (typeof performance !== "undefined" ? performance.now() : Date.now());
            const dtSeconds = Math.max(0.004, Math.min(0.08, (now - lastDragTimestamp) * 0.001));
            const instVelX = Math.max(-1600, Math.min(1600, (event.clientX - lastDragClientX) / dtSeconds));
            const instVelY = Math.max(-1600, Math.min(1600, (event.clientY - lastDragClientY) / dtSeconds));
            dragVelocityX = dragVelocityX * 0.5 + instVelX * 0.5;
            dragVelocityY = dragVelocityY * 0.5 + instVelY * 0.5;
            lastDragClientX = event.clientX;
            lastDragClientY = event.clientY;
            lastDragTimestamp = now;

            springController.setDrag(targetX, targetY, false);
            springController.setTilt(Math.tanh(rawDeltaX / 36), -Math.tanh(rawDeltaY / 36));
            syncCoalescenceState(Math.hypot(dragVelocityX, dragVelocityY), true);
            return;
        }

        const rect = element.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return;
        const horizontal = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const vertical = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
        springController.setTilt(horizontal, vertical);
    };

    const finishDragInteraction = (event: Event, isCancel: boolean) => {
        if (!isPointerDragging) return;
        const pointerEvent = event as PointerEvent;
        if (
            typeof pointerEvent.pointerId === "number" &&
            activeDragPointerId !== null &&
            pointerEvent.pointerId !== activeDragPointerId &&
            event.type !== "blur"
        ) {
            return;
        }
        isPointerDragging = false;
        const capturedId = activeDragPointerId;
        activeDragPointerId = null;
        element.removeAttribute("data-lg-dragging");
        if (capturedId !== null) {
            try {
                element.releasePointerCapture?.(capturedId);
            } catch {
            }
        }

        springController?.setDrag(0, 0, false);
        if (!isCancel) {
            springController?.impulseDrag(-dragVelocityX * 0.04, -dragVelocityY * 0.04);
        }
        dragVelocityX = 0;
        dragVelocityY = 0;
        if (isCancel) {
            hasDraggedBeyondThreshold = false;
        }
    };

    const onInteractivePointerUp = (event: PointerEvent) => {
        finishDragInteraction(event, false);
        springController?.release(true);
    };

    const onInteractivePointerCancel = (event: Event) => {
        if (isPointerDragging && event.type === "pointerleave") return;
        finishDragInteraction(event, true);
        springController?.setTilt(0, 0);
        springController?.release(false);
    };

    const onInteractiveClickCapture = (event: MouseEvent) => {
        if (hasDraggedBeyondThreshold) {
            event.preventDefault();
            event.stopPropagation();
            hasDraggedBeyondThreshold = false;
        }
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
            element.removeEventListener("pointermove", onInteractivePointerMove);
            element.removeEventListener("pointerup", onInteractivePointerUp);
            element.removeEventListener("pointercancel", onInteractivePointerCancel);
            element.removeEventListener("pointerleave", onInteractivePointerCancel);
            element.removeEventListener("click", onInteractiveClickCapture, true);
            element.removeEventListener("keydown", onInteractiveKeyDown);
            element.removeEventListener("keyup", onInteractiveKeyUp);
            element.removeEventListener("blur", onInteractivePointerCancel);
        }
        springController?.destroy();
        springController = null;
        isPointerDragging = false;
        activeDragPointerId = null;
        hasDraggedBeyondThreshold = false;
        lastSpringDragX = 0;
        lastSpringDragY = 0;
        dragMotionSpeed = 0;
        pressGlow = 0;
        lightTiltHorizontal = 0;
        lightTiltVertical = 0;
        element.classList.remove("lg-interactive");
        element.removeAttribute("data-lg-draggable");
        element.removeAttribute("data-lg-dragging");
        element.style.removeProperty("--lg-spring-scale-x");
        element.style.removeProperty("--lg-spring-scale-y");
        element.style.removeProperty("--lg-stretch-matrix");
        element.style.removeProperty("--lg-drag-x");
        element.style.removeProperty("--lg-drag-y");
        element.style.removeProperty("--lg-press-glow");
    };

    const syncInteractive = () => {
        const dragMode = resolveDragMode();
        const enabled = isInteractiveElement() || dragMode !== null;
        if (!enabled) {
            detachInteractive();
            return;
        }

        if (dragMode !== null) {
            element.setAttribute("data-lg-draggable", dragMode);
        } else {
            element.removeAttribute("data-lg-draggable");
        }
        element.classList.add("lg-interactive");
        if (!springController) {
            springController = createInteractiveSpring(
                (frame) => {
                    element.style.setProperty("--lg-spring-scale-x", frame.scaleX.toFixed(4));
                    element.style.setProperty("--lg-spring-scale-y", frame.scaleY.toFixed(4));
                    const [m11, m12, m21, m22] = frame.stretchMatrix;
                    element.style.setProperty(
                        "--lg-stretch-matrix",
                        `matrix(${m11.toFixed(4)}, ${m12.toFixed(4)}, ${m21.toFixed(4)}, ${m22.toFixed(4)}, 0, 0)`,
                    );
                    if (frame.dragX !== 0 || frame.dragY !== 0) {
                        element.style.setProperty("--lg-drag-x", `${frame.dragX.toFixed(2)}px`);
                        element.style.setProperty("--lg-drag-y", `${frame.dragY.toFixed(2)}px`);
                    }
                    element.style.setProperty("--lg-press-glow", frame.glow.toFixed(3));
                    const prevGlow = pressGlow;
                    const prevTiltH = lightTiltHorizontal;
                    const prevTiltV = lightTiltVertical;
                    const dragMoved =
                        Math.abs(frame.dragX - lastSpringDragX) > 0.25 ||
                        Math.abs(frame.dragY - lastSpringDragY) > 0.25;
                    pressGlow = frame.glow;
                    lightTiltHorizontal = frame.tiltHorizontal;
                    lightTiltVertical = frame.tiltVertical;
                    lastSpringDragX = frame.dragX;
                    lastSpringDragY = frame.dragY;
                    dragMotionSpeed = Math.hypot(frame.velocityX, frame.velocityY);
                    if (dragMoved) {
                        syncCoalescenceState(dragMotionSpeed, true);
                    }
                    if (
                        activeEngine === "webgl" &&
                        (dragMoved ||
                            Math.abs(frame.glow - prevGlow) > 0.004 ||
                            Math.abs(frame.tiltHorizontal - prevTiltH) > 0.004 ||
                            Math.abs(frame.tiltVertical - prevTiltV) > 0.004)
                    ) {
                        scheduleWebglRender();
                    }
                },
                () => {
                    const prevGlow = pressGlow;
                    const prevTiltH = lightTiltHorizontal;
                    const prevTiltV = lightTiltVertical;
                    const prevDrag = Math.abs(lastSpringDragX) > 0.25 || Math.abs(lastSpringDragY) > 0.25;
                    pressGlow = 0;
                    lightTiltHorizontal = 0;
                    lightTiltVertical = 0;
                    dragMotionSpeed = 0;
                    element.style.removeProperty("--lg-spring-scale-x");
                    element.style.removeProperty("--lg-spring-scale-y");
                    element.style.removeProperty("--lg-stretch-matrix");
                    element.style.removeProperty("--lg-drag-x");
                    element.style.removeProperty("--lg-drag-y");
                    lastSpringDragX = 0;
                    lastSpringDragY = 0;
                    element.style.removeProperty("--lg-press-glow");
                    syncCoalescenceState(0, true);
                    if (
                        activeEngine === "webgl" &&
                        (prevDrag ||
                            prevGlow > 0.004 ||
                            Math.abs(prevTiltH) > 0.004 ||
                            Math.abs(prevTiltV) > 0.004)
                    ) {
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
            element.addEventListener("pointermove", onInteractivePointerMove, { passive: true });
            element.addEventListener("pointerup", onInteractivePointerUp, { passive: true });
            element.addEventListener("pointercancel", onInteractivePointerCancel, { passive: true });
            element.addEventListener("pointerleave", onInteractivePointerCancel, { passive: true });
            element.addEventListener("click", onInteractiveClickCapture, true);
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

    const syncCoalescenceRegistration = () => {
        if (options.coalesce === false) {
            unregisterCoalescence?.();
            unregisterCoalescence = null;
            element.removeAttribute("data-lg-coalescing");
            element.style.removeProperty("--lg-bleed");
            element.style.removeProperty("--lg-interference");
            return;
        }
        if (unregisterCoalescence) return;
        unregisterCoalescence = registerCoalescenceParticipant({
            element,
            readBounds: readCoalescenceBounds,
            notifyPeerUpdate: () => {
                if (destroyed) return;
                if (activeEngine === "webgl") {
                    scheduleWebglRender();
                } else {
                    applyCoalescenceVisuals();
                }
            },
        });
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
                syncCoalescenceRegistration();
                applyEngine();
            }
        });
    }

    syncCoalescenceRegistration();

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
            syncCoalescenceRegistration();
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
                if (targetEngine === "webgl" && activeEngine === "css" && isWebglSlotOnStandby(webglPoolEntry)) {
                    return;
                }
                applyEngine();
                return;
            }
            if (activeEngine === "webgl") {
                const nextBackdropKey = getSceneBackdropKey();
                if (localSceneCapture && nextBackdropKey !== lastSceneBackdropKey) {
                    lastSceneBackdropKey = nextBackdropKey;
                    localSceneCapture.scheduleCapture();
                }
                syncCoalescenceState(0, true);
                scheduleWebglRender();
            } else if (activeEngine === "wasm-svg") {
                cachedRadiusStr = null;
                const existingState = elementStateMap.get(element);
                if (existingState) existingState.cachedRadiusStr = null;
                registerManagedElement(element, config);
                syncCoalescenceState(0, true);
                applyCoalescenceVisuals();
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
            unregisterCoalescence?.();
            unregisterCoalescence = null;
            teardownWebgl();
            releaseWebglSlot(webglPoolEntry, true);
            unregisterManagedElement(element);
            element.classList.remove("lg-on", "lg-hollow", "lg-interactive");
            element.removeAttribute("data-lg-surface");
            element.removeAttribute("data-lg-engine");
            element.removeAttribute("data-lg-pill");
            element.removeAttribute("data-lg-webgl-scene");
            element.removeAttribute("data-lg-coalescing");
            element.style.removeProperty("--lg-filter");
            element.style.removeProperty("--lg-tint");
            element.style.removeProperty("--lg-bg");
            element.style.removeProperty("--lg-radius");
            element.style.removeProperty("--lg-rim-opacity");
            element.style.removeProperty("--lg-bleed");
            element.style.removeProperty("--lg-interference");
        },
    };
}

export { isWasmReady };
