import {
    onBeforeUnmount,
    onMounted,
    ref,
    toValue,
    watch,
    type MaybeRefOrGetter,
    type Ref,
} from "vue";
import { computeMergedOptionPatch, mergeGlassOptions } from "../core/config.js";
import { createGlassSlider } from "../core/slider.js";
import type {
    GlassEngine,
    LiquidGlassSliderInstance,
    LiquidGlassSliderOptions,
} from "../core/types.js";
import { useLiquidGlassContext } from "./context.js";

export interface UseVueGlassSliderResult {
    engine: Ref<GlassEngine>;
    value: Ref<number>;
    setValue: (value: number, animate?: boolean) => void;
    refresh: () => void;
    setLightTilt: (horizontal: number, vertical: number) => void;
}

export function useGlassSlider(
    inputRef: Ref<HTMLInputElement | null>,
    options: MaybeRefOrGetter<LiquidGlassSliderOptions> = {},
): UseVueGlassSliderResult {
    const context = useLiquidGlassContext();
    const engine = ref<GlassEngine>("css");
    const value = ref<number>(0);
    let instance: LiquidGlassSliderInstance | null = null;
    let prevMergedOptions: LiquidGlassSliderOptions | null = null;

    const syncInstance = () => {
        const element = inputRef.value;
        if (!element) {
            instance?.destroy();
            instance = null;
            prevMergedOptions = null;
            return;
        }

        const currentOptions = toValue(options);
        if (
            (currentOptions.engine ?? context?.defaults.value?.engine) === "webgl" &&
            context &&
            !context.sceneCanvas.value
        ) {
            context.requestSceneCapture();
        }

        const sceneElement = currentOptions.sceneElement ?? context?.sceneElement.value ?? null;
        const mergedOptions: LiquidGlassSliderOptions = {
            ...mergeGlassOptions(context?.defaults.value, currentOptions),
            sceneCanvas: currentOptions.sceneCanvas ?? (sceneElement ? null : context?.sceneCanvas.value) ?? null,
            sceneElement,
            onChange: (nextValue, inputEl) => {
                value.value = nextValue;
                currentOptions.onChange?.(nextValue, inputEl);
            },
            onEngineChange: (nextEngine) => {
                engine.value = nextEngine;
                currentOptions.onEngineChange?.(nextEngine);
            },
        };

        if (!instance || instance.element !== element) {
            instance?.destroy();
            instance = createGlassSlider(element, mergedOptions);
            prevMergedOptions = mergedOptions;
            engine.value = instance.engine;
            value.value = instance.value;
        } else {
            const patch = computeMergedOptionPatch(prevMergedOptions, mergedOptions);
            prevMergedOptions = mergedOptions;
            instance.update(patch);
            engine.value = instance.engine;
            value.value = instance.value;
        }
    };

    onMounted(syncInstance);

    watch(
        [
            inputRef,
            () => toValue(options),
            () => context?.sceneCanvas.value,
            () => context?.sceneElement.value,
            () => context?.defaults.value,
        ],
        syncInstance,
        { deep: true },
    );

    onBeforeUnmount(() => {
        instance?.destroy();
        instance = null;
        prevMergedOptions = null;
    });

    const setValue = (nextValue: number, animate = true) => {
        if (!instance) return;
        instance.setValue(nextValue, animate);
        value.value = instance.value;
    };

    const refresh = () => {
        instance?.refresh();
    };

    const setLightTilt = (horizontal: number, vertical: number) => {
        instance?.setLightTilt?.(horizontal, vertical);
    };

    return {
        engine,
        value,
        setValue,
        refresh,
        setLightTilt,
    };
}
