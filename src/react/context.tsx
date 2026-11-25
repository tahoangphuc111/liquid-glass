import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
    type RefObject,
} from "react";
import { resolveSceneCaptureSharpness } from "../core/config.js";
import { canUseSvgGlass, canUseWebglRefraction, getMediaQueries, subscribeBatteryChanges } from "../core/observer.js";
import { acquireSharedSceneCapture } from "../core/sceneCapture.js";
import type { LiquidGlassOptions, SceneCaptureController } from "../core/types.js";
import { isWasmReady, onWasmReady } from "../core/wasm.js";

export interface LiquidGlassContextValue {
    sceneCanvas: HTMLCanvasElement | null;
    sceneElement: HTMLElement | null;
    defaults: Partial<LiquidGlassOptions>;
    requestSceneCapture: () => void;
    refreshCapture: () => void;
}

const LiquidGlassContext = createContext<LiquidGlassContextValue | null>(null);

export interface LiquidGlassProviderProps {
    children: ReactNode;
    sceneRef?: RefObject<HTMLElement | null>;
    captureScene?: "auto" | "always" | "never";
    defaults?: Partial<LiquidGlassOptions>;
    className?: string;
}

const EMPTY_DEFAULTS: Partial<LiquidGlassOptions> = {};

function shallowDefaultsEqual(
    prev: Partial<LiquidGlassOptions>,
    next: Partial<LiquidGlassOptions>,
): boolean {
    if (prev === next) return true;
    const prevKeys = Object.keys(prev) as Array<keyof LiquidGlassOptions>;
    const nextKeys = Object.keys(next) as Array<keyof LiquidGlassOptions>;
    if (prevKeys.length !== nextKeys.length) return false;
    for (const key of prevKeys) {
        const aVal = prev[key];
        const bVal = next[key];
        if (Object.is(aVal, bVal)) continue;
        if (
            key === "lightTilt" &&
            aVal &&
            bVal &&
            typeof aVal === "object" &&
            typeof bVal === "object"
        ) {
            const tiltA = aVal as { horizontal?: number; vertical?: number };
            const tiltB = bVal as { horizontal?: number; vertical?: number };
            if (Object.is(tiltA.horizontal, tiltB.horizontal) && Object.is(tiltA.vertical, tiltB.vertical)) {
                continue;
            }
        }
        return false;
    }
    return true;
}

export function LiquidGlassProvider({
    children,
    sceneRef,
    captureScene = "auto",
    defaults = EMPTY_DEFAULTS,
    className,
}: LiquidGlassProviderProps) {
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const controllerRef = useRef<SceneCaptureController | null>(null);
    const captureTargetRef = useRef<HTMLElement | null>(null);
    const stabilizedDefaultsRef = useRef<Partial<LiquidGlassOptions>>(defaults);
    if (!shallowDefaultsEqual(stabilizedDefaultsRef.current, defaults)) {
        stabilizedDefaultsRef.current = defaults;
    }
    const stableDefaults = stabilizedDefaultsRef.current;
    const defaultsRef = useRef(stableDefaults);
    defaultsRef.current = stableDefaults;
    const [sceneCanvas, setSceneCanvas] = useState<HTMLCanvasElement | null>(null);
    const [sceneElement, setSceneElement] = useState<HTMLElement | null>(null);
    const [forcedCapture, setForcedCapture] = useState(false);

    const shouldCaptureNow = useCallback(() => {
        if (captureScene === "never") return false;
        if (captureScene === "always") return true;
        return canUseWebglRefraction() && (forcedCapture || !canUseSvgGlass());
    }, [captureScene, forcedCapture]);

    const syncCapture = useCallback(() => {
        const target = sceneRef?.current ?? wrapperRef.current;
        captureTargetRef.current = target;
        if (!target || !shouldCaptureNow()) {
            controllerRef.current?.destroy();
            controllerRef.current = null;
            setSceneCanvas(null);
            setSceneElement(target ?? null);
            return;
        }

        if (controllerRef.current && controllerRef.current.source === target) {
            setSceneElement(target);
            controllerRef.current.scheduleCapture();
            return;
        }

        controllerRef.current?.destroy();
        setSceneCanvas(null);
        const controller = acquireSharedSceneCapture(target, () => {
            const sharpness = resolveSceneCaptureSharpness(defaultsRef.current);
            return {
                pixelRatio: defaultsRef.current.pixelRatio,
                radius: defaultsRef.current.pill ? 9999 : defaultsRef.current.radius,
                ...(sharpness > 0 ? { sharpness } : {}),
            };
        });
        controllerRef.current = controller;
        setSceneElement(target);
        controller.subscribe((canvas, sourceEl) => {
            setSceneCanvas(canvas);
            setSceneElement(sourceEl);
        });
    }, [sceneRef, shouldCaptureNow]);

    useEffect(() => {
        syncCapture();

        const {
            reducedMotionQuery,
            mobileOrTouchQuery,
            reducedTransparencyQuery,
            highContrastQuery,
        } = getMediaQueries();
        reducedMotionQuery?.addEventListener?.("change", syncCapture);
        mobileOrTouchQuery?.addEventListener?.("change", syncCapture);
        reducedTransparencyQuery?.addEventListener?.("change", syncCapture);
        highContrastQuery?.addEventListener?.("change", syncCapture);
        const unsubWasm = isWasmReady() ? null : onWasmReady(syncCapture);
        const unsubscribeBattery = captureScene === "auto" ? subscribeBatteryChanges(syncCapture) : null;

        return () => {
            unsubWasm?.();
            unsubscribeBattery?.();
            reducedMotionQuery?.removeEventListener?.("change", syncCapture);
            mobileOrTouchQuery?.removeEventListener?.("change", syncCapture);
            reducedTransparencyQuery?.removeEventListener?.("change", syncCapture);
            highContrastQuery?.removeEventListener?.("change", syncCapture);
        };
    }, [captureScene, syncCapture]);

    useEffect(() => {
        if ((sceneRef?.current ?? wrapperRef.current) !== captureTargetRef.current) syncCapture();
    });

    useEffect(() => {
        controllerRef.current?.scheduleCapture();
    }, [
        stableDefaults.pixelRatio,
        stableDefaults.radius,
        stableDefaults.pill,
        stableDefaults.sharpness,
        stableDefaults.blur,
        stableDefaults.preset,
    ]);

    useEffect(() => {
        return () => {
            controllerRef.current?.destroy();
            controllerRef.current = null;
        };
    }, []);

    const requestSceneCapture = useCallback(() => {
        if (captureScene === "auto") {
            setForcedCapture(true);
        }
    }, [captureScene]);

    const refreshCapture = useCallback(() => {
        controllerRef.current?.scheduleCapture();
    }, []);

    const contextValue = useMemo<LiquidGlassContextValue>(
        () => ({
            sceneCanvas,
            sceneElement,
            defaults: stableDefaults,
            requestSceneCapture,
            refreshCapture,
        }),
        [sceneCanvas, sceneElement, stableDefaults, requestSceneCapture, refreshCapture],
    );

    return (
        <LiquidGlassContext.Provider value={contextValue}>
            {sceneRef ? (
                children
            ) : (
                <div ref={wrapperRef} className={className} style={{ position: "relative" }}>
                    {children}
                </div>
            )}
        </LiquidGlassContext.Provider>
    );
}

export function useLiquidGlassContext(): LiquidGlassContextValue | null {
    return useContext(LiquidGlassContext);
}
