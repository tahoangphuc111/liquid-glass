import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiquidGlass, destroyLiquidGlass, resolveGlassEngine } from "../src/index.js";
import { stepDampedSpring } from "../src/core/spring.js";
import { resetTelemetryForTesting } from "../src/core/telemetry.js";

function setForcedChromium(value: boolean | undefined): void {
    const win = window as unknown as { __LG_FORCE_CHROMIUM__?: boolean };
    if (value === undefined) {
        delete win.__LG_FORCE_CHROMIUM__;
    } else {
        win.__LG_FORCE_CHROMIUM__ = value;
    }
}

describe("LiquidGlass controller and engine selection", () => {
    afterEach(() => {
        destroyLiquidGlass();
        resetTelemetryForTesting();
        setForcedChromium(undefined);
        document.body.innerHTML = "";
        vi.restoreAllMocks();
    });

    it("picks wasm-svg on desktop Chromium and falls back to webgl or css elsewhere", () => {
        setForcedChromium(true);
        expect(resolveGlassEngine("auto", true)).toBe("wasm-svg");
        expect(resolveGlassEngine("css", true)).toBe("css");

        setForcedChromium(false);
        expect(resolveGlassEngine("auto", true)).toBe("webgl");
        expect(resolveGlassEngine("auto", false)).toBe("css");
        expect(resolveGlassEngine("wasm-svg", true)).toBe("webgl");
        expect(resolveGlassEngine("wasm-svg", false)).toBe("css");
    });

    it("falls back to css when WebGL context creation returns null", () => {
        setForcedChromium(false);
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

        const sceneEl = document.createElement("div");
        const targetEl = document.createElement("div");
        document.body.append(sceneEl, targetEl);

        const seenEngines: string[] = [];
        const glass = createLiquidGlass(targetEl, {
            engine: "auto",
            sceneElement: sceneEl,
            pill: true,
            onEngineChange(engine) {
                seenEngines.push(engine);
            },
        });

        expect(targetEl.hasAttribute("data-lg-surface")).toBe(true);
        expect(targetEl.getAttribute("data-lg-pill")).toBe("true");
        expect(glass.engine).toBe("css");
        expect(targetEl.getAttribute("data-lg-engine")).toBe("css");
        expect(seenEngines).toContain("css");

        glass.destroy();
        expect(targetEl.hasAttribute("data-lg-surface")).toBe(false);
        expect(targetEl.hasAttribute("data-lg-engine")).toBe(false);
        expect(targetEl.hasAttribute("data-lg-pill")).toBe(false);
    });

    it("creates and revokes SVG displacement blob URLs on desktop Chromium", () => {
        setForcedChromium(true);
        const createUrlSpy = vi.fn(() => "blob:lg-mock-map");
        const revokeUrlSpy = vi.fn();
        Object.defineProperty(URL, "createObjectURL", {
            value: createUrlSpy,
            configurable: true,
            writable: true,
        });
        Object.defineProperty(URL, "revokeObjectURL", {
            value: revokeUrlSpy,
            configurable: true,
            writable: true,
        });

        const targetEl = document.createElement("div");
        Object.defineProperty(targetEl, "offsetWidth", { value: 240, configurable: true });
        Object.defineProperty(targetEl, "offsetHeight", { value: 48, configurable: true });
        document.body.appendChild(targetEl);

        const glass = createLiquidGlass(targetEl, { engine: "wasm-svg" });

        expect(glass.engine).toBe("wasm-svg");
        expect(targetEl.getAttribute("data-lg-engine")).toBe("wasm-svg");
        expect(createUrlSpy).toHaveBeenCalled();

        glass.update({ pill: true, thickness: 55 });
        expect(glass.engine).toBe("wasm-svg");

        glass.destroy();
        destroyLiquidGlass();
        expect(targetEl.hasAttribute("data-lg-engine")).toBe(false);
        expect(revokeUrlSpy).toHaveBeenCalled();
    });

    it("keeps radius, pill, and blur in sync during interactive updates", () => {
        const targetEl = document.createElement("div");
        document.body.appendChild(targetEl);

        const glass = createLiquidGlass(targetEl, {
            engine: "css",
            radius: 20,
            blur: 0,
            pill: false,
        });

        expect(targetEl.style.getPropertyValue("--lg-radius")).toBe("20px");
        expect(targetEl.style.getPropertyValue("--lg-filter")).toBe("blur(0.0px) saturate(165%)");

        glass.update({ pill: true, blur: 2 });
        expect(targetEl.getAttribute("data-lg-pill")).toBe("true");
        expect(targetEl.style.getPropertyValue("--lg-radius")).toBe("");
        expect(targetEl.style.getPropertyValue("--lg-filter")).toBe("blur(7.0px) saturate(165%)");

        glass.update({ pill: false, radius: 0 });
        expect(targetEl.hasAttribute("data-lg-pill")).toBe(false);
        expect(targetEl.style.getPropertyValue("--lg-radius")).toBe("0px");

        glass.destroy();
    });

    it("enables damped spring button oscillation on buttons and interactive surfaces", () => {
        const buttonEl = document.createElement("button");
        document.body.appendChild(buttonEl);

        const buttonGlass = createLiquidGlass(buttonEl, { engine: "css", pill: true });
        expect(buttonEl.classList.contains("lg-interactive")).toBe(true);

        let displacement = -0.028;
        let velocity = 0.34;
        let maxOvershoot = 0;
        let settled = false;
        for (let step = 0; step < 120; step++) {
            const next = stepDampedSpring(displacement, velocity, 0, false, 0.016);
            displacement = next.displacement;
            velocity = next.velocity;
            if (displacement > maxOvershoot) maxOvershoot = displacement;
            if (next.settled) {
                settled = true;
                break;
            }
        }
        expect(maxOvershoot).toBeGreaterThan(0.004);
        expect(settled).toBe(true);

        buttonGlass.update({ interactive: false });
        expect(buttonEl.classList.contains("lg-interactive")).toBe(false);

        buttonGlass.update({ interactive: true });
        expect(buttonEl.classList.contains("lg-interactive")).toBe(true);

        buttonGlass.destroy();
        expect(buttonEl.classList.contains("lg-interactive")).toBe(false);
    });
});
