import type { GlassEngine, GlassEngineMode } from "./types.js";
import { disconnectLoafTelemetry, initLoafTelemetry, isGlassDowngraded } from "./telemetry.js";
import { initWasmSimdModule, isWasmReady } from "./wasm.js";

interface NavigatorExtended extends Navigator {
    userAgentData?: {
        brands?: Array<{ brand: string; version: string }>;
    };
    getBattery?: () => Promise<{
        level: number;
        charging: boolean;
        addEventListener(type: string, listener: () => void): void;
    }>;
}

export function checkIsChromium(): boolean {
    if (typeof window !== "undefined") {
        const testFlag = (window as unknown as { __LG_FORCE_CHROMIUM__?: boolean }).__LG_FORCE_CHROMIUM__;
        if (testFlag === true) return true;
        if (testFlag === false) return false;
    }
    if (typeof navigator === "undefined") return false;

    const nav = navigator as NavigatorExtended;
    if (Array.isArray(nav.userAgentData?.brands)) {
        return nav.userAgentData.brands.some((item) => item.brand === "Chromium");
    }
    return /Chrome\//.test(navigator.userAgent);
}

let reducedMotionQuery: MediaQueryList | null = null;
let mobileOrTouchQuery: MediaQueryList | null = null;
let reducedTransparencyQuery: MediaQueryList | null = null;
let highContrastQuery: MediaQueryList | null = null;

export function getMediaQueries() {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return {
            reducedMotionQuery: null,
            mobileOrTouchQuery: null,
            reducedTransparencyQuery: null,
            highContrastQuery: null,
        };
    }
    reducedMotionQuery ??= window.matchMedia("(prefers-reduced-motion: reduce)");
    mobileOrTouchQuery ??= window.matchMedia("(max-width: 768px), (pointer: coarse)");
    reducedTransparencyQuery ??= window.matchMedia("(prefers-reduced-transparency: reduce)");
    highContrastQuery ??= window.matchMedia("(prefers-contrast: more)");

    return {
        reducedMotionQuery,
        mobileOrTouchQuery,
        reducedTransparencyQuery,
        highContrastQuery,
    };
}

let isBatteryLow = false;
let batteryRequest: symbol | null = null;
let activeBatteryManager: {
    addEventListener(type: string, listener: () => void): void;
    removeEventListener?(type: string, listener: () => void): void;
} | null = null;
let activeBatteryListener: (() => void) | null = null;
const batterySubscribers = new Set<() => void>();

function attachBatteryListener(): void {
    if (batteryRequest || typeof navigator === "undefined") return;
    const nav = navigator as NavigatorExtended;
    if (typeof nav.getBattery !== "function") return;
    const request = Symbol();
    batteryRequest = request;

    nav
        .getBattery()
        .then((battery) => {
            if (batteryRequest !== request) return;
            activeBatteryManager = battery;
            const updateBattery = () => {
                const wasLow = isBatteryLow;
                isBatteryLow = battery.level <= 0.2 && !battery.charging;
                if (wasLow !== isBatteryLow) {
                    for (const listener of batterySubscribers) listener();
                }
            };
            activeBatteryListener = updateBattery;
            battery.addEventListener("levelchange", updateBattery);
            battery.addEventListener("chargingchange", updateBattery);
            updateBattery();
        })
        .catch(() => {
            if (batteryRequest === request) batteryRequest = null;
        });
}

function detachUnusedBatteryListener(): void {
    if (listenersAttached || batterySubscribers.size > 0) return;
    if (activeBatteryManager && activeBatteryListener) {
        activeBatteryManager.removeEventListener?.("levelchange", activeBatteryListener);
        activeBatteryManager.removeEventListener?.("chargingchange", activeBatteryListener);
        activeBatteryManager = null;
        activeBatteryListener = null;
    }
    batteryRequest = null;
    isBatteryLow = false;
}

export function subscribeBatteryChanges(listener: () => void): () => void {
    batterySubscribers.add(listener);
    attachBatteryListener();
    return () => {
        batterySubscribers.delete(listener);
        detachUnusedBatteryListener();
    };
}

export function isConstrainedDevice(): boolean {
    if (typeof document !== "undefined" && document.documentElement.classList.contains("low-end-device")) {
        return true;
    }
    const { reducedTransparencyQuery: rt, highContrastQuery: hc } = getMediaQueries();
    return Boolean(rt?.matches) || Boolean(hc?.matches) || isBatteryLow;
}

