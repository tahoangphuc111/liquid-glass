import { resolveRefractionBezel } from "./refractionBounds.js";
import {
    formatCssFallbackFilter,
    formatGlassCoreFilter,
    parseCssCornerRadiusPx,
    resolveGlassConfig,
    resolveGlassSharpness,
    resolveGlassTheme,
    resolvePresetOptions,
    resolveSharpnessPixelRatio,
} from "./config.js";
import {
    EMPTY_COALESCENCE_SNAPSHOT,
    clearCoalescenceGeometry,
    collectCoalescenceSnapshot,
    registerCoalescenceParticipant,
    syncCoalescenceGeometry,
} from "./coalescence.js";
import {
    elementStateMap,
    registerControllerOwnedElement,
    registerManagedElement,
    unregisterControllerOwnedElement,
    unregisterManagedElement,
} from "./engine.js";
import {
    canUseSvgGlass,
    getMediaQueries,
    observeSharedElementResize,
    resolveGlassEngine,
    subscribeBatteryChanges,
} from "./observer.js";
import { acquireSharedSceneCapture, subscribeSceneCanvas } from "./sceneCapture.js";
import { createInteractiveSpring, predictMomentumOffset, type SpringController } from "./spring.js";
import type {
    GlassConfig,
    GlassEngine,
    GlassLightTiltMode,
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
import { GlassWebglRenderer, parseCssColorToRgb, type GlassFrameParams } from "./webglRenderer.js";

const DEFAULT_DARK_TINT_RGB: [number, number, number] = [28 / 255, 28 / 255, 30 / 255];
const DEFAULT_DARK_GLIDER_TINT_RGB: [number, number, number] = [142 / 255, 142 / 255, 147 / 255];

const visibilityHandlers = new WeakMap<Element, Set<(isVisible: boolean) => void>>();
const observedVisibilityElements = new Set<Element>();
let sharedVisibilityObserver: IntersectionObserver | null = null;
let sharedVisibilityObserverCtor: typeof IntersectionObserver | null = null;

function observeElementVisibility(
    targetElement: Element,
    onVisibilityChange: (isVisible: boolean) => void,
): () => void {
    if (typeof IntersectionObserver !== "function") {
        return () => {};
    }
    if (!sharedVisibilityObserver || sharedVisibilityObserverCtor !== IntersectionObserver) {
        sharedVisibilityObserver?.disconnect();
        sharedVisibilityObserverCtor = IntersectionObserver;
        sharedVisibilityObserver = new IntersectionObserver(
            (entries) => {
                for (let index = 0; index < entries.length; index++) {
                    const entry = entries[index]!;
                    const handlers = visibilityHandlers.get(entry.target);
                    if (!handlers || handlers.size === 0) continue;
                    if (handlers.size === 1) {
                        for (const handler of handlers) handler(entry.isIntersecting);
                    } else {
                        for (const handler of Array.from(handlers)) handler(entry.isIntersecting);
                    }
                }
            },
            { rootMargin: "120px" },
        );
        for (const existingElement of observedVisibilityElements) {
            sharedVisibilityObserver.observe(existingElement);
        }
    }
    let handlers = visibilityHandlers.get(targetElement);
    if (!handlers) {
        handlers = new Set();
        visibilityHandlers.set(targetElement, handlers);
        observedVisibilityElements.add(targetElement);
        sharedVisibilityObserver.observe(targetElement);
    }
    handlers.add(onVisibilityChange);

    let active = true;
    return () => {
        if (!active) return;
        active = false;
        const set = visibilityHandlers.get(targetElement);
        if (set) {
            set.delete(onVisibilityChange);
            if (set.size === 0) {
                visibilityHandlers.delete(targetElement);
                observedVisibilityElements.delete(targetElement);
                sharedVisibilityObserver?.unobserve(targetElement);
                if (observedVisibilityElements.size === 0) {
                    sharedVisibilityObserver?.disconnect();
                    sharedVisibilityObserver = null;
                    sharedVisibilityObserverCtor = null;
                }
            }
        }
    };
}

const pointerTiltListeners = new Set<(horizontal: number, vertical: number) => void>();
const gyroTiltListeners = new Set<(horizontal: number, vertical: number) => void>();
let pointerTiltBound = false;
let gyroTiltBound = false;

function handleGlobalPointerTilt(event: PointerEvent): void {
    if (typeof window === "undefined") return;
    const viewportW = Math.max(1, window.innerWidth || 1);
    const viewportH = Math.max(1, window.innerHeight || 1);
    const horizontal = Math.max(-1, Math.min(1, (event.clientX / viewportW) * 2 - 1));
    const vertical = Math.max(-1, Math.min(1, -((event.clientY / viewportH) * 2 - 1)));
    for (const listener of pointerTiltListeners) {
        listener(horizontal, vertical);
    }
}

function resolveScreenOrientationAngle(): number {
    if (typeof window === "undefined") return 0;
    const screenOrientationAngle =
        typeof screen !== "undefined" &&
        screen.orientation &&
        typeof screen.orientation.angle === "number"
            ? screen.orientation.angle
            : typeof (window as Window & { orientation?: number }).orientation === "number"
              ? (window as Window & { orientation?: number }).orientation!
              : 0;
    const normalized = ((Math.round(screenOrientationAngle / 90) * 90) % 360 + 360) % 360;
    return normalized;
}

function handleGlobalDeviceOrientation(event: DeviceOrientationEvent): void {
    const gamma = typeof event.gamma === "number" && Number.isFinite(event.gamma) ? event.gamma : 0;
    const rawBeta = typeof event.beta === "number" && Number.isFinite(event.beta) ? event.beta : 45;
    const orientationAngle = resolveScreenOrientationAngle();
    let tiltX: number;
    let tiltY: number;
    if (orientationAngle === 90) {
        tiltX = rawBeta;
        tiltY = gamma + 45;
    } else if (orientationAngle === 270) {
        tiltX = -rawBeta;
        tiltY = -(gamma - 45);
    } else if (orientationAngle === 180) {
        tiltX = -gamma;
        tiltY = rawBeta + 45;
    } else {
        tiltX = gamma;
        tiltY = -(rawBeta - 45);
    }
    const horizontal = Math.max(-1, Math.min(1, tiltX / 45));
    const vertical = Math.max(-1, Math.min(1, tiltY / 45));
    for (const listener of gyroTiltListeners) {
        listener(horizontal, vertical);
    }
}

export async function requestDeviceTiltPermission(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    const deviceOrientationCtor = (
        window as Window & {
            DeviceOrientationEvent?: {
                requestPermission?: () => Promise<string>;
            };
        }
    ).DeviceOrientationEvent;
    if (!deviceOrientationCtor) return false;
    if (typeof deviceOrientationCtor.requestPermission === "function") {
        try {
            const state = await deviceOrientationCtor.requestPermission();
            return state === "granted";
        } catch {
            return false;
        }
    }
    return true;
}

function subscribeAmbientLightTilt(
    mode: "pointer" | "gyro",
    listener: (horizontal: number, vertical: number) => void,
): () => void {
    if (typeof window === "undefined") return () => {};
    if (mode === "pointer") {
        pointerTiltListeners.add(listener);
        if (!pointerTiltBound) {
            pointerTiltBound = true;
            window.addEventListener("pointermove", handleGlobalPointerTilt, { passive: true });
        }
        return () => {
            pointerTiltListeners.delete(listener);
            if (pointerTiltListeners.size === 0 && pointerTiltBound) {
                pointerTiltBound = false;
                window.removeEventListener("pointermove", handleGlobalPointerTilt);
            }
        };
    }

    gyroTiltListeners.add(listener);
    if (!gyroTiltBound) {
        gyroTiltBound = true;
        window.addEventListener("deviceorientation", handleGlobalDeviceOrientation, { passive: true });
    }
    return () => {
        gyroTiltListeners.delete(listener);
        if (gyroTiltListeners.size === 0 && gyroTiltBound) {
            gyroTiltBound = false;
            window.removeEventListener("deviceorientation", handleGlobalDeviceOrientation);
        }
    };
}

function extractStaticLightTilt(lightTilt: GlassLightTiltMode | undefined): {
    horizontal: number;
    vertical: number;
} {
    if (lightTilt && typeof lightTilt === "object") {
        const h = Number.isFinite(lightTilt.horizontal) ? lightTilt.horizontal : 0;
        const v = Number.isFinite(lightTilt.vertical) ? lightTilt.vertical : 0;
        return {
            horizontal: Math.max(-1, Math.min(1, h)),
            vertical: Math.max(-1, Math.min(1, v)),
        };
    }
    return { horizontal: 0, vertical: 0 };
}

function formatTintCssValue(
    tintColor: string | undefined,
    tintOpacity: number | undefined,
): string | null {
    if (tintColor !== undefined) {
        if (tintOpacity === undefined || !Number.isFinite(tintOpacity)) {
            return tintColor;
        }
        const [r, g, b] = parseCssColorToRgb(tintColor);
        const alpha = Math.min(1, Math.max(0, tintOpacity));
        return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${Number(alpha.toFixed(4))})`;
    }
    if (tintOpacity !== undefined && Number.isFinite(tintOpacity)) {
        const alpha = Math.min(1, Math.max(0, tintOpacity));
        return `rgba(255, 255, 255, ${Number(alpha.toFixed(4))})`;
    }
    return null;
}

interface ViewportSubscriber {
    prepareViewportFrame(viewportChanged: boolean): void;
    commitViewportFrame(): void;
    onDocumentVisibilityChange(): void;
}

const viewportSubscribers = new Set<ViewportSubscriber>();
let sharedViewportListenersAttached = false;
let sharedViewportRafId: number | null = null;
const viewportSourceRects = new Map<HTMLElement, DOMRect>();
let queuedViewportSubscribers = new Set<ViewportSubscriber>();
let spareViewportSubscribers = new Set<ViewportSubscriber>();
let preparingViewportSubscribers: Set<ViewportSubscriber> | null = null;
let viewportChanged = false;

function scheduleViewportFrame(): void {
    if (sharedViewportRafId !== null || typeof requestAnimationFrame !== "function") return;
    sharedViewportRafId = requestAnimationFrame(flushViewportFrame);
}

function flushViewportFrame(): void {
    sharedViewportRafId = null;
    const subscribers = queuedViewportSubscribers;
    const movedViewport = viewportChanged;
    viewportChanged = false;
    queuedViewportSubscribers = spareViewportSubscribers;
    queuedViewportSubscribers.clear();
    if (movedViewport) {
        for (const subscriber of viewportSubscribers) subscribers.add(subscriber);
    }

    preparingViewportSubscribers = subscribers;
    try {
        for (const subscriber of subscribers) subscriber.prepareViewportFrame(movedViewport);
        preparingViewportSubscribers = null;
        for (const subscriber of subscribers) subscriber.commitViewportFrame();
    } finally {
        preparingViewportSubscribers = null;
        subscribers.clear();
        spareViewportSubscribers = subscribers;
        viewportSourceRects.clear();
    }
}

function onSharedViewportEvent(): void {
    viewportChanged = true;
    scheduleViewportFrame();
}

function onSharedDocumentVisibilityChange(): void {
    for (const sub of viewportSubscribers) {
        sub.onDocumentVisibilityChange();
    }
}

function registerViewportSubscriber(subscriber: ViewportSubscriber): () => void {
    viewportSubscribers.add(subscriber);
    if (!sharedViewportListenersAttached && typeof window !== "undefined") {
        sharedViewportListenersAttached = true;
        window.addEventListener("scroll", onSharedViewportEvent, { capture: true, passive: true });
        window.addEventListener("resize", onSharedViewportEvent, { passive: true });
        if (typeof document !== "undefined") {
            document.addEventListener("visibilitychange", onSharedDocumentVisibilityChange, {
                passive: true,
            });
        }
    }
    let active = true;
    return () => {
        if (!active) return;
        active = false;
        viewportSubscribers.delete(subscriber);
        queuedViewportSubscribers.delete(subscriber);
        preparingViewportSubscribers?.delete(subscriber);
        if (viewportSubscribers.size === 0 && sharedViewportListenersAttached) {
            sharedViewportListenersAttached = false;
            viewportChanged = false;
            if (sharedViewportRafId !== null && typeof cancelAnimationFrame === "function") {
                cancelAnimationFrame(sharedViewportRafId);
                sharedViewportRafId = null;
            }
            if (typeof window !== "undefined") {
                window.removeEventListener("scroll", onSharedViewportEvent, true);
                window.removeEventListener("resize", onSharedViewportEvent);
            }
            if (typeof document !== "undefined") {
                document.removeEventListener("visibilitychange", onSharedDocumentVisibilityChange);
            }
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
    const parsed = parseCssCornerRadiusPx(rawRadius, width, height);
    if (parsed !== null && Number.isFinite(parsed)) {
        return { radius: Math.min(Math.max(parsed, 0), halfMin), rawRadiusStr: rawRadius };
    }
    const fallback = config.radius ?? Math.min(Math.round(height * 0.5), 24);
    return { radius: Math.min(Math.max(fallback, 0), halfMin), rawRadiusStr: rawRadius };
}

function sameWebglFrame(frame: GlassFrameParams, previous: GlassFrameParams): boolean {
    if (
        frame.width !== previous.width || frame.height !== previous.height ||
        frame.radius !== previous.radius || frame.cornerStyle !== previous.cornerStyle ||
        frame.bezel !== previous.bezel || frame.thickness !== previous.thickness ||
        frame.scaleRatio !== previous.scaleRatio || frame.ior !== previous.ior ||
        frame.adaptiveRefraction !== previous.adaptiveRefraction ||
        frame.refractionDirection !== previous.refractionDirection ||
        frame.refractionEdgeFade !== previous.refractionEdgeFade ||
        frame.maxRefractionPx !== previous.maxRefractionPx ||
        frame.maxScaleMultiplier !== previous.maxScaleMultiplier ||
        frame.blur !== previous.blur || frame.sharpness !== previous.sharpness || frame.saturation !== previous.saturation || frame.surface !== previous.surface ||
        frame.tintColor !== previous.tintColor || frame.tintOpacity !== previous.tintOpacity ||
        frame.highlight !== previous.highlight || frame.darkRimScale !== previous.darkRimScale ||
        frame.pixelRatio !== previous.pixelRatio || frame.chromaticAberration !== previous.chromaticAberration ||
        frame.abbeNumber !== previous.abbeNumber || frame.bleedPx !== previous.bleedPx ||
        frame.lightTilt?.horizontal !== previous.lightTilt?.horizontal ||
        frame.lightTilt?.vertical !== previous.lightTilt?.vertical ||
        frame.sceneRect?.relX !== previous.sceneRect?.relX || frame.sceneRect?.relY !== previous.sceneRect?.relY ||
        frame.sceneRect?.relW !== previous.sceneRect?.relW || frame.sceneRect?.relH !== previous.sceneRect?.relH
    ) {
        return false;
    }

    const peers = frame.coalescePeers;
    const previousPeers = previous.coalescePeers;
    if (peers === previousPeers) return true;
    if (!peers || !previousPeers || peers.length !== previousPeers.length) return false;
    return peers.every((peer, index) => {
        const old = previousPeers[index]!;
        return peer.relCenterX === old.relCenterX && peer.relCenterY === old.relCenterY &&
            peer.halfWidth === old.halfWidth && peer.halfHeight === old.halfHeight &&
            peer.radius === old.radius && peer.mergeRadius === old.mergeRadius &&
            peer.wavePhase === old.wavePhase && peer.priorityWinsTie === old.priorityWinsTie;
    });
}

export function createLiquidGlass(
    element: HTMLElement,
    initialOptions: LiquidGlassOptions = {},
): LiquidGlassInstance {
    return createLiquidGlassController(element, initialOptions);
}

export function createLiquidGlassController(
    element: HTMLElement,
    initialOptions: LiquidGlassOptions,
): LiquidGlassInstance & { refreshMotion(sceneChanged?: boolean): void } {
    let options: LiquidGlassOptions = { ...initialOptions };
    let effectiveOptions: LiquidGlassOptions = resolvePresetOptions(options);
    let config = resolveGlassConfig(options);
    let webglCoreFilter = formatGlassCoreFilter(config.coreFilter, config.saturation);
    let activeEngine: GlassEngine = "css";
    let hasInitializedEngine = false;
    let destroyed = false;

    let cachedRadiusStr: string | null = null;
    let webglCanvas: HTMLCanvasElement | null = null;
    let webglRenderer: GlassWebglRenderer | null = null;
    let webglContextLost = false;
    let unobserveResize: (() => void) | null = null;
    let unregisterViewport: (() => void) | null = null;
    let localSceneCapture: SceneCaptureController | null = null;
    let unsubscribeCapture: (() => void) | null = null;
    let externalSceneCanvas: HTMLCanvasElement | null = options.sceneCanvas ?? null;
    let observedSceneCanvas: HTMLCanvasElement | null = null;
    let unsubscribeSceneCanvas: (() => void) | null = null;
    let observedSceneSource: HTMLElement | null = null;
    let unobserveSceneSource: (() => void) | null = null;
    let capturedSceneCanvas: HTMLCanvasElement | null = null;
    let sceneUploadPending = false;
    let lastSceneWidth = 0;
    let lastSceneHeight = 0;
    let lastSceneSharpness = 0;
    let lastCaptureQualityKey = "";
    let sceneEl: HTMLElement | null = options.sceneElement ?? null;
    let notifyPeersOnRender = false;
    let lastSceneBackdropKey = "";
    let lastFastBackdropAttrKey = "";
    let listenersAttached = false;
    let unsubscribeBattery: (() => void) | null = null;
    let isViewportVisible = true;
    let pendingVisibleRender = false;
    let unobserveVisibility: (() => void) | null = null;

    const getFastSceneBackdropAttrKey = (): string => {
        if (typeof document === "undefined") return "";
        const source = sceneEl ?? options.sceneElement;
        const docEl = document.documentElement;
        const body = document.body;
        return `${docEl.className}|${docEl.getAttribute("data-theme") ?? ""}|${docEl.getAttribute("data-color-scheme") ?? ""}|${body?.className ?? ""}|${source?.className ?? ""}|${source?.getAttribute("style") ?? ""}`;
    };

    const getSceneBackdropKey = (): string => {
        if (typeof document === "undefined" || typeof window === "undefined") return "";
        const fastKey = getFastSceneBackdropAttrKey();
        if (lastSceneBackdropKey && fastKey === lastFastBackdropAttrKey) {
            return lastSceneBackdropKey;
        }
        lastFastBackdropAttrKey = fastKey;
        const source = sceneEl ?? options.sceneElement;
        const sourceStyle =
            source && source.isConnected && typeof window.getComputedStyle === "function"
                ? window.getComputedStyle(source)
                : null;
        const sourceBg = sourceStyle ? `${sourceStyle.backgroundColor}|${sourceStyle.backgroundImage}` : "";
        return `${fastKey}|${sourceBg}`;
    };
    let springController: SpringController | null = null;
    let interactiveListenersAttached = false;
    let pressGlow = 0;
    let springTiltHorizontal = 0;
    let springTiltVertical = 0;
    const initialStaticTilt = extractStaticLightTilt(effectiveOptions.lightTilt);
    let baseLightTiltHorizontal = initialStaticTilt.horizontal;
    let baseLightTiltVertical = initialStaticTilt.vertical;
    let lightTiltHorizontal = baseLightTiltHorizontal;
    let lightTiltVertical = baseLightTiltVertical;
    let unsubAmbientLightTilt: (() => void) | null = null;
    let ambientLightMode: "pointer" | "gyro" | null = null;
    let pendingAmbientLightSync = false;
    let unsubWasmReady: (() => void) | null = null;
    let dragMotionSpeed = 0;
    let useDragResolution = false;
    let lastSpringDragX = 0;
    let lastSpringDragY = 0;
    let isPointerDragging = false;
    let activeDragPointerId: number | null = null;
    let activeFreeDragBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null;
    let dragStartClientX = 0;
    let dragStartClientY = 0;
    let lastDragClientX = 0;
    let lastDragClientY = 0;
    let lastDragTimestamp = 0;
    let dragVelocityX = 0;
    let dragVelocityY = 0;
    let hasDraggedBeyondThreshold = false;
    let freeDragRestX = 0;
    let freeDragRestY = 0;
    let dragOriginOffsetX = 0;
    let dragOriginOffsetY = 0;
    let activeDragMode: "elastic" | "free" | null = null;
    let lastConfiguredDragMode: "elastic" | "free" | null = null;
    let unregisterCoalescence: (() => void) | null = null;
    let unobserveCoalescenceResize: (() => void) | null = null;

    const hadSurfaceClass = element.classList.contains("lg-surface");
    element.setAttribute("data-lg-surface", "");
    element.classList.add("lg-surface");
    registerControllerOwnedElement(element);

    const hasSceneInput = (): boolean =>
        Boolean(externalSceneCanvas || sceneEl);

    const setEngine = (engine: GlassEngine) => {
        const changed = !hasInitializedEngine || activeEngine !== engine;
        hasInitializedEngine = true;
        activeEngine = engine;
        if (element.getAttribute("data-lg-engine") !== engine) element.setAttribute("data-lg-engine", engine);
        return changed;
    };

    let resolvedTheme: "light" | "dark" = resolveGlassTheme(effectiveOptions.theme, element);
    let lastThemeAttr = "";
    let lastThemeSig = "";
    let lastRefractionAxisAttr = "";
    let lastRefractionFadeCss: string | null = null;
    let lastPillAttr: boolean | null = null;
    let lastRadiusCss: string | null | undefined = undefined;
    let lastCornerStyleAttr = "";
    let lastRimOpacityCss: string | null | undefined = undefined;
    let lastSvgBgCss: string | null | undefined = undefined;
    let lastSvgGeometrySig = "";

    const syncThemeAttribute = (force = false) => {
        const docEl = typeof document !== "undefined" ? document.documentElement : null;
        const bodyEl = typeof document !== "undefined" ? document.body : null;
        const nextThemeSig = `${effectiveOptions.theme ?? "auto"}|${docEl?.className ?? ""}|${docEl?.getAttribute("data-theme") ?? ""}|${docEl?.getAttribute("data-color-scheme") ?? ""}|${docEl?.getAttribute("style") ?? ""}|${bodyEl?.className ?? ""}|${bodyEl?.getAttribute("data-theme") ?? ""}`;
        if (!force && lastThemeAttr && nextThemeSig === lastThemeSig) {
            return;
        }
        lastThemeSig = nextThemeSig;
        resolvedTheme = resolveGlassTheme(effectiveOptions.theme, element);
        if (lastThemeAttr !== resolvedTheme) {
            lastThemeAttr = resolvedTheme;
            element.setAttribute("data-lg-theme", resolvedTheme);
        }
    };

    const syncPillAttribute = () => {
        syncThemeAttribute();
        const direction = config.refractionDirection ?? "all";
        if (lastRefractionAxisAttr !== direction) {
            lastRefractionAxisAttr = direction;
            element.setAttribute("data-lg-refraction-axis", direction);
        }
        const nextRefractionFade =
            direction === "all" ? null : `${(config.refractionEdgeFade ?? 0.35) * 50}%`;
        if (lastRefractionFadeCss !== nextRefractionFade) {
            lastRefractionFadeCss = nextRefractionFade;
            if (nextRefractionFade === null) {
                element.style.removeProperty("--lg-refraction-fade");
            } else {
                element.style.setProperty("--lg-refraction-fade", nextRefractionFade);
            }
        }
        let radiusShapeChanged = false;
        if (lastPillAttr !== config.pill) {
            lastPillAttr = config.pill;
            radiusShapeChanged = true;
            if (config.pill) {
                element.setAttribute("data-lg-pill", "true");
            } else {
                element.removeAttribute("data-lg-pill");
            }
        }
        const nextRadiusCss = config.pill
            ? null
            : effectiveOptions.radius !== undefined
              ? `${Math.max(0, config.radius)}px`
              : null;
        if (lastRadiusCss !== nextRadiusCss) {
            lastRadiusCss = nextRadiusCss;
            radiusShapeChanged = true;
            if (nextRadiusCss === null) {
                element.style.removeProperty("--lg-radius");
            } else {
                element.style.setProperty("--lg-radius", nextRadiusCss);
            }
        }
        const nextCornerStyle = config.cornerStyle === "squircle" ? "squircle" : "";
        if (lastCornerStyleAttr !== nextCornerStyle) {
            lastCornerStyleAttr = nextCornerStyle;
            radiusShapeChanged = true;
            if (nextCornerStyle) {
                element.setAttribute("data-lg-corner-style", nextCornerStyle);
            } else {
                element.removeAttribute("data-lg-corner-style");
            }
        }
        const nextRimOpacity =
            effectiveOptions.highlight !== undefined
                ? String(Math.min(1, Math.max(0, effectiveOptions.highlight)))
                : null;
        if (lastRimOpacityCss !== nextRimOpacity) {
            lastRimOpacityCss = nextRimOpacity;
            if (nextRimOpacity === null) {
                element.style.removeProperty("--lg-rim-opacity");
            } else {
                element.style.setProperty("--lg-rim-opacity", nextRimOpacity);
            }
        }
        if (radiusShapeChanged) {
            cachedRadiusStr = null;
            const existingState = elementStateMap.get(element);
            if (existingState) {
                existingState.cachedRadiusStr = null;
            }
        }
    };

    let cachedTintColorRaw: string | undefined;
    let cachedTintColorRgb: [number, number, number] = parseCssColorToRgb(effectiveOptions.tintColor);
    let lastCoalescingState = false;
    let lastBleedPx = -1;
    let lastInterferenceStr = "";
    let lastWebglSceneState = "";
    let lastWebglCoreFilter = "";

    let lastRenderedFrame: GlassFrameParams | null = null;
    let lastDevicePixelRatio = 0;
    const lightTiltSlots: [{ horizontal: number; vertical: number }, { horizontal: number; vertical: number }] = [
        { horizontal: 0, vertical: 0 },
        { horizontal: 0, vertical: 0 },
    ];
    const sceneRectSlots: [
        { relX: number; relY: number; relW: number; relH: number },
        { relX: number; relY: number; relW: number; relH: number },
    ] = [
        { relX: 0, relY: 0, relW: 1, relH: 1 },
        { relX: 0, relY: 0, relW: 1, relH: 1 },
    ];
    const frameSlots: [GlassFrameParams, GlassFrameParams] = [
        {
            width: 0, height: 0, radius: 0, bezel: 0, thickness: 0, scaleRatio: 0,
            ior: 1.5, blur: 0, surface: config.surface, tintColor: cachedTintColorRgb,
            tintOpacity: 0.07, highlight: 0.62,
        },
        {
            width: 0, height: 0, radius: 0, bezel: 0, thickness: 0, scaleRatio: 0,
            ior: 1.5, blur: 0, surface: config.surface, tintColor: cachedTintColorRgb,
            tintOpacity: 0.07, highlight: 0.62,
        },
    ];
    let nextFrameSlot = 0;

    const computeSceneRect = (
        bounds: { left: number; top: number; width: number; height: number },
        targetSlot: { relX: number; relY: number; relW: number; relH: number },
    ) => {
        const source = sceneEl ?? options.sceneElement;
        if (!source) {
            targetSlot.relX = 0;
            targetSlot.relY = 0;
            targetSlot.relW = 1;
            targetSlot.relH = 1;
            return targetSlot;
        }
        if (!source.isConnected) return undefined;
        let sourceRect = viewportSourceRects.get(source);
        if (!sourceRect) {
            sourceRect = source.getBoundingClientRect();
            viewportSourceRects.set(source, sourceRect);
        }
        if (sourceRect.width < 2 || sourceRect.height < 2) return undefined;
        targetSlot.relX = (bounds.left - sourceRect.left) / sourceRect.width;
        targetSlot.relY = (bounds.top - sourceRect.top) / sourceRect.height;
        targetSlot.relW = bounds.width / sourceRect.width;
        targetSlot.relH = bounds.height / sourceRect.height;
        return targetSlot;
    };

    const readCoalescenceBounds = () => {
        if (destroyed || !element.isConnected) return null;
        const rect = element.getBoundingClientRect();
        const rawOffsetWidth = element.offsetWidth;
        const rawOffsetHeight = element.offsetHeight;
        const width =
            rawOffsetWidth > 0
                ? rect.width > 0 && Math.abs(rect.width - rawOffsetWidth) < 1
                    ? rect.width
                    : rawOffsetWidth
                : rect.width;
        const height =
            rawOffsetHeight > 0
                ? rect.height > 0 && Math.abs(rect.height - rawOffsetHeight) < 1
                    ? rect.height
                    : rawOffsetHeight
                : rect.height;
        if (width < 2 || height < 2) return null;
        const radiusResult = computeCornerRadiusPx(element, width, height, config, cachedRadiusStr);
        cachedRadiusStr = radiusResult.rawRadiusStr;
        const radius = radiusResult.radius;
        const bezel = resolveRefractionBezel(Math.min(width, height), config.bezel, config.adaptiveRefraction === true);
        const unstretchedLeft = (rect.left + rect.right) * 0.5 - width * 0.5;
        const unstretchedTop = (rect.top + rect.bottom) * 0.5 - height * 0.5;
        return { left: unstretchedLeft, top: unstretchedTop, width, height, radius, bezel };
    };

    const syncCoalescenceState = (motionImpulse = 0, notifyPeers = true) => {
        if (effectiveOptions.coalesce === false) return;
        const bounds = readCoalescenceBounds();
        if (!bounds) {
            clearCoalescenceGeometry(element);
            return;
        }
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
        if (effectiveOptions.coalesce === false) {
            if (lastCoalescingState) {
                lastCoalescingState = false;
                lastBleedPx = -1;
                lastInterferenceStr = "";
                element.removeAttribute("data-lg-coalescing");
                element.style.removeProperty("--lg-bleed");
                element.style.removeProperty("--lg-interference");
            }
            return EMPTY_COALESCENCE_SNAPSHOT;
        }
        const snapshot = collectCoalescenceSnapshot(element);
        if (snapshot.peers.length > 0) {
            if (!lastCoalescingState) {
                lastCoalescingState = true;
                element.setAttribute("data-lg-coalescing", "1");
            }
            if (snapshot.requiredBleedPx !== lastBleedPx) {
                lastBleedPx = snapshot.requiredBleedPx;
                element.style.setProperty("--lg-bleed", `${snapshot.requiredBleedPx}px`);
            }
            const nextInterference = snapshot.interferenceIntensity.toFixed(3);
            if (nextInterference !== lastInterferenceStr) {
                lastInterferenceStr = nextInterference;
                element.style.setProperty("--lg-interference", nextInterference);
            }
        } else if (lastCoalescingState) {
            lastCoalescingState = false;
            lastBleedPx = -1;
            lastInterferenceStr = "";
            element.removeAttribute("data-lg-coalescing");
            element.style.removeProperty("--lg-bleed");
            element.style.removeProperty("--lg-interference");
        }
        return snapshot;
    };

    let lastLightXCss = "";
    let lastLightYCss = "";
    let lastLightAngleCss = "";
    let lastLightXQuant = 0;
    let lastLightYQuant = 0;

    const clearLightTiltCssVars = () => {
        lastLightXQuant = 0;
        lastLightYQuant = 0;
        if (lastLightXCss) {
            lastLightXCss = "";
            element.style.removeProperty("--lg-light-x");
        }
        if (lastLightYCss) {
            lastLightYCss = "";
            element.style.removeProperty("--lg-light-y");
        }
        if (lastLightAngleCss) {
            lastLightAngleCss = "";
            element.style.removeProperty("--lg-light-angle");
        }
    };

    const syncEffectiveLightTilt = () => {
        lightTiltHorizontal = Math.max(-1, Math.min(1, baseLightTiltHorizontal + springTiltHorizontal));
        lightTiltVertical = Math.max(-1, Math.min(1, baseLightTiltVertical + springTiltVertical));
        if (Math.abs(lightTiltHorizontal) > 0.002 || Math.abs(lightTiltVertical) > 0.002) {
            const xQuant = Math.round(lightTiltHorizontal * 1000);
            const yQuant = Math.round(lightTiltVertical * 1000);
            if (xQuant === lastLightXQuant && yQuant === lastLightYQuant && lastLightAngleCss) {
                return;
            }
            if (xQuant !== lastLightXQuant || !lastLightXCss) {
                lastLightXQuant = xQuant;
                const nextLightX = (xQuant * 0.001).toFixed(3);
                lastLightXCss = nextLightX;
                element.style.setProperty("--lg-light-x", nextLightX);
            }
            if (yQuant !== lastLightYQuant || !lastLightYCss) {
                lastLightYQuant = yQuant;
                const nextLightY = (yQuant * 0.001).toFixed(3);
                lastLightYCss = nextLightY;
                element.style.setProperty("--lg-light-y", nextLightY);
            }
            const angleDeg =
                180 +
                Math.atan2(
                    lightTiltHorizontal * 0.42,
                    Math.max(0.6, 1.0 + lightTiltVertical * 0.25),
                ) *
                    (180 / Math.PI);
            const nextAngle = `${angleDeg.toFixed(1)}deg`;
            if (nextAngle !== lastLightAngleCss) {
                lastLightAngleCss = nextAngle;
                element.style.setProperty("--lg-light-angle", nextAngle);
            }
        } else {
            clearLightTiltCssVars();
        }
    };

    interface PreparedWebglSnapshot {
        bounds: {
            left: number;
            top: number;
            width: number;
            height: number;
            radius: number;
            bezel: number;
        };
        activeSceneCanvas: HTMLCanvasElement | null;
        sceneRect: { relX: number; relY: number; relW: number; relH: number } | undefined;
    }
    const preparedSnapshotSlot: PreparedWebglSnapshot = {
        bounds: { left: 0, top: 0, width: 0, height: 0, radius: 0, bezel: 0 },
        activeSceneCanvas: null,
        sceneRect: undefined,
    };
    let hasPreparedViewportSnapshot = false;

    const syncWebglBackdrop = (hasScene: boolean) => {
        const nextState = hasScene ? "1" : "0";
        if (lastWebglSceneState !== nextState) {
            lastWebglSceneState = nextState;
            element.setAttribute("data-lg-webgl-scene", nextState);
        }
        const nextFilter = hasScene ? "" : webglCoreFilter;
        if (lastWebglCoreFilter !== nextFilter) {
            lastWebglCoreFilter = nextFilter;
            if (nextFilter) element.style.setProperty("--lg-filter", nextFilter);
            else element.style.removeProperty("--lg-filter");
        }
    };

    const drawWebglFrame = ({ bounds, activeSceneCanvas, sceneRect }: PreparedWebglSnapshot) => {
        if (destroyed || activeEngine !== "webgl" || !webglRenderer || webglContextLost) return;
        if (!isViewportVisible || (typeof document !== "undefined" && document.hidden)) {
            pendingVisibleRender = true;
            return;
        }

        const { width, height, radius, bezel } = bounds;
        const usableScene = sceneRect ? activeSceneCanvas : null;
        const sceneWidth = usableScene?.width ?? 0;
        const sceneHeight = usableScene?.height ?? 0;
        const effectiveSharpness = resolveGlassSharpness(config.sharpness, config.blur);
        if (
            (usableScene && (sceneUploadPending || effectiveSharpness !== lastSceneSharpness)) ||
            sceneWidth !== lastSceneWidth ||
            sceneHeight !== lastSceneHeight
        ) {
            lastRenderedFrame = null;
            if (effectiveSharpness > 0) {
                webglRenderer.setSceneCanvas(usableScene, effectiveSharpness);
            } else {
                webglRenderer.setSceneCanvas(usableScene);
            }
            lastSceneWidth = webglRenderer.hasSceneTexture ? sceneWidth : 0;
            lastSceneHeight = webglRenderer.hasSceneTexture ? sceneHeight : 0;
            lastSceneSharpness = webglRenderer.hasSceneTexture ? effectiveSharpness : 0;
        }
        sceneUploadPending = false;
        const hasSceneTex = webglRenderer.hasSceneTexture && sceneRect !== undefined;
        const coalescenceSnapshot = applyCoalescenceVisuals();

        if (effectiveOptions.tintColor !== cachedTintColorRaw) {
            cachedTintColorRaw = effectiveOptions.tintColor;
            cachedTintColorRgb = parseCssColorToRgb(effectiveOptions.tintColor);
        }
        const isDarkTheme = resolvedTheme === "dark";
        const isSwitchGlider = element.classList.contains("lg-switch-glider");
        const tintColor: [number, number, number] =
            effectiveOptions.tintColor === undefined && isDarkTheme
                ? (isSwitchGlider ? DEFAULT_DARK_GLIDER_TINT_RGB : DEFAULT_DARK_TINT_RGB)
                : cachedTintColorRgb;
        const tintOpacity = effectiveOptions.tintOpacity ?? (isDarkTheme ? 0.36 : 0.07);
        const baseHighlight = effectiveOptions.highlight ?? 0.62;
        const highlight = Math.min(1, (isDarkTheme ? baseHighlight * 0.80 : baseHighlight) + pressGlow);
        const rawDeviceDpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
        const sharpnessPixelRatio =
            effectiveSharpness > 0 ? resolveSharpnessPixelRatio(effectiveSharpness, rawDeviceDpr) : undefined;
        const baseDpr =
            effectiveOptions.pixelRatio ??
            sharpnessPixelRatio ??
            Math.min(2, rawDeviceDpr);
        const effectivePixelRatio =
            useDragResolution && (radius > 0 || effectiveOptions.pixelRatio !== undefined || sharpnessPixelRatio !== undefined)
                ? Math.min(baseDpr, Math.max(0.75, baseDpr * 0.7))
                : (effectiveOptions.pixelRatio ?? sharpnessPixelRatio);

        syncWebglBackdrop(hasSceneTex);

        const frame = frameSlots[nextFrameSlot]!;
        frame.width = width;
        frame.height = height;
        frame.radius = radius;
        frame.cornerStyle = config.cornerStyle;
        frame.bezel = bezel;
        frame.thickness = config.thickness;
        frame.scaleRatio = config.scaleRatio;
        frame.adaptiveRefraction = config.adaptiveRefraction;
        frame.refractionDirection = config.refractionDirection;
        frame.refractionEdgeFade = config.refractionEdgeFade;
        frame.maxRefractionPx = config.maxRefractionPx;
        frame.maxScaleMultiplier = config.maxScaleMultiplier;
        frame.ior = config.ior;
        frame.blur = config.blur;
        frame.sharpness = config.sharpness;
        frame.saturation = config.saturation ?? (isDarkTheme && config.blur >= 1 ? 1.32 : undefined);
        frame.surface = config.surface;
        frame.tintColor = tintColor;
        frame.tintOpacity = tintOpacity;
        frame.highlight = highlight;
        frame.darkRimScale = isSwitchGlider ? 0 : (isDarkTheme ? 0.60 : 1);
        frame.pixelRatio = effectivePixelRatio;
        frame.chromaticAberration = config.chromaticAberration;
        frame.abbeNumber = config.abbeNumber;
        if (lightTiltHorizontal !== 0 || lightTiltVertical !== 0) {
            const tiltSlot = lightTiltSlots[nextFrameSlot]!;
            tiltSlot.horizontal = lightTiltHorizontal;
            tiltSlot.vertical = lightTiltVertical;
            frame.lightTilt = tiltSlot;
        } else {
            frame.lightTilt = undefined;
        }
        frame.sceneRect = hasSceneTex ? sceneRect : undefined;
        frame.coalescePeers = coalescenceSnapshot.peers;
        frame.bleedPx = coalescenceSnapshot.requiredBleedPx;

        const devicePixelRatio = typeof window !== "undefined" ? window.devicePixelRatio : 1;
        if (
            lastRenderedFrame &&
            devicePixelRatio === lastDevicePixelRatio &&
            sameWebglFrame(frame, lastRenderedFrame)
        ) {
            return;
        }
        webglRenderer.render(frame);
        lastRenderedFrame = frame;
        nextFrameSlot ^= 1;
        lastDevicePixelRatio = devicePixelRatio;
    };

    const scheduleWebglRender = () => {
        if (destroyed || activeEngine !== "webgl" || webglContextLost) return;
        if (!isViewportVisible || (typeof document !== "undefined" && document.hidden)) {
            pendingVisibleRender = true;
            return;
        }
        if (preparingViewportSubscribers) {
            preparingViewportSubscribers.add(viewportSubscriber);
            return;
        }
        queuedViewportSubscribers.add(viewportSubscriber);
        scheduleViewportFrame();
    };

    const observeExternalScene = (canvas: HTMLCanvasElement | null, source: HTMLElement | null) => {
        if (canvas !== observedSceneCanvas) {
            unsubscribeSceneCanvas?.();
            observedSceneCanvas = canvas;
            unsubscribeSceneCanvas = canvas && subscribeSceneCanvas(canvas, () => {
                sceneUploadPending = true;
                scheduleWebglRender();
            });
        }
        if (source !== observedSceneSource) {
            unobserveSceneSource?.();
            observedSceneSource = source;
            unobserveSceneSource = source && observeSharedElementResize(source, scheduleWebglRender);
        }
    };

    const handleVisibilityChange = (nextVisible: boolean) => {
        if (destroyed || isViewportVisible === nextVisible) return;
        isViewportVisible = nextVisible;
        updateWebglSlotVisibility(webglPoolEntry, nextVisible);
        if (activeEngine !== "webgl") return;
        const effectiveActive = nextVisible && !(typeof document !== "undefined" && document.hidden);
        localSceneCapture?.setActive?.(effectiveActive);
        if (!nextVisible) clearCoalescenceGeometry(element);
        if (!effectiveActive) {
            if (queuedViewportSubscribers.delete(viewportSubscriber)) pendingVisibleRender = true;
            return;
        }
        if (pendingAmbientLightSync) {
            pendingAmbientLightSync = false;
            syncEffectiveLightTilt();
            pendingVisibleRender = true;
        }
        pendingVisibleRender = false;
        notifyPeersOnRender = true;
        scheduleWebglRender();
    };

    const onDocumentVisibilityChange = () => {
        if (destroyed || activeEngine !== "webgl") return;
        const isTabVisible = typeof document === "undefined" || !document.hidden;
        localSceneCapture?.setActive?.(isViewportVisible && isTabVisible);
        if (!isTabVisible) {
            if (queuedViewportSubscribers.delete(viewportSubscriber)) pendingVisibleRender = true;
            return;
        }
        if (isViewportVisible && pendingAmbientLightSync) {
            pendingAmbientLightSync = false;
            syncEffectiveLightTilt();
            pendingVisibleRender = true;
        }
        if (isViewportVisible && pendingVisibleRender) {
            pendingVisibleRender = false;
            scheduleWebglRender();
        }
    };

    const prepareViewportFrame = (movedViewport: boolean) => {
        if (movedViewport) {
            cachedHoverRect = null;
            activeFreeDragBounds = null;
        }
        hasPreparedViewportSnapshot = false;
        if (
            destroyed ||
            activeEngine !== "webgl" ||
            !webglRenderer ||
            webglContextLost ||
            !isViewportVisible ||
            (typeof document !== "undefined" && document.hidden)
        ) {
            return;
        }
        const bounds = readCoalescenceBounds();
        if (!bounds) {
            clearCoalescenceGeometry(element);
            return;
        }
        const { left, top, width, height, radius, bezel } = bounds;
        const notifyPeers = notifyPeersOnRender;
        notifyPeersOnRender = false;
        syncCoalescenceGeometry(element, left, top, width, height, radius, bezel, dragMotionSpeed, notifyPeers);
        const activeSceneCanvas = externalSceneCanvas ?? capturedSceneCanvas;
        const hasSceneTex =
            !!activeSceneCanvas && activeSceneCanvas.width > 0 && activeSceneCanvas.height > 0;
        const sceneRect = hasSceneTex
            ? computeSceneRect(bounds, sceneRectSlots[nextFrameSlot]!)
            : undefined;
        preparedSnapshotSlot.bounds.left = left;
        preparedSnapshotSlot.bounds.top = top;
        preparedSnapshotSlot.bounds.width = width;
        preparedSnapshotSlot.bounds.height = height;
        preparedSnapshotSlot.bounds.radius = radius;
        preparedSnapshotSlot.bounds.bezel = bezel;
        preparedSnapshotSlot.activeSceneCanvas = activeSceneCanvas;
        preparedSnapshotSlot.sceneRect = sceneRect;
        hasPreparedViewportSnapshot = true;
    };

    const commitViewportFrame = () => {
        if (!hasPreparedViewportSnapshot) return;
        hasPreparedViewportSnapshot = false;
        try {
            drawWebglFrame(preparedSnapshotSlot);
        } catch (error) {
            console.warn("[LiquidGlass] WebGL frame failed:", error);
            mountCss();
        } finally {
            preparedSnapshotSlot.activeSceneCanvas = null;
            preparedSnapshotSlot.sceneRect = undefined;
        }
    };

    const viewportSubscriber: ViewportSubscriber = {
        prepareViewportFrame,
        commitViewportFrame,
        onDocumentVisibilityChange,
    };

    const onWebglContextLost = (event: Event) => {
        if (event.target !== webglCanvas) return;
        event.preventDefault();
        webglContextLost = true;
        webglRenderer?.dispose();
        webglRenderer = null;
        lastRenderedFrame = null;
        lastSceneWidth = 0;
        lastSceneHeight = 0;
        lastSceneSharpness = 0;
        lastCaptureQualityKey = "";
        syncWebglBackdrop(false);
    };

    const onWebglContextRestored = (event: Event) => {
        if (destroyed || activeEngine !== "webgl" || event.target !== webglCanvas || !webglContextLost) return;
        webglContextLost = false;
        mountWebgl();
    };

    const teardownWebgl = (preserveVisibilityObserver = false) => {
        webglContextLost = false;
        observeExternalScene(null, null);
        notifyPeersOnRender = false;
        hasPreparedViewportSnapshot = false;
        preparedSnapshotSlot.activeSceneCanvas = null;
        preparedSnapshotSlot.sceneRect = undefined;
        pendingAmbientLightSync = false;
        unregisterViewport?.();
        unregisterViewport = null;
        if (!preserveVisibilityObserver) {
            unobserveVisibility?.();
            unobserveVisibility = null;
            isViewportVisible = true;
        }
        pendingVisibleRender = false;
        unobserveResize?.();
        unobserveResize = null;
        unsubscribeCapture?.();
        unsubscribeCapture = null;
        localSceneCapture?.destroy();
        localSceneCapture = null;
        capturedSceneCanvas = null;
        lastRenderedFrame = null;
        lastSceneWidth = 0;
        lastSceneHeight = 0;
        lastSceneSharpness = 0;
        lastCaptureQualityKey = "";
        webglRenderer?.dispose(true);
        webglRenderer = null;
        if (webglCanvas) {
            webglCanvas.removeEventListener("webglcontextlost", onWebglContextLost);
            webglCanvas.removeEventListener("webglcontextrestored", onWebglContextRestored);
            if (webglCanvas.parentNode === element) {
                webglCanvas.remove();
            }
        }
        webglCanvas = null;
        lastWebglSceneState = "";
        lastWebglCoreFilter = "";
        element.removeAttribute("data-lg-webgl-scene");
    };

    const mountCss = (preservePoolStandby = false) => {
        teardownWebgl(preservePoolStandby);
        if (!preservePoolStandby) {
            releaseWebglSlot(webglPoolEntry, true);
        }
        unregisterManagedElement(element);
        element.classList.add("lg-on");
        element.style.removeProperty("--lg-bg");
        const cssFilter = effectiveOptions.coreFilter !== undefined
            ? formatGlassCoreFilter(effectiveOptions.coreFilter, config.saturation)
            : formatCssFallbackFilter(config.saturation, effectiveOptions.blur === undefined ? undefined : config.blur);
        element.style.setProperty("--lg-filter", cssFilter);
        const cssTint = formatTintCssValue(effectiveOptions.tintColor, effectiveOptions.tintOpacity);
        if (cssTint !== null) {
            element.style.setProperty("--lg-tint", cssTint);
        } else {
            element.style.removeProperty("--lg-tint");
        }
        const changed = setEngine("css");
        syncCoalescenceState(0, true);
        applyCoalescenceVisuals();
        if (changed) options.onEngineChange?.("css");
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
            const targetEngine = resolveGlassEngine(effectiveOptions.engine ?? "auto", hasSceneInput());
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
        if (webglContextLost) {
            syncWebglBackdrop(false);
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
            sceneUploadPending = true;
        }

        observeExternalScene(externalSceneCanvas, externalSceneCanvas ? sceneEl : null);
        if (!externalSceneCanvas && sceneEl) {
            const targetSource = sceneEl;
            const resolveCaptureQuality = () => {
                const sharpness = resolveGlassSharpness(config.sharpness, config.blur);
                const pixelRatio = effectiveOptions.pixelRatio;
                const resolvedRadius = config.pill
                    ? 1
                    : (() => {
                          cachedRadiusStr ??= window.getComputedStyle(element).borderTopLeftRadius.trim();
                          return parseCssCornerRadiusPx(cachedRadiusStr, 2, 2) ?? config.radius;
                      })();
                return {
                    ...(pixelRatio !== undefined && Number.isFinite(pixelRatio) && pixelRatio > 0 ? { pixelRatio } : {}),
                    radius: resolvedRadius,
                    ...(sharpness > 0 ? { sharpness } : {}),
                };
            };
            const nextQuality = resolveCaptureQuality();
            const nextQualityKey = `${nextQuality.pixelRatio ?? ""}|${nextQuality.radius}|${nextQuality.sharpness ?? 0}`;
            if (!localSceneCapture || localSceneCapture.source !== targetSource) {
                unsubscribeCapture?.();
                localSceneCapture?.destroy();
                capturedSceneCanvas = null;
                sceneUploadPending = true;
                lastCaptureQualityKey = nextQualityKey;
                localSceneCapture = acquireSharedSceneCapture(targetSource, resolveCaptureQuality);
                localSceneCapture.setActive?.(
                    isViewportVisible && !(typeof document !== "undefined" && document.hidden),
                );
                unsubscribeCapture = localSceneCapture.subscribe((canvas, source) => {
                    capturedSceneCanvas = canvas;
                    sceneEl = source;
                    lastSceneBackdropKey = getSceneBackdropKey();
                    sceneUploadPending = true;
                    scheduleWebglRender();
                });
            } else if (nextQualityKey !== lastCaptureQualityKey) {
                lastCaptureQualityKey = nextQualityKey;
                localSceneCapture.scheduleCapture();
            }
        } else {
            unsubscribeCapture?.();
            unsubscribeCapture = null;
            localSceneCapture?.destroy();
            localSceneCapture = null;
            capturedSceneCanvas = null;
        }

        if (!unobserveResize) {
            unobserveResize = observeSharedElementResize(element, () => {
                cachedRadiusStr = null;
                scheduleWebglRender();
            });
        }

        if (!unregisterViewport) {
            unregisterViewport = registerViewportSubscriber(viewportSubscriber);
        }

        element.style.removeProperty("--lg-tint");
        element.style.removeProperty("--lg-bg");
        element.classList.add("lg-on");
        const changed = setEngine("webgl");
        syncCoalescenceState(0, true);
        scheduleWebglRender();
        if (changed) options.onEngineChange?.("webgl");
    };

    const mountSvg = () => {
        const wasSvg = activeEngine === "wasm-svg";
        if (!wasSvg) {
            teardownWebgl();
            releaseWebglSlot(webglPoolEntry, true);
            element.style.removeProperty("--lg-tint");
            lastSvgBgCss = undefined;
            lastSvgGeometrySig = "";
        }
        const svgTint = formatTintCssValue(effectiveOptions.tintColor, effectiveOptions.tintOpacity);
        if (lastSvgBgCss !== svgTint) {
            lastSvgBgCss = svgTint;
            if (svgTint !== null) {
                element.style.setProperty("--lg-bg", svgTint);
            } else {
                element.style.removeProperty("--lg-bg");
            }
        }
        const changed = setEngine("wasm-svg");
        registerManagedElement(element, config);
        const nextSvgGeometrySig = `${config.pill ? 1 : 0}|${config.radius}|${config.bezel}|${config.adaptiveRefraction ? 1 : 0}|${effectiveOptions.coalesce === false ? 0 : 1}`;
        if (!wasSvg || nextSvgGeometrySig !== lastSvgGeometrySig) {
            lastSvgGeometrySig = nextSvgGeometrySig;
            syncCoalescenceState(0, true);
            applyCoalescenceVisuals();
        }
        if (changed) options.onEngineChange?.("wasm-svg");
    };

    const MAX_BUTTON_DRAG_PX = 4;
    const DEFAULT_MAX_FREE_DRAG_PX = 24;
    const FREE_DRAG_RUBBER_RESISTANCE_PX = 14;
    const FREE_DRAG_MAX_MOMENTUM_PX = 20;
    let cachedHoverRect: DOMRect | null = null;

    const invalidateHoverRect = () => {
        cachedHoverRect = null;
    };

    const isButtonElement = (): boolean =>
        element.tagName === "BUTTON" ||
        element.tagName === "A" ||
        element.getAttribute("role") === "button";

    const isCircularOrPillElement = (): boolean => {
        if (config.pill || element.getAttribute("data-lg-pill") === "true") {
            return true;
        }
        const rect = element.getBoundingClientRect();
        const width = element.offsetWidth || rect.width;
        const height = element.offsetHeight || rect.height;
        let rawRadius = cachedRadiusStr ?? "";
        if (width >= 2 && height >= 2) {
            const halfMin = Math.min(width, height) * 0.5;
            const computed = computeCornerRadiusPx(element, width, height, config, cachedRadiusStr);
            if (computed.radius >= halfMin * 0.85) {
                return true;
            }
            rawRadius = computed.rawRadiusStr.trim();
        } else if (
            !rawRadius &&
            typeof window !== "undefined" &&
            typeof window.getComputedStyle === "function"
        ) {
            rawRadius = window.getComputedStyle(element).borderTopLeftRadius?.trim() ?? "";
        }
        if (rawRadius === "50%" || rawRadius === "100%") {
            return true;
        }
        const pxVal = Number.parseFloat(rawRadius);
        if (rawRadius.endsWith("px") && Number.isFinite(pxVal) && pxVal >= 999) {
            return true;
        }
        return false;
    };

    const resolveDragMode = (): "elastic" | "free" | null => {
        if (effectiveOptions.interactive === false || effectiveOptions.draggable === false) return null;
        if (!isButtonElement() || !isCircularOrPillElement()) return null;
        if (effectiveOptions.draggable === "free") {
            return "free";
        }
        if (
            effectiveOptions.draggable === undefined ||
            effectiveOptions.draggable === true ||
            effectiveOptions.draggable === "elastic"
        ) {
            return "elastic";
        }
        return null;
    };

    const isInteractiveElement = (): boolean =>
        effectiveOptions.interactive ?? isButtonElement();

    const resolveFreeDragBounds = (): {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
    } => {
        const boundsOption = effectiveOptions.dragBounds;
        if (!boundsOption) {
            return {
                minX: -DEFAULT_MAX_FREE_DRAG_PX,
                maxX: DEFAULT_MAX_FREE_DRAG_PX,
                minY: -DEFAULT_MAX_FREE_DRAG_PX,
                maxY: DEFAULT_MAX_FREE_DRAG_PX,
            };
        }
        if (typeof boundsOption === "object" && !(boundsOption instanceof HTMLElement)) {
            const minX =
                typeof boundsOption.minX === "number" && Number.isFinite(boundsOption.minX)
                    ? boundsOption.minX
                    : -DEFAULT_MAX_FREE_DRAG_PX;
            const maxX =
                typeof boundsOption.maxX === "number" && Number.isFinite(boundsOption.maxX)
                    ? boundsOption.maxX
                    : DEFAULT_MAX_FREE_DRAG_PX;
            const minY =
                typeof boundsOption.minY === "number" && Number.isFinite(boundsOption.minY)
                    ? boundsOption.minY
                    : -DEFAULT_MAX_FREE_DRAG_PX;
            const maxY =
                typeof boundsOption.maxY === "number" && Number.isFinite(boundsOption.maxY)
                    ? boundsOption.maxY
                    : DEFAULT_MAX_FREE_DRAG_PX;
            return {
                minX: Math.min(minX, maxX),
                maxX: Math.max(minX, maxX),
                minY: Math.min(minY, maxY),
                maxY: Math.max(minY, maxY),
            };
        }
        const elRect = element.getBoundingClientRect();
        const unstretchedWidth = element.offsetWidth || elRect.width;
        const unstretchedHeight = element.offsetHeight || elRect.height;
        const centerX = (elRect.left + elRect.right) * 0.5 - lastSpringDragX;
        const centerY = (elRect.top + elRect.bottom) * 0.5 - lastSpringDragY;
        const baseLeft = centerX - unstretchedWidth * 0.5;
        const baseTop = centerY - unstretchedHeight * 0.5;
        const baseRight = baseLeft + unstretchedWidth;
        const baseBottom = baseTop + unstretchedHeight;
        let containerLeft = 0;
        let containerTop = 0;
        let containerRight = typeof window !== "undefined" ? window.innerWidth : baseRight;
        let containerBottom = typeof window !== "undefined" ? window.innerHeight : baseBottom;
        if (boundsOption === "parent") {
            const parentEl = element.parentElement;
            if (parentEl) {
                const parentRect = parentEl.getBoundingClientRect();
                containerLeft = parentRect.left;
                containerTop = parentRect.top;
                containerRight = parentRect.right;
                containerBottom = parentRect.bottom;
            }
        } else if (boundsOption instanceof HTMLElement) {
            const containerRect = boundsOption.getBoundingClientRect();
            containerLeft = containerRect.left;
            containerTop = containerRect.top;
            containerRight = containerRect.right;
            containerBottom = containerRect.bottom;
        }
        let minX = containerLeft - baseLeft;
        let maxX = containerRight - baseRight;
        let minY = containerTop - baseTop;
        let maxY = containerBottom - baseBottom;
        if (minX > maxX) {
            const midX = (minX + maxX) * 0.5;
            minX = midX;
            maxX = midX;
        }
        if (minY > maxY) {
            const midY = (minY + maxY) * 0.5;
            minY = midY;
            maxY = midY;
        }
        return { minX, maxX, minY, maxY };
    };

    const applyRubberBand = (
        value: number,
        minVal: number,
        maxVal: number,
        resistance = FREE_DRAG_RUBBER_RESISTANCE_PX,
    ): number => {
        if (value < minVal) {
            const over = minVal - value;
            return minVal - resistance * (over / (over + resistance));
        }
        if (value > maxVal) {
            const over = value - maxVal;
            return maxVal + resistance * (over / (over + resistance));
        }
        return value;
    };

    const clampToRange = (value: number, minVal: number, maxVal: number): number =>
        Math.min(maxVal, Math.max(minVal, value));

    const dragWindow = element.ownerDocument.defaultView;
    const stopDragWindowListeners = () => {
        dragWindow?.removeEventListener("pointermove", onDragWindowMove);
        dragWindow?.removeEventListener("pointerup", onInteractivePointerUp);
        dragWindow?.removeEventListener("pointercancel", onInteractivePointerCancel);
        dragWindow?.removeEventListener("blur", onInteractivePointerCancel);
    };

    const onInteractivePointerDown = (event: PointerEvent) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        if (isPointerDragging || activeDragPointerId !== null) return;
        hasDraggedBeyondThreshold = false;
        springController?.press(event.pointerType === "touch" || event.pointerType === "pen");
        const dragMode = resolveDragMode();
        if (dragMode !== null) {
            isPointerDragging = true;
            activeDragMode = dragMode;
            activeDragPointerId = event.pointerId;
            activeFreeDragBounds = dragMode === "free" ? resolveFreeDragBounds() : null;
            dragStartClientX = event.clientX;
            dragStartClientY = event.clientY;
            dragOriginOffsetX = lastSpringDragX;
            dragOriginOffsetY = lastSpringDragY;
            lastDragClientX = event.clientX;
            lastDragClientY = event.clientY;
            lastDragTimestamp = event.timeStamp || (typeof performance !== "undefined" ? performance.now() : Date.now());
            dragVelocityX = 0;
            dragVelocityY = 0;
            let hasCapture = false;
            try {
                element.setPointerCapture?.(event.pointerId);
                hasCapture = element.hasPointerCapture?.(event.pointerId) === true;
            } catch {
            }
            if (!hasCapture) {
                dragWindow?.addEventListener("pointermove", onDragWindowMove, { passive: true });
            }
            dragWindow?.addEventListener("pointerup", onInteractivePointerUp, { passive: true });
            dragWindow?.addEventListener("pointercancel", onInteractivePointerCancel, { passive: true });
            dragWindow?.addEventListener("blur", onInteractivePointerCancel, { passive: true });
        }
    };

    const onInteractivePointerMove = (event: PointerEvent) => {
        if (!springController) return;
        if (isPointerDragging && event.pointerId !== activeDragPointerId) return;
        if (isPointerDragging && activeDragMode !== null) {
            const dragMode = activeDragMode;
            const rawDeltaX = event.clientX - dragStartClientX;
            const rawDeltaY = event.clientY - dragStartClientY;
            const dragDistance = Math.hypot(rawDeltaX, rawDeltaY);
            if (!hasDraggedBeyondThreshold && dragDistance > 4) {
                hasDraggedBeyondThreshold = true;
                element.setAttribute("data-lg-dragging", "1");
            }

            const now = event.timeStamp || (typeof performance !== "undefined" ? performance.now() : Date.now());
            const elapsedSec = Math.max(0.002, Math.min(0.12, (now - lastDragTimestamp) * 0.001));
            const instVelX = Math.max(-1600, Math.min(1600, (event.clientX - lastDragClientX) / elapsedSec));
            const instVelY = Math.max(-1600, Math.min(1600, (event.clientY - lastDragClientY) / elapsedSec));
            const alpha = 1 - Math.exp(-elapsedSec / 0.032);
            dragVelocityX = dragVelocityX + (instVelX - dragVelocityX) * alpha;
            dragVelocityY = dragVelocityY + (instVelY - dragVelocityY) * alpha;
            lastDragClientX = event.clientX;
            lastDragClientY = event.clientY;
            lastDragTimestamp = now;

            if (dragMode === "free") {
                const bounds = activeFreeDragBounds ?? (activeFreeDragBounds = resolveFreeDragBounds());
                const targetX = applyRubberBand(dragOriginOffsetX + rawDeltaX, bounds.minX, bounds.maxX);
                const targetY = applyRubberBand(dragOriginOffsetY + rawDeltaY, bounds.minY, bounds.maxY);
                freeDragRestX = targetX;
                freeDragRestY = targetY;
                springController.setDrag(targetX, targetY, false);
                springController.setTilt(Math.tanh(dragVelocityX / 600), -Math.tanh(dragVelocityY / 600));
                effectiveOptions.onDragChange?.(targetX, targetY, true);
                return;
            }

            let targetX = 0;
            let targetY = 0;
            if (dragDistance > 0.001) {
                const clampedDistance = MAX_BUTTON_DRAG_PX * (dragDistance / (dragDistance + 72));
                targetX = (rawDeltaX / dragDistance) * clampedDistance;
                targetY = (rawDeltaY / dragDistance) * clampedDistance;
            }

            springController.setDrag(targetX, targetY, false);
            springController.setTilt(Math.tanh(rawDeltaX / 36), -Math.tanh(rawDeltaY / 36));
            effectiveOptions.onDragChange?.(targetX, targetY, true);
            return;
        }

        const rect = cachedHoverRect ?? (cachedHoverRect = element.getBoundingClientRect());
        if (rect.width < 2 || rect.height < 2) return;
        const horizontal = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const vertical = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
        springController.setTilt(horizontal, vertical);
    };

    const onDragWindowMove = (event: PointerEvent) => {
        if (isPointerDragging && !event.composedPath().includes(element)) onInteractivePointerMove(event);
    };

    const finishDragInteraction = (event: Event | null, isCancel: boolean, resetOffset = false) => {
        if (!isPointerDragging) return;
        stopDragWindowListeners();
        const finishedMode = activeDragMode;
        isPointerDragging = false;
        activeDragMode = null;
        const capturedId = activeDragPointerId;
        activeDragPointerId = null;
        element.removeAttribute("data-lg-dragging");
        if (capturedId !== null) {
            try {
                element.releasePointerCapture?.(capturedId);
            } catch {
            }
        }

        const releaseTime = event?.timeStamp || performance.now();
        const idleDecay = isCancel ? 0 : Math.exp(-Math.max(0, releaseTime - lastDragTimestamp) / 55);

        if (finishedMode === "free" && !resetOffset) {
            const bounds = activeFreeDragBounds ?? resolveFreeDragBounds();
            activeFreeDragBounds = null;
            if (isCancel) {
                freeDragRestX = clampToRange(freeDragRestX, bounds.minX, bounds.maxX);
                freeDragRestY = clampToRange(freeDragRestY, bounds.minY, bounds.maxY);
                springController?.setDrag(freeDragRestX, freeDragRestY, false);
            } else {
                const vx = dragVelocityX * idleDecay;
                const vy = dragVelocityY * idleDecay;
                const rawMomentumX = predictMomentumOffset(0, vx, 12);
                const rawMomentumY = predictMomentumOffset(0, vy, 12);
                const clampedMomentumX = clampToRange(
                    rawMomentumX,
                    -FREE_DRAG_MAX_MOMENTUM_PX,
                    FREE_DRAG_MAX_MOMENTUM_PX,
                );
                const clampedMomentumY = clampToRange(
                    rawMomentumY,
                    -FREE_DRAG_MAX_MOMENTUM_PX,
                    FREE_DRAG_MAX_MOMENTUM_PX,
                );
                freeDragRestX = clampToRange(freeDragRestX + clampedMomentumX, bounds.minX, bounds.maxX);
                freeDragRestY = clampToRange(freeDragRestY + clampedMomentumY, bounds.minY, bounds.maxY);
                springController?.setDrag(freeDragRestX, freeDragRestY, false);
                springController?.impulseDrag(vx * 0.1, vy * 0.1);
            }
        } else {
            activeFreeDragBounds = null;
            freeDragRestX = 0;
            freeDragRestY = 0;
            springController?.setDrag(0, 0, false);
            if (!isCancel) {
                springController?.impulseDrag(-dragVelocityX * 0.025 * idleDecay, -dragVelocityY * 0.025 * idleDecay);
            }
        }

        dragVelocityX = 0;
        dragVelocityY = 0;
        if (isCancel) {
            hasDraggedBeyondThreshold = false;
        }
        effectiveOptions.onDragChange?.(freeDragRestX, freeDragRestY, false);
    };

    const onInteractivePointerUp = (event: PointerEvent) => {
        if (activeDragPointerId !== null && event.pointerId !== activeDragPointerId) {
            return;
        }
        finishDragInteraction(event, false);
        springController?.release(true);
    };

    const onInteractivePointerCancel = (event: Event) => {
        if (isPointerDragging && event.type === "pointerleave") return;
        if (!isPointerDragging && event.type === "lostpointercapture") return;
        const pointerEvent = event as PointerEvent;
        if (
            typeof pointerEvent.pointerId === "number" &&
            activeDragPointerId !== null &&
            pointerEvent.pointerId !== activeDragPointerId &&
            event.type !== "blur"
        ) {
            return;
        }
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
            element.removeEventListener("pointerenter", invalidateHoverRect);
            element.removeEventListener("pointerdown", onInteractivePointerDown);
            element.removeEventListener("pointermove", onInteractivePointerMove);
            element.removeEventListener("pointerup", onInteractivePointerUp);
            element.removeEventListener("pointercancel", onInteractivePointerCancel);
            element.removeEventListener("pointerleave", onInteractivePointerCancel);
            element.removeEventListener("lostpointercapture", onInteractivePointerCancel);
            element.removeEventListener("click", onInteractiveClickCapture, true);
            element.removeEventListener("keydown", onInteractiveKeyDown);
            element.removeEventListener("keyup", onInteractiveKeyUp);
            element.removeEventListener("blur", onInteractivePointerCancel);
        }
        if (isPointerDragging) stopDragWindowListeners();
        if (activeDragPointerId !== null) {
            try {
                element.releasePointerCapture?.(activeDragPointerId);
            } catch {
            }
        }
        springController?.destroy();
        springController = null;
        isPointerDragging = false;
        activeDragMode = null;
        lastConfiguredDragMode = null;
        freeDragRestX = 0;
        freeDragRestY = 0;
        cachedHoverRect = null;
        activeDragPointerId = null;
        hasDraggedBeyondThreshold = false;
        lastSpringDragX = 0;
        lastSpringDragY = 0;
        dragMotionSpeed = 0;
        useDragResolution = false;
        pressGlow = 0;
        springTiltHorizontal = 0;
        springTiltVertical = 0;
        syncEffectiveLightTilt();
        element.classList.remove("lg-interactive");
        element.removeAttribute("data-lg-draggable");
        element.removeAttribute("data-lg-dragging");
        element.removeAttribute("data-lg-offset");
        clearSpringCssVars(false);
    };

    let lastSpringScaleXCss = "";
    let lastSpringScaleYCss = "";
    let lastStretchMatrixCss = "";
    let lastDragXCss = "";
    let lastDragYCss = "";
    let lastPressGlowCss = "";
    let lastScaleXQuant = -999999;
    let lastScaleYQuant = -999999;
    let lastM11Quant = -999999;
    let lastM12Quant = -999999;
    let lastM21Quant = -999999;
    let lastM22Quant = -999999;
    let lastDragXQuant = -999999;
    let lastDragYQuant = -999999;
    let lastGlowQuant = -999999;

    function clearSpringCssVars(preserveNonZeroDragOffset = false): void {
        lastScaleXQuant = -999999;
        lastScaleYQuant = -999999;
        lastM11Quant = -999999;
        lastM12Quant = -999999;
        lastM21Quant = -999999;
        lastM22Quant = -999999;
        lastGlowQuant = -999999;
        if (lastSpringScaleXCss) {
            lastSpringScaleXCss = "";
            element.style.removeProperty("--lg-spring-scale-x");
        }
        if (lastSpringScaleYCss) {
            lastSpringScaleYCss = "";
            element.style.removeProperty("--lg-spring-scale-y");
        }
        if (lastStretchMatrixCss) {
            lastStretchMatrixCss = "";
            element.style.removeProperty("--lg-stretch-matrix");
        }
        if (!preserveNonZeroDragOffset || (Math.abs(freeDragRestX) < 0.01 && Math.abs(freeDragRestY) < 0.01)) {
            lastDragXQuant = -999999;
            lastDragYQuant = -999999;
            if (lastDragXCss) {
                lastDragXCss = "";
                element.style.removeProperty("--lg-drag-x");
            }
            if (lastDragYCss) {
                lastDragYCss = "";
                element.style.removeProperty("--lg-drag-y");
            }
            element.removeAttribute("data-lg-offset");
        } else {
            lastDragXQuant = Math.round(freeDragRestX * 100);
            lastDragYQuant = Math.round(freeDragRestY * 100);
            const settledX = `${freeDragRestX.toFixed(2)}px`;
            if (settledX !== lastDragXCss) {
                lastDragXCss = settledX;
                element.style.setProperty("--lg-drag-x", settledX);
            }
            const settledY = `${freeDragRestY.toFixed(2)}px`;
            if (settledY !== lastDragYCss) {
                lastDragYCss = settledY;
                element.style.setProperty("--lg-drag-y", settledY);
            }
            element.setAttribute("data-lg-offset", "1");
        }
        if (lastPressGlowCss) {
            lastPressGlowCss = "";
            element.style.removeProperty("--lg-press-glow");
        }
    }

    const syncInteractive = () => {
        const dragMode = resolveDragMode();
        if (isPointerDragging && activeDragMode !== dragMode) {
            finishDragInteraction(null, true, true);
            if (destroyed) return;
            springController?.setTilt(0, 0);
            springController?.release(false);
        }
        if (!isInteractiveElement() && dragMode === null) {
            detachInteractive();
            return;
        }
        if (lastConfiguredDragMode === "free" && dragMode !== "free") {
            freeDragRestX = 0;
            freeDragRestY = 0;
            springController?.setDrag(0, 0, true);
        }
        lastConfiguredDragMode = dragMode;

        if (dragMode !== null) {
            element.setAttribute("data-lg-draggable", dragMode);
        } else {
            element.removeAttribute("data-lg-draggable");
        }
        element.classList.add("lg-interactive");
        if (!springController) {
            springController = createInteractiveSpring(
                (frame) => {
                    const scaleXQuant = Math.round(frame.scaleX * 10000);
                    if (scaleXQuant !== lastScaleXQuant) {
                        lastScaleXQuant = scaleXQuant;
                        const nextScaleXCss = frame.scaleX.toFixed(4);
                        lastSpringScaleXCss = nextScaleXCss;
                        element.style.setProperty("--lg-spring-scale-x", nextScaleXCss);
                    }
                    const scaleYQuant = Math.round(frame.scaleY * 10000);
                    if (scaleYQuant !== lastScaleYQuant) {
                        lastScaleYQuant = scaleYQuant;
                        const nextScaleYCss = frame.scaleY.toFixed(4);
                        lastSpringScaleYCss = nextScaleYCss;
                        element.style.setProperty("--lg-spring-scale-y", nextScaleYCss);
                    }
                    const [m11, m12, m21, m22] = frame.stretchMatrix;
                    const m11Quant = Math.round(m11 * 10000);
                    const m12Quant = Math.round(m12 * 10000);
                    const m21Quant = Math.round(m21 * 10000);
                    const m22Quant = Math.round(m22 * 10000);
                    if (
                        m11Quant !== lastM11Quant ||
                        m12Quant !== lastM12Quant ||
                        m21Quant !== lastM21Quant ||
                        m22Quant !== lastM22Quant
                    ) {
                        lastM11Quant = m11Quant;
                        lastM12Quant = m12Quant;
                        lastM21Quant = m21Quant;
                        lastM22Quant = m22Quant;
                        const nextStretchMatrixCss = `matrix(${m11.toFixed(4)}, ${m12.toFixed(4)}, ${m21.toFixed(4)}, ${m22.toFixed(4)}, 0, 0)`;
                        lastStretchMatrixCss = nextStretchMatrixCss;
                        element.style.setProperty("--lg-stretch-matrix", nextStretchMatrixCss);
                    }
                    const dragXQuant = Math.round(frame.dragX * 100);
                    if (dragXQuant !== lastDragXQuant) {
                        lastDragXQuant = dragXQuant;
                        const nextDragXCss = `${frame.dragX.toFixed(2)}px`;
                        lastDragXCss = nextDragXCss;
                        element.style.setProperty("--lg-drag-x", nextDragXCss);
                    }
                    const dragYQuant = Math.round(frame.dragY * 100);
                    if (dragYQuant !== lastDragYQuant) {
                        lastDragYQuant = dragYQuant;
                        const nextDragYCss = `${frame.dragY.toFixed(2)}px`;
                        lastDragYCss = nextDragYCss;
                        element.style.setProperty("--lg-drag-y", nextDragYCss);
                    }
                    const glowQuant = Math.round(frame.glow * 1000);
                    if (glowQuant !== lastGlowQuant) {
                        lastGlowQuant = glowQuant;
                        const nextPressGlowCss = frame.glow.toFixed(3);
                        lastPressGlowCss = nextPressGlowCss;
                        element.style.setProperty("--lg-press-glow", nextPressGlowCss);
                    }
                    const prevGlow = pressGlow;
                    const prevTiltH = lightTiltHorizontal;
                    const prevTiltV = lightTiltVertical;
                    const dragMoved =
                        Math.abs(frame.dragX - lastSpringDragX) > 0.25 ||
                        Math.abs(frame.dragY - lastSpringDragY) > 0.25;
                    pressGlow = frame.glow;
                    springTiltHorizontal = frame.tiltHorizontal;
                    springTiltVertical = frame.tiltVertical;
                    syncEffectiveLightTilt();
                    lastSpringDragX = frame.dragX;
                    lastSpringDragY = frame.dragY;
                    dragMotionSpeed = Math.hypot(frame.velocityX, frame.velocityY);
                    // Keep the drawing buffer stable through spring reversals and settling.
                    const enteredDragResolution = !useDragResolution && dragMotionSpeed > 0.3;
                    useDragResolution ||= enteredDragResolution;
                    if (dragMoved) {
                        syncCoalescenceState(dragMotionSpeed, true);
                    }
                    if (
                        activeEngine === "webgl" &&
                        (dragMoved ||
                            enteredDragResolution ||
                            Math.abs(frame.glow - prevGlow) > 0.004 ||
                            Math.abs(lightTiltHorizontal - prevTiltH) > 0.004 ||
                            Math.abs(lightTiltVertical - prevTiltV) > 0.004)
                    ) {
                        scheduleWebglRender();
                    }
                },
                () => {
                    const prevGlow = pressGlow;
                    const prevTiltH = lightTiltHorizontal;
                    const prevTiltV = lightTiltVertical;
                    const restoreResolution = useDragResolution;
                    const prevDrag =
                        Math.abs(lastSpringDragX - freeDragRestX) > 0.25 ||
                        Math.abs(lastSpringDragY - freeDragRestY) > 0.25;
                    pressGlow = 0;
                    springTiltHorizontal = 0;
                    springTiltVertical = 0;
                    syncEffectiveLightTilt();
                    dragMotionSpeed = 0;
                    useDragResolution = false;
                    lastSpringDragX = freeDragRestX;
                    lastSpringDragY = freeDragRestY;
                    clearSpringCssVars(true);
                    syncCoalescenceState(0, true);
                    if (
                        activeEngine === "webgl" &&
                        (prevDrag ||
                            restoreResolution ||
                            prevGlow > 0.004 ||
                            Math.abs(lightTiltHorizontal - prevTiltH) > 0.004 ||
                            Math.abs(lightTiltVertical - prevTiltV) > 0.004)
                    ) {
                        scheduleWebglRender();
                    }
                },
            );
        }

        springController.setFreeDragMode?.(dragMode === "free");
        const { reducedMotionQuery } = getMediaQueries();
        const prefersReducedMotion = Boolean(reducedMotionQuery?.matches);
        if (prefersReducedMotion) useDragResolution = false;
        springController.setReducedMotion(prefersReducedMotion);

        if (!interactiveListenersAttached) {
            interactiveListenersAttached = true;
            element.addEventListener("pointerenter", invalidateHoverRect, { passive: true });
            element.addEventListener("pointerdown", onInteractivePointerDown, { passive: true });
            element.addEventListener("pointermove", onInteractivePointerMove, { passive: true });
            element.addEventListener("pointerup", onInteractivePointerUp, { passive: true });
            element.addEventListener("pointercancel", onInteractivePointerCancel, { passive: true });
            element.addEventListener("pointerleave", onInteractivePointerCancel, { passive: true });
            element.addEventListener("lostpointercapture", onInteractivePointerCancel, { passive: true });
            element.addEventListener("click", onInteractiveClickCapture, true);
            element.addEventListener("keydown", onInteractiveKeyDown);
            element.addEventListener("keyup", onInteractiveKeyUp);
            element.addEventListener("blur", onInteractivePointerCancel, { passive: true });
        }
    };

    const syncAmbientLightTiltSubscription = () => {
        const nextMode =
            effectiveOptions.lightTilt === "pointer" || effectiveOptions.lightTilt === "gyro"
                ? effectiveOptions.lightTilt
                : null;
        if (nextMode === ambientLightMode) return;
        unsubAmbientLightTilt?.();
        unsubAmbientLightTilt = null;
        ambientLightMode = nextMode;
        if (nextMode) {
            unsubAmbientLightTilt = subscribeAmbientLightTilt(nextMode, (horizontal, vertical) => {
                if (destroyed) return;
                if (horizontal === baseLightTiltHorizontal && vertical === baseLightTiltVertical) return;
                baseLightTiltHorizontal = horizontal;
                baseLightTiltVertical = vertical;
                if (activeEngine === "webgl" && (!isViewportVisible || (typeof document !== "undefined" && document.hidden))) {
                    pendingAmbientLightSync = true;
                    return;
                }
                syncEffectiveLightTilt();
                if (activeEngine === "webgl") {
                    scheduleWebglRender();
                }
            });
        }
    };

    const applyEngine = () => {
        if (destroyed) return;
        activeFreeDragBounds = null;
        effectiveOptions = resolvePresetOptions(options);
        config = resolveGlassConfig(options);
        webglCoreFilter = formatGlassCoreFilter(config.coreFilter, config.saturation);
        syncPillAttribute();
        syncInteractive();
        if (destroyed) return;
        syncEffectiveLightTilt();
        syncAmbientLightTiltSubscription();
        const requestedEngine = effectiveOptions.engine ?? "auto";
        if (requestedEngine === "css") {
            unsubscribeBattery?.();
            unsubscribeBattery = null;
        } else {
            unsubscribeBattery ??= subscribeBatteryChanges(applyEngine);
        }
        const targetEngine = resolveGlassEngine(requestedEngine, hasSceneInput());
        if (targetEngine !== "wasm-svg" && (requestedEngine === "auto" || requestedEngine === "wasm-svg") && !isWasmReady()) {
            unsubWasmReady ??= onWasmReady(() => {
                unsubWasmReady = null;
                if (canUseSvgGlass()) applyEngine();
            });
        } else {
            unsubWasmReady?.();
            unsubWasmReady = null;
        }

        if (targetEngine === "wasm-svg") {
            mountSvg();
        } else if (targetEngine === "webgl") {
            mountWebgl();
        } else {
            mountCss();
        }
    };

    const syncCoalescenceRegistration = () => {
        if (effectiveOptions.coalesce === false) {
            unobserveCoalescenceResize?.();
            unobserveCoalescenceResize = null;
            unregisterCoalescence?.();
            unregisterCoalescence = null;
            lastCoalescingState = false;
            lastBleedPx = -1;
            lastInterferenceStr = "";
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
        unobserveCoalescenceResize = observeSharedElementResize(element, () => {
            if (activeEngine === "webgl" && !webglContextLost) return;
            cachedRadiusStr = null;
            syncCoalescenceState(0, true);
            applyCoalescenceVisuals();
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
    }

    syncCoalescenceRegistration();

    applyEngine();

    return {
        element,
        get engine() {
            return activeEngine;
        },
        update(newOptions) {
            if (destroyed || Object.keys(newOptions).length === 0) return;
            const prevPixelRatio = effectiveOptions.pixelRatio;
            const prevRadius = config.radius;
            const prevPill = config.pill;
            const prevCornerStyle = config.cornerStyle;
            options = { ...options, ...newOptions };
            effectiveOptions = resolvePresetOptions(options);
            if ("lightTilt" in newOptions || "preset" in newOptions) {
                const staticTilt = extractStaticLightTilt(effectiveOptions.lightTilt);
                baseLightTiltHorizontal = staticTilt.horizontal;
                baseLightTiltVertical = staticTilt.vertical;
                syncEffectiveLightTilt();
                syncAmbientLightTiltSubscription();
            }
            syncCoalescenceRegistration();
            if ("sceneCanvas" in newOptions) {
                const nextCanvas = newOptions.sceneCanvas ?? null;
                if (nextCanvas !== externalSceneCanvas || nextCanvas !== null) {
                    externalSceneCanvas = nextCanvas;
                    sceneUploadPending = true;
                }
            }
            if ("sceneElement" in newOptions) {
                const nextSource = newOptions.sceneElement ?? null;
                if (nextSource !== sceneEl) {
                    capturedSceneCanvas = null;
                    sceneUploadPending = true;
                }
                sceneEl = nextSource;
            }
            applyEngine();
            if (
                ("pixelRatio" in newOptions && effectiveOptions.pixelRatio !== prevPixelRatio) ||
                config.radius !== prevRadius ||
                config.pill !== prevPill ||
                config.cornerStyle !== prevCornerStyle
            ) {
                localSceneCapture?.scheduleCapture();
            }
        },
        setLightTilt(horizontal: number, vertical: number) {
            if (destroyed) return;
            const nextH = Number.isFinite(horizontal) ? Math.max(-1, Math.min(1, horizontal)) : 0;
            const nextV = Number.isFinite(vertical) ? Math.max(-1, Math.min(1, vertical)) : 0;
            const hadAmbient = ambientLightMode !== null;
            if (nextH === baseLightTiltHorizontal && nextV === baseLightTiltVertical && !hadAmbient) return;
            baseLightTiltHorizontal = nextH;
            baseLightTiltVertical = nextV;
            options = { ...options, lightTilt: { horizontal: nextH, vertical: nextV } };
            effectiveOptions = resolvePresetOptions(options);
            syncAmbientLightTiltSubscription();
            syncEffectiveLightTilt();
            if (activeEngine === "webgl") {
                scheduleWebglRender();
            }
        },
        setDragOffset(offsetX: number, offsetY: number, animate = true) {
            if (destroyed) return;
            const dragMode = resolveDragMode();
            const safeX = Number.isFinite(offsetX) ? offsetX : 0;
            const safeY = Number.isFinite(offsetY) ? offsetY : 0;
            if (dragMode === null && (safeX !== 0 || safeY !== 0)) {
                return;
            }
            const bounds =
                dragMode === "free"
                    ? resolveFreeDragBounds()
                    : {
                          minX: -MAX_BUTTON_DRAG_PX,
                          maxX: MAX_BUTTON_DRAG_PX,
                          minY: -MAX_BUTTON_DRAG_PX,
                          maxY: MAX_BUTTON_DRAG_PX,
                      };
            const clampedX = clampToRange(safeX, bounds.minX, bounds.maxX);
            const clampedY = clampToRange(safeY, bounds.minY, bounds.maxY);
            freeDragRestX = clampedX;
            freeDragRestY = clampedY;
            if (springController) {
                springController.setDrag(clampedX, clampedY, !animate);
                if (!animate) {
                    lastSpringDragX = clampedX;
                    lastSpringDragY = clampedY;
                    clearSpringCssVars(true);
                    syncCoalescenceState(0, true);
                    if (activeEngine === "webgl") {
                        scheduleWebglRender();
                    }
                }
            } else {
                lastSpringDragX = clampedX;
                lastSpringDragY = clampedY;
                clearSpringCssVars(true);
                syncCoalescenceState(0, true);
                if (activeEngine === "webgl") {
                    scheduleWebglRender();
                }
            }
            effectiveOptions.onDragChange?.(clampedX, clampedY, false);
        },
        refreshMotion(sceneChanged = false) {
            if (destroyed || activeEngine !== "webgl") return;
            sceneUploadPending ||= sceneChanged;
            notifyPeersOnRender = true;
            scheduleWebglRender();
        },
        refresh() {
            if (destroyed) return;
            cachedRadiusStr = null;
            const existingState = elementStateMap.get(element);
            syncThemeAttribute(true);
            if (existingState) existingState.cachedRadiusStr = null;
            const targetEngine = resolveGlassEngine(effectiveOptions.engine ?? "auto", hasSceneInput());
            if (targetEngine !== activeEngine) {
                if (targetEngine === "webgl" && activeEngine === "css" && isWebglSlotOnStandby(webglPoolEntry)) {
                    syncCoalescenceState(0, true);
                    applyCoalescenceVisuals();
                    return;
                }
                applyEngine();
                return;
            }
            if (activeEngine === "webgl") {
                if (localSceneCapture) {
                    const nextBackdropKey = getSceneBackdropKey();
                    if (nextBackdropKey !== lastSceneBackdropKey) {
                        lastSceneBackdropKey = nextBackdropKey;
                        localSceneCapture.scheduleCapture();
                    }
                }
                notifyPeersOnRender = true;
                scheduleWebglRender();
            } else if (activeEngine === "wasm-svg") {
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
            sceneUploadPending = true;
            options.sceneCanvas = canvas;
            if (nextSceneEl !== undefined) {
                if (nextSceneEl !== sceneEl) {
                    capturedSceneCanvas = null;
                }
                sceneEl = nextSceneEl;
                options.sceneElement = nextSceneEl;
            }
            if (canvas) {
                unsubscribeCapture?.();
                unsubscribeCapture = null;
                localSceneCapture?.destroy();
                localSceneCapture = null;
                capturedSceneCanvas = null;
            }
            const targetEngine = resolveGlassEngine(effectiveOptions.engine ?? "auto", hasSceneInput());
            if (targetEngine !== activeEngine) {
                applyEngine();
                return;
            }
            if (activeEngine === "webgl" && webglRenderer) {
                if (!canvas) {
                    mountWebgl();
                } else {
                    observeExternalScene(canvas, sceneEl);
                    scheduleWebglRender();
                }
            } else {
                applyEngine();
            }
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            unsubWasmReady?.();
            unsubWasmReady = null;
            unsubscribeBattery?.();
            unsubscribeBattery = null;
            unsubAmbientLightTilt?.();
            unsubAmbientLightTilt = null;
            ambientLightMode = null;
            unregisterControllerOwnedElement(element);
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
            clearLightTiltCssVars();
            unobserveCoalescenceResize?.();
            unobserveCoalescenceResize = null;
            unregisterCoalescence?.();
            unregisterCoalescence = null;
            teardownWebgl();
            releaseWebglSlot(webglPoolEntry, true);
            unregisterManagedElement(element);
            element.classList.remove("lg-on", "lg-hollow", "lg-interactive");
            if (!hadSurfaceClass) element.classList.remove("lg-surface");
            element.removeAttribute("data-lg-surface");
            element.removeAttribute("data-lg-engine");
            element.removeAttribute("data-lg-theme");
            element.removeAttribute("data-lg-pill");
            element.removeAttribute("data-lg-corner-style");
            element.removeAttribute("data-lg-refraction-axis");
            element.removeAttribute("data-lg-webgl-scene");
            element.removeAttribute("data-lg-coalescing");
            element.style.removeProperty("--lg-filter");
            element.style.removeProperty("--lg-tint");
            element.style.removeProperty("--lg-bg");
            element.style.removeProperty("--lg-radius");
            element.style.removeProperty("--lg-rim-opacity");
            element.style.removeProperty("--lg-refraction-fade");
            element.style.removeProperty("--lg-bleed");
            element.style.removeProperty("--lg-interference");
        },
    };
}

export { isWasmReady };
