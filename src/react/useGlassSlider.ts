import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type RefObject,
} from "react";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;
import {
    computeMergedOptionPatch,
    mergeGlassOptions,
    serializeLightTiltKey,
} from "../core/config.js";
import { createGlassSlider } from "../core/slider.js";
import type {
    GlassEngine,
    LiquidGlassSliderInstance,
    LiquidGlassSliderOptions,
} from "../core/types.js";
import { useLiquidGlassContext } from "./context.js";

export interface UseGlassSliderResult {
    engine: GlassEngine;
    value: number;
    setValue: (value: number, animate?: boolean) => void;
    refresh: () => void;
    setLightTilt: (horizontal: number, vertical: number) => void;
}

export function useGlassSlider(
    inputRef: RefObject<HTMLInputElement | null>,
    options: LiquidGlassSliderOptions = {},
): UseGlassSliderResult {
    const context = useLiquidGlassContext();
    const instanceRef = useRef<LiquidGlassSliderInstance | null>(null);
    const prevMergedOptionsRef = useRef<LiquidGlassSliderOptions | null>(null);
    const [engine, setEngine] = useState<GlassEngine>("css");
    const [value, setValueState] = useState<number>(0);

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

    const handleChange = useCallback((nextValue: number, inputElement: HTMLInputElement) => {
        setValueState(nextValue);
        onChangeRef.current?.(nextValue, inputElement);
    }, []);
    const handleEngineChange = useCallback((nextEngine: GlassEngine) => {
        setEngine(nextEngine);
        onEngineChangeRef.current?.(nextEngine);
    }, []);

    const latestMergedOptionsRef = useRef<LiquidGlassSliderOptions>({});
    latestMergedOptionsRef.current = {
        ...mergeGlassOptions(context?.defaults, options),
        sceneCanvas,
        sceneElement,
        onChange: handleChange,
        onEngineChange: handleEngineChange,
    };

    const syncTargetElement = useCallback(() => {
        const element = inputRef.current;
        if (!element) {
            instanceRef.current?.destroy();
            instanceRef.current = null;
            prevMergedOptionsRef.current = null;
            return;
        }
        const mergedOptions = latestMergedOptionsRef.current;
        if (!instanceRef.current || instanceRef.current.element !== element) {
            instanceRef.current?.destroy();
            const instance = createGlassSlider(element, mergedOptions);
            instanceRef.current = instance;
            prevMergedOptionsRef.current = mergedOptions;
            setEngine(instance.engine);
            setValueState(instance.value);
        } else {
            const patch = computeMergedOptionPatch(prevMergedOptionsRef.current, mergedOptions);
            prevMergedOptionsRef.current = mergedOptions;
            if (Object.keys(patch).length > 0) {
                instanceRef.current.update(patch);
            }
            setEngine(instanceRef.current.engine);
            setValueState(instanceRef.current.value);
        }
    }, [inputRef]);

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
        options.orientation,
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
        const currentEl = inputRef.current;
        const boundEl = instanceRef.current?.element ?? null;
        if (currentEl !== boundEl) {
            syncTargetElement();
        }
    });

    useIsomorphicLayoutEffect(() => {
        return () => {
            instanceRef.current?.destroy();
            instanceRef.current = null;
            prevMergedOptionsRef.current = null;
        };
    }, []);

    const setValue = useCallback((nextValue: number, animate = true) => {
        const instance = instanceRef.current;
        if (!instance) return;
        instance.setValue(nextValue, animate);
        setValueState(instance.value);
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
        setValue,
        refresh,
        setLightTilt,
    };
}
