import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createLiquidGlass } from "../core/controller.js";
import type {
    GlassEngine,
    LiquidGlassInstance,
    LiquidGlassOptions,
} from "../core/types.js";
import { useLiquidGlassContext } from "./context.js";

export interface UseLiquidGlassResult {
    engine: GlassEngine;
    refresh: () => void;
}

export function useLiquidGlass(
    targetRef: RefObject<HTMLElement | null>,
    options: LiquidGlassOptions = {},
): UseLiquidGlassResult {
    const context = useLiquidGlassContext();
    const instanceRef = useRef<LiquidGlassInstance | null>(null);
    const [engine, setEngine] = useState<GlassEngine>("css");

    const sceneCanvas = options.sceneCanvas ?? context?.sceneCanvas ?? null;
    const sceneElement = options.sceneElement ?? context?.sceneElement ?? null;
    const onEngineChangeRef = useRef(options.onEngineChange);
    onEngineChangeRef.current = options.onEngineChange;

    useEffect(() => {
        if (options.engine === "webgl" && context && !context.sceneCanvas) {
            context.requestSceneCapture();
        }
    }, [options.engine, context]);

    useEffect(() => {
        const element = targetRef.current;
        if (!element) return;

        const mergedOptions: LiquidGlassOptions = {
            ...context?.defaults,
            ...options,
            sceneCanvas,
            sceneElement,
            onEngineChange: (nextEngine) => {
                setEngine(nextEngine);
                onEngineChangeRef.current?.(nextEngine);
            },
        };

        if (!instanceRef.current || instanceRef.current.element !== element) {
            instanceRef.current?.destroy();
            const instance = createLiquidGlass(element, mergedOptions);
            instanceRef.current = instance;
            setEngine(instance.engine);
        } else {
            instanceRef.current.update(mergedOptions);
            setEngine(instanceRef.current.engine);
        }
    }, [
        targetRef,
        context?.defaults,
        options.surface,
        options.engine,
        options.thickness,
        options.bezel,
        options.scaleRatio,
        options.maxScaleMultiplier,
        options.blur,
        options.ior,
        options.radius,
        options.pill,
        options.hollow,
        options.alwaysOn,
        options.coreFilter,
        options.tintColor,
        options.tintOpacity,
        options.highlight,
        options.pixelRatio,
        options.chromaticAberration,
        options.interactive,
        options.draggable,
        options.coalesce,
        sceneCanvas,
        sceneElement,
    ]);

    useEffect(() => {
        return () => {
            instanceRef.current?.destroy();
            instanceRef.current = null;
        };
    }, []);

    const refresh = useCallback(() => {
        instanceRef.current?.refresh();
    }, []);

    return { engine, refresh };
}
