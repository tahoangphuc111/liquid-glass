import { defineComponent, h, ref, type PropType } from "vue";
import type {
    GlassEngine,
    GlassEngineMode,
    GlassSurface,
} from "../core/types.js";
import { useLiquidGlass } from "./useLiquidGlass.js";

export const LiquidGlass = defineComponent({
    name: "LiquidGlass",
    props: {
        as: {
            type: String,
            default: "div",
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
        pixelRatio: {
            type: Number,
            default: undefined,
        },
        chromaticAberration: {
            type: [Boolean, Number] as PropType<boolean | number | undefined>,
            default: undefined,
        },
        interactive: {
            type: Boolean as PropType<boolean | undefined>,
            default: undefined,
        },
        draggable: {
            type: [Boolean, String] as PropType<boolean | "elastic" | undefined>,
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
        engineChange: (_engine: GlassEngine) => true,
    },
    setup(props, { slots, emit }) {
        const elRef = ref<HTMLElement | null>(null);

        useLiquidGlass(elRef, () => ({
            surface: props.surface,
            engine: props.engine,
            thickness: props.thickness,
            bezel: props.bezel,
            scaleRatio: props.scaleRatio,
            maxScaleMultiplier: props.maxScaleMultiplier,
            blur: props.blur,
            ior: props.ior,
            radius: props.radius,
            pill: props.pill,
            hollow: props.hollow,
            alwaysOn: props.alwaysOn,
            coreFilter: props.coreFilter,
            tintColor: props.tintColor,
            tintOpacity: props.tintOpacity,
            highlight: props.highlight,
            pixelRatio: props.pixelRatio,
            chromaticAberration: props.chromaticAberration,
            interactive: props.interactive,
            draggable: props.draggable,
            coalesce: props.coalesce,
            sceneElement: props.sceneElement,
            sceneCanvas: props.sceneCanvas,
            onEngineChange: (nextEngine) => emit("engineChange", nextEngine),
        }));

        return () =>
            h(
                props.as,
                {
                    ref: elRef,
                    class: "lg-surface",
                },
                slots.default?.(),
            );
    },
});
