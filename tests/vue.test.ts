import { afterEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { LiquidGlass, LiquidGlassPlugin, LiquidGlassProvider } from "../src/vue/index.js";
import { destroyLiquidGlass } from "../src/index.js";

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
});
