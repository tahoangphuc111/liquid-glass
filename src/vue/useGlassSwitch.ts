import {
    onBeforeUnmount,
    onMounted,
    ref,
    toValue,
    watch,
    type MaybeRefOrGetter,
    type Ref,
} from "vue";
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

    const syncInstance = () => {
        const element = targetRef.value;
        if (!element) {
            instance?.destroy();
            instance = null;
            return;
        }

        const currentOptions = toValue(options);
        if (currentOptions.engine === "webgl" && context && !context.sceneCanvas.value) {
            context.requestSceneCapture();
        }

        const mergedOptions: LiquidGlassSwitchOptions = {
            ...(context?.defaults.value ?? {}),
            ...currentOptions,
            sceneCanvas: currentOptions.sceneCanvas ?? context?.sceneCanvas.value ?? null,
            sceneElement: currentOptions.sceneElement ?? context?.sceneElement.value ?? null,
            onChange: (nextValue, nextIndex, itemElement) => {
                value.value = nextValue;
                activeIndex.value = nextIndex;
                currentOptions.onChange?.(nextValue, nextIndex, itemElement);
            },
            onEngineChange: (nextEngine) => {
                engine.value = nextEngine;
                currentOptions.onEngineChange?.(nextEngine);
            },
        };

        if (!instance || instance.element !== element) {
            instance?.destroy();
            instance = createGlassSwitch(element, mergedOptions);
            engine.value = instance.engine;
            value.value = instance.value;
            activeIndex.value = instance.activeIndex;
        } else {
            instance.update(mergedOptions);
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

    return {
        engine,
        value,
        activeIndex,
        setValue,
        setActiveIndex,
        refresh,
    };
}
