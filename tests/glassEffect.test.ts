import { beforeEach, describe, expect, it } from "vitest";
import { glassEffect } from "../src/index.js";

describe("glassEffect helper and HTMLElement prototype method", () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="card" class="glass-item" style="width: 220px; height: 80px;">card</div>
            <button id="pill" class="glass-item" style="width: 140px; height: 44px;">pill</button>
        `;
    });

    it("supports element.glassEffect() with idempotent updates and clean destroy", () => {
        const card = document.getElementById("card") as HTMLElement;
        const first = card.glassEffect({ engine: "css", blur: 0.8 });

        expect(card.classList.contains("lg-surface")).toBe(true);
        expect(card.classList.contains("lg-on")).toBe(true);
        expect(first.engine).toBe("css");

        const second = card.glassEffect({ blur: 1.2, pill: true });
        expect(second).toBe(first);
        expect(card.dataset.lgPill).toBe("true");

        first.destroy();
        expect(card.classList.contains("lg-on")).toBe(false);
    });

    it("supports selector group calls via glassEffect(selector, options)", () => {
        const group = glassEffect(".glass-item", { engine: "css", radius: 20 });
        expect(group.instances).toHaveLength(2);

        group.update({ pill: true });
        expect(document.getElementById("card")?.dataset.lgPill).toBe("true");
        expect(document.getElementById("pill")?.dataset.lgPill).toBe("true");

        group.destroy();
        expect(document.getElementById("card")?.classList.contains("lg-on")).toBe(false);
    });

    it("upgrades input[type=range] into a liquid glass slider and restores on destroy", () => {
        document.body.innerHTML = `<div id="wrap"><input id="vol" type="range" min="0" max="100" value="25" /></div>`;
        const input = document.getElementById("vol") as HTMLInputElement;
        const slider = input.glassEffect({ engine: "css" });

        const wrapper = input.closest(".lg-slider") as HTMLElement | null;
        const thumb = wrapper?.querySelector(".lg-slider-thumb") as HTMLElement | null;

        expect(wrapper).not.toBeNull();
        expect(wrapper?.style.getPropertyValue("--lg-slider-progress")).toBe("0.2500");
        expect(thumb?.classList.contains("lg-surface")).toBe(true);
        expect(thumb?.dataset.lgPill).toBe("true");
        expect(thumb?.style.getPropertyValue("--lg-filter")).toContain("blur(0.0px)");

        input.value = "75";
        input.dispatchEvent(new Event("input"));
        expect(wrapper?.style.getPropertyValue("--lg-slider-progress")).toBe("0.7500");

        slider.destroy();
        expect(document.querySelector(".lg-slider")).toBeNull();
        expect(document.getElementById("wrap")?.contains(input)).toBe(true);
    });
});
