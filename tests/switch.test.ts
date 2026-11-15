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
});
