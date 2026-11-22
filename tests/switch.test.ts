import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlassSwitch } from "../src/core/switch.js";

function dispatchPointerEvent(
    target: EventTarget,
    type: string,
    coords: { clientX?: number; clientY?: number; pointerId?: number; button?: number; pointerType?: string } = {},
): void {
    const pointerEvent = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: coords.clientX ?? 0,
        clientY: coords.clientY ?? 0,
        button: coords.button ?? 0,
    });
    Object.defineProperty(pointerEvent, "pointerId", {
        value: coords.pointerId ?? 1,
        configurable: true,
    });
    Object.defineProperty(pointerEvent, "pointerType", {
        value: coords.pointerType ?? "mouse",
        configurable: true,
    });
    target.dispatchEvent(pointerEvent);
}

function buildSwitchFixture(itemWidths: number[], values: string[]) {
    const nav = document.createElement("nav");
    const items: HTMLButtonElement[] = [];
    let currentLeft = 4;

    values.forEach((itemValue, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "lg-switch-item";
        button.dataset.switchValue = itemValue;
        button.textContent = itemValue;
        const itemWidth = itemWidths[index] ?? 96;
        const itemLeft = currentLeft;
        Object.defineProperty(button, "offsetLeft", {
            get: () => itemLeft,
            configurable: true,
        });
        Object.defineProperty(button, "offsetWidth", {
            get: () => itemWidth,
            configurable: true,
        });
        currentLeft += itemWidth;
        nav.appendChild(button);
        items.push(button);
    });

    document.body.appendChild(nav);
    return { nav, items };
}

