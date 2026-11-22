import { defineComponent, h, ref, type PropType } from "vue";
import type {
    GlassCornerStyle,
    GlassRefractionDirection,
    GlassDragBounds,
    GlassDragMode,
    GlassEngine,
    GlassEngineMode,
    GlassLightTiltMode,
    GlassPreset,
    GlassSurface,
    GlassTheme,
} from "../core/types.js";
import { useLiquidGlass } from "./useLiquidGlass.js";

export const LiquidGlass = defineComponent({
    name: "LiquidGlass",
    props: {
        as: {
            type: String,
            default: "div",
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
        dragBounds: {
            type: [String, Object] as PropType<GlassDragBounds | undefined>,
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
        dragChange: (_offsetX: number, _offsetY: number, _isDragging: boolean) => true,
    },
    setup(props, { slots, emit }) {
        const elRef = ref<HTMLElement | null>(null);

        useLiquidGlass(elRef, () => ({
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
            dragBounds: props.dragBounds,
            coalesce: props.coalesce,
            sceneElement: props.sceneElement,
            sceneCanvas: props.sceneCanvas,
            onDragChange: (offsetX, offsetY, isDragging) =>
                emit("dragChange", offsetX, offsetY, isDragging),
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
