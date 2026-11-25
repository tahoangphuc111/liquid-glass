import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
    computeMergedOptionPatch,
    mergeGlassOptions,
    serializeLightTiltKey,
} from "../core/config.js";
import { createGlassSwitch } from "../core/switch.js";
import type {
    GlassEngine,
    LiquidGlassSwitchInstance,
    LiquidGlassSwitchOptions,
} from "../core/types.js";
import { useLiquidGlassContext } from "./context.js";

export interface UseGlassSwitchResult {
    engine: GlassEngine;
    value: string;
    activeIndex: number;
    setValue: (value: string, animate?: boolean) => void;
    setActiveIndex: (index: number, animate?: boolean) => void;
    refresh: () => void;
    setLightTilt: (horizontal: number, vertical: number) => void;
}

export function useGlassSwitch(
    targetRef: RefObject<HTMLElement | null>,
    options: LiquidGlassSwitchOptions = {},
): UseGlassSwitchResult {
    const context = useLiquidGlassContext();
    const instanceRef = useRef<LiquidGlassSwitchInstance | null>(null);
    const prevMergedOptionsRef = useRef<LiquidGlassSwitchOptions | null>(null);
    const [engine, setEngine] = useState<GlassEngine>("css");
    const [value, setValueState] = useState<string>(
        options.value ?? options.defaultValue ?? "",
    );
    const [activeIndex, setActiveIndexState] = useState<number>(0);

    const sceneElement = options.sceneElement ?? context?.sceneElement ?? null;
    const sceneCanvas =
        options.sceneCanvas ??
        (options.sceneElement && options.sceneElement !== context?.sceneElement
            ? null
            : context?.sceneCanvas) ??
        null;
    const onChangeRef = useRef(options.onChange);
    onChangeRef.current = options.onChange;
    const onEngineChangeRef = useRef(options.onEngineChange);
    onEngineChangeRef.current = options.onEngineChange;

    const handleChange = useCallback(
        (nextValue: string, nextIndex: number, itemElement: HTMLElement) => {
            setValueState(nextValue);
            setActiveIndexState(nextIndex);
            onChangeRef.current?.(nextValue, nextIndex, itemElement);
        },
        [],
    );
    const handleEngineChange = useCallback((nextEngine: GlassEngine) => {
        setEngine(nextEngine);
        onEngineChangeRef.current?.(nextEngine);
    }, []);

    const latestMergedOptionsRef = useRef<LiquidGlassSwitchOptions>({});
    latestMergedOptionsRef.current = {
        ...mergeGlassOptions(context?.defaults, options),
        sceneCanvas,
        sceneElement,
        onChange: handleChange,
        onEngineChange: handleEngineChange,
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
            const instance = createGlassSwitch(element, mergedOptions);
            instanceRef.current = instance;
            prevMergedOptionsRef.current = mergedOptions;
            setEngine(instance.engine);
            setValueState(instance.value);
            setActiveIndexState(instance.activeIndex);
        } else {
            const patch = computeMergedOptionPatch(prevMergedOptionsRef.current, mergedOptions);
            prevMergedOptionsRef.current = mergedOptions;
            if (Object.keys(patch).length > 0) {
                instanceRef.current.update(patch);
            }
            setEngine(instanceRef.current.engine);
            setValueState(instanceRef.current.value);
            setActiveIndexState(instanceRef.current.activeIndex);
        }
    }, [targetRef]);

    useEffect(() => {
        if ((options.engine ?? context?.defaults?.engine) === "webgl" && context && !context.sceneCanvas) {
            context.requestSceneCapture();
        }
    }, [options.engine, context]);

    const tiltKey = serializeLightTiltKey(options.lightTilt);

    useEffect(() => {
        syncTargetElement();
    }, [
        syncTargetElement,
        context?.defaults,
        options.value,
        options.defaultValue,
        options.orientation,
        options.itemSelector,
        options.gliderElement,
        options.trackOptions,
        options.gliderOptions,
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
        options.sharpness,
        options.saturation,
        options.chromaticAberration,
        options.abbeNumber,
        options.interactive,
        options.draggable,
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

    const setValue = useCallback((nextValue: string, animate = true) => {
        const instance = instanceRef.current;
        if (!instance) {
            return;
        }
        instance.setValue(nextValue, animate);
        setValueState(instance.value);
        setActiveIndexState(instance.activeIndex);
    }, []);

    const setActiveIndex = useCallback((nextIndex: number, animate = true) => {
        const instance = instanceRef.current;
        if (!instance) {
            return;
        }
        instance.setActiveIndex(nextIndex, animate);
        setValueState(instance.value);
        setActiveIndexState(instance.activeIndex);
    }, []);

    const refresh = useCallback(() => {
        instanceRef.current?.refresh();
    }, []);

    const setLightTilt = useCallback((horizontal: number, vertical: number) => {
        instanceRef.current?.setLightTilt?.(horizontal, vertical);
    }, []);

    return {
        engine,
        value,
        activeIndex,
        setValue,
        setActiveIndex,
        refresh,
        setLightTilt,
    };
}