describe("Apple bottom navigation switch physics (createGlassSwitch)", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = "";
    });

    it("initializes N navigation items with glider width and active highlight", () => {
        const { nav, items } = buildSwitchFixture(
            [72, 112, 88, 96],
            ["home", "explore", "library", "profile"],
        );

        const switchInstance = createGlassSwitch(nav, {
            engine: "css",
            defaultValue: "explore",
        });

        expect(switchInstance.value).toBe("explore");
        expect(switchInstance.activeIndex).toBe(1);
        expect(items[1]!.classList.contains("active")).toBe(true);
        expect(items[1]!.getAttribute("aria-selected")).toBe("true");

        const glider = nav.querySelector<HTMLElement>(".lg-switch-glider");
        expect(glider).not.toBeNull();
        expect(nav.classList.contains("lg-surface")).toBe(true);
        expect(nav.classList.contains("lg-on")).toBe(true);
        expect(nav.hasAttribute("data-lg-coalescing")).toBe(false);
        expect(glider!.classList.contains("lg-surface")).toBe(true);
        expect(glider!.classList.contains("lg-on")).toBe(true);
        expect(glider!.hasAttribute("data-lg-coalescing")).toBe(false);
        expect(glider!.style.width).toBe("112px");
        expect(glider!.style.transform).toContain("translate3d(72.00px");
        expect(items[1]!.style.getPropertyValue("--lg-switch-coverage")).toBe("1.000");
        expect(items[1]!.style.getPropertyValue("--lg-switch-hit-start")).toBe("0.0%");
        expect(items[1]!.style.getPropertyValue("--lg-switch-hit-end")).toBe("100.0%");
        expect(items[0]!.style.getPropertyValue("--lg-switch-coverage")).toBe("0.000");
        expect(items[0]!.style.getPropertyValue("--lg-switch-hit-end")).toBe("0.0%");

        switchInstance.destroy();
        expect(items[1]!.style.getPropertyValue("--lg-switch-coverage")).toBe("");
        expect(items[1]!.style.getPropertyValue("--lg-switch-hit-start")).toBe("");
        expect(items[1]!.style.getPropertyValue("--lg-switch-hit-end")).toBe("");
    });

    it("applies per-part optics and follows orientation when overrides are reset", () => {
        const { nav } = buildSwitchFixture([90, 90], ["one", "two"]);
        const sw = createGlassSwitch(nav, {
            engine: "css",
            trackOptions: { refractionDirection: "all", blur: 2 },
            gliderOptions: { refractionEdgeFade: 0.6 },
        });
        const glider = nav.querySelector<HTMLElement>(".lg-switch-glider")!;
        expect(nav.getAttribute("data-lg-refraction-axis")).toBe("all");
        expect(nav.style.getPropertyValue("--lg-filter")).toContain("blur(7.0px)");
        expect(glider.getAttribute("data-lg-refraction-axis")).toBe("horizontal");
        expect(glider.style.getPropertyValue("--lg-refraction-fade")).toBe("30%");

        sw.update({ orientation: "vertical", trackOptions: undefined, gliderOptions: undefined });
        expect(nav.getAttribute("data-lg-refraction-axis")).toBe("vertical");
        expect(nav.style.getPropertyValue("--lg-filter")).toBe("blur(0.0px)");
        expect(glider.getAttribute("data-lg-refraction-axis")).toBe("vertical");
        expect(glider.style.getPropertyValue("--lg-refraction-fade")).toBe("17.5%");
        sw.destroy();
        expect(nav.hasAttribute("data-lg-refraction-axis")).toBe(false);
    });

    it("switches tabs on click and suppresses trailing click immediately after a real drag", () => {
        let nowMs = 1000;
        let nextFrameId = 1;
        const queuedCallbacks = new Map<number, FrameRequestCallback>();
        vi.spyOn(performance, "now").mockImplementation(() => nowMs);
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
            const id = nextFrameId;
            nextFrameId += 1;
            queuedCallbacks.set(id, callback);
            return id;
        });
        vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
            queuedCallbacks.delete(id);
        });

        const { nav, items } = buildSwitchFixture(
            [96, 96, 96, 96],
            ["home", "explore", "library", "profile"],
        );
        const onChange = vi.fn();
        const switchInstance = createGlassSwitch(nav, {
            engine: "css",
            defaultValue: "home",
            onChange,
        });

        items[2]!.click();
        expect(switchInstance.value).toBe("library");
        expect(switchInstance.activeIndex).toBe(2);
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenLastCalledWith("library", 2, items[2]);

        for (let frame = 0; frame < 60; frame += 1) {
            const pending = Array.from(queuedCallbacks.entries());
            if (pending.length === 0) {
                break;
            }
            queuedCallbacks.clear();
            nowMs += 16;
            for (const [, callback] of pending) {
                callback(nowMs);
            }
        }

        dispatchPointerEvent(nav, "pointerdown", { clientX: 200, pointerId: 2 });
        nowMs += 120;
        dispatchPointerEvent(window, "pointermove", { clientX: 190, pointerId: 2 });
        nowMs += 120;
        dispatchPointerEvent(window, "pointerup", { clientX: 190, pointerId: 2 });

        items[0]!.click();
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(switchInstance.value).toBe("library");

        switchInstance.destroy();
    });

    it("sleeps while held still, wakes on drag and settles at the released anchor", () => {
        vi.useFakeTimers();
        const { nav } = buildSwitchFixture([96, 96], ["one", "two"]);
        const sw = createGlassSwitch(nav, { engine: "css" });
        const glider = nav.querySelector<HTMLElement>(".lg-switch-glider")!;
        const frames = vi.spyOn(window, "requestAnimationFrame");
        try {
            dispatchPointerEvent(nav, "pointerdown", { clientX: 40 });
            vi.advanceTimersByTime(2000);
            expect(nav.classList.contains("is-animating")).toBe(false);
            expect(nav.classList.contains("is-pressed")).toBe(true);
            expect(Number(glider.style.getPropertyValue("--p"))).toBeGreaterThan(0);
            frames.mockClear();
            vi.advanceTimersByTime(2000);
            expect(frames).not.toHaveBeenCalled();

            dispatchPointerEvent(window, "pointermove", { clientX: 138 });
            expect(nav.classList.contains("is-animating")).toBe(true);
            vi.advanceTimersByTime(2000);
            expect(nav.classList.contains("is-animating")).toBe(false);
            expect(nav.classList.contains("is-dragging")).toBe(true);
            dispatchPointerEvent(window, "pointerup", { clientX: 138 });
            vi.advanceTimersByTime(2000);
            expect(sw.value).toBe("two");
            expect(nav.classList.contains("is-animating")).toBe(false);
            expect(Number(glider.style.getPropertyValue("--p"))).toBe(0);
        } finally {
            sw.destroy();
            vi.useRealTimers();
        }
    });

    it("projects swipe throw velocity forward and excites swell & wobble physics", () => {
        let nowMs = 1000;
        let nextFrameId = 1;
        const queuedCallbacks = new Map<number, FrameRequestCallback>();

        vi.spyOn(performance, "now").mockImplementation(() => nowMs);
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
            const id = nextFrameId;
            nextFrameId += 1;
            queuedCallbacks.set(id, callback);
            return id;
        });
        vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
            queuedCallbacks.delete(id);
        });

        const { nav } = buildSwitchFixture(
            [96, 96, 96, 96],
            ["home", "explore", "library", "profile"],
        );
        const onChange = vi.fn();
        const switchInstance = createGlassSwitch(nav, {
            engine: "css",
            defaultValue: "home",
            onChange,
        });
        const glider = nav.querySelector<HTMLElement>(".lg-switch-glider")!;

        dispatchPointerEvent(nav, "pointerdown", { clientX: 40, pointerId: 3 });
        expect(nav.classList.contains("is-pressed")).toBe(true);

        nowMs += 16;
        dispatchPointerEvent(window, "pointermove", { clientX: 120, pointerId: 3 });
        expect(nav.classList.contains("is-dragging")).toBe(true);

        nowMs += 16;
        dispatchPointerEvent(window, "pointermove", { clientX: 190, pointerId: 3 });

        nowMs += 16;
        dispatchPointerEvent(window, "pointerup", { clientX: 190, pointerId: 3 });

        expect(switchInstance.activeIndex).toBeGreaterThanOrEqual(2);
        expect(onChange).toHaveBeenCalled();

        for (let frame = 0; frame < 6; frame += 1) {
            const pending = Array.from(queuedCallbacks.entries());
            queuedCallbacks.clear();
            nowMs += 16;
            for (const [, callback] of pending) {
                callback(nowMs);
            }
        }

        const pValue = Number.parseFloat(glider.style.getPropertyValue("--p"));
        expect(pValue).toBeGreaterThan(0);

        for (let frame = 0; frame < 90; frame += 1) {
            const pending = Array.from(queuedCallbacks.entries());
            if (pending.length === 0) {
                break;
            }
            queuedCallbacks.clear();
            nowMs += 16;
            for (const [, callback] of pending) {
                callback(nowMs);
            }
        }

        expect(glider.style.getPropertyValue("--p")).toBe("0.000");
        expect(nav.classList.contains("is-animating")).toBe(false);

        switchInstance.destroy();
    });

    it("applies rubber overdrag resistance past the outer bounds and restores cleanly on cancel", () => {
        let nowMs = 500;
        vi.spyOn(performance, "now").mockImplementation(() => nowMs);
        vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
        vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

        const { nav } = buildSwitchFixture([100, 100], ["vi", "en"]);
        const switchInstance = createGlassSwitch(nav, {
            engine: "css",
            defaultValue: "vi",
        });
        const glider = nav.querySelector<HTMLElement>(".lg-switch-glider")!;

        dispatchPointerEvent(nav, "pointerdown", { clientX: 60, pointerId: 4 });
        nowMs += 16;
        dispatchPointerEvent(window, "pointermove", { clientX: -140, pointerId: 4 });

        const match = glider.style.transform.match(/translate3d\((-?[\d.]+)px/);
        expect(match).not.toBeNull();
        const draggedLeft = Number.parseFloat(match![1]!);
        expect(draggedLeft).toBeLessThan(0);
        expect(draggedLeft).toBeGreaterThan(-38);

        dispatchPointerEvent(window, "pointercancel", { pointerId: 4 });
        expect(nav.classList.contains("is-dragging")).toBe(false);
        expect(nav.classList.contains("is-pressed")).toBe(false);

        switchInstance.destroy();
        expect(nav.classList.contains("lg-switch")).toBe(false);
        expect(nav.querySelector(".lg-switch-glider")).toBeNull();
    });

    it.each([3, 30])("updates per-frame color coverage and hit bounds with %i tabs", (tabCount) => {
        let nowMs = 200;
        let nextRafId = 1;
        const queuedCallbacks = new Map<number, FrameRequestCallback>();

        vi.spyOn(performance, "now").mockImplementation(() => nowMs);
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
            const id = nextRafId;
            nextRafId += 1;
            queuedCallbacks.set(id, callback);
            return id;
        });
        vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
            queuedCallbacks.delete(id);
        });

        const values = ["a", "b", ...Array.from({ length: tabCount - 2 }, (_, idx) => String(idx))];
        const { nav, items } = buildSwitchFixture(values.map(() => 100), values);
        const switchInstance = createGlassSwitch(nav, {
            engine: "css",
            defaultValue: "a",
        });

        expect(items[0]!.style.getPropertyValue("--lg-switch-coverage")).toBe("1.000");
        expect(items[1]!.style.getPropertyValue("--lg-switch-coverage")).toBe("0.000");

        switchInstance.setValue("b", true);
        const distantItem = vi.spyOn(items.at(-1)!, "setAttribute");

        for (let frame = 0; frame < 4; frame += 1) {
            const pending = Array.from(queuedCallbacks.entries());
            queuedCallbacks.clear();
            nowMs += 16;
            for (const [, callback] of pending) {
                callback(nowMs);
            }
            if (frame === 0) distantItem.mockClear();
        }

        const midCoverageFirst = Number.parseFloat(
            items[0]!.style.getPropertyValue("--lg-switch-coverage"),
        );
        const midCoverageSecond = Number.parseFloat(
            items[1]!.style.getPropertyValue("--lg-switch-coverage"),
        );
        const midHitEndSecond = Number.parseFloat(
            items[1]!.style.getPropertyValue("--lg-switch-hit-end"),
        );

        expect(midCoverageFirst).toBeGreaterThan(0);
        expect(midCoverageFirst).toBeLessThan(1);
        expect(midCoverageSecond).toBeGreaterThan(0);
        expect(midCoverageSecond).toBeLessThan(1);
        expect(items[1]!.style.getPropertyValue("--lg-switch-hit-start")).toBe("0.0%");
        expect(midHitEndSecond).toBeGreaterThan(0);
        expect(midHitEndSecond).toBeLessThan(100);
        expect(distantItem).not.toHaveBeenCalledWith("aria-selected", expect.anything());

        for (let frame = 0; frame < 90; frame += 1) {
            const pending = Array.from(queuedCallbacks.entries());
            if (pending.length === 0) {
                break;
            }
            queuedCallbacks.clear();
            nowMs += 16;
            for (const [, callback] of pending) {
                callback(nowMs);
            }
        }

        expect(items[0]!.style.getPropertyValue("--lg-switch-coverage")).toBe("0.000");
        expect(items[1]!.style.getPropertyValue("--lg-switch-coverage")).toBe("1.000");
        expect(items[1]!.style.getPropertyValue("--lg-switch-hit-start")).toBe("0.0%");
        expect(items[1]!.style.getPropertyValue("--lg-switch-hit-end")).toBe("100.0%");

        switchInstance.destroy();
    });

    it("isolates active drag pointer ID from secondary pointers", () => {
        const { nav } = buildSwitchFixture([100, 100, 100], ["one", "two", "three"]);
        const switchInstance = createGlassSwitch(nav, {
            engine: "css",
            defaultValue: "one",
        });

        dispatchPointerEvent(nav, "pointerdown", { pointerId: 10, clientX: 20 });
        expect(nav.classList.contains("is-pressed")).toBe(true);

        dispatchPointerEvent(window, "pointermove", { pointerId: 10, clientX: 50 });
        expect(nav.classList.contains("is-dragging")).toBe(true);

        dispatchPointerEvent(window, "pointermove", { pointerId: 20, clientX: 999 });
        expect(nav.classList.contains("is-dragging")).toBe(true);

        dispatchPointerEvent(window, "pointerup", { pointerId: 20, clientX: 999 });
        expect(nav.classList.contains("is-dragging")).toBe(true);
        expect(nav.classList.contains("is-pressed")).toBe(true);

        dispatchPointerEvent(window, "pointerup", { pointerId: 10, clientX: 50 });
        expect(nav.classList.contains("is-dragging")).toBe(false);
        expect(nav.classList.contains("is-pressed")).toBe(false);

        switchInstance.destroy();
    });

    it("measures dynamically mounted items on first interaction if mounted after initialization", () => {
        const nav = document.createElement("nav");
        document.body.appendChild(nav);

        const switchInstance = createGlassSwitch(nav, { engine: "css" });
        expect(switchInstance.value).toBe("");

        const button1 = document.createElement("button");
        button1.className = "lg-switch-item";
        button1.dataset.switchValue = "alpha";
        button1.textContent = "Alpha";
        Object.defineProperty(button1, "offsetLeft", { value: 10, configurable: true });
        Object.defineProperty(button1, "offsetWidth", { value: 80, configurable: true });

        const button2 = document.createElement("button");
        button2.className = "lg-switch-item";
        button2.dataset.switchValue = "beta";
        button2.textContent = "Beta";
        Object.defineProperty(button2, "offsetLeft", { value: 90, configurable: true });
        Object.defineProperty(button2, "offsetWidth", { value: 80, configurable: true });

        nav.appendChild(button1);
        nav.appendChild(button2);

        button2.click();
        expect(switchInstance.value).toBe("beta");
        expect(switchInstance.activeIndex).toBe(1);

        switchInstance.destroy();
    });

    it("clamps activeIndex gracefully when items are dynamically removed", () => {
        const { nav, items } = buildSwitchFixture([80, 80, 80, 80], ["a", "b", "c", "d"]);
        const switchInstance = createGlassSwitch(nav, {
            engine: "css",
            defaultValue: "d",
        });

        expect(switchInstance.activeIndex).toBe(3);
        expect(switchInstance.value).toBe("d");

        items[2]!.remove();
        items[3]!.remove();

        switchInstance.refresh();
        expect(switchInstance.activeIndex).toBe(1);
        expect(switchInstance.value).toBe("b");

        switchInstance.destroy();
    });

    it("keeps selection by element when tabs are reordered and ignores non-finite indices", async () => {
        const { nav, items } = buildSwitchFixture([80, 60, 100], ["a", "b", "c"]);
        const onChange = vi.fn();
        const sw = createGlassSwitch(nav, { engine: "css", defaultValue: "b", onChange });

        nav.appendChild(items[1]!);
        await Promise.resolve();
        expect(sw.activeIndex).toBe(2);
        expect(sw.value).toBe("b");
        expect(items[1]!.getAttribute("aria-selected")).toBe("true");
        sw.setActiveIndex(NaN);
        expect(sw.value).toBe("b");
        expect(onChange).not.toHaveBeenCalled();
        sw.destroy();
    });

    it("supports dynamic itemSelector update via switchInstance.update()", () => {
        const nav = document.createElement("nav");
        const customItem1 = document.createElement("div");
        customItem1.className = "custom-tab";
        customItem1.dataset.switchValue = "custom1";
        Object.defineProperty(customItem1, "offsetLeft", { value: 0, configurable: true });
        Object.defineProperty(customItem1, "offsetWidth", { value: 100, configurable: true });

        const customItem2 = document.createElement("div");
        customItem2.className = "custom-tab";
        customItem2.dataset.switchValue = "custom2";
        Object.defineProperty(customItem2, "offsetLeft", { value: 100, configurable: true });
        Object.defineProperty(customItem2, "offsetWidth", { value: 100, configurable: true });

        nav.appendChild(customItem1);
        nav.appendChild(customItem2);
        document.body.appendChild(nav);

        const switchInstance = createGlassSwitch(nav, {
            engine: "css",
            itemSelector: ".not-found",
        });
        expect(switchInstance.value).toBe("");

        switchInstance.update({ itemSelector: ".custom-tab" });
        switchInstance.setValue("custom2", false);
        expect(switchInstance.value).toBe("custom2");
        expect(switchInstance.activeIndex).toBe(1);

        switchInstance.destroy();
    });

    it("preserves wanted defaultValue when items mount dynamically after initialization", () => {
        const nav = document.createElement("nav");
        document.body.appendChild(nav);

        const switchInstance = createGlassSwitch(nav, {
            engine: "css",
            defaultValue: "charlie",
        });

        expect(switchInstance.value).toBe("charlie");

        const button1 = document.createElement("button");
        button1.className = "lg-switch-item";
        button1.dataset.switchValue = "alpha";
        button1.textContent = "Alpha";
        Object.defineProperty(button1, "offsetLeft", { value: 0, configurable: true });
        Object.defineProperty(button1, "offsetWidth", { value: 60, configurable: true });

        const button2 = document.createElement("button");
        button2.className = "lg-switch-item";
        button2.dataset.switchValue = "bravo";
        button2.textContent = "Bravo";
        Object.defineProperty(button2, "offsetLeft", { value: 60, configurable: true });
        Object.defineProperty(button2, "offsetWidth", { value: 60, configurable: true });

        const button3 = document.createElement("button");
        button3.className = "lg-switch-item";
        button3.dataset.switchValue = "charlie";
        button3.textContent = "Charlie";
        Object.defineProperty(button3, "offsetLeft", { value: 120, configurable: true });
        Object.defineProperty(button3, "offsetWidth", { value: 60, configurable: true });

        nav.appendChild(button1);
        nav.appendChild(button2);
        nav.appendChild(button3);

        switchInstance.refresh();
        expect(switchInstance.value).toBe("charlie");
        expect(switchInstance.activeIndex).toBe(2);

        switchInstance.destroy();
    });

    it("ignores clicks and skips disabled items during keyboard navigation", () => {
        const { nav, items } = buildSwitchFixture([80, 80, 80], ["first", "second", "third"]);
        items[1]!.disabled = true;

        const switchInstance = createGlassSwitch(nav, {
            engine: "css",
            defaultValue: "first",
        });

        expect(switchInstance.activeIndex).toBe(0);

        items[1]!.click();
        expect(switchInstance.activeIndex).toBe(0);
        expect(switchInstance.value).toBe("first");

        dispatchPointerEvent(items[1]!, "pointerdown", { clientX: 120, pointerId: 10 });
        expect(nav.classList.contains("is-pressed")).toBe(false);

        nav.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        expect(switchInstance.activeIndex).toBe(2);
        expect(switchInstance.value).toBe("third");

        nav.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
        expect(switchInstance.activeIndex).toBe(0);
        expect(switchInstance.value).toBe("first");

        switchInstance.destroy();
    });

    it("defaults to the first enabled item if item 0 is disabled, and prevents default on disabled anchor links", () => {
        const nav = document.createElement("nav");
        nav.className = "lg-switch";
        document.body.appendChild(nav);

        const link1 = document.createElement("a");
        link1.className = "lg-switch-item";
        link1.href = "#link1";
        link1.dataset.switchValue = "l1";
        link1.setAttribute("aria-disabled", "true");
        Object.defineProperty(link1, "offsetLeft", { value: 0, configurable: true });
        Object.defineProperty(link1, "offsetWidth", { value: 70, configurable: true });

        const link2 = document.createElement("a");
        link2.className = "lg-switch-item";
        link2.href = "#link2";
        link2.dataset.switchValue = "l2";
        Object.defineProperty(link2, "offsetLeft", { value: 70, configurable: true });
        Object.defineProperty(link2, "offsetWidth", { value: 70, configurable: true });

        nav.appendChild(link1);
        nav.appendChild(link2);

        const switchInstance = createGlassSwitch(nav, { engine: "css" });
        expect(switchInstance.activeIndex).toBe(1);
        expect(switchInstance.value).toBe("l2");

        const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
        const preventDefaultSpy = vi.spyOn(clickEvent, "preventDefault");
        link1.dispatchEvent(clickEvent);
        expect(preventDefaultSpy).toHaveBeenCalled();
        expect(switchInstance.activeIndex).toBe(1);

        switchInstance.destroy();
    });

    it("preserves active index on refresh/resize after user selection even when initialized with value", () => {
        const { nav } = buildSwitchFixture(
            [80, 80, 80],
            ["tab0", "tab1", "tab2"],
        );

        const switchInstance = createGlassSwitch(nav, {
            engine: "css",
            value: "tab0",
        });

        expect(switchInstance.activeIndex).toBe(0);
        expect(switchInstance.value).toBe("tab0");

        switchInstance.setActiveIndex(2, false);
        expect(switchInstance.activeIndex).toBe(2);
        expect(switchInstance.value).toBe("tab2");

        switchInstance.refresh();

        expect(switchInstance.activeIndex).toBe(2);
        expect(switchInstance.value).toBe("tab2");

        switchInstance.destroy();
    });

    it("falls back to the first enabled item when initial target is disabled", () => {
        const nav = document.createElement("nav");
        document.body.appendChild(nav);

        const btn0 = document.createElement("button");
        btn0.dataset.switchValue = "b0";
        btn0.disabled = true;
        Object.defineProperty(btn0, "offsetLeft", { value: 0, configurable: true });
        Object.defineProperty(btn0, "offsetWidth", { value: 60, configurable: true });

        const btn1 = document.createElement("button");
        btn1.dataset.switchValue = "b1";
        Object.defineProperty(btn1, "offsetLeft", { value: 60, configurable: true });
        Object.defineProperty(btn1, "offsetWidth", { value: 60, configurable: true });

        nav.appendChild(btn0);
        nav.appendChild(btn1);

        const switchInstance = createGlassSwitch(nav, {
            engine: "css",
            value: "b0",
        });

        expect(switchInstance.activeIndex).toBe(1);
        expect(switchInstance.value).toBe("b1");

        switchInstance.destroy();
    });

    it("supports ArrowDown and ArrowUp keyboard navigation", () => {
        const { nav } = buildSwitchFixture(
            [80, 80, 80],
            ["tab0", "tab1", "tab2"],
        );

        const switchInstance = createGlassSwitch(nav, {
            engine: "css",
            defaultValue: "tab0",
        });

        expect(switchInstance.activeIndex).toBe(0);

        nav.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
        expect(switchInstance.activeIndex).toBe(1);
        expect(switchInstance.value).toBe("tab1");

        nav.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
        expect(switchInstance.activeIndex).toBe(0);
        expect(switchInstance.value).toBe("tab0");

        switchInstance.destroy();
    });

    it("cleans up assigned tablist role and item ARIA attributes on destroy", () => {
        const { nav, items } = buildSwitchFixture(
            [80, 80],
            ["tab0", "tab1"],
        );

        expect(nav.hasAttribute("role")).toBe(false);

        const switchInstance = createGlassSwitch(nav, { engine: "css" });
        expect(nav.getAttribute("role")).toBe("tablist");
        expect(items[0]!.getAttribute("aria-selected")).toBe("true");
        expect(items[0]!.classList.contains("active")).toBe(true);

        switchInstance.destroy();
        expect(nav.hasAttribute("role")).toBe(false);
        expect(items[0]!.hasAttribute("aria-selected")).toBe(false);
        expect(items[0]!.hasAttribute("aria-pressed")).toBe(false);
        expect(items[0]!.classList.contains("active")).toBe(false);
    });

    it("skips items marked disabled via CSS class during clicks and keyboard navigation", () => {
        const { nav, items } = buildSwitchFixture(
            [80, 80, 80],
            ["tab0", "tab1", "tab2"],
        );

        items[1]!.classList.add("is-disabled");

        const switchInstance = createGlassSwitch(nav, {
            engine: "css",
            defaultValue: "tab0",
        });

        expect(switchInstance.activeIndex).toBe(0);

        items[1]!.click();
        expect(switchInstance.activeIndex).toBe(0);
        expect(switchInstance.value).toBe("tab0");

        nav.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        expect(switchInstance.activeIndex).toBe(2);
        expect(switchInstance.value).toBe("tab2");

        switchInstance.destroy();
    });

    it("cleans up inline styles from custom glider element without removing it on destroy", () => {
        const { nav } = buildSwitchFixture([80, 80], ["tab0", "tab1"]);
        const customGlider = document.createElement("div");
        customGlider.className = "custom-glider";
        nav.appendChild(customGlider);

        const switchInstance = createGlassSwitch(nav, {
            engine: "css",
            gliderElement: customGlider,
        });

        expect(customGlider.style.getPropertyValue("--p")).toBeDefined();
        expect(nav.contains(customGlider)).toBe(true);

        switchInstance.destroy();

        expect(nav.contains(customGlider)).toBe(true);
        expect(customGlider.style.getPropertyValue("--p")).toBe("");
        expect(customGlider.style.getPropertyValue("transform")).toBe("");
        expect(customGlider.style.getPropertyValue("width")).toBe("");
    });

    it("preserves the track sceneElement fallback for the glider across update() calls", () => {
        const win = window as unknown as { __LG_FORCE_CHROMIUM__?: boolean };
        win.__LG_FORCE_CHROMIUM__ = false;
        const getContextSpy = vi
            .spyOn(HTMLCanvasElement.prototype, "getContext")
            .mockImplementation((type: string) => {
                if (type === "webgl2" || type === "webgl") {
                    return {
                        VERTEX_SHADER: 0x8b31,
                        FRAGMENT_SHADER: 0x8b30,
                        COMPILE_STATUS: 0x8b81,
                        LINK_STATUS: 0x8b82,
                        ARRAY_BUFFER: 0x8892,
                        STATIC_DRAW: 0x88e4,
                        FLOAT: 0x1406,
                        TEXTURE0: 0x84c0,
                        TEXTURE1: 0x84c1,
                        TEXTURE_2D: 0x0de1,
                        RGBA: 0x1908,
                        UNSIGNED_BYTE: 0x1401,
                        TEXTURE_WRAP_S: 0x2802,
                        TEXTURE_WRAP_T: 0x2803,
                        TEXTURE_MIN_FILTER: 0x2801,
                        TEXTURE_MAG_FILTER: 0x2800,
                        CLAMP_TO_EDGE: 0x812f,
                        LINEAR: 0x2601,
                        MAX_VIEWPORT_DIMS: 0x0d3a,
                        MAX_TEXTURE_SIZE: 0x0d33,
                        UNPACK_FLIP_Y_WEBGL: 0x9240,
                        UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
                        getParameter: () => 4096,
                        getExtension: () => null,
                        createShader: () => ({}),
                        shaderSource: () => {},
                        compileShader: () => {},
                        getShaderParameter: () => true,
                        deleteShader: () => {},
                        createProgram: () => ({}),
                        attachShader: () => {},
                        bindAttribLocation: () => {},
                        linkProgram: () => {},
                        getProgramParameter: () => true,
                        deleteProgram: () => {},
                        useProgram: () => {},
                        createBuffer: () => ({}),
                        bindBuffer: () => {},
                        bufferData: () => {},
                        deleteBuffer: () => {},
                        getAttribLocation: () => 0,
                        enableVertexAttribArray: () => {},
                        vertexAttribPointer: () => {},
                        getUniformLocation: () => ({}),
                        activeTexture: () => {},
                        createTexture: () => ({}),
                        bindTexture: () => {},
                        pixelStorei: () => {},
                        texParameteri: () => {},
                        texImage2D: () => {},
                        deleteTexture: () => {},
                        uniform1i: () => {},
                        uniform1f: () => {},
                        uniform2f: () => {},
                        uniform4f: () => {},
                        viewport: () => {},
                        drawArrays: () => {},
                    } as unknown as RenderingContext;
                }
                return null;
            });

        const { nav } = buildSwitchFixture([80, 80], ["tab0", "tab1"]);
        const switchInstance = createGlassSwitch(nav, {
            engine: "auto",
        });
        expect(switchInstance.engine).toBe("webgl");

        switchInstance.update({ sceneElement: null, tintOpacity: 0.2 });
        expect(switchInstance.engine).toBe("webgl");

        switchInstance.destroy();
        getContextSpy.mockRestore();
        delete win.__LG_FORCE_CHROMIUM__;
    });

    it("supports non-monotonic / RTL spatial anchor ordering for sweep, width interpolation, and dragging", () => {
        const nav = document.createElement("nav");
        const specs = [
            { value: "first", left: 204, width: 80 },
            { value: "second", left: 104, width: 100 },
            { value: "third", left: 4, width: 100 },
        ];

        specs.forEach((spec) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "lg-switch-item";
            button.dataset.switchValue = spec.value;
            button.textContent = spec.value;
            Object.defineProperty(button, "offsetLeft", {
                get: () => spec.left,
                configurable: true,
            });
            Object.defineProperty(button, "offsetWidth", {
                get: () => spec.width,
                configurable: true,
            });
            nav.appendChild(button);
        });
        document.body.appendChild(nav);

        const sw = createGlassSwitch(nav, {
            engine: "css",
            defaultValue: "third",
        });

        expect(nav.style.getPropertyValue("--sweep")).toBe("-15.0%");

        const glider = nav.querySelector(".lg-switch-glider") as HTMLElement;
        expect(parseFloat(glider.style.width)).toBe(100);

        sw.setValue("first", false);
        expect(nav.style.getPropertyValue("--sweep")).toBe("115.0%");
        expect(parseFloat(glider.style.width)).toBe(80);

        let nowMs = 1000;
        vi.spyOn(performance, "now").mockImplementation(() => nowMs);
        dispatchPointerEvent(nav, "pointerdown", { clientX: 244, pointerId: 1 });
        nowMs += 200;
        dispatchPointerEvent(nav, "pointermove", { clientX: 144, pointerId: 1 });
        nowMs += 100;
        dispatchPointerEvent(nav, "pointermove", { clientX: 144, pointerId: 1 });
        expect(parseFloat(glider.style.width)).toBeCloseTo(100, 1);
        dispatchPointerEvent(nav, "pointerup", { clientX: 144, pointerId: 1 });
        expect(sw.value).toBe("second");

        sw.destroy();
    });

    it("gates progressive label and icon highlight strictly to active liquid glass lenses and manages track element lifecycle", () => {
        const nav = document.createElement("nav");
        const labels: HTMLSpanElement[] = [];
        const buttons: HTMLButtonElement[] = [];

        ["Home", "Search"].forEach((name, idx) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "lg-switch-item";
            btn.dataset.switchValue = name.toLowerCase();
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.getBoundingClientRect = () =>
                ({ left: 4 + idx * 100 + 40, top: 6, right: 4 + idx * 100 + 60, bottom: 26, width: 20, height: 20, x: 4 + idx * 100 + 40, y: 6, toJSON() {} }) as DOMRect;
            const span = document.createElement("span");
            span.textContent = name;
            Object.defineProperty(span, "offsetLeft", { get: () => 25, configurable: true });
            Object.defineProperty(span, "offsetWidth", { get: () => 50, configurable: true });
            btn.append(svg, span);

            const left = 4 + idx * 100;
            Object.defineProperty(btn, "offsetLeft", { get: () => left, configurable: true });
            Object.defineProperty(btn, "offsetWidth", { get: () => 100, configurable: true });
            btn.getBoundingClientRect = () =>
                ({ left, top: 0, right: left + 100, bottom: 44, width: 100, height: 44, x: left, y: 0, toJSON() {} }) as DOMRect;

            nav.appendChild(btn);
            buttons.push(btn);
            labels.push(span);
        });
        document.body.appendChild(nav);

        const cssSwitch = createGlassSwitch(nav, {
            engine: "css",
            blur: 12,
            defaultValue: "home",
        });

        expect(nav.querySelector(".lg-switch-track")).not.toBeNull();
        expect(nav.hasAttribute("data-lg-switch-glass")).toBe(false);
        expect(labels[0]!.hasAttribute("data-lg-switch-lit")).toBe(false);
        expect(labels[1]!.hasAttribute("data-lg-switch-lit")).toBe(false);
        expect(buttons[0]!.style.getPropertyValue("--lg-switch-icon-coverage")).toBe("0.000");
        expect(buttons[1]!.style.getPropertyValue("--lg-switch-icon-coverage")).toBe("0.000");

        let nowMs = 1000;
        vi.spyOn(performance, "now").mockImplementation(() => nowMs);
        dispatchPointerEvent(nav, "pointerdown", { clientX: 50, pointerId: 1 });
        nowMs += 200;
        dispatchPointerEvent(window, "pointermove", { clientX: 110, pointerId: 1 });
        expect(labels[1]!.hasAttribute("data-lg-switch-lit")).toBe(false);
        expect(buttons[1]!.style.getPropertyValue("--lg-switch-icon-coverage")).toBe("0.000");
        dispatchPointerEvent(window, "pointerup", { clientX: 110, pointerId: 1 });
        cssSwitch.destroy();
        expect(nav.querySelector(".lg-switch-track")).toBeNull();

        const win = window as unknown as { __LG_FORCE_CHROMIUM__?: boolean };
        win.__LG_FORCE_CHROMIUM__ = false;
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((type: string) => {
            if (type === "webgl2" || type === "webgl") {
                return {
                    VERTEX_SHADER: 0x8b31,
                    FRAGMENT_SHADER: 0x8b30,
                    COMPILE_STATUS: 0x8b81,
                    LINK_STATUS: 0x8b82,
                    ARRAY_BUFFER: 0x8892,
                    STATIC_DRAW: 0x88e4,
                    FLOAT: 0x1406,
                    TEXTURE0: 0x84c0,
                    TEXTURE1: 0x84c1,
                    TEXTURE_2D: 0x0de1,
                    RGBA: 0x1908,
                    UNSIGNED_BYTE: 0x1401,
                    TEXTURE_WRAP_S: 0x2802,
                    TEXTURE_WRAP_T: 0x2803,
                    TEXTURE_MIN_FILTER: 0x2801,
                    TEXTURE_MAG_FILTER: 0x2800,
                    CLAMP_TO_EDGE: 0x812f,
                    LINEAR: 0x2601,
                    MAX_VIEWPORT_DIMS: 0x0d3a,
                    MAX_TEXTURE_SIZE: 0x0d33,
                    UNPACK_FLIP_Y_WEBGL: 0x9240,
                    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
                    getParameter: () => 4096,
                    getExtension: () => null,
                    createShader: () => ({}),
                    shaderSource: () => {},
                    compileShader: () => {},
                    getShaderParameter: () => true,
                    deleteShader: () => {},
                    createProgram: () => ({}),
                    attachShader: () => {},
                    bindAttribLocation: () => {},
                    linkProgram: () => {},
                    getProgramParameter: () => true,
                    deleteProgram: () => {},
                    useProgram: () => {},
                    createBuffer: () => ({}),
                    bindBuffer: () => {},
                    bufferData: () => {},
                    deleteBuffer: () => {},
                    getAttribLocation: () => 0,
                    enableVertexAttribArray: () => {},
                    vertexAttribPointer: () => {},
                    getUniformLocation: () => ({}),
                    activeTexture: () => {},
                    createTexture: () => ({}),
                    bindTexture: () => {},
                    pixelStorei: () => {},
                    texParameteri: () => {},
                    texImage2D: () => {},
                    deleteTexture: () => {},
                    uniform1i: () => {},
                    uniform1f: () => {},
                    uniform2f: () => {},
                    uniform4f: () => {},
                    viewport: () => {},
                    drawArrays: () => {},
                } as unknown as RenderingContext;
            }
            return null;
        });

        const glassSwitch = createGlassSwitch(nav, {
            engine: "auto",
            blur: 14,
            defaultValue: "home",
        });
        expect(glassSwitch.engine).toBe("webgl");
        expect(nav.getAttribute("data-lg-switch-glass")).toBe("1");
        expect(nav.style.getPropertyValue("--lg-filter")).not.toContain("blur(14px)");
        expect(labels[0]!.getAttribute("data-lg-switch-lit")).toBe("1");
        expect(labels[1]!.hasAttribute("data-lg-switch-lit")).toBe(false);

        nowMs += 200;
        dispatchPointerEvent(nav, "pointerdown", { clientX: 50, pointerId: 2 });
        nowMs += 200;
        dispatchPointerEvent(window, "pointermove", { clientX: 65, pointerId: 2 });
        expect(Number.parseFloat(buttons[1]!.style.getPropertyValue("--lg-switch-hit-end"))).toBeGreaterThan(0);
        expect(labels[1]!.hasAttribute("data-lg-switch-lit")).toBe(false);
        expect(buttons[1]!.style.getPropertyValue("--lg-switch-icon-coverage")).toBe("0.000");

        nowMs += 200;
        dispatchPointerEvent(window, "pointermove", { clientX: 110, pointerId: 2 });
        expect(labels[1]!.getAttribute("data-lg-switch-lit")).toBe("1");
        expect(Number.parseFloat(labels[1]!.style.getPropertyValue("--lg-switch-label-hit-end"))).toBeGreaterThan(0);
        expect(Number.parseFloat(buttons[1]!.style.getPropertyValue("--lg-switch-icon-coverage"))).toBeGreaterThan(0);

        dispatchPointerEvent(window, "pointerup", { clientX: 110, pointerId: 2 });
        glassSwitch.destroy();
        expect(nav.hasAttribute("data-lg-switch-glass")).toBe(false);
        expect(nav.querySelector(".lg-switch-track")).toBeNull();
        expect(labels[1]!.hasAttribute("data-lg-switch-lit")).toBe(false);
        expect(buttons[1]!.style.getPropertyValue("--lg-switch-icon-coverage")).toBe("");
    });

    it("emits onChange from setValue, guards disabled/destroyed state, clears tintColor, observes dynamic items, and supports vertical stale fling decay", async () => {
        const nav = document.createElement("nav");
        const tabA = document.createElement("button");
        tabA.dataset.switchValue = "a";
        Object.defineProperties(tabA, { offsetTop: { value: 4 }, offsetHeight: { value: 44 }, offsetLeft: { value: 4 }, offsetWidth: { value: 120 } });
        const tabB = document.createElement("button");
        tabB.dataset.switchValue = "b";
        Object.defineProperties(tabB, { offsetTop: { value: 52 }, offsetHeight: { value: 44 }, offsetLeft: { value: 4 }, offsetWidth: { value: 120 } });
        const tabC = document.createElement("button");
        tabC.dataset.switchValue = "c";
        tabC.disabled = true;
        nav.append(tabA, tabB, tabC);
        document.body.appendChild(nav);

        let nowPerf = 100;
        vi.spyOn(performance, "now").mockImplementation(() => nowPerf);

        const changes: Array<[string, number]> = [];
        const sw = createGlassSwitch(nav, {
            engine: "css",
            orientation: "vertical",
            defaultValue: "a",
            tintColor: "rgb(10, 20, 30)",
            onChange: (val, idx) => changes.push([val, idx]),
        });
        expect(nav.getAttribute("data-lg-switch-orientation")).toBe("vertical");
        const glider = nav.querySelector<HTMLElement>(".lg-switch-glider")!;
        expect(glider.style.transform).toContain("translate3d(0, 0.00px, 0)");

        nav.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 20, clientY: 10 }));
        nowPerf = 116;
        window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 20, clientY: 22 }));
        nowPerf = 450;
        window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 20, clientY: 22 }));
        expect(sw.value).toBe("a");

        sw.setValue("b", false);
        expect(sw.value).toBe("b");
        expect(changes).toEqual([["b", 1]]);
        expect(glider.style.transform).toContain("translate3d(0, 48.00px, 0)");

        sw.setValue("c", false);
        sw.setActiveIndex(2, false);
        expect(sw.value).toBe("b");
        expect(changes).toEqual([["b", 1]]);

        expect(nav.style.getPropertyValue("--lg-tint")).toBe("rgba(10, 20, 30, 0.06)");
        sw.update({ tintColor: undefined });
        expect(nav.style.getPropertyValue("--lg-tint")).toBe("rgba(255, 255, 255, 0.06)");

        const tabD = document.createElement("button");
        tabD.dataset.switchValue = "d";
        nav.appendChild(tabD);
        await new Promise((resolve) => setTimeout(resolve, 10));
        sw.setValue("d", false);
        expect(sw.value).toBe("d");

        sw.destroy();
        sw.setValue("a", false);
        sw.update({ orientation: "horizontal" });
        expect(sw.value).toBe("d");
    });

    it("defers glider style writes until after all anchor layout reads during measureAnchors", () => {
        let sawReadAfterWrite = false;
        let wroteGliderLeft = false;
        const nav = document.createElement("nav");
        const tab1 = document.createElement("button");
        tab1.dataset.switchValue = "one";
        const tab2 = document.createElement("button");
        tab2.dataset.switchValue = "two";
        Object.defineProperties(tab1, {
            offsetLeft: { configurable: true, get: () => 4 },
            offsetWidth: { configurable: true, get: () => 80 },
        });
        Object.defineProperties(tab2, {
            offsetLeft: {
                configurable: true,
                get: () => {
                    if (wroteGliderLeft) sawReadAfterWrite = true;
                    return 88;
                },
            },
            offsetWidth: {
                configurable: true,
                get: () => {
                    if (wroteGliderLeft) sawReadAfterWrite = true;
                    return 80;
                },
            },
        });
        nav.append(tab1, tab2);
        document.body.appendChild(nav);

        const sw = createGlassSwitch(nav, { engine: "css", defaultValue: "one" });
        const glider = nav.querySelector<HTMLElement>(".lg-switch-glider")!;

        const origLeftDescriptor = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, "left");
        Object.defineProperty(glider.style, "left", {
            configurable: true,
            set(val: string) {
                wroteGliderLeft = true;
                origLeftDescriptor?.set?.call(this, val);
            },
            get() {
                return origLeftDescriptor?.get?.call(this) ?? "";
            },
        });

        sw.refresh();
        expect(wroteGliderLeft).toBe(true);
        expect(sawReadAfterWrite).toBe(false);
        sw.destroy();
    });
});
