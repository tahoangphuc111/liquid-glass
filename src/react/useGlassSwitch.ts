import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
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
}

export function useGlassSwitch(
    targetRef: RefObject<HTMLElement | null>,
    options: LiquidGlassSwitchOptions = {},
): UseGlassSwitchResult {
    const context = useLiquidGlassContext();
    const instanceRef = useRef<LiquidGlassSwitchInstance | null>(null);
    const [engine, setEngine] = useState<GlassEngine>("css");
    const [value, setValueState] = useState<string>(
        options.value ?? options.defaultValue ?? "",
    );
    const [activeIndex, setActiveIndexState] = useState<number>(0);

    const sceneCanvas = options.sceneCanvas ?? context?.sceneCanvas ?? null;
    const sceneElement = options.sceneElement ?? context?.sceneElement ?? null;
    const onChangeRef = useRef(options.onChange);
    onChangeRef.current = options.onChange;
    const onEngineChangeRef = useRef(options.onEngineChange);
    onEngineChangeRef.current = options.onEngineChange;

    useEffect(() => {
        if (options.engine === "webgl" && context && !context.sceneCanvas) {
            context.requestSceneCapture();
        }
    }, [options.engine, context]);

    useEffect(() => {
        const element = targetRef.current;
        if (!element) {
            return;
        }

        const mergedOptions: LiquidGlassSwitchOptions = {
            ...context?.defaults,
            ...options,
            sceneCanvas,
            sceneElement,
            onChange: (nextValue, nextIndex, itemElement) => {
                setValueState(nextValue);
                setActiveIndexState(nextIndex);
                onChangeRef.current?.(nextValue, nextIndex, itemElement);
            },
            onEngineChange: (nextEngine) => {
                setEngine(nextEngine);
                onEngineChangeRef.current?.(nextEngine);
            },
        };

        if (!instanceRef.current || instanceRef.current.element !== element) {
            instanceRef.current?.destroy();
            const instance = createGlassSwitch(element, mergedOptions);
            instanceRef.current = instance;
            setEngine(instance.engine);
            setValueState(instance.value);
            setActiveIndexState(instance.activeIndex);
        } else {
            instanceRef.current.update(mergedOptions);
            setEngine(instanceRef.current.engine);
            setValueState(instanceRef.current.value);
            setActiveIndexState(instanceRef.current.activeIndex);
        }
    }, [
        targetRef,
        context?.defaults,
        options.value,
        options.defaultValue,
        options.itemSelector,
        options.gliderElement,
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

    return {
        engine,
        value,
        activeIndex,
        setValue,
        setActiveIndex,
        refresh,
    };
}
