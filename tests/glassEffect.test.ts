import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { glassEffect } from "../src/index.js";

describe("glassEffect helper and HTMLElement prototype method", () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="card" class="glass-item" style="width: 220px; height: 80px;">card</div>
            <button id="pill" class="glass-item" style="width: 140px; height: 44px;">pill</button>
        `;
    });

    afterEach(() => {
        vi.restoreAllMocks();
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

    it("animates slider visual progress and press spring on click instead of snapping", () => {
        const rafQueue: FrameRequestCallback[] = [];
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
            rafQueue.push(cb);
            return rafQueue.length;
        });
        vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

        document.body.innerHTML = `<div id="wrap"><input id="vol" type="range" min="0" max="100" value="20" /></div>`;
        const input = document.getElementById("vol") as HTMLInputElement;
        const slider = input.glassEffect({ engine: "css" });

        const wrapper = input.closest(".lg-slider") as HTMLElement;
        const thumb = wrapper.querySelector(".lg-slider-thumb") as HTMLElement;

        expect(wrapper.style.getPropertyValue("--lg-slider-visual-progress")).toBe("0.2000");

        // Simulate a fast click on the slider track jumping from 20% to 80%.
        input.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        input.value = "80";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        window.dispatchEvent(new Event("pointerup"));

        expect(wrapper.style.getPropertyValue("--lg-slider-progress")).toBe("0.8000");
        expect(wrapper.style.getPropertyValue("--lg-slider-visual-progress")).toBe("0.2000");
        expect(rafQueue.length).toBeGreaterThan(0);

        let now = 16;
        const seenVisual: number[] = [];
        const seenScaleX: number[] = [];
        for (let frame = 0; frame < 60 && rafQueue.length > 0; frame++) {
            rafQueue.shift()!(now);
            now += 16;
            seenVisual.push(Number(wrapper.style.getPropertyValue("--lg-slider-visual-progress")));
            seenScaleX.push(Number(wrapper.style.getPropertyValue("--lg-slider-bounce-scale-x")));
        }

        // Intermediate frames smoothly interpolate instead of teleporting in a single frame.
        expect(seenVisual[0]).toBeGreaterThan(0.2);
        expect(seenVisual[0]).toBeLessThan(0.8);
        expect(seenVisual.at(-1)).toBeCloseTo(0.8, 3);

        // Quick click produces visible press/rebound scale motion and settles back to 1.
        expect(Math.max(...seenScaleX)).toBeGreaterThan(1.015);
        expect(Math.min(...seenScaleX)).toBeLessThan(1.0);
        expect(seenScaleX.at(-1)).toBeCloseTo(1, 3);
        expect(thumb.style.getPropertyValue("--lg-press-glow")).toBe("");

        slider.destroy();
    });

    it("snaps slider progress immediately when prefers-reduced-motion is enabled", () => {
        const origMatchMedia = window.matchMedia;
        let reduceMotion = true;
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
            get matches() {
                return reduceMotion && query === "(prefers-reduced-motion: reduce)";
            },
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })) as unknown as typeof window.matchMedia;

        try {
            document.body.innerHTML = `<div id="wrap"><input id="vol" type="range" min="0" max="100" value="10" /></div>`;
            const input = document.getElementById("vol") as HTMLInputElement;
            const slider = input.glassEffect({ engine: "css" });
            const wrapper = input.closest(".lg-slider") as HTMLElement;

            input.value = "90";
            input.dispatchEvent(new Event("input", { bubbles: true }));

            expect(wrapper.style.getPropertyValue("--lg-slider-progress")).toBe("0.9000");
            expect(wrapper.style.getPropertyValue("--lg-slider-visual-progress")).toBe("0.9000");

            slider.destroy();
        } finally {
            reduceMotion = false;
            window.matchMedia = origMatchMedia;
        }
    });

    it("upgrades switch containers via element.glassEffect() and cleans up on destroy", () => {
        document.body.innerHTML = `
            <nav id="nav-bar" class="lg-switch">
                <button type="button" class="lg-switch-item" data-switch-value="home"><span>Home</span></button>
                <button type="button" class="lg-switch-item" data-switch-value="search"><span>Search</span></button>
            </nav>
        `;
        const nav = document.getElementById("nav-bar") as HTMLElement;
        const instance = nav.glassEffect({
            engine: "css",
            defaultValue: "search",
        });

        const glider = nav.querySelector(".lg-switch-glider");
        const items = nav.querySelectorAll<HTMLElement>(".lg-switch-item");
        expect(glider).not.toBeNull();
        expect(items[1]!.classList.contains("active")).toBe(true);
        expect(items[1]!.style.getPropertyValue("--lg-switch-coverage")).toBe("1.000");

        instance.destroy();
        expect(nav.querySelector(".lg-switch-glider")).toBeNull();
    });
});