export function canUseSvgGlass(): boolean {
    if (typeof window === "undefined" || isGlassDowngraded || isConstrainedDevice() || !checkIsChromium()) return false;

    const { reducedMotionQuery: rm, mobileOrTouchQuery: mobile } = getMediaQueries();
    if (rm?.matches || mobile?.matches) return false;
    initWasmSimdModule();
    return isWasmReady();
}

export function canUseWebglRefraction(): boolean {
    if (typeof window === "undefined" || typeof document === "undefined") return false;
    return !isConstrainedDevice();
}

export function resolveGlassEngine(
    mode: GlassEngineMode = "auto",
    hasSceneSource = false,
): GlassEngine {
    if (mode === "css") return "css";
    if (mode === "wasm-svg") {
        return canUseSvgGlass() ? "wasm-svg" : hasSceneSource && canUseWebglRefraction() ? "webgl" : "css";
    }
    if (mode === "webgl") {
        return canUseWebglRefraction() ? "webgl" : "css";
    }

    if (canUseSvgGlass()) return "wasm-svg";
    if (hasSceneSource && canUseWebglRefraction()) return "webgl";
    return "css";
}

export let isDocumentIdle = false;
let lastActivityTick = 0;
let listenersAttached = false;
let onDprResize: (() => void) | null = null;

export function setDprResizeCallback(callback: (() => void) | null): void {
    onDprResize = callback;
}

export function notifyUserActivity(): void {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - lastActivityTick < 500 && !isDocumentIdle) return;
    lastActivityTick = now;

    if (isDocumentIdle) {
        isDocumentIdle = false;
        if (typeof document !== "undefined") {
            document.documentElement.classList.remove("lg-idle");
        }
        initLoafTelemetry();
    }
}

function onBlur(): void {
    if (!isDocumentIdle) {
        isDocumentIdle = true;
        if (typeof document !== "undefined") {
            document.documentElement.classList.add("lg-idle");
        }
        disconnectLoafTelemetry();
    }
}

function onResize(): void {
    notifyUserActivity();
    onDprResize?.();
}

export function attachGlobalListeners(): void {
    if (typeof window === "undefined" || listenersAttached) return;
    listenersAttached = true;

    window.addEventListener("focus", notifyUserActivity, { passive: true });
    window.addEventListener("blur", onBlur, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    attachBatteryListener();

    if (typeof document !== "undefined" && !document.hidden) {
        initLoafTelemetry();
    }
}

export function detachGlobalListeners(): void {
    if (typeof window === "undefined" || !listenersAttached) return;
    listenersAttached = false;

    window.removeEventListener("focus", notifyUserActivity);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("resize", onResize);

    detachUnusedBatteryListener();

    disconnectLoafTelemetry();
}

export function resetObserverForTesting(): void {
    detachGlobalListeners();
    reducedMotionQuery = null;
    mobileOrTouchQuery = null;
    reducedTransparencyQuery = null;
    highContrastQuery = null;
    isBatteryLow = false;
    onDprResize = null;
    isDocumentIdle = false;
    lastActivityTick = 0;
    sharedResizeObserver?.disconnect();
    sharedResizeObserver = null;
    sharedResizeObserverCtor = null;
    for (const element of observedResizeElements) {
        resizeHandlers.delete(element);
    }
    observedResizeElements.clear();
}

const resizeHandlers = new WeakMap<Element, Set<() => void>>();
const observedResizeElements = new Set<Element>();
let sharedResizeObserver: ResizeObserver | null = null;
let sharedResizeObserverCtor: typeof ResizeObserver | null = null;

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
                if (!callbacks || callbacks.size === 0) continue;
                if (callbacks.size === 1) {
                    for (const cb of callbacks) cb();
                } else {
                    for (const cb of Array.from(callbacks)) cb();
                }
            }
        });
        for (const existingElement of observedResizeElements) {
            sharedResizeObserver.observe(existingElement, { box: "border-box" });
        }
    }
    let callbacks = resizeHandlers.get(targetElement);
    if (!callbacks) {
        callbacks = new Set();
        resizeHandlers.set(targetElement, callbacks);
        observedResizeElements.add(targetElement);
        sharedResizeObserver.observe(targetElement, { box: "border-box" });
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
                observedResizeElements.delete(targetElement);
                sharedResizeObserver?.unobserve(targetElement);
                if (observedResizeElements.size === 0) {
                    sharedResizeObserver?.disconnect();
                    sharedResizeObserver = null;
                    sharedResizeObserverCtor = null;
                }
            }
        }
    };
}
