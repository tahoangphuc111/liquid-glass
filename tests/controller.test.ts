import { afterEach, describe, expect, it, vi } from "vitest";
import {
    GLASS_PRESETS,
    MAP_PRELOAD_TIMEOUT_MS,
    type LiquidGlassCustomElement,
    createLiquidGlass,
    destroyLiquidGlass,
    getLiquidGlassStats,
    initLiquidGlass,
    initWasmSimdModule,
    parseCssCornerRadiusPx,
    parseElementGlassAttributes,
    rebuildAllLiquidGlassFilters,
    registerLiquidGlassElement,
    requestDeviceTiltPermission,
    resolveGlassConfig,
    resolveGlassEngine,
} from "../src/index.js";
import { disconnectLoafTelemetry, initLoafTelemetry } from "../src/core/telemetry.js";
import { dirtyElements, elementStateMap, flushDirtyElements } from "../src/core/engine.js";
import {
    attachGlobalListeners,
    detachGlobalListeners,
    observeSharedElementResize,
    resetObserverForTesting,
} from "../src/core/observer.js";
import {
    createInteractiveSpring,
    quantizeSpringDtSeconds,
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
        vi.useRealTimers();
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

    it("cleans up SVG registration when onEngineChange destroys the controller", () => {
        setForcedChromium(true);
        const element = document.body.appendChild(document.createElement("div"));
        const glass = createLiquidGlass(element, { engine: "css" });
        try {
            glass.update({
                engine: "wasm-svg",
                onEngineChange(engine) {
                    if (engine === "wasm-svg") glass.destroy();
                },
            });
            expect(elementStateMap.has(element)).toBe(false);
            expect(element.hasAttribute("data-lg-engine")).toBe(false);
            expect(element.hasAttribute("data-lg-refraction-axis")).toBe(false);
        } finally {
            glass.destroy();
        }
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

    it("updates SVG saturation on the existing displacement map and restores automatic saturation", async () => {
        vi.useFakeTimers();
        setForcedChromium(true);
        const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:lg-saturation");
        vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
        const el = document.createElement("div");
        Object.defineProperties(el, {
            offsetWidth: { value: 187 },
            offsetHeight: { value: 83 },
        });
        document.body.append(el);

        const glass = createLiquidGlass(el, { engine: "wasm-svg", hollow: true, ior: 1.532 });
        await vi.advanceTimersByTimeAsync(MAP_PRELOAD_TIMEOUT_MS + 70);
        const filter = () => el.style.getPropertyValue("--lg-filter");
        const original = filter();
        const id = original.match(/url\(#[^)]+\)/)?.[0];
        expect(id).toBeTruthy();
        expect(original).toContain("saturate(200%)");
        const initialCreates = createObjectUrl.mock.calls.length;

        glass.update({ saturation: 0 });
        expect(filter()).toContain(`${id} saturate(0)`);
        expect(el.style.getPropertyValue("--lg-core-filter")).toContain("saturate(0)");
        glass.update({ saturation: undefined });
        expect(filter()).toBe(original);
        expect(createObjectUrl).toHaveBeenCalledTimes(initialCreates);
        glass.destroy();
    });

    it("keeps the current SVG map when a resize reverses before the new map decodes", async () => {
        vi.useFakeTimers();
        setForcedChromium(true);
        let mapId = 0;
        vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:lg-resize-${++mapId}`);
        vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

        let height = 24;
        const el = document.createElement("div");
        Object.defineProperties(el, {
            offsetWidth: { get: () => 147 },
            offsetHeight: { get: () => height },
        });
        document.body.append(el);
        const glass = createLiquidGlass(el, { engine: "wasm-svg", bezel: 40, ior: 1.647 });
        await vi.advanceTimersByTimeAsync(MAP_PRELOAD_TIMEOUT_MS + 70);
        const original = el.style.getPropertyValue("--lg-filter");
        expect(original).toContain("url(");

        height = 52;
        glass.refresh();
        height = 24;
        glass.refresh();
        await vi.advanceTimersByTimeAsync(MAP_PRELOAD_TIMEOUT_MS + 70);
        expect(el.style.getPropertyValue("--lg-filter")).toBe(original);
        glass.destroy();
    });

    it("drops unmatched pending SVG targets and keeps custom selectors when a controller mounts", async () => {
        vi.useFakeTimers();
        setForcedChromium(true);
        let mapId = 0;
        vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:lg-selector-${++mapId}`);
        vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
        const target = document.body.appendChild(document.createElement("div"));
        const controllerTarget = document.body.appendChild(document.createElement("div"));
        for (const element of [target, controllerTarget]) {
            vi.spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 130, 42));
        }
        target.className = "batch-target";
        initLiquidGlass([{ ...resolveGlassConfig({ blur: 3 }), selector: ".batch-target" }]);
        const controller = createLiquidGlass(controllerTarget, { engine: "wasm-svg" });
        try {
            rebuildAllLiquidGlassFilters();
            await vi.advanceTimersByTimeAsync(MAP_PRELOAD_TIMEOUT_MS + 40);
            expect(target.style.getPropertyValue("--lg-filter")).toContain("blur(3px)");

            rebuildAllLiquidGlassFilters([{ ...resolveGlassConfig({ blur: 4, thickness: 70 }), selector: ".batch-target" }]);
            rebuildAllLiquidGlassFilters([]);
            await vi.advanceTimersByTimeAsync(MAP_PRELOAD_TIMEOUT_MS + 40);
            expect(target.classList.contains("lg-on")).toBe(false);
            expect(target.style.getPropertyValue("--lg-filter")).toBe("");
            expect(controllerTarget.style.getPropertyValue("--lg-filter")).toContain("url(");
        } finally {
            controller.destroy();
        }
    });

    it("keeps newer SVG options when a queued rebuild yields", async () => {
        vi.useFakeTimers();
        setForcedChromium(true);
        let mapId = 0;
        vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:lg-yield-${++mapId}`);
        vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
        let resume: (() => void) | undefined;
        vi.stubGlobal("scheduler", {
            yield: () => new Promise<void>((resolve) => { resume = resolve; }),
        });
        const targets = Array.from({ length: 5 }, () => {
            const target = document.body.appendChild(document.createElement("div"));
            target.className = "yield-target";
            vi.spyOn(target, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 130, 42));
            return target;
        });
        const config = { ...resolveGlassConfig({ blur: 3 }), selector: ".yield-target" };
        try {
            initLiquidGlass([config]);
            for (const target of targets) dirtyElements.add(target);
            const flush = flushDirtyElements();
            expect(resume).toBeTypeOf("function");

            initLiquidGlass([{ ...config, blur: 9 }]);
            resume?.();
            await flush;
            await vi.advanceTimersByTimeAsync(MAP_PRELOAD_TIMEOUT_MS + 40);
            expect(targets[4]?.style.getPropertyValue("--lg-filter")).toContain("blur(9px)");
        } finally {
            vi.unstubAllGlobals();
        }
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
        expect(targetEl.style.getPropertyValue("--lg-filter")).toBe("blur(0.0px)");

        glass.update({ pill: true, blur: 0.6 });
        expect(targetEl.getAttribute("data-lg-pill")).toBe("true");
        expect(targetEl.style.getPropertyValue("--lg-radius")).toBe("");
        expect(targetEl.style.getPropertyValue("--lg-filter")).toBe("blur(2.1px)");

        glass.update({ blur: 2 });
        expect(targetEl.style.getPropertyValue("--lg-filter")).toBe("blur(7.0px) saturate(180%)");

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

    it("keeps the rim highlight continuous when a held button is released", () => {
        vi.useFakeTimers();
        const button = document.body.appendChild(document.createElement("button"));
        const glass = createLiquidGlass(button, { engine: "css" });
        const readGlow = () => Number(button.style.getPropertyValue("--lg-press-glow"));

        try {
            button.dispatchEvent(new MouseEvent("pointerdown"));
            vi.advanceTimersByTime(300);
            const heldGlow = readGlow();
            expect(heldGlow).toBeGreaterThan(0.08);

            button.dispatchEvent(new MouseEvent("pointerup"));
            vi.advanceTimersByTime(16);
            expect(readGlow()).toBeGreaterThan(heldGlow * 0.75);
            vi.advanceTimersByTime(600);
            expect(readGlow()).toBe(0);
        } finally {
            glass.destroy();
            vi.useRealTimers();
        }
    });

    it("finishes glass drags outside the element when pointer capture fails or drag mode changes", () => {
        const button = document.body.appendChild(document.createElement("button"));
        const onDragChange = vi.fn();
        const glass = createLiquidGlass(button, { engine: "css", pill: true, draggable: "free", onDragChange });
        const dispatch = (target: EventTarget, type: string, clientX: number, pointerId = 7) => {
            const event = new MouseEvent(type, { bubbles: true, clientX });
            Object.defineProperty(event, "pointerId", { value: pointerId });
            target.dispatchEvent(event);
        };

        try {
            dispatch(button, "pointerdown", 10);
            dispatch(document.body, "pointermove", 35);
            expect(button.getAttribute("data-lg-dragging")).toBe("1");
            dispatch(document.body, "pointerup", 35, 8);
            expect(button.getAttribute("data-lg-dragging")).toBe("1");
            dispatch(document.body, "pointerup", 35);
            expect(button.hasAttribute("data-lg-dragging")).toBe(false);
            expect(onDragChange).toHaveBeenLastCalledWith(expect.any(Number), expect.any(Number), false);

            dispatch(button, "pointerdown", 10);
            dispatch(document.body, "pointermove", 35);
            glass.update({ draggable: "elastic" });
            expect(button.hasAttribute("data-lg-dragging")).toBe(false);
            expect(onDragChange).toHaveBeenLastCalledWith(0, 0, false);
            onDragChange.mockClear();
            dispatch(document.body, "pointermove", 60);
            expect(onDragChange).not.toHaveBeenCalled();
        } finally {
            glass.destroy();
        }
        expect(button.classList.contains("lg-surface")).toBe(false);
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

        const pointerDown1 = new MouseEvent("pointerdown", { bubbles: true, clientX: 20, clientY: 20 });
        Object.defineProperty(pointerDown1, "pointerId", { value: 1 });
        Object.defineProperty(pointerDown1, "pointerType", { value: "touch" });
        buttonEl.dispatchEvent(pointerDown1);

        const pointerDown2 = new MouseEvent("pointerdown", { bubbles: true, clientX: 50, clientY: 50 });
        Object.defineProperty(pointerDown2, "pointerId", { value: 2 });
        Object.defineProperty(pointerDown2, "pointerType", { value: "touch" });
        buttonEl.dispatchEvent(pointerDown2);

        const pointerMove1 = new MouseEvent("pointermove", { bubbles: true, clientX: 40, clientY: 20 });
        Object.defineProperty(pointerMove1, "pointerId", { value: 1 });
        Object.defineProperty(pointerMove1, "pointerType", { value: "touch" });
        buttonEl.dispatchEvent(pointerMove1);

        expect(buttonEl.getAttribute("data-lg-dragging")).toBe("1");

        const pointerUp2 = new MouseEvent("pointerup", { bubbles: true, clientX: 50, clientY: 50 });
        Object.defineProperty(pointerUp2, "pointerId", { value: 2 });
        Object.defineProperty(pointerUp2, "pointerType", { value: "touch" });
        buttonEl.dispatchEvent(pointerUp2);

        expect(buttonEl.getAttribute("data-lg-dragging")).toBe("1");

        const pointerUp1 = new MouseEvent("pointerup", { bubbles: true, clientX: 40, clientY: 20 });
        Object.defineProperty(pointerUp1, "pointerId", { value: 1 });
        Object.defineProperty(pointerUp1, "pointerType", { value: "touch" });
        buttonEl.dispatchEvent(pointerUp1);

        expect(buttonEl.hasAttribute("data-lg-dragging")).toBe(false);

        buttonGlass.destroy();
    });

    it("transitions bidirectionally between WebGL and CSS on dynamic setSceneCanvas in auto mode", () => {
        vi.useFakeTimers();
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
            value: () => ({ left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 }),
            configurable: true,
        });
        document.body.appendChild(targetEl);

        const glass = createLiquidGlass(targetEl, {
            engine: "auto",
        });

        expect(glass.engine).toBe("css");

        const sceneCanvas = document.createElement("canvas");
        sceneCanvas.width = 200;
        sceneCanvas.height = 80;

        glass.setSceneCanvas(sceneCanvas);
        expect(glass.engine).toBe("webgl");
        const replacementCanvas = document.createElement("canvas");
        glass.setSceneCanvas(replacementCanvas);
        glass.setSceneCanvas(replacementCanvas);
        expect(mockGl.texImage2D).not.toHaveBeenCalled();
        vi.advanceTimersByTime(16);
        const sceneUploads = mockGl.texImage2D.mock.calls.filter((args) => args.length === 6);
        expect(sceneUploads).toHaveLength(1);
        expect((sceneUploads[0] as unknown[] | undefined)?.[5]).toBe(replacementCanvas);

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
        recordJankFrame(1600);
        expect(qualityTier).toBe(1);
        recordJankFrame(1700);
        recordJankFrame(1800);
        expect(qualityTier).toBe(2);
        downgradeLiquidGlass();
        expect(isGlassDowngraded).toBe(true);
        resetTelemetryForTesting();
    });

    it("recovers one tier at a time after the last jank, including at the lowest tier", () => {
        vi.useFakeTimers();
        [100, 200, 300, 400, 500, 600].forEach(recordJankFrame);
        expect(qualityTier).toBe(2);
        vi.advanceTimersByTime(2500);
        recordJankFrame(3100);
        vi.advanceTimersByTime(2999);
        expect(qualityTier).toBe(2);
        vi.advanceTimersByTime(1);
        expect(qualityTier).toBe(1);
        vi.advanceTimersByTime(3000);
        expect(qualityTier).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("clears sceneElement fallback when setSceneCanvas(null, null) is called and aborts drag when draggable becomes false", () => {
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

        const sceneEl = document.createElement("div");
        const boxEl = document.createElement("button");
        Object.defineProperty(boxEl, "getBoundingClientRect", {
            value: () => ({ left: 0, top: 0, width: 120, height: 40, right: 120, bottom: 40 }),
            configurable: true,
        });
        boxEl.releasePointerCapture = vi.fn();
        boxEl.setPointerCapture = vi.fn();
        document.body.append(sceneEl, boxEl);

        const glass = createLiquidGlass(boxEl, {
            engine: "auto",
            sceneElement: sceneEl,
            draggable: true,
        });
        expect(glass.engine).toBe("webgl");

        glass.setSceneCanvas(null, null);
        expect(glass.engine).toBe("css");

        const down = new MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 });
        Object.defineProperty(down, "pointerId", { value: 9 });
        Object.defineProperty(down, "pointerType", { value: "touch" });
        boxEl.dispatchEvent(down);

        const move = new MouseEvent("pointermove", { bubbles: true, clientX: 40, clientY: 10 });
        Object.defineProperty(move, "pointerId", { value: 9 });
        Object.defineProperty(move, "pointerType", { value: "touch" });
        boxEl.dispatchEvent(move);
        expect(boxEl.getAttribute("data-lg-dragging")).toBe("1");

        glass.update({ draggable: false });
        expect(boxEl.hasAttribute("data-lg-dragging")).toBe(false);
        expect(boxEl.releasePointerCapture).toHaveBeenCalledWith(9);

        glass.destroy();
    });

    it("attaches and detaches battery listeners cleanly without leaking", async () => {
        const addSpy = vi.fn();
        const removeSpy = vi.fn();
        const nav = navigator as unknown as { getBattery?: () => Promise<unknown> };
        const originalGetBattery = nav.getBattery;
        nav.getBattery = vi.fn(() =>
            Promise.resolve({
                level: 0.15,
                charging: false,
                addEventListener: addSpy,
                removeEventListener: removeSpy,
            }),
        );
        try {
            attachGlobalListeners();
            await Promise.resolve();
            expect(addSpy).toHaveBeenCalledWith("levelchange", expect.any(Function));
            detachGlobalListeners();
            expect(removeSpy).toHaveBeenCalledWith("levelchange", expect.any(Function));
        } finally {
            if (originalGetBattery === undefined) delete nav.getBattery;
            else nav.getBattery = originalGetBattery;
            resetObserverForTesting();
        }
    });

    it("switches to CSS on low battery and restores SVG when charging resumes", async () => {
        setForcedChromium(true);
        const battery = Object.assign(new EventTarget(), { level: 0.8, charging: false });
        const nav = navigator as Navigator & { getBattery?: () => Promise<EventTarget> };
        const originalGetBattery = nav.getBattery;
        nav.getBattery = async () => battery;
        const target = document.body.appendChild(document.createElement("div"));
        const instance = createLiquidGlass(target, { engine: "wasm-svg" });
        try {
            await Promise.resolve();
            expect(instance.engine).toBe("wasm-svg");
            battery.level = 0.15;
            battery.dispatchEvent(new Event("levelchange"));
            expect(instance.engine).toBe("css");

            battery.charging = true;
            battery.dispatchEvent(new Event("chargingchange"));
            expect(instance.engine).toBe("wasm-svg");
        } finally {
            instance.destroy();
            if (originalGetBattery) nav.getBattery = originalGetBattery;
            else delete nav.getBattery;
        }
    });

    it("settles an elastic spring at a nonzero programmatic drag offset", () => {
        vi.useFakeTimers();
        const onRest = vi.fn();
        const spring = createInteractiveSpring(() => {}, onRest);
        try {
            spring.setDrag(3, -2);
            vi.advanceTimersByTime(1500);
            expect(onRest).toHaveBeenCalledOnce();
        } finally {
            spring.destroy();
        }
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

    it("quantizes spring step dt and caches repeated propagator evaluations without writing redundant CSS vars", () => {
        expect(quantizeSpringDtSeconds(16.6)).toBeCloseTo(0.0165, 6);
        expect(quantizeSpringDtSeconds(16.7)).toBeCloseTo(0.0165, 6);
        expect(quantizeSpringDtSeconds(0.1)).toBeCloseTo(0.001, 6);
        expect(quantizeSpringDtSeconds(80)).toBeCloseTo(0.032, 6);

        const params = { stiffness: 320, gamma: 16 };
        const first = stepSpring(0.5, 0.2, 0, 0.0165, params);
        const second = stepSpring(0.5, 0.2, 0, 0.0165, params);
        expect(second).toEqual(first);

        vi.useFakeTimers();
        const card = document.createElement("div");
        document.body.appendChild(card);
        const setPropSpy = vi.spyOn(card.style, "setProperty");

        const glass = createLiquidGlass(card, { engine: "css", interactive: true });
        setPropSpy.mockClear();

        card.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
        vi.advanceTimersByTime(16);
        const dragPropWrites = setPropSpy.mock.calls.filter(
            ([propName]) => propName === "--lg-drag-x" || propName === "--lg-drag-y",
        );
        expect(dragPropWrites).toHaveLength(2);

        vi.advanceTimersByTime(32);
        const subsequentDragWrites = setPropSpy.mock.calls.filter(
            ([propName]) => propName === "--lg-drag-x" || propName === "--lg-drag-y",
        );
        expect(subsequentDragWrites).toHaveLength(2);

        glass.destroy();
        vi.useRealTimers();
    });

    it("supports extended material presets, circular-only free drag bounds, CSS light-tilt angle, gyro helper, and <liquid-glass> custom element", async () => {
        expect(GLASS_PRESETS.prism.abbeNumber).toBe(25.8);
        expect(GLASS_PRESETS.diamond.ior).toBe(2.417);
        expect(GLASS_PRESETS.smoke.tintColor).toBe("rgba(18, 22, 32, 1)");
        expect(GLASS_PRESETS.ice.ior).toBe(1.309);
        const crystalConfig = resolveGlassConfig({ preset: "crystal", blur: 7 });
        expect(crystalConfig.abbeNumber).toBe(28);
        expect(crystalConfig.blur).toBe(7);

        expect(parseCssCornerRadiusPx("50% 10px", 100, 60)).toBe(10);
        expect(parseCssCornerRadiusPx("25%", 100, 80)).toBe(20);

        const attrEl = document.createElement("div");
        attrEl.setAttribute("data-lg-preset", "prism");
        attrEl.setAttribute("data-lg-draggable", "free");
        attrEl.setAttribute("data-lg-drag-bounds", "viewport");
        attrEl.setAttribute("data-lg-light-tilt", "0.5,-0.25");
        attrEl.setAttribute("data-lg-coalesce", "false");
        const parsedAttrs = parseElementGlassAttributes(attrEl);
        expect(parsedAttrs).toMatchObject({
            preset: "prism",
            draggable: "free",
            dragBounds: "viewport",
            lightTilt: { horizontal: 0.5, vertical: -0.25 },
            coalesce: false,
        });

        const panel = document.createElement("div");
        const rectBtn = document.createElement("button");
        const circleBtn = document.createElement("button");
        document.body.append(panel, rectBtn, circleBtn);
        vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 180, 90));
        vi.spyOn(rectBtn, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 220, 160, 60));
        vi.spyOn(circleBtn, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 300, 56, 56));

        const panelInst = createLiquidGlass(panel, { engine: "css", draggable: "free" });
        expect(panel.hasAttribute("data-lg-draggable")).toBe(false);
        panelInst.setDragOffset?.(20, 20, false);
        expect(panel.style.getPropertyValue("--lg-drag-x")).toBe("");
        panelInst.destroy();

        const rectInst = createLiquidGlass(rectBtn, { engine: "css", radius: 6, draggable: "free" });
        expect(rectBtn.hasAttribute("data-lg-draggable")).toBe(false);
        rectInst.destroy();

        const dragEvents: Array<[number, number, boolean]> = [];
        const circleInst = createLiquidGlass(circleBtn, {
            engine: "css",
            preset: "diamond",
            pill: true,
            draggable: "free",
            onDragChange: (x, y, dragging) => dragEvents.push([x, y, dragging]),
        });
        expect(circleBtn.getAttribute("data-lg-draggable")).toBe("free");
        circleInst.setDragOffset?.(250, -100, false);
        expect(circleBtn.style.getPropertyValue("--lg-drag-x")).toBe("24.00px");
        expect(circleBtn.style.getPropertyValue("--lg-drag-y")).toBe("-24.00px");
        expect(dragEvents.at(-1)).toEqual([24, -24, false]);

        circleInst.update({ dragBounds: { minX: -50, maxX: 60, minY: -30, maxY: 40 } });
        circleInst.setDragOffset?.(250, -100, false);
        expect(circleBtn.style.getPropertyValue("--lg-drag-x")).toBe("60.00px");
        expect(circleBtn.style.getPropertyValue("--lg-drag-y")).toBe("-30.00px");

        circleInst.setLightTilt?.(0.6, 0.2);
        expect(circleBtn.style.getPropertyValue("--lg-light-x")).toBe("0.600");
        const lightAngle = Number.parseFloat(circleBtn.style.getPropertyValue("--lg-light-angle"));
        expect(lightAngle).toBeGreaterThan(180);
        expect(lightAngle).toBeLessThan(208);

        circleInst.destroy();
        expect(circleBtn.style.getPropertyValue("--lg-light-angle")).toBe("");
        expect(circleBtn.style.getPropertyValue("--lg-drag-x")).toBe("");

        (window as unknown as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent = {
            requestPermission: vi.fn().mockResolvedValue("granted"),
        };
        expect(await requestDeviceTiltPermission()).toBe(true);
        (window as unknown as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent = {
            requestPermission: vi.fn().mockResolvedValue("denied"),
        };
        expect(await requestDeviceTiltPermission()).toBe(false);

        expect(registerLiquidGlassElement("liquid-glass-test")).toBe(true);
        const customEl = document.createElement("liquid-glass-test") as LiquidGlassCustomElement & {
            connectedCallback(): void;
        };
        customEl.setAttribute("role", "button");
        customEl.setAttribute("pill", "true");
        customEl.setAttribute("engine", "css");
        customEl.setAttribute("preset", "prism");
        customEl.setAttribute("corner-style", "squircle");
        customEl.setAttribute("draggable", "free");
        document.body.appendChild(customEl);
        const firstCustomInstance = customEl.glassInstance!;
        expect(firstCustomInstance).not.toBeNull();
        expect(customEl.getAttribute("data-lg-draggable")).toBe("free");
        customEl.removeAttribute("corner-style");
        expect(customEl.getAttribute("data-lg-corner-style")).toBeNull();
        customEl.setDragOffset(35, -15, false);
        expect(customEl.style.getPropertyValue("--lg-drag-x")).toBe("24.00px");
        customEl.connectedCallback();
        expect(customEl.glassInstance).not.toBe(firstCustomInstance);
        customEl.remove();
        expect(customEl.glassInstance).toBeNull();
    });

    it("prevents initLiquidGlass rebuilds from hijacking controller-owned elements, avoids double onWasmReady, and guards hidden LoAF telemetry", async () => {
        const originalHidden = Object.getOwnPropertyDescriptor(document, "hidden");
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        let observerCb: ((list: { getEntries: () => unknown[] }) => void) | null = null;
        vi.stubGlobal(
            "PerformanceObserver",
            class {
                static supportedEntryTypes = ["long-animation-frame"];
                constructor(cb: (list: { getEntries: () => unknown[] }) => void) {
                    observerCb = cb;
                }
                observe() {}
                disconnect() {}
            },
        );
        initLoafTelemetry();
        for (let i = 0; i < 4; i++) {
            observerCb!({ getEntries: () => [{ duration: 120, blockingDuration: 80, startTime: i * 100 }] });
        }
        expect(qualityTier).toBe(0);
        if (originalHidden) Object.defineProperty(document, "hidden", originalHidden);
        else delete (document as { hidden?: boolean }).hidden;
        vi.unstubAllGlobals();

        initWasmSimdModule();
        setForcedChromium(true);
        const origCreateUrl = URL.createObjectURL;
        const origRevokeUrl = URL.revokeObjectURL;
        let nextBlobId = 1;
        URL.createObjectURL = vi.fn(() => `blob:mock-${nextBlobId++}`);
        URL.revokeObjectURL = vi.fn();
        vi.stubGlobal(
            "Image",
            class {
                decoding = "";
                onload: (() => void) | null = null;
                onerror: (() => void) | null = null;
                set src(_val: string) {
                    queueMicrotask(() => this.onload?.());
                }
                removeAttribute() {}
                decode() {
                    return Promise.resolve();
                }
            },
        );

        try {
            const engineCalls: string[] = [];
            const cssBtn = document.createElement("button");
            const customAuto = document.createElement("div");
            customAuto.className = "custom-auto-glass";
            customAuto.setAttribute("data-lg-preset", "crystal");
            customAuto.setAttribute("data-lg-blur", "6");
            document.body.append(cssBtn, customAuto);
            vi.spyOn(cssBtn, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 120, 40));
            vi.spyOn(customAuto, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 60, 160, 80));

            const cssCtrl = createLiquidGlass(cssBtn, {
                engine: "css",
                lightTilt: "pointer",
                tintColor: "rgb(10, 20, 30)",
                tintOpacity: 0.4,
                onEngineChange: (eng) => engineCalls.push(eng),
            });
            expect(engineCalls).toEqual(["css"]);
            expect(cssBtn.style.getPropertyValue("--lg-tint")).toBe("rgba(10, 20, 30, 0.4)");
            window.dispatchEvent(new MouseEvent("pointermove", { clientX: window.innerWidth, clientY: 0 }));

            const customConfig = resolveGlassConfig({ surface: "lip", thickness: 77 });
            customConfig.selector = ".custom-auto-glass";
            initLiquidGlass([customConfig]);
            await new Promise((resolve) => setTimeout(resolve, 25));
            expect(getLiquidGlassStats().activeElements).toBe(1);
            expect(customAuto.style.getPropertyValue("--lg-filter")).toContain("blur(6px)");

            rebuildAllLiquidGlassFilters();
            await new Promise((resolve) => setTimeout(resolve, 25));
            expect(cssBtn.getAttribute("data-lg-engine")).toBe("css");
            expect(cssBtn.style.getPropertyValue("--lg-filter")).not.toContain("url(#");
            expect(getLiquidGlassStats().activeElements).toBe(1);

            cssCtrl.destroy();
        } finally {
            destroyLiquidGlass();
            vi.unstubAllGlobals();
            URL.createObjectURL = origCreateUrl;
            URL.revokeObjectURL = origRevokeUrl;
        }
    });

    it("avoids layout/style queries on hover pointermove, resumes telemetry recovery after blur, and avoids out-of-order jank misfires", () => {
        const button = document.createElement("button");
        document.body.appendChild(button);
        const rectSpy = vi.spyOn(button, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 10, 120, 44));
        const styleSpy = vi.spyOn(window, "getComputedStyle");

        const inst = createLiquidGlass(button, { engine: "css", interactive: true });
        rectSpy.mockClear();
        styleSpy.mockClear();

        for (let step = 0; step < 5; step++) {
            button.dispatchEvent(
                new MouseEvent("pointermove", { bubbles: true, clientX: 20 + step * 10, clientY: 24 }),
            );
        }
        expect(rectSpy).toHaveBeenCalledTimes(1);
        expect(styleSpy).not.toHaveBeenCalled();
        inst.destroy();

        vi.useFakeTimers();
        resetTelemetryForTesting();
        recordJankFrame(2000);
        recordJankFrame(100);
        recordJankFrame(150);
        expect(qualityTier).toBe(0);

        recordJankFrame(2200);
        recordJankFrame(2300);
        expect(qualityTier).toBe(1);
        disconnectLoafTelemetry();
        vi.advanceTimersByTime(5000);
        expect(qualityTier).toBe(1);
        initLoafTelemetry();
        vi.advanceTimersByTime(3100);
        expect(qualityTier).toBe(0);
        resetTelemetryForTesting();
        vi.useRealTimers();
    });

    it("resolves light and dark theme via theme option and auto document detection", () => {
        const el = document.createElement("div");
        document.body.appendChild(el);

        const inst = createLiquidGlass(el, { engine: "css" });
        expect(el.getAttribute("data-lg-theme")).toBe("light");

        document.documentElement.classList.add("dark");
        inst.refresh();
        expect(el.getAttribute("data-lg-theme")).toBe("dark");

        inst.update({ theme: "light" });
        expect(el.getAttribute("data-lg-theme")).toBe("light");

        inst.update({ theme: "dark" });
        expect(el.getAttribute("data-lg-theme")).toBe("dark");

        document.documentElement.classList.remove("dark");
        inst.update({ theme: "auto" });
        expect(el.getAttribute("data-lg-theme")).toBe("light");

        inst.destroy();
        expect(el.hasAttribute("data-lg-theme")).toBe(false);
    });

    it("restores coalescence attributes after toggling coalesce off and back on", () => {
        const first = document.createElement("div");
        const second = document.createElement("div");
        document.body.append(first, second);
        vi.spyOn(first, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 80, 40));
        vi.spyOn(second, "getBoundingClientRect").mockReturnValue(new DOMRect(190, 100, 80, 40));

        const instA = createLiquidGlass(first, { engine: "css", coalesce: true });
        const instB = createLiquidGlass(second, { engine: "css", coalesce: true });

        expect(first.getAttribute("data-lg-coalescing")).toBe("1");
        expect(first.style.getPropertyValue("--lg-bleed")).not.toBe("");

        instA.update({ coalesce: false });
        expect(first.hasAttribute("data-lg-coalescing")).toBe(false);
        expect(first.style.getPropertyValue("--lg-bleed")).toBe("");

        instA.update({ coalesce: true });
        expect(first.getAttribute("data-lg-coalescing")).toBe("1");
        expect(first.style.getPropertyValue("--lg-bleed")).not.toBe("");

        instA.destroy();
        instB.destroy();
    });

    it("re-observes active resize targets when ResizeObserver constructor changes", () => {
        const firstEl = document.createElement("div");
        const secondEl = document.createElement("div");
        document.body.append(firstEl, secondEl);

        const observedByFirst = new Set<Element>();
        const observedBySecond = new Set<Element>();
        const secondCallbacks: ResizeObserverCallback[] = [];

        class MockResizeObserverA {
            observe(target: Element) {
                observedByFirst.add(target);
            }
            unobserve(target: Element) {
                observedByFirst.delete(target);
            }
            disconnect() {
                observedByFirst.clear();
            }
        }
        class MockResizeObserverB {
            constructor(cb: ResizeObserverCallback) {
                secondCallbacks.push(cb);
            }
            observe(target: Element) {
                observedBySecond.add(target);
            }
            unobserve(target: Element) {
                observedBySecond.delete(target);
            }
            disconnect() {
                observedBySecond.clear();
            }
        }

        const firstCb = vi.fn();
        const secondCb = vi.fn();
        vi.stubGlobal("ResizeObserver", MockResizeObserverA);
        const stopFirst = observeSharedElementResize(firstEl, firstCb);
        expect(observedByFirst.has(firstEl)).toBe(true);

        vi.stubGlobal("ResizeObserver", MockResizeObserverB);
        const stopSecond = observeSharedElementResize(secondEl, secondCb);
        expect(observedBySecond.has(firstEl)).toBe(true);
        expect(observedBySecond.has(secondEl)).toBe(true);

        secondCallbacks[0]?.(
            [{ target: firstEl } as unknown as ResizeObserverEntry],
            {} as ResizeObserver,
        );
        expect(firstCb).toHaveBeenCalledTimes(1);

        stopFirst();
        stopSecond();
        vi.unstubAllGlobals();
    });

    it("detects GPU-bound long animation frames without main-thread blocking and updates chromatic SVG filters in place", async () => {
        resetTelemetryForTesting();
        let observerCb: ((list: { getEntries: () => unknown[] }) => void) | null = null;
        vi.stubGlobal(
            "PerformanceObserver",
            class {
                static supportedEntryTypes = ["long-animation-frame"];
                constructor(cb: (list: { getEntries: () => unknown[] }) => void) {
                    observerCb = cb;
                }
                observe() {}
                disconnect() {}
            },
        );
        initLoafTelemetry();
        for (let idx = 0; idx < 3; idx += 1) {
            observerCb!({ getEntries: () => [{ duration: 96, blockingDuration: 0, startTime: idx * 120 }] });
        }
        expect(qualityTier).toBe(1);
        resetTelemetryForTesting();
        vi.unstubAllGlobals();

        initWasmSimdModule();
        setForcedChromium(true);
        const origCreateUrl = URL.createObjectURL;
        const origRevokeUrl = URL.revokeObjectURL;
        let nextBlobId = 1;
        URL.createObjectURL = vi.fn(() => `blob:mock-chroma-inplace-${nextBlobId++}`);
        URL.revokeObjectURL = vi.fn();
        vi.stubGlobal(
            "Image",
            class {
                decoding = "";
                onload: (() => void) | null = null;
                onerror: (() => void) | null = null;
                set src(_val: string) {
                    queueMicrotask(() => this.onload?.());
                }
                removeAttribute() {}
                decode() {
                    return Promise.resolve();
                }
            },
        );

        const el = document.createElement("div");
        Object.defineProperty(el, "offsetWidth", { value: 220, configurable: true });
        Object.defineProperty(el, "offsetHeight", { value: 72, configurable: true });
        document.body.appendChild(el);

        const instance = createLiquidGlass(el, {
            engine: "wasm-svg",
            alwaysOn: true,
            blur: 2,
            chromaticAberration: 0.2,
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        const initialFilterVal = el.style.getPropertyValue("--lg-filter");
        const initialFilterId = initialFilterVal.match(/url\(#([^)]+)\)/)?.[1];
        expect(initialFilterId).toBeTruthy();
        const initialFilterNode = document.getElementById(initialFilterId!);
        expect(initialFilterNode).not.toBeNull();
        const initialWarmScale = initialFilterNode!
            .querySelectorAll("feDisplacementMap")[0]!
            .getAttribute("scale");

        const computedStyleSpy = vi.spyOn(window, "getComputedStyle");
        const rafSpy = vi.spyOn(window, "requestAnimationFrame");
        instance.update({ chromaticAberration: 0.7 });
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(el.style.getPropertyValue("--lg-filter")).toBe(initialFilterVal);
        expect(document.getElementById(initialFilterId!)).toBe(initialFilterNode);
        const updatedWarmScale = initialFilterNode!
            .querySelectorAll("feDisplacementMap")[0]!
            .getAttribute("scale");
        expect(updatedWarmScale).not.toBe(initialWarmScale);
        expect(computedStyleSpy).not.toHaveBeenCalled();
        expect(rafSpy).not.toHaveBeenCalled();

        instance.destroy();
        el.remove();
        URL.createObjectURL = origCreateUrl;
        URL.revokeObjectURL = origRevokeUrl;
        vi.unstubAllGlobals();
        setForcedChromium(undefined);
    });
});
