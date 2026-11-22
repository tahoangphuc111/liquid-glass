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
import { createLiquidGlass } from "../core/controller.js";
import type {
    GlassEngine,
    LiquidGlassInstance,
    LiquidGlassOptions,
} from "../core/types.js";
import { useLiquidGlassContext } from "./context.js";

export interface UseVueLiquidGlassResult {
    engine: Ref<GlassEngine>;
    refresh: () => void;
    setLightTilt: (horizontal: number, vertical: number) => void;
    setDragOffset: (offsetX: number, offsetY: number, animate?: boolean) => void;
}

export function useLiquidGlass(
    targetRef: Ref<HTMLElement | null>,
    options: MaybeRefOrGetter<LiquidGlassOptions> = {},
): UseVueLiquidGlassResult {
    const context = useLiquidGlassContext();
    const engine = ref<GlassEngine>("css");
    let instance: LiquidGlassInstance | null = null;
    let prevMergedOptions: LiquidGlassOptions | null = null;

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
        const mergedOptions: LiquidGlassOptions = {
            ...mergeGlassOptions(context?.defaults.value, currentOptions),
            sceneCanvas: currentOptions.sceneCanvas ?? (sceneElement ? null : context?.sceneCanvas.value) ?? null,
            sceneElement,
            onEngineChange: (nextEngine) => {
                engine.value = nextEngine;
                currentOptions.onEngineChange?.(nextEngine);
            },
        };

        if (!instance || instance.element !== element) {
            instance?.destroy();
            instance = createLiquidGlass(element, mergedOptions);
            prevMergedOptions = mergedOptions;
            engine.value = instance.engine;
        } else {
            const patch = computeMergedOptionPatch(prevMergedOptions, mergedOptions);
            prevMergedOptions = mergedOptions;
            instance.update(patch);
            engine.value = instance.engine;
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

    const refresh = () => {
        instance?.refresh();
    };

    const setLightTilt = (horizontal: number, vertical: number) => {
        instance?.setLightTilt?.(horizontal, vertical);
    };

    const setDragOffset = (offsetX: number, offsetY: number, animate = true) => {
        instance?.setDragOffset?.(offsetX, offsetY, animate);
    };

    return { engine, refresh, setLightTilt, setDragOffset };
}
