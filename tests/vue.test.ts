import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import {
    LiquidGlass,
    LiquidGlassPlugin,
    LiquidGlassProvider,
    LiquidGlassSlider,
    LiquidGlassSwitch,
    useLiquidGlass,
} from "../src/vue/index.js";
import { destroyLiquidGlass } from "../src/index.js";
import * as sceneCapture from "../src/core/sceneCapture.js";

function setForcedChromium(value: boolean | undefined): void {
    const win = window as unknown as { __LG_FORCE_CHROMIUM__?: boolean };
    if (value === undefined) {
        delete win.__LG_FORCE_CHROMIUM__;
    } else {
        win.__LG_FORCE_CHROMIUM__ = value;
    }
}

describe("Vue 3 bindings", () => {
    afterEach(() => {
        destroyLiquidGlass();
        setForcedChromium(undefined);
        vi.restoreAllMocks();
    });

    it("captures the Vue provider wrapper when switching away from an external scene", async () => {
        const external = document.body.appendChild(document.createElement("section"));
        const acquireCapture = vi.spyOn(sceneCapture, "acquireSharedSceneCapture").mockImplementation((source) => ({
            source,
            canvas: null,
            subscribe: () => () => {},
            scheduleCapture: () => {},
            destroy: () => {},
        }));
        const provider = mount(LiquidGlassProvider, {
            props: { sceneElement: external, captureScene: "always" },
            slots: { default: () => h("span", { class: "provider-child" }) },
        });
        try {
            expect(acquireCapture.mock.calls[0]?.[0]).toBe(external);
            await provider.setProps({ sceneElement: null });
            expect(acquireCapture.mock.calls[1]?.[0]).toBe(provider.find(".provider-child").element.parentElement);
        } finally {
            provider.unmount();
            external.remove();
        }
    });

    it("renders LiquidGlass inside LiquidGlassProvider", () => {
        setForcedChromium(true);

        const wrapper = mount({
            components: { LiquidGlassProvider, LiquidGlass },
            render() {
                return h(
                    LiquidGlassProvider,
                    { defaults: { blur: 1.5 } },
                    {
                        default: () => [
                            h("div", { class: "bg" }, "Scene"),
                            h(
                                LiquidGlass,
                                { as: "section", pill: true, class: "glass-box" },
                                { default: () => "Glass" },
                            ),
                        ],
                    },
                );
            },
        });

        const box = wrapper.findComponent(LiquidGlass);
        expect(box.exists()).toBe(true);
        expect(box.element.tagName).toBe("SECTION");
        expect(box.classes()).toContain("lg-surface");
        expect(box.classes()).toContain("glass-box");
        expect(box.attributes("data-lg-pill")).toBe("true");
        expect(box.attributes("data-lg-engine")).toBe("wasm-svg");

        wrapper.unmount();
    });

    it("installs components via LiquidGlassPlugin", () => {
        const Host = defineComponent({
            template: `<LiquidGlass>Hello</LiquidGlass>`,
        });

        const wrapper = mount(Host, {
            global: {
                plugins: [LiquidGlassPlugin],
            },
        });

        expect(wrapper.find(".lg-surface").exists()).toBe(true);
        wrapper.unmount();
    });

    it("renders LiquidGlassSwitch with v-model support via LiquidGlassPlugin", async () => {
        const Host = defineComponent({
            components: { LiquidGlassSwitch },
            data() {
                return {
                    selected: "home",
                    items: [
                        { value: "home", label: "Home" },
                        { value: "library", label: "Library" },
                    ],
                };
            },
            template: `<LiquidGlassSwitch v-model="selected" engine="css" :items="items" />`,
        });

        const wrapper = mount(Host, {
            global: {
                plugins: [LiquidGlassPlugin],
            },
        });

        expect(wrapper.find(".lg-switch").exists()).toBe(true);
        expect(wrapper.find(".lg-switch-glider").exists()).toBe(true);

        const tabs = wrapper.findAll('[role="tab"]');
        expect(tabs).toHaveLength(2);
        await tabs[1]!.trigger("click");
        expect(wrapper.vm.selected).toBe("library");
        wrapper.unmount();
    });

    it("preserves LiquidGlassProvider defaults when component props are omitted", () => {
        setForcedChromium(false);

        const wrapper = mount({
            components: { LiquidGlassProvider, LiquidGlass },
            render() {
                return h(
                    LiquidGlassProvider,
                    {
                        captureScene: "never",
                        defaults: { engine: "css", blur: 4, tintColor: "rgb(1, 2, 3)" },
                    },
                    {
                        default: () => h(LiquidGlass, null, { default: () => "Glass" }),
                    },
                );
            },
        });

        const el = wrapper.find(".lg-surface").element as HTMLElement;
        expect(el.getAttribute("data-lg-engine")).toBe("css");
        expect(el.style.getPropertyValue("--lg-filter")).toBe("blur(14.0px) saturate(180%)");
        expect(el.style.getPropertyValue("--lg-tint")).toBe("rgb(1, 2, 3)");
        wrapper.unmount();
    });

    it("forwards switch options, clears removed props, and supports Vue LiquidGlassSlider with safe conditional unmount", async () => {
        setForcedChromium(true);
        const customGlider = document.createElement("span");
        const switchWrapper = mount({
            components: { LiquidGlassSwitch },
            render() {
                return h(LiquidGlassSwitch, {
                    orientation: "vertical",
                    cornerStyle: "squircle",
                    gliderElement: customGlider,
                    items: [
                        { value: "alpha", label: "Alpha", icon: h("svg", { "data-testid": "vue-icon" }) },
                        { value: "beta", label: "Beta" },
                    ],
                });
            },
        });
        expect(switchWrapper.attributes("data-lg-switch-orientation")).toBe("vertical");
        expect(switchWrapper.attributes("data-lg-corner-style")).toBe("squircle");
        expect(customGlider.classList.contains("lg-switch-glider")).toBe(true);
        expect(switchWrapper.find("[data-testid='vue-icon']").exists()).toBe(true);
        switchWrapper.unmount();

        const Comp = defineComponent({
            setup() {
                const tint = ref<string | undefined>("rgb(12, 34, 56)");
                const sliderVal = ref(35);
                const showSlider = ref(true);
                return { tint, sliderVal, showSlider };
            },
            render() {
                return h("div", [
                    h(
                        LiquidGlass,
                        { "data-test": "vue-glass", engine: "css", tintColor: this.tint } as Record<string, unknown>,
                        () => "Card",
                    ),
                    this.showSlider
                        ? h(LiquidGlassSlider, {
                              modelValue: this.sliderVal,
                              "onUpdate:modelValue": (val: number) => {
                                  this.sliderVal = val;
                              },
                              engine: "css",
                              orientation: "vertical",
                              min: 0,
                              max: 100,
                          })
                        : null,
                    h("span", "sibling"),
                ]);
            },
        });

        const wrapper = mount(Comp, { global: { plugins: [LiquidGlassPlugin] } });
        const cardEl = wrapper.find("[data-test='vue-glass']").element as HTMLElement;
        expect(cardEl.style.getPropertyValue("--lg-tint")).toBe("rgb(12, 34, 56)");

        wrapper.vm.tint = undefined;
        await nextTick();
        expect(cardEl.style.getPropertyValue("--lg-tint")).toBe("");

        expect(wrapper.find(".lg-slider").attributes("data-lg-slider-orientation")).toBe("vertical");
        const rangeEl = wrapper.find("input[type='range']").element as HTMLInputElement;
        rangeEl.value = "82";
        rangeEl.dispatchEvent(new Event("input", { bubbles: true }));
        await nextTick();
        expect(wrapper.vm.sliderVal).toBe(82);

        wrapper.vm.showSlider = false;
        await expect(nextTick()).resolves.toBeUndefined();
        wrapper.unmount();
    });

    it("forwards onDragChange through useLiquidGlass and avoids redundant updates on unchanged options", async () => {
        const dragEvents: Array<{ offsetX: number; offsetY: number; isDragging: boolean }> = [];
        const DragComp = defineComponent({
            setup() {
                const targetRef = ref<HTMLElement | null>(null);
                const blurRadius = ref(12);
                useLiquidGlass(targetRef, () => ({
                    engine: "css",
                    pill: true,
                    draggable: "free",
                    blur: blurRadius.value,
                    onDragChange: (offsetX, offsetY, isDragging) => {
                        dragEvents.push({ offsetX, offsetY, isDragging });
                    },
                }));
                return () => h("button", { ref: targetRef, "data-test": "drag-glass" }, "Draggable");
            },
        });

        const wrapper = mount(DragComp);
        const dragEl = wrapper.find("[data-test='drag-glass']").element as HTMLElement;
        dragEl.getBoundingClientRect = () => new DOMRect(0, 0, 120, 48);

        dragEl.dispatchEvent(new MouseEvent("pointerdown", { clientX: 20, clientY: 20, bubbles: true }));
        dragEl.dispatchEvent(new MouseEvent("pointermove", { clientX: 45, clientY: 35, bubbles: true }));
        dragEl.dispatchEvent(new MouseEvent("pointerup", { clientX: 45, clientY: 35, bubbles: true }));

        expect(dragEvents.length).toBeGreaterThanOrEqual(2);
        expect(dragEvents[0]?.isDragging).toBe(true);
        expect(dragEvents[dragEvents.length - 1]?.isDragging).toBe(false);
        wrapper.unmount();
    });

    it("forwards sharpness in Vue LiquidGlassProvider scene capture and reschedules when sharpness or blur changes", async () => {
        const scheduleCapture = vi.fn();
        let qualityGetter: (() => unknown) | undefined;
        vi.spyOn(sceneCapture, "acquireSharedSceneCapture").mockImplementation((sourceEl, getQuality) => {
            qualityGetter = getQuality;
            return {
                canvas: document.createElement("canvas"),
                source: sourceEl,
                subscribe: () => () => {},
                scheduleCapture,
                setActive: vi.fn(),
                destroy: vi.fn(),
            };
        });

        const Host = defineComponent({
            setup() {
                const blur = ref(0);
                const sharpness = ref<number | undefined>(undefined);
                return { blur, sharpness };
            },
            render() {
                return h(
                    LiquidGlassProvider,
                    {
                        captureScene: "always",
                        defaults: {
                            blur: this.blur,
                            sharpness: this.sharpness,
                        },
                    },
                    {
                        default: () => h("span", "Scene"),
                    },
                );
            },
        });

        const wrapper = mount(Host);
        expect(qualityGetter?.()).toMatchObject({ sharpness: 0.65 });

        scheduleCapture.mockClear();
        wrapper.vm.sharpness = 1;
        await nextTick();
        expect(scheduleCapture).toHaveBeenCalledTimes(1);
        expect(qualityGetter?.()).toMatchObject({ sharpness: 1 });

        scheduleCapture.mockClear();
        wrapper.vm.blur = 8;
        wrapper.vm.sharpness = undefined;
        await nextTick();
        expect(scheduleCapture).toHaveBeenCalledTimes(1);
        expect(qualityGetter?.()).not.toHaveProperty("sharpness");

        wrapper.unmount();
    });
});
