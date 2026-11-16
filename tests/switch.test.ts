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

    it("updates per-frame color coverage and horizontal hit bounds as the glider moves across tabs", () => {
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

        const { nav, items } = buildSwitchFixture([100, 100, 100], ["a", "b", "c"]);
        const switchInstance = createGlassSwitch(nav, {
            engine: "css",
            defaultValue: "a",
        });

        expect(items[0]!.style.getPropertyValue("--lg-switch-coverage")).toBe("1.000");
        expect(items[1]!.style.getPropertyValue("--lg-switch-coverage")).toBe("0.000");

        switchInstance.setValue("b", true);

        for (let frame = 0; frame < 4; frame += 1) {
            const pending = Array.from(queuedCallbacks.entries());
            queuedCallbacks.clear();
            nowMs += 16;
            for (const [, callback] of pending) {
                callback(nowMs);
            }
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

        // Start drag with pointerId 10
        dispatchPointerEvent(nav, "pointerdown", { pointerId: 10, clientX: 20 });
        expect(nav.classList.contains("is-pressed")).toBe(true);

        // Move pointerId 10 past threshold
        dispatchPointerEvent(window, "pointermove", { pointerId: 10, clientX: 50 });
        expect(nav.classList.contains("is-dragging")).toBe(true);

        // Secondary pointer 20 moves - should be ignored
        dispatchPointerEvent(window, "pointermove", { pointerId: 20, clientX: 999 });
        expect(nav.classList.contains("is-dragging")).toBe(true);

        // Secondary pointer 20 releases - should NOT cancel pointer 10's drag
        dispatchPointerEvent(window, "pointerup", { pointerId: 20, clientX: 999 });
        expect(nav.classList.contains("is-dragging")).toBe(true);
        expect(nav.classList.contains("is-pressed")).toBe(true);

        // Primary pointer 10 releases - ends drag
        dispatchPointerEvent(window, "pointerup", { pointerId: 10, clientX: 50 });
        expect(nav.classList.contains("is-dragging")).toBe(false);
        expect(nav.classList.contains("is-pressed")).toBe(false);

        switchInstance.destroy();
    });

    it("measures dynamically mounted items on first interaction if mounted after initialization", () => {
        const nav = document.createElement("nav");
        document.body.appendChild(nav);

        // Initialize with empty nav
        const switchInstance = createGlassSwitch(nav, { engine: "css" });
        expect(switchInstance.value).toBe("");

        // Now mount items dynamically
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

        // Click on button2 - should measure and select Beta
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

        // Remove 2 items from DOM (down to 2 items)
        items[2]!.remove();
        items[3]!.remove();

        switchInstance.refresh();
        expect(switchInstance.activeIndex).toBe(1);
        expect(switchInstance.value).toBe("b");

        switchInstance.destroy();
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

        // Update selector
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

        // Even with no elements initially, value returns the pending wanted value
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
        // Mark the middle item disabled
        items[1]!.disabled = true;

        const switchInstance = createGlassSwitch(nav, {
            engine: "css",
            defaultValue: "first",
        });

        expect(switchInstance.activeIndex).toBe(0);

        // Clicking the disabled button must not select it
        items[1]!.click();
        expect(switchInstance.activeIndex).toBe(0);
        expect(switchInstance.value).toBe("first");

        // Pointerdown on disabled button does not trigger is-pressed
        dispatchPointerEvent(items[1]!, "pointerdown", { clientX: 120, pointerId: 10 });
        expect(nav.classList.contains("is-pressed")).toBe(false);

        // ArrowRight from 0 should skip disabled item 1 and land on item 2
        nav.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        expect(switchInstance.activeIndex).toBe(2);
        expect(switchInstance.value).toBe("third");

        // ArrowLeft from 2 should skip disabled item 1 and land on item 0
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
        // Since link 1 is disabled and no initial value specified, link 2 is selected
        expect(switchInstance.activeIndex).toBe(1);
        expect(switchInstance.value).toBe("l2");

        // Clicking disabled link calls preventDefault
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

        // User or code switches to tab2
        switchInstance.setActiveIndex(2, false);
        expect(switchInstance.activeIndex).toBe(2);
        expect(switchInstance.value).toBe("tab2");

        // Trigger refresh (as happens during window/container resize)
        switchInstance.refresh();

        // Must not reset back to tab0
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

        // ArrowDown moves forward like ArrowRight
        nav.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
        expect(switchInstance.activeIndex).toBe(1);
        expect(switchInstance.value).toBe("tab1");

        // ArrowUp moves backward like ArrowLeft
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

        // Mark tab1 disabled via CSS class
        items[1]!.classList.add("is-disabled");

        const switchInstance = createGlassSwitch(nav, {
            engine: "css",
            defaultValue: "tab0",
        });

        expect(switchInstance.activeIndex).toBe(0);

        // Clicking disabled tab1 should be prevented
        items[1]!.click();
        expect(switchInstance.activeIndex).toBe(0);
        expect(switchInstance.value).toBe("tab0");

        // ArrowRight navigation should skip tab1 and go straight to tab2
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

        // Custom glider must remain in the DOM, but its inline properties must be stripped
        expect(nav.contains(customGlider)).toBe(true);
        expect(customGlider.style.getPropertyValue("--p")).toBe("");
        expect(customGlider.style.getPropertyValue("transform")).toBe("");
        expect(customGlider.style.getPropertyValue("width")).toBe("");
    });
});
