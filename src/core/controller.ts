import { resolveRefractionBezel } from "./refractionBounds.js";
import {
    formatCssFallbackFilter,
    formatGlassCoreFilter,
    parseCssCornerRadiusPx,
    resolveGlassConfig,
    resolveGlassTheme,
    resolvePresetOptions,
} from "./config.js";
import {
    EMPTY_COALESCENCE_SNAPSHOT,
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
    resolveGlassEngine,
    subscribeBatteryChanges,
} from "./observer.js";
import { acquireSharedSceneCapture } from "./sceneCapture.js";
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

const visibilityHandlers = new WeakMap<Element, (isVisible: boolean) => void>();
let sharedVisibilityObserver: IntersectionObserver | null = null;
let sharedVisibilityObserverCtor: typeof IntersectionObserver | null = null;
let sharedVisibilityCount = 0;

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
            sharedVisibilityObserverCtor = null;
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

const resizeHandlers = new WeakMap<Element, Set<() => void>>();
let sharedResizeObserver: ResizeObserver | null = null;
let sharedResizeObserverCtor: typeof ResizeObserver | null = null;
let sharedResizeCount = 0;

export function observeSharedElementResize(
    targetElement: Element,
    onResize: () => void,
): () => void {
    if (typeof ResizeObserver !== "function") {
        return () => {};
    }
    if (!sharedResizeObserver || sharedResizeObserverCtor !== ResizeObserver) {
        sharedResizeObserver?.disconnect();
        sharedResizeObserverCtor = ResizeObserver;
        sharedResizeObserver = new ResizeObserver((entries) => {
            for (let index = 0; index < entries.length; index++) {
                const callbacks = resizeHandlers.get(entries[index]!.target);
                if (callbacks) {
                    for (const cb of callbacks) {
                        cb();
                    }
                }
            }
        });
    }
    let callbacks = resizeHandlers.get(targetElement);
    if (!callbacks) {
        callbacks = new Set();
        resizeHandlers.set(targetElement, callbacks);
        sharedResizeObserver.observe(targetElement);
        sharedResizeCount += 1;
    }
    callbacks.add(onResize);

    let active = true;
    return () => {
        if (!active) return;
        active = false;
        const set = resizeHandlers.get(targetElement);
        if (set) {
            set.delete(onResize);
            if (set.size === 0) {
                resizeHandlers.delete(targetElement);
                sharedResizeObserver?.unobserve(targetElement);
                sharedResizeCount = Math.max(0, sharedResizeCount - 1);
                if (sharedResizeCount === 0) {
                    sharedResizeObserver?.disconnect();
                    sharedResizeObserver = null;
                    sharedResizeObserverCtor = null;
                }
            }
        }
    };
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
        frame.blur !== previous.blur || frame.saturation !== previous.saturation || frame.surface !== previous.surface ||
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
    let unobserveResize: (() => void) | null = null;
    let unregisterViewport: (() => void) | null = null;
    let localSceneCapture: SceneCaptureController | null = null;
    let unsubscribeCapture: (() => void) | null = null;
    let externalSceneCanvas: HTMLCanvasElement | null = options.sceneCanvas ?? null;
    let capturedSceneCanvas: HTMLCanvasElement | null = null;
    let sceneUploadPending = false;
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

    element.setAttribute("data-lg-surface", "");
    element.classList.add("lg-surface");
    registerControllerOwnedElement(element);

    const hasSceneInput = (): boolean =>
        Boolean(externalSceneCanvas || sceneEl);

    const setEngine = (engine: GlassEngine) => {
        const changed = !hasInitializedEngine || activeEngine !== engine;
        hasInitializedEngine = true;
        activeEngine = engine;
        element.setAttribute("data-lg-engine", engine);
        if (changed) {
            options.onEngineChange?.(engine);
        }
    };

    let resolvedTheme: "light" | "dark" = resolveGlassTheme(effectiveOptions.theme, element);

    const syncThemeAttribute = () => {
        resolvedTheme = resolveGlassTheme(effectiveOptions.theme, element);
        element.setAttribute("data-lg-theme", resolvedTheme);
    };

    const syncPillAttribute = () => {
        syncThemeAttribute();
        const direction = config.refractionDirection ?? "all";
        element.setAttribute("data-lg-refraction-axis", direction);
        if (direction === "all") {
            element.style.removeProperty("--lg-refraction-fade");
        } else {
            element.style.setProperty("--lg-refraction-fade", `${(config.refractionEdgeFade ?? 0.35) * 50}%`);
        }
        if (config.pill) {
            element.setAttribute("data-lg-pill", "true");
            element.style.removeProperty("--lg-radius");
        } else {
            element.removeAttribute("data-lg-pill");
            if (effectiveOptions.radius !== undefined) {
                element.style.setProperty("--lg-radius", `${Math.max(0, config.radius)}px`);
            } else {
                element.style.removeProperty("--lg-radius");
            }
        }
        if (config.cornerStyle === "squircle") {
            element.setAttribute("data-lg-corner-style", "squircle");
        } else {
            element.removeAttribute("data-lg-corner-style");
        }
        if (effectiveOptions.highlight !== undefined) {
            element.style.setProperty("--lg-rim-opacity", String(Math.min(1, Math.max(0, effectiveOptions.highlight))));
        } else {
            element.style.removeProperty("--lg-rim-opacity");
        }
        cachedRadiusStr = null;
        const existingState = elementStateMap.get(element);
        if (existingState) {
            existingState.cachedRadiusStr = null;
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
            tintOpacity: 0.12, highlight: 0.44,
        },
        {
            width: 0, height: 0, radius: 0, bezel: 0, thickness: 0, scaleRatio: 0,
            ior: 1.5, blur: 0, surface: config.surface, tintColor: cachedTintColorRgb,
            tintOpacity: 0.12, highlight: 0.44,
        },
    ];
    let nextFrameSlot = 0;

    const computeSceneRect = (
        bounds: { left: number; top: number; width: number; height: number },
        targetSlot: { relX: number; relY: number; relW: number; relH: number },
    ) => {
        const source = sceneEl ?? options.sceneElement;
        if (!source?.isConnected) {
            targetSlot.relX = 0;
            targetSlot.relY = 0;
            targetSlot.relW = 1;
            targetSlot.relH = 1;
            return targetSlot;
        }
        let sourceRect = viewportSourceRects.get(source);
        if (!sourceRect) {
            sourceRect = source.getBoundingClientRect();
            viewportSourceRects.set(source, sourceRect);
        }
        if (sourceRect.width < 2 || sourceRect.height < 2) {
            targetSlot.relX = 0;
            targetSlot.relY = 0;
            targetSlot.relW = 1;
            targetSlot.relH = 1;
            return targetSlot;
        }
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
        hasSceneTex: boolean;
        sceneRect: { relX: number; relY: number; relW: number; relH: number } | undefined;
    }
    const preparedSnapshotSlot: PreparedWebglSnapshot = {
        bounds: { left: 0, top: 0, width: 0, height: 0, radius: 0, bezel: 0 },
        activeSceneCanvas: null,
        hasSceneTex: false,
        sceneRect: undefined,
    };
    let hasPreparedViewportSnapshot = false;

    const drawWebglFrame = ({ bounds, activeSceneCanvas, hasSceneTex, sceneRect }: PreparedWebglSnapshot) => {
        if (destroyed || activeEngine !== "webgl" || !webglRenderer) return;
        if (!isViewportVisible || (typeof document !== "undefined" && document.hidden)) {
            pendingVisibleRender = true;
            return;
        }

        const { width, height, radius, bezel } = bounds;
        if (sceneUploadPending) {
            lastRenderedFrame = null;
            webglRenderer.setSceneCanvas(activeSceneCanvas);
            sceneUploadPending = false;
        }
        const coalescenceSnapshot = applyCoalescenceVisuals();

        if (effectiveOptions.tintColor !== cachedTintColorRaw) {
            cachedTintColorRaw = effectiveOptions.tintColor;
            cachedTintColorRgb = parseCssColorToRgb(effectiveOptions.tintColor);
        }
        const isDarkTheme = resolvedTheme === "dark";
        const tintColor: [number, number, number] =
            effectiveOptions.tintColor !== undefined
                ? cachedTintColorRgb
                : isDarkTheme
                    ? [0.06, 0.07, 0.09]
                    : cachedTintColorRgb;
        const tintOpacity = effectiveOptions.tintOpacity ?? (isDarkTheme ? 0.24 : 0.12);
        const baseHighlight = effectiveOptions.highlight ?? 0.44;
        const highlight = Math.min(1, (isDarkTheme ? baseHighlight * 0.58 : baseHighlight) + pressGlow);
        const baseDpr =
            effectiveOptions.pixelRatio ??
            (typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1);
        const effectivePixelRatio =
            dragMotionSpeed > 0.3 && (radius > 0 || effectiveOptions.pixelRatio !== undefined)
                ? Math.min(baseDpr, Math.max(0.75, baseDpr * 0.7))
                : effectiveOptions.pixelRatio;

        const nextSceneState = hasSceneTex ? "1" : "0";
        if (nextSceneState !== lastWebglSceneState) {
            lastWebglSceneState = nextSceneState;
            element.setAttribute("data-lg-webgl-scene", nextSceneState);
        }
        const nextCoreFilter = hasSceneTex ? "" : webglCoreFilter;
        if (nextCoreFilter !== lastWebglCoreFilter) {
            lastWebglCoreFilter = nextCoreFilter;
            if (nextCoreFilter) {
                element.style.setProperty("--lg-filter", nextCoreFilter);
            } else {
                element.style.removeProperty("--lg-filter");
            }
        }

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
        frame.saturation = config.saturation;
        frame.surface = config.surface;
        frame.tintColor = tintColor;
        frame.tintOpacity = tintOpacity;
        frame.highlight = highlight;
        frame.darkRimScale = element.classList.contains("lg-switch-glider") ? 0 : 1;
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
        frame.sceneRect = sceneRect;
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
        if (destroyed || activeEngine !== "webgl") return;
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

    const handleVisibilityChange = (nextVisible: boolean) => {
        if (destroyed || isViewportVisible === nextVisible) return;
        isViewportVisible = nextVisible;
        updateWebglSlotVisibility(webglPoolEntry, nextVisible);
        if (activeEngine !== "webgl") return;
        const effectiveActive = nextVisible && !(typeof document !== "undefined" && document.hidden);
        localSceneCapture?.setActive?.(effectiveActive);
        if (!effectiveActive) {
            if (queuedViewportSubscribers.delete(viewportSubscriber)) pendingVisibleRender = true;
            return;
        }
        if (pendingAmbientLightSync) {
            pendingAmbientLightSync = false;
            syncEffectiveLightTilt();
            pendingVisibleRender = true;
        }
        if (pendingVisibleRender) {
            pendingVisibleRender = false;
            scheduleWebglRender();
        }
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
            !isViewportVisible ||
            (typeof document !== "undefined" && document.hidden)
        ) {
            return;
        }
        const bounds = readCoalescenceBounds();
        if (!bounds) return;
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
        preparedSnapshotSlot.hasSceneTex = hasSceneTex;
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
        event.preventDefault();
        lastRenderedFrame = null;
    };

    const onWebglContextRestored = () => {
        if (destroyed || activeEngine !== "webgl") return;
        webglRenderer?.dispose();
        webglRenderer = null;
        mountWebgl();
    };

    const teardownWebgl = (preserveVisibilityObserver = false) => {
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

        if (!externalSceneCanvas && sceneEl) {
            const targetSource = sceneEl;
            if (!localSceneCapture || localSceneCapture.source !== targetSource) {
                unsubscribeCapture?.();
                localSceneCapture?.destroy();
                capturedSceneCanvas = null;
                sceneUploadPending = true;
                localSceneCapture = acquireSharedSceneCapture(
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
                            pixelRatio: effectiveOptions.pixelRatio,
                            radius,
                        };
                    },
                );
                unsubscribeCapture = localSceneCapture.subscribe((canvas, source) => {
                    capturedSceneCanvas = canvas;
                    sceneEl = source;
                    lastSceneBackdropKey = getSceneBackdropKey();
                    sceneUploadPending = true;
                    scheduleWebglRender();
                });
                localSceneCapture.setActive?.(isViewportVisible);
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
        setEngine("webgl");
        syncCoalescenceState(0, true);
        scheduleWebglRender();
    };

    const mountSvg = () => {
        teardownWebgl();
        releaseWebglSlot(webglPoolEntry, true);
        element.style.removeProperty("--lg-tint");
        const svgTint = formatTintCssValue(effectiveOptions.tintColor, effectiveOptions.tintOpacity);
        if (svgTint !== null) {
            element.style.setProperty("--lg-bg", svgTint);
        } else {
            element.style.removeProperty("--lg-bg");
        }
        setEngine("wasm-svg");
        registerManagedElement(element, config);
        syncCoalescenceState(0, true);
        applyCoalescenceVisuals();
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
            const parentEl =
                (element.offsetParent as HTMLElement | null) ?? element.parentElement;
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

    const onInteractivePointerDown = (event: PointerEvent) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        if (isPointerDragging || activeDragPointerId !== null) return;
        hasDraggedBeyondThreshold = false;
        springController?.press();
        const dragMode = resolveDragMode();
        if (dragMode !== null) {
            isPointerDragging = true;
            activeDragMode = dragMode;
            activeDragPointerId = event.pointerId;
            activeFreeDragBounds = dragMode === "free" ? resolveFreeDragBounds() : null;
            dragStartClientX = event.clientX;
            dragStartClientY = event.clientY;
            dragOriginOffsetX = freeDragRestX;
            dragOriginOffsetY = freeDragRestY;
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
        if (isPointerDragging && activeDragMode !== null && event.pointerId === activeDragPointerId) {
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

    const finishDragInteraction = (event: Event, isCancel: boolean) => {
        if (!isPointerDragging) return;
        const pointerEvent = event as PointerEvent;
        if (
            typeof pointerEvent.pointerId === "number" &&
            activeDragPointerId !== null &&
            pointerEvent.pointerId !== activeDragPointerId &&
            event.type !== "blur" &&
            event.type !== "lostpointercapture"
        ) {
            return;
        }
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

        const releaseTime =
            (typeof pointerEvent.timeStamp === "number" && pointerEvent.timeStamp > 0
                ? pointerEvent.timeStamp
                : typeof performance !== "undefined"
                  ? performance.now()
                  : Date.now());
        const idleSec = Math.max(0, (releaseTime - lastDragTimestamp) * 0.001);
        const idleDecay = Math.exp(-idleSec / 0.055);

        if (finishedMode === "free") {
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
            effectiveOptions.onDragChange?.(freeDragRestX, freeDragRestY, false);
        } else {
            activeFreeDragBounds = null;
            springController?.setDrag(0, 0, false);
            if (!isCancel) {
                springController?.impulseDrag(-dragVelocityX * 0.025 * idleDecay, -dragVelocityY * 0.025 * idleDecay);
            }
            effectiveOptions.onDragChange?.(0, 0, false);
        }

        dragVelocityX = 0;
        dragVelocityY = 0;
        if (isCancel) {
            hasDraggedBeyondThreshold = false;
        }
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
        const enabled = isInteractiveElement() || dragMode !== null;
        if (!enabled) {
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
            if (isPointerDragging) {
                finishDragInteraction(new Event("cancel"), true);
            }
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
                    if (dragMoved) {
                        syncCoalescenceState(dragMotionSpeed, true);
                    }
                    if (
                        activeEngine === "webgl" &&
                        (dragMoved ||
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
                    const prevMotionSpeed = dragMotionSpeed;
                    const prevDrag =
                        Math.abs(lastSpringDragX - freeDragRestX) > 0.25 ||
                        Math.abs(lastSpringDragY - freeDragRestY) > 0.25;
                    pressGlow = 0;
                    springTiltHorizontal = 0;
                    springTiltVertical = 0;
                    syncEffectiveLightTilt();
                    dragMotionSpeed = 0;
                    lastSpringDragX = freeDragRestX;
                    lastSpringDragY = freeDragRestY;
                    clearSpringCssVars(true);
                    syncCoalescenceState(0, true);
                    if (
                        activeEngine === "webgl" &&
                        (prevDrag ||
                            prevMotionSpeed > 0.3 ||
                            prevGlow > 0.004 ||
                            Math.abs(prevTiltH) > 0.004 ||
                            Math.abs(prevTiltV) > 0.004)
                    ) {
                        scheduleWebglRender();
                    }
                },
            );
        }

        springController.setFreeDragMode?.(dragMode === "free");
        const { reducedMotionQuery } = getMediaQueries();
        springController.setReducedMotion(Boolean(reducedMotionQuery?.matches));

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
                externalSceneCanvas = newOptions.sceneCanvas ?? null;
                sceneUploadPending = true;
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
            syncThemeAttribute();
            if (existingState) existingState.cachedRadiusStr = null;
            const targetEngine = resolveGlassEngine(effectiveOptions.engine ?? "auto", hasSceneInput());
            if (targetEngine !== activeEngine) {
                if (targetEngine === "webgl" && activeEngine === "css" && isWebglSlotOnStandby(webglPoolEntry)) {
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
            unregisterCoalescence?.();
            unregisterCoalescence = null;
            teardownWebgl();
            releaseWebglSlot(webglPoolEntry, true);
            unregisterManagedElement(element);
            element.classList.remove("lg-on", "lg-hollow", "lg-interactive");
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
