import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
    computeMergedOptionPatch,
    mergeGlassOptions,
    serializeLightTiltKey,
} from "../core/config.js";
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
    setLightTilt: (horizontal: number, vertical: number) => void;
    setDragOffset: (offsetX: number, offsetY: number, animate?: boolean) => void;
}

function serializeDragBoundsKey(bounds: LiquidGlassOptions["dragBounds"]): string | HTMLElement | undefined {
    if (!bounds || typeof bounds === "string") return bounds;
    if ("nodeType" in bounds) return bounds;
    return `${bounds.minX ?? ""}|${bounds.maxX ?? ""}|${bounds.minY ?? ""}|${bounds.maxY ?? ""}`;
}

export function useLiquidGlass(
    targetRef: RefObject<HTMLElement | null>,
    options: LiquidGlassOptions = {},
): UseLiquidGlassResult {
    const context = useLiquidGlassContext();
    const instanceRef = useRef<LiquidGlassInstance | null>(null);
    const prevMergedOptionsRef = useRef<LiquidGlassOptions | null>(null);
    const [engine, setEngine] = useState<GlassEngine>("css");

    const sceneElement = options.sceneElement ?? context?.sceneElement ?? null;
    const sceneCanvas = options.sceneCanvas ?? (sceneElement ? null : context?.sceneCanvas) ?? null;
    const onEngineChangeRef = useRef(options.onEngineChange);
    onEngineChangeRef.current = options.onEngineChange;
    const onDragChangeRef = useRef(options.onDragChange);
    onDragChangeRef.current = options.onDragChange;

    const latestMergedOptionsRef = useRef<LiquidGlassOptions>({});
    latestMergedOptionsRef.current = {
        ...mergeGlassOptions(context?.defaults, options),
        sceneCanvas,
        sceneElement,
        onDragChange: (offsetX, offsetY, isDragging) => {
            onDragChangeRef.current?.(offsetX, offsetY, isDragging);
        },
        onEngineChange: (nextEngine) => {
            setEngine(nextEngine);
            onEngineChangeRef.current?.(nextEngine);
        },
    };

    const syncTargetElement = useCallback(() => {
        const element = targetRef.current;
        if (!element) {
            instanceRef.current?.destroy();
            instanceRef.current = null;
            prevMergedOptionsRef.current = null;
            return;
        }
        const mergedOptions = latestMergedOptionsRef.current;
        if (!instanceRef.current || instanceRef.current.element !== element) {
            instanceRef.current?.destroy();
            const instance = createLiquidGlass(element, mergedOptions);
            instanceRef.current = instance;
            prevMergedOptionsRef.current = mergedOptions;
            setEngine(instance.engine);
        } else {
            const patch = computeMergedOptionPatch(prevMergedOptionsRef.current, mergedOptions);
            prevMergedOptionsRef.current = mergedOptions;
            instanceRef.current.update(patch);
            setEngine(instanceRef.current.engine);
        }
    }, [targetRef]);

    useEffect(() => {
        if ((options.engine ?? context?.defaults?.engine) === "webgl" && context && !context.sceneCanvas) {
            context.requestSceneCapture();
        }
    }, [options.engine, context]);

    const tiltKey = serializeLightTiltKey(options.lightTilt);
    const dragBoundsKey = serializeDragBoundsKey(options.dragBounds);

    useEffect(() => {
        syncTargetElement();
    }, [
        syncTargetElement,
        context?.defaults,
        options.preset,
        options.theme,
        options.surface,
        options.engine,
        options.thickness,
        options.bezel,
        options.adaptiveRefraction,
        options.refractionDirection,
        options.refractionEdgeFade,
        options.maxRefractionPx,
        options.scaleRatio,
        options.maxScaleMultiplier,
        options.blur,
        options.ior,
        options.radius,
        options.cornerStyle,
        options.pill,
        options.hollow,
        options.alwaysOn,
        options.coreFilter,
        options.tintColor,
        options.tintOpacity,
        options.highlight,
        tiltKey,
        options.pixelRatio,
        options.saturation,
        options.chromaticAberration,
        options.abbeNumber,
        options.interactive,
        options.draggable,
        dragBoundsKey,
        options.coalesce,
        sceneCanvas,
        sceneElement,
    ]);

    useEffect(() => {
        const currentEl = targetRef.current;
        const boundEl = instanceRef.current?.element ?? null;
        if (currentEl !== boundEl) {
            syncTargetElement();
        }
    });

    useEffect(() => {
        return () => {
            instanceRef.current?.destroy();
            instanceRef.current = null;
            prevMergedOptionsRef.current = null;
        };
    }, []);

    const refresh = useCallback(() => {
        instanceRef.current?.refresh();
    }, []);

    const setLightTilt = useCallback((horizontal: number, vertical: number) => {
        instanceRef.current?.setLightTilt?.(horizontal, vertical);
    }, []);

    const setDragOffset = useCallback((offsetX: number, offsetY: number, animate = true) => {
        instanceRef.current?.setDragOffset?.(offsetX, offsetY, animate);
    }, []);

    return { engine, refresh, setLightTilt, setDragOffset };
}
