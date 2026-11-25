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
import { createGlassSwitch } from "../core/switch.js";
import type {
    GlassEngine,
    LiquidGlassSwitchInstance,
    LiquidGlassSwitchOptions,
} from "../core/types.js";
import { useLiquidGlassContext } from "./context.js";

export interface UseVueGlassSwitchResult {
    engine: Ref<GlassEngine>;
    value: Ref<string>;
    activeIndex: Ref<number>;
    setValue: (value: string, animate?: boolean) => void;
    setActiveIndex: (index: number, animate?: boolean) => void;
    refresh: () => void;
    setLightTilt: (horizontal: number, vertical: number) => void;
}

export function useGlassSwitch(
    targetRef: Ref<HTMLElement | null>,
    options: MaybeRefOrGetter<LiquidGlassSwitchOptions> = {},
): UseVueGlassSwitchResult {
    const context = useLiquidGlassContext();
    const initialOptions = toValue(options);
    const engine = ref<GlassEngine>("css");
    const value = ref<string>(initialOptions.value ?? initialOptions.defaultValue ?? "");
    const activeIndex = ref<number>(0);
    let instance: LiquidGlassSwitchInstance | null = null;
    let prevMergedOptions: LiquidGlassSwitchOptions | null = null;

    const handleChange = (nextValue: string, nextIndex: number, itemElement: HTMLElement) => {
        value.value = nextValue;
        activeIndex.value = nextIndex;
        toValue(options).onChange?.(nextValue, nextIndex, itemElement);
    };
    const handleEngineChange = (nextEngine: GlassEngine) => {
        engine.value = nextEngine;
        toValue(options).onEngineChange?.(nextEngine);
    };

    const syncInstance = () => {
        const element = targetRef.value;
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
        const sceneCanvas =
            currentOptions.sceneCanvas ??
            (currentOptions.sceneElement &&
            currentOptions.sceneElement !== context?.sceneElement.value
                ? null
                : context?.sceneCanvas.value) ??
            null;
        const mergedOptions: LiquidGlassSwitchOptions = {
            ...mergeGlassOptions(context?.defaults.value, currentOptions),
            sceneCanvas,
            sceneElement,
            onChange: handleChange,
            onEngineChange: handleEngineChange,
        };

        if (!instance || instance.element !== element) {
            instance?.destroy();
            instance = createGlassSwitch(element, mergedOptions);
            prevMergedOptions = mergedOptions;
            engine.value = instance.engine;
            value.value = instance.value;
            activeIndex.value = instance.activeIndex;
        } else {
            const patch = computeMergedOptionPatch(prevMergedOptions, mergedOptions);
            prevMergedOptions = mergedOptions;
            if (Object.keys(patch).length > 0) {
                instance.update(patch);
            }
            engine.value = instance.engine;
            value.value = instance.value;
            activeIndex.value = instance.activeIndex;
        }
    };

    onMounted(syncInstance);

    watch(
        [
            targetRef,
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

    const setValue = (nextValue: string, animate = true) => {
        if (!instance) {
            return;
        }
        instance.setValue(nextValue, animate);
        value.value = instance.value;
        activeIndex.value = instance.activeIndex;
    };

    const setActiveIndex = (nextIndex: number, animate = true) => {
        if (!instance) {
            return;
        }
        instance.setActiveIndex(nextIndex, animate);
        value.value = instance.value;
        activeIndex.value = instance.activeIndex;
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
        activeIndex,
        setValue,
        setActiveIndex,
        refresh,
        setLightTilt,
    };
}
