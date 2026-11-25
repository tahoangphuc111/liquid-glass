import {
    defineComponent,
    h,
    inject,
    onBeforeUnmount,
    onMounted,
    provide,
    ref,
    shallowRef,
    watch,
    type InjectionKey,
    type PropType,
    type Ref,
} from "vue";
import { resolveSceneCaptureSharpness } from "../core/config.js";
import { canUseSvgGlass, canUseWebglRefraction, getMediaQueries, subscribeBatteryChanges } from "../core/observer.js";
import { acquireSharedSceneCapture } from "../core/sceneCapture.js";
import type { LiquidGlassOptions, SceneCaptureController } from "../core/types.js";
import { isWasmReady, onWasmReady } from "../core/wasm.js";

export interface VueLiquidGlassContext {
    sceneCanvas: Ref<HTMLCanvasElement | null>;
    sceneElement: Ref<HTMLElement | null>;
    defaults: Ref<Partial<LiquidGlassOptions>>;
    requestSceneCapture: () => void;
    refreshCapture: () => void;
}

export const LIQUID_GLASS_INJECTION_KEY: InjectionKey<VueLiquidGlassContext> =
    Symbol("LiquidGlassContext");

export function useLiquidGlassContext(): VueLiquidGlassContext | null {
    return inject(LIQUID_GLASS_INJECTION_KEY, null);
}

export const LiquidGlassProvider = defineComponent({
    name: "LiquidGlassProvider",
    props: {
        sceneElement: {
            type: Object as PropType<HTMLElement | null>,
            default: null,
        },
        captureScene: {
            type: String as PropType<"auto" | "always" | "never">,
            default: "auto",
        },
        defaults: {
            type: Object as PropType<Partial<LiquidGlassOptions>>,
            default: () => ({}),
        },
    },
    setup(props, { slots }) {
        const wrapperRef = ref<HTMLElement | null>(null);
        const sceneCanvas = shallowRef<HTMLCanvasElement | null>(null);
        const activeSceneEl = shallowRef<HTMLElement | null>(null);
        const defaultsRef = ref<Partial<LiquidGlassOptions>>(props.defaults);
        const forcedCapture = ref(false);
        let controller: SceneCaptureController | null = null;

        watch(
            () => props.defaults,
            (nextDefaults) => {
                defaultsRef.value = nextDefaults;
            },
            { deep: true },
        );

        const shouldCaptureNow = () => {
            if (props.captureScene === "never") return false;
            if (props.captureScene === "always") return true;
            return canUseWebglRefraction() && (forcedCapture.value || !canUseSvgGlass());
        };

        const syncCapture = () => {
            const target = props.sceneElement ?? wrapperRef.value;
            if (!target || !shouldCaptureNow()) {
                controller?.destroy();
                controller = null;
                sceneCanvas.value = null;
                activeSceneEl.value = target ?? null;
                return;
            }

            if (controller && controller.source === target) {
                activeSceneEl.value = target;
                controller.scheduleCapture();
                return;
            }

            controller?.destroy();
            sceneCanvas.value = null;
            controller = acquireSharedSceneCapture(target, () => {
                const sharpness = resolveSceneCaptureSharpness(defaultsRef.value);
                return {
                    pixelRatio: defaultsRef.value.pixelRatio,
                    radius: defaultsRef.value.pill ? 9999 : defaultsRef.value.radius,
                    ...(sharpness > 0 ? { sharpness } : {}),
                };
            });
            activeSceneEl.value = target;
            controller.subscribe((canvas, sourceEl) => {
                sceneCanvas.value = canvas;
                activeSceneEl.value = sourceEl;
            });
        };

        watch([() => props.sceneElement, () => props.captureScene, forcedCapture], syncCapture, { flush: "post" });
        watch(
            [
                () => defaultsRef.value.pixelRatio,
                () => defaultsRef.value.radius,
                () => defaultsRef.value.pill,
                () => defaultsRef.value.sharpness,
                () => defaultsRef.value.blur,
                () => defaultsRef.value.preset,
            ],
            () => controller?.scheduleCapture(),
        );

        let unsubWasm: (() => void) | null = null;
        let unsubscribeBattery: (() => void) | null = null;

        onMounted(() => {
            syncCapture();
            const {
                reducedMotionQuery,
                mobileOrTouchQuery,
                reducedTransparencyQuery,
                highContrastQuery,
            } = getMediaQueries();
            reducedMotionQuery?.addEventListener?.("change", syncCapture);
            mobileOrTouchQuery?.addEventListener?.("change", syncCapture);
            reducedTransparencyQuery?.addEventListener?.("change", syncCapture);
            highContrastQuery?.addEventListener?.("change", syncCapture);
            if (!isWasmReady()) {
                unsubWasm = onWasmReady(syncCapture);
            }
            unsubscribeBattery = subscribeBatteryChanges(syncCapture);
        });

        onBeforeUnmount(() => {
            unsubWasm?.();
            unsubWasm = null;
            unsubscribeBattery?.();
            unsubscribeBattery = null;
            const {
                reducedMotionQuery,
                mobileOrTouchQuery,
                reducedTransparencyQuery,
                highContrastQuery,
            } = getMediaQueries();
            reducedMotionQuery?.removeEventListener?.("change", syncCapture);
            mobileOrTouchQuery?.removeEventListener?.("change", syncCapture);
            reducedTransparencyQuery?.removeEventListener?.("change", syncCapture);
            highContrastQuery?.removeEventListener?.("change", syncCapture);
            controller?.destroy();
            controller = null;
        });

        provide(LIQUID_GLASS_INJECTION_KEY, {
            sceneCanvas,
            sceneElement: activeSceneEl,
            defaults: defaultsRef,
            requestSceneCapture: () => {
                if (props.captureScene === "auto") {
                    forcedCapture.value = true;
                }
            },
            refreshCapture: () => {
                controller?.scheduleCapture();
            },
        });

        return () => {
            if (props.sceneElement) {
                return slots.default?.() ?? null;
            }
            return h(
                "div",
                {
                    ref: wrapperRef,
                    style: { position: "relative" },
                },
                slots.default?.(),
            );
        };
    },
});
