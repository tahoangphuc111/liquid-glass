import { defineComponent, h, ref, watch, type PropType } from "vue";
import type {
    GlassCornerStyle,
    GlassRefractionDirection,
    GlassDragMode,
    GlassEngine,
    GlassEngineMode,
    GlassLightTiltMode,
    GlassOrientation,
    GlassPreset,
    GlassSurface,
    GlassTheme,
} from "../core/types.js";
import { useGlassSlider } from "./useGlassSlider.js";

export const LiquidGlassSlider = defineComponent({
    name: "LiquidGlassSlider",
    props: {
        modelValue: {
            type: [Number, String] as PropType<number | string | undefined>,
            default: undefined,
        },
        value: {
            type: [Number, String] as PropType<number | string | undefined>,
            default: undefined,
        },
        min: {
            type: [Number, String] as PropType<number | string | undefined>,
            default: undefined,
        },
        max: {
            type: [Number, String] as PropType<number | string | undefined>,
            default: undefined,
        },
        step: {
            type: [Number, String] as PropType<number | string | undefined>,
            default: undefined,
        },
        disabled: {
            type: Boolean as PropType<boolean | undefined>,
            default: undefined,
        },
        orientation: {
            type: String as PropType<GlassOrientation | undefined>,
            default: undefined,
        },
        preset: {
            type: String as PropType<GlassPreset | undefined>,
            default: undefined,
        },
        theme: {
            type: String as PropType<GlassTheme | undefined>,
            default: undefined,
        },
        surface: {
            type: String as PropType<GlassSurface | undefined>,
            default: undefined,
        },
        engine: {
            type: String as PropType<GlassEngineMode | undefined>,
            default: undefined,
        },
        thickness: {
            type: Number,
            default: undefined,
        },
        bezel: {
            type: Number,
            default: undefined,
        },
        refractionDirection: {
            type: String as PropType<GlassRefractionDirection>,
            default: undefined,
        },
        refractionEdgeFade: {
            type: Number,
            default: undefined,
        },
        maxRefractionPx: {
            type: Number,
            default: undefined,
        },
        adaptiveRefraction: {
            type: Boolean,
            default: undefined,
        },
        scaleRatio: {
            type: Number,
            default: undefined,
        },
        maxScaleMultiplier: {
            type: Number,
            default: undefined,
        },
        blur: {
            type: Number,
            default: undefined,
        },
        ior: {
            type: Number,
            default: undefined,
        },
        radius: {
            type: Number,
            default: undefined,
        },
        cornerStyle: {
            type: String as PropType<GlassCornerStyle | undefined>,
            default: undefined,
        },
        pill: {
            type: Boolean as PropType<boolean | undefined>,
            default: undefined,
        },
        hollow: {
            type: Boolean as PropType<boolean | undefined>,
            default: undefined,
        },
        alwaysOn: {
            type: Boolean as PropType<boolean | undefined>,
            default: undefined,
        },
        coreFilter: {
            type: String,
            default: undefined,
        },
        tintColor: {
            type: String,
            default: undefined,
        },
        tintOpacity: {
            type: Number,
            default: undefined,
        },
        highlight: {
            type: Number,
            default: undefined,
        },
        lightTilt: {
            type: [Object, String] as PropType<GlassLightTiltMode | undefined>,
            default: undefined,
        },
        pixelRatio: {
            type: Number,
            default: undefined,
        },
        saturation: {
            type: Number,
            default: undefined,
        },
        chromaticAberration: {
            type: [Boolean, Number] as PropType<boolean | number | undefined>,
            default: undefined,
        },
        abbeNumber: {
            type: Number,
            default: undefined,
        },
        interactive: {
            type: Boolean as PropType<boolean | undefined>,
            default: undefined,
        },
        draggable: {
            type: [Boolean, String] as PropType<GlassDragMode | undefined>,
            default: undefined,
        },
        coalesce: {
            type: Boolean as PropType<boolean | undefined>,
            default: undefined,
        },
        sceneElement: {
            type: Object as PropType<HTMLElement | null>,
            default: undefined,
        },
        sceneCanvas: {
            type: Object as PropType<HTMLCanvasElement | null>,
            default: undefined,
        },
    },
    emits: {
        "update:modelValue": (_value: number) => true,
        change: (_value: number, _input: HTMLInputElement) => true,
        engineChange: (_engine: GlassEngine) => true,
    },
    setup(props, { emit }) {
        const inputRef = ref<HTMLInputElement | null>(null);

        const { refresh } = useGlassSlider(inputRef, () => ({
            orientation: props.orientation,
            preset: props.preset,
            theme: props.theme,
            surface: props.surface,
            engine: props.engine,
            thickness: props.thickness,
            bezel: props.bezel,
            adaptiveRefraction: props.adaptiveRefraction,
            refractionDirection: props.refractionDirection,
            refractionEdgeFade: props.refractionEdgeFade,
            maxRefractionPx: props.maxRefractionPx,
            scaleRatio: props.scaleRatio,
            maxScaleMultiplier: props.maxScaleMultiplier,
            blur: props.blur,
            ior: props.ior,
            radius: props.radius,
            cornerStyle: props.cornerStyle,
            pill: props.pill,
            hollow: props.hollow,
            alwaysOn: props.alwaysOn,
            coreFilter: props.coreFilter,
            tintColor: props.tintColor,
            tintOpacity: props.tintOpacity,
            highlight: props.highlight,
            lightTilt: props.lightTilt,
            pixelRatio: props.pixelRatio,
            saturation: props.saturation,
            chromaticAberration: props.chromaticAberration,
            abbeNumber: props.abbeNumber,
            interactive: props.interactive,
            draggable: props.draggable,
            coalesce: props.coalesce,
            sceneElement: props.sceneElement,
            sceneCanvas: props.sceneCanvas,
            onChange: (nextValue, inputEl) => {
                emit("update:modelValue", nextValue);
                emit("change", nextValue, inputEl);
            },
            onEngineChange: (nextEngine) => emit("engineChange", nextEngine),
        }));

        watch(
            [
                () => props.modelValue,
                () => props.value,
                () => props.min,
                () => props.max,
                () => props.step,
                () => props.disabled,
            ],
            () => {
                refresh();
            },
            { flush: "post" },
        );

        return () =>
            h(
                "span",
                {
                    class: "lg-slider-host",
                    style: { display: "contents" },
                },
                [
                    h("input", {
                        ref: inputRef,
                        type: "range",
                        value: props.modelValue ?? props.value,
                        min: props.min,
                        max: props.max,
                        step: props.step,
                        disabled: props.disabled,
                    }),
                ],
            );
    },
});
