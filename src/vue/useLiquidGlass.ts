import {
    onBeforeUnmount,
    onMounted,
    ref,
    toValue,
    watch,
    type MaybeRefOrGetter,
    type Ref,
} from "vue";
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
}

export function useLiquidGlass(
    targetRef: Ref<HTMLElement | null>,
    options: MaybeRefOrGetter<LiquidGlassOptions> = {},
): UseVueLiquidGlassResult {
    const context = useLiquidGlassContext();
    const engine = ref<GlassEngine>("css");
    let instance: LiquidGlassInstance | null = null;

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

        const mergedOptions: LiquidGlassOptions = {
            ...(context?.defaults.value ?? {}),
            ...currentOptions,
            sceneCanvas: currentOptions.sceneCanvas ?? context?.sceneCanvas.value ?? null,
            sceneElement: currentOptions.sceneElement ?? context?.sceneElement.value ?? null,
            onEngineChange: (nextEngine) => {
                engine.value = nextEngine;
                currentOptions.onEngineChange?.(nextEngine);
            },
        };

        if (!instance || instance.element !== element) {
            instance?.destroy();
            instance = createLiquidGlass(element, mergedOptions);
            engine.value = instance.engine;
        } else {
            instance.update(mergedOptions);
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
    });

    const refresh = () => {
        instance?.refresh();
    };

    return { engine, refresh };
}
