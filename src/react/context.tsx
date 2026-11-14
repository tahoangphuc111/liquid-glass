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
import { canUseSvgGlass, getMediaQueries } from "../core/observer.js";
import { createSceneCaptureController } from "../core/sceneCapture.js";
import type { LiquidGlassOptions, SceneCaptureController } from "../core/types.js";
import { onWasmReady } from "../core/wasm.js";

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

export function LiquidGlassProvider({
    children,
    sceneRef,
    captureScene = "auto",
    defaults = {},
    className,
}: LiquidGlassProviderProps) {
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const controllerRef = useRef<SceneCaptureController | null>(null);
    const defaultsRef = useRef(defaults);
    defaultsRef.current = defaults;
    const [sceneCanvas, setSceneCanvas] = useState<HTMLCanvasElement | null>(null);
    const [sceneElement, setSceneElement] = useState<HTMLElement | null>(null);
    const [forcedCapture, setForcedCapture] = useState(false);

    const shouldCaptureNow = useCallback(() => {
        if (captureScene === "never") return false;
        if (captureScene === "always" || forcedCapture) return true;
        return !canUseSvgGlass();
    }, [captureScene, forcedCapture]);

    const syncCapture = useCallback(() => {
        const target = sceneRef?.current ?? wrapperRef.current;
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
        const controller = createSceneCaptureController(target, () => ({
            pixelRatio: defaultsRef.current.pixelRatio,
            radius: defaultsRef.current.pill ? 9999 : defaultsRef.current.radius,
        }));
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
        onWasmReady(syncCapture);

        return () => {
            reducedMotionQuery?.removeEventListener?.("change", syncCapture);
            mobileOrTouchQuery?.removeEventListener?.("change", syncCapture);
            reducedTransparencyQuery?.removeEventListener?.("change", syncCapture);
            highContrastQuery?.removeEventListener?.("change", syncCapture);
            controllerRef.current?.destroy();
            controllerRef.current = null;
        };
    }, [syncCapture]);

    const requestSceneCapture = useCallback(() => {
        setForcedCapture(true);
    }, []);

    const refreshCapture = useCallback(() => {
        controllerRef.current?.scheduleCapture();
    }, []);

    const contextValue = useMemo<LiquidGlassContextValue>(
        () => ({
            sceneCanvas,
            sceneElement,
            defaults,
            requestSceneCapture,
            refreshCapture,
        }),
        [sceneCanvas, sceneElement, defaults, requestSceneCapture, refreshCapture],
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
