import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGlassSlider, glassEffect } from "../src/index.js";

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

        const remounted = card.glassEffect({ engine: "css" });
        first.destroy();
        expect(card.glassEffect({ blur: 3 })).toBe(remounted);
        remounted.destroy();
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

    it("follows form reset and native attributes and leaves the input where the wrapper was", async () => {
        const form = document.body.appendChild(document.createElement("form"));
        const input = form.appendChild(document.createElement("input"));
        input.type = "range";
        input.defaultValue = "25";
        input.setAttribute("aria-orientation", "horizontal");
        const slider = createGlassSlider(input, { engine: "css", orientation: "vertical" });
        const wrapper = input.parentElement!;
        const sibling = document.createElement("span");
        wrapper.after(sibling);
        try {
            slider.setValue(75, false);
            expect(wrapper.style.getPropertyValue("--lg-slider-progress")).toBe("0.7500");
            form.reset();
            await Promise.resolve();
            expect(wrapper.style.getPropertyValue("--lg-slider-progress")).toBe("0.2500");

            input.dir = "rtl";
            input.disabled = true;
            await Promise.resolve();
            expect(wrapper.dir).toBe("rtl");
            expect(wrapper.classList.contains("is-disabled")).toBe(true);
        } finally {
            slider.destroy();
        }
        expect(input.nextElementSibling).toBe(sibling);
        expect(input.getAttribute("aria-orientation")).toBe("horizontal");
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

        expect(seenVisual[0]).toBeGreaterThan(0.2);
        expect(seenVisual[0]).toBeLessThan(0.8);
        expect(seenVisual.at(-1)).toBeCloseTo(0.8, 3);

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

        expect(instance.value).toBe("search");
        expect(instance.activeIndex).toBe(1);
        instance.setValue("home", false);
        expect(instance.value).toBe("home");
        expect(instance.activeIndex).toBe(0);
        instance.setActiveIndex(1, false);
        expect(instance.value).toBe("search");
        expect(instance.activeIndex).toBe(1);

        instance.destroy();
        expect(nav.querySelector(".lg-switch-glider")).toBeNull();
    });

    it("detects switch container via defaultValue option even without .lg-switch class", () => {
        document.body.innerHTML = `
            <nav id="plain-nav">
                <button type="button" data-switch-value="one">One</button>
                <button type="button" data-switch-value="two">Two</button>
            </nav>
        `;
        const plainNav = document.getElementById("plain-nav") as HTMLElement;
        const instance = plainNav.glassEffect({
            engine: "css",
            defaultValue: "two",
        });

        expect(plainNav.classList.contains("lg-switch")).toBe(true);
        expect(plainNav.querySelector(".lg-switch-glider")).not.toBeNull();
        expect(instance.value).toBe("two");
        expect(instance.activeIndex).toBe(1);

        instance.destroy();
    });

    it("creates a slider from range input and isolates primary pointer from secondary touches", () => {
        const input = document.createElement("input");
        input.type = "range";
        input.min = "0";
        input.max = "100";
        input.value = "50";
        document.body.appendChild(input);

        const instance = glassEffect(input, { engine: "css" });
        const wrapper = input.parentElement as HTMLElement;
        expect(wrapper.classList.contains("lg-slider")).toBe(true);

        const pDown1 = new MouseEvent("pointerdown", { bubbles: true, clientX: 50 });
        Object.defineProperty(pDown1, "pointerId", { value: 1 });
        Object.defineProperty(pDown1, "pointerType", { value: "touch" });
        input.dispatchEvent(pDown1);
        expect(wrapper.classList.contains("is-active")).toBe(true);

        const pDown2 = new MouseEvent("pointerdown", { bubbles: true, clientX: 90 });
        Object.defineProperty(pDown2, "pointerId", { value: 2 });
        Object.defineProperty(pDown2, "pointerType", { value: "touch" });
        input.dispatchEvent(pDown2);

        const pUp2 = new MouseEvent("pointerup", { bubbles: true, clientX: 90 });
        Object.defineProperty(pUp2, "pointerId", { value: 2 });
        Object.defineProperty(pUp2, "pointerType", { value: "touch" });
        window.dispatchEvent(pUp2);
        expect(wrapper.classList.contains("is-active")).toBe(true);

        const pUp1 = new MouseEvent("pointerup", { bubbles: true, clientX: 50 });
        Object.defineProperty(pUp1, "pointerId", { value: 1 });
        Object.defineProperty(pUp1, "pointerType", { value: "touch" });
        window.dispatchEvent(pUp1);
        expect(wrapper.classList.contains("is-active")).toBe(false);

        instance.destroy();
        expect(document.querySelector(".lg-slider")).toBeNull();
    });

    it("returns pure LiquidGlassInstance for regular elements without pseudo switch properties", () => {
        const button = document.createElement("button");
        document.body.appendChild(button);

        const instance = glassEffect(button, { engine: "css" });
        expect("setValue" in instance).toBe(false);
        expect("activeIndex" in instance).toBe(false);

        instance.destroy();
    });

    it("resets slider active drag state when window receives blur event", () => {
        const input = document.createElement("input");
        input.type = "range";
        document.body.appendChild(input);

        const instance = glassEffect(input, { engine: "css" });
        const wrapper = input.parentElement as HTMLElement;

        const pDown = new MouseEvent("pointerdown", { bubbles: true, clientX: 20 });
        Object.defineProperty(pDown, "pointerId", { value: 5 });
        input.dispatchEvent(pDown);
        expect(wrapper.classList.contains("is-active")).toBe(true);

        window.dispatchEvent(new Event("blur"));
        expect(wrapper.classList.contains("is-active")).toBe(false);

        instance.destroy();
    });

    it("safely unparents input when wrapper is already disconnected on destroy", () => {
        const input = document.createElement("input");
        input.type = "range";
        document.body.appendChild(input);

        const instance = glassEffect(input, { engine: "css" });
        const wrapper = input.parentElement as HTMLElement;
        expect(wrapper.classList.contains("lg-slider")).toBe(true);

        wrapper.remove();
        expect(wrapper.parentNode).toBeNull();
        expect(input.parentElement).toBe(wrapper);

        instance.destroy();
        expect(input.parentElement).toBeNull();
    });

    it("tracks pointermove on window during active drag and guards against NaN progress", () => {
        const input = document.createElement("input");
        input.type = "range";
        input.min = "0";
        input.max = "100";
        input.value = "invalid";
        document.body.appendChild(input);

        const instance = glassEffect(input, { engine: "css" });
        const wrapper = input.parentElement as HTMLElement;

        const progressVal = wrapper.style.getPropertyValue("--lg-slider-progress");
        expect(progressVal).not.toBe("NaN");

        const pDown = new MouseEvent("pointerdown", { bubbles: true, clientX: 50 });
        Object.defineProperty(pDown, "pointerId", { value: 11 });
        Object.defineProperty(pDown, "pointerType", { value: "touch" });
        input.dispatchEvent(pDown);
        expect(wrapper.classList.contains("is-active")).toBe(true);

        const pMove = new MouseEvent("pointermove", { bubbles: true, clientX: 200 });
        Object.defineProperty(pMove, "pointerId", { value: 11 });
        window.dispatchEvent(pMove);
        expect(wrapper.classList.contains("is-active")).toBe(true);

        window.dispatchEvent(new Event("blur"));
        expect(wrapper.classList.contains("is-active")).toBe(false);

        instance.destroy();
    });

    it("supports vertical slider orientation, disabled guard, duplicate onChange suppression, preset blur preservation, and ancestor sceneElement", () => {
        const disabledRange = document.createElement("input");
        disabledRange.type = "range";
        disabledRange.disabled = true;
        document.body.appendChild(disabledRange);
        const disabledSlider = createGlassSlider(disabledRange, { engine: "css" });
        const disabledWrap = disabledRange.parentElement!;
        expect(disabledWrap.classList.contains("is-disabled")).toBe(true);
        disabledRange.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        expect(disabledWrap.classList.contains("is-active")).toBe(false);
        disabledSlider.destroy();

        const sceneHost = document.createElement("div");
        const range = document.createElement("input");
        range.type = "range";
        range.min = "0";
        range.max = "100";
        range.value = "30";
        sceneHost.appendChild(range);
        document.body.appendChild(sceneHost);

        const changes: number[] = [];
        const slider = createGlassSlider(range, {
            engine: "css",
            preset: "frosted",
            orientation: "vertical",
            sceneElement: sceneHost,
            onChange: (val) => changes.push(val),
        });
        const wrap = range.closest(".lg-slider") as HTMLElement;
        expect(wrap.getAttribute("data-lg-slider-orientation")).toBe("vertical");
        expect(range.getAttribute("aria-orientation")).toBe("vertical");

        range.value = "65";
        range.dispatchEvent(new Event("input", { bubbles: true }));
        range.dispatchEvent(new Event("change", { bubbles: true }));
        expect(changes).toEqual([65]);

        const thumb = wrap.querySelector<HTMLElement>(".lg-slider-thumb")!;
        slider.update({ highlight: 0.6 });
        expect(thumb.style.getPropertyValue("--lg-filter")).not.toBe("blur(0.0px)");

        slider.setValue(80, false);
        expect(slider.value).toBe(80);
        expect(wrap.style.getPropertyValue("--lg-slider-progress")).toBe("0.8000");
        slider.refresh();
        slider.destroy();
        slider.setValue(10, false);
        expect(slider.value).toBe(80);
    });

    it("attaches slider window pointer drag listeners lazily only while pressed", () => {
        const addWindowSpy = vi.spyOn(window, "addEventListener");
        const removeWindowSpy = vi.spyOn(window, "removeEventListener");

        const range = document.createElement("input");
        range.type = "range";
        range.min = "0";
        range.max = "100";
        range.value = "50";
        document.body.appendChild(range);

        const slider = createGlassSlider(range, { engine: "css" });
        const addedWhileIdle = addWindowSpy.mock.calls.filter(([type]) => type === "pointermove");
        expect(addedWhileIdle).toHaveLength(0);

        range.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        const addedOnPress = addWindowSpy.mock.calls.filter(([type]) => type === "pointermove");
        expect(addedOnPress).toHaveLength(1);

        window.dispatchEvent(new Event("pointerup"));
        const removedOnRelease = removeWindowSpy.mock.calls.filter(([type]) => type === "pointermove");
        expect(removedOnRelease).toHaveLength(1);

        slider.destroy();
    });
});
