import { defineComponent, h, ref, watch, type PropType } from "vue";
import type {
    GlassEngine,
    GlassEngineMode,
    GlassSurface,
} from "../core/types.js";
import { useGlassSwitch } from "./useGlassSwitch.js";

export interface LiquidGlassSwitchItem {
    value: string;
    label: string;
    href?: string;
    disabled?: boolean;
    ariaLabel?: string;
}

export const LiquidGlassSwitch = defineComponent({
    name: "LiquidGlassSwitch",
    props: {
        as: {
            type: String,
            default: "nav",
        },
        items: {
            type: Array as PropType<LiquidGlassSwitchItem[] | undefined>,
            default: undefined,
        },
        modelValue: {
            type: String,
            default: undefined,
        },
        value: {
            type: String,
            default: undefined,
        },
        defaultValue: {
            type: String,
            default: undefined,
        },
        itemSelector: {
            type: String,
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
        "update:modelValue": (_value: string) => true,
        change: (_value: string, _index: number, _itemElement: HTMLElement) => true,
        engineChange: (_engine: GlassEngine) => true,
    },
    setup(props, { slots, emit }) {
        const containerRef = ref<HTMLElement | null>(null);

        const { refresh } = useGlassSwitch(containerRef, () => ({
            value: props.modelValue ?? props.value,
            defaultValue: props.defaultValue,
            itemSelector: props.itemSelector,
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
            onChange: (nextValue, nextIndex, itemElement) => {
                emit("update:modelValue", nextValue);
                emit("change", nextValue, nextIndex, itemElement);
            },
            onEngineChange: (nextEngine) => emit("engineChange", nextEngine),
        }));

        watch(
            () => props.items,
            () => {
                refresh();
            },
            { deep: true, flush: "post" },
        );

        return () =>
            h(
                props.as,
                {
                    ref: containerRef,
                    class: "lg-switch",
                },
                props.items
                    ? props.items.map((item) =>
                          item.href
                              ? h(
                                    "a",
                                    {
                                        key: item.value,
                                        href: item.href,
                                        class: "lg-switch-item",
                                        "data-switch-value": item.value,
                                        role: "tab",
                                        "aria-label": item.ariaLabel,
                                    },
                                    [h("span", item.label)],
                                )
                              : h(
                                    "button",
                                    {
                                        key: item.value,
                                        type: "button",
                                        class: "lg-switch-item",
                                        "data-switch-value": item.value,
                                        role: "tab",
                                        disabled: item.disabled,
                                        "aria-label": item.ariaLabel,
                                    },
                                    [h("span", item.label)],
                                ),
                      )
                    : slots.default?.(),
            );
    },
});
