import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiquidGlass, destroyLiquidGlass, resolveGlassEngine } from "../src/index.js";
import {
    attachGlobalListeners,
    detachGlobalListeners,
    resetObserverForTesting,
} from "../src/core/observer.js";
import {
    createInteractiveSpring,
    stepDampedSpring,
    stepSpring,
} from "../src/core/spring.js";
import {
    downgradeLiquidGlass,
    isGlassDowngraded,
    qualityTier,
    recordJankFrame,
    resetTelemetryForTesting,
} from "../src/core/telemetry.js";

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
        expect(targetEl.style.getPropertyValue("--lg-filter")).toBe("blur(0.0px) saturate(220%)");

        glass.update({ pill: true, blur: 2 });
        expect(targetEl.getAttribute("data-lg-pill")).toBe("true");
        expect(targetEl.style.getPropertyValue("--lg-radius")).toBe("");
        expect(targetEl.style.getPropertyValue("--lg-filter")).toBe("blur(7.0px) saturate(220%)");

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

    it("isolates primary drag pointer from secondary pointers during interactive drag", () => {
        const buttonEl = document.createElement("button");
        Object.defineProperty(buttonEl, "getBoundingClientRect", {
            value: () => ({ left: 0, top: 0, width: 120, height: 40 }),
            configurable: true,
        });
        document.body.appendChild(buttonEl);

        const buttonGlass = createLiquidGlass(buttonEl, {
            engine: "css",
            interactive: true,
            draggable: true,
        });

        // Pointer 1 down
        const pointerDown1 = new MouseEvent("pointerdown", { bubbles: true, clientX: 20, clientY: 20 });
        Object.defineProperty(pointerDown1, "pointerId", { value: 1 });
        Object.defineProperty(pointerDown1, "pointerType", { value: "touch" });
        buttonEl.dispatchEvent(pointerDown1);

        // Pointer 2 down while pointer 1 is dragging
        const pointerDown2 = new MouseEvent("pointerdown", { bubbles: true, clientX: 50, clientY: 50 });
        Object.defineProperty(pointerDown2, "pointerId", { value: 2 });
        Object.defineProperty(pointerDown2, "pointerType", { value: "touch" });
        buttonEl.dispatchEvent(pointerDown2);

        // Move pointer 1 beyond drag threshold (4px)
        const pointerMove1 = new MouseEvent("pointermove", { bubbles: true, clientX: 40, clientY: 20 });
        Object.defineProperty(pointerMove1, "pointerId", { value: 1 });
        Object.defineProperty(pointerMove1, "pointerType", { value: "touch" });
        buttonEl.dispatchEvent(pointerMove1);

        expect(buttonEl.getAttribute("data-lg-dragging")).toBe("1");

        // Pointer 2 up should NOT cancel or end pointer 1's drag
        const pointerUp2 = new MouseEvent("pointerup", { bubbles: true, clientX: 50, clientY: 50 });
        Object.defineProperty(pointerUp2, "pointerId", { value: 2 });
        Object.defineProperty(pointerUp2, "pointerType", { value: "touch" });
        buttonEl.dispatchEvent(pointerUp2);

        expect(buttonEl.getAttribute("data-lg-dragging")).toBe("1");

        // Pointer 1 up finishes drag
        const pointerUp1 = new MouseEvent("pointerup", { bubbles: true, clientX: 40, clientY: 20 });
        Object.defineProperty(pointerUp1, "pointerId", { value: 1 });
        Object.defineProperty(pointerUp1, "pointerType", { value: "touch" });
        buttonEl.dispatchEvent(pointerUp1);

        expect(buttonEl.hasAttribute("data-lg-dragging")).toBe(false);

        buttonGlass.destroy();
    });

    it("transitions bidirectionally between WebGL and CSS on dynamic setSceneCanvas in auto mode", () => {
        setForcedChromium(false);
        const mockGl = {
            MAX_VIEWPORT_DIMS: 0x0d3a,
            MAX_TEXTURE_SIZE: 0x0d33,
            TEXTURE_WRAP_S: 0x2802,
            TEXTURE_WRAP_T: 0x2803,
            TEXTURE_MIN_FILTER: 0x2801,
            TEXTURE_MAG_FILTER: 0x2800,
            CLAMP_TO_EDGE: 0x812f,
            LINEAR: 0x2601,
            getParameter: vi.fn((param: number) =>
                param === 0x0d3a ? new Int32Array([4096, 4096]) : 4096,
            ),
            createShader: vi.fn(() => ({})),
            shaderSource: vi.fn(),
            compileShader: vi.fn(),
            getShaderParameter: vi.fn(() => true),
            createProgram: vi.fn(() => ({})),
            attachShader: vi.fn(),
            bindAttribLocation: vi.fn(),
            linkProgram: vi.fn(),
            getProgramParameter: vi.fn(() => true),
            getUniformLocation: vi.fn(() => 1),
            useProgram: vi.fn(),
            createBuffer: vi.fn(() => ({})),
            bindBuffer: vi.fn(),
            bufferData: vi.fn(),
            getAttribLocation: vi.fn(() => 0),
            enableVertexAttribArray: vi.fn(),
            vertexAttribPointer: vi.fn(),
            activeTexture: vi.fn(),
            createTexture: vi.fn(() => ({})),
            bindTexture: vi.fn(),
            pixelStorei: vi.fn(),
            texParameteri: vi.fn(),
            texImage2D: vi.fn(),
            uniform1i: vi.fn(),
            uniform1f: vi.fn(),
            uniform2f: vi.fn(),
            uniform4f: vi.fn(),
            viewport: vi.fn(),
            drawArrays: vi.fn(),
            deleteProgram: vi.fn(),
            deleteShader: vi.fn(),
            deleteBuffer: vi.fn(),
            deleteTexture: vi.fn(),
        };
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((type: string) => {
            if (type === "webgl2" || type === "webgl") return mockGl as unknown as RenderingContext;
            return null;
        });

        const targetEl = document.createElement("div");
        Object.defineProperty(targetEl, "getBoundingClientRect", {
            value: () => ({ left: 0, top: 0, width: 100, height: 40 }),
            configurable: true,
        });
        document.body.appendChild(targetEl);

        const glass = createLiquidGlass(targetEl, {
            engine: "auto",
        });

        // Initially without scene canvas in auto mode on non-chromium -> css
        expect(glass.engine).toBe("css");

        const sceneCanvas = document.createElement("canvas");
        sceneCanvas.width = 200;
        sceneCanvas.height = 80;

        // Providing scene canvas -> transitions to webgl
        glass.setSceneCanvas(sceneCanvas);
        expect(glass.engine).toBe("webgl");

        // Removing scene canvas with setSceneCanvas(null) -> transitions back to css
        glass.setSceneCanvas(null);
        expect(glass.engine).toBe("css");

        glass.destroy();
    });

    it("releases pointer capture and removes data-lg-dragging when interactive is disabled mid-drag", () => {
        const buttonEl = document.createElement("button");
        Object.defineProperty(buttonEl, "getBoundingClientRect", {
            value: () => ({ left: 0, top: 0, width: 120, height: 40 }),
            configurable: true,
        });
        buttonEl.releasePointerCapture = vi.fn();
        buttonEl.setPointerCapture = vi.fn();
        document.body.appendChild(buttonEl);

        const glass = createLiquidGlass(buttonEl, {
            engine: "css",
            interactive: true,
            draggable: true,
        });

        const pointerDown = new MouseEvent("pointerdown", { bubbles: true, clientX: 20, clientY: 20 });
        Object.defineProperty(pointerDown, "pointerId", { value: 7 });
        Object.defineProperty(pointerDown, "pointerType", { value: "touch" });
        buttonEl.dispatchEvent(pointerDown);

        const pointerMove = new MouseEvent("pointermove", { bubbles: true, clientX: 50, clientY: 20 });
        Object.defineProperty(pointerMove, "pointerId", { value: 7 });
        Object.defineProperty(pointerMove, "pointerType", { value: "touch" });
        buttonEl.dispatchEvent(pointerMove);

        expect(buttonEl.getAttribute("data-lg-dragging")).toBe("1");

        // Disabling interactive mid-drag must release pointer capture and strip dragging attr
        glass.update({ interactive: false });
        expect(buttonEl.hasAttribute("data-lg-dragging")).toBe(false);
        expect(buttonEl.releasePointerCapture).toHaveBeenCalledWith(7);

        glass.destroy();
    });

    it("steps down quality tier on repeated jank frames and locks to CSS on downgrade", () => {
        resetTelemetryForTesting();
        expect(qualityTier).toBe(0);
        recordJankFrame(1000);
        recordJankFrame(1200);
        recordJankFrame(1500);
        expect(qualityTier).toBe(1);
        downgradeLiquidGlass();
        expect(isGlassDowngraded).toBe(true);
        resetTelemetryForTesting();
    });

    it("attaches and detaches battery listeners cleanly without leaking", async () => {
        const addSpy = vi.fn();
        const removeSpy = vi.fn();
        const nav = navigator as unknown as { getBattery?: () => Promise<unknown> };
        nav.getBattery = vi.fn(() =>
            Promise.resolve({
                level: 0.15,
                charging: false,
                addEventListener: addSpy,
                removeEventListener: removeSpy,
            }),
        );
        attachGlobalListeners();
        await Promise.resolve();
        expect(addSpy).toHaveBeenCalledWith("levelchange", expect.any(Function));
        detachGlobalListeners();
        expect(removeSpy).toHaveBeenCalledWith("levelchange", expect.any(Function));
        resetObserverForTesting();
    });

    it("safely handles NaN in stepSpring and catches onRest errors during destroy", () => {
        const res = stepSpring(NaN, 0, 5, 0.016, { stiffness: 300, gamma: 10 });
        expect(res.value).toBe(5);
        expect(res.settled).toBe(true);

        const spring = createInteractiveSpring(
            () => {},
            () => {
                throw new Error("safe onRest test");
            },
        );
        expect(() => spring.destroy()).not.toThrow();
    });
});
