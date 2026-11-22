import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlassSlider, createLiquidGlass, destroyLiquidGlass } from "../src/index.js";
import * as renderBudget from "../src/core/renderBudget.js";
import { createInteractiveSpring } from "../src/core/spring.js";
import {
    acquireWebglSlot,
    getWebglPoolStats,
    releaseWebglSlot,
    resetWebglPoolForTesting,
    setMaxActiveWebglContextsForTesting,
} from "../src/core/webglPool.js";
import { GlassWebglRenderer, parseCssColorToRgb } from "../src/core/webglRenderer.js";

function createMockGl() {
    const uniforms = new Map<string, number>();
    let nextLocId = 1;
    const uniform2fCalls: Array<{ name: string; x: number; y: number }> = [];
    const uniform1fCalls: Array<{ name: string; val: number }> = [];
    const locNames = new Map<number, string>();

    const gl = {
        VERTEX_SHADER: 0x8b31,
        FRAGMENT_SHADER: 0x8b30,
        COMPILE_STATUS: 0x8b81,
        LINK_STATUS: 0x8b82,
        ARRAY_BUFFER: 0x8892,
        STATIC_DRAW: 0x88e4,
        FLOAT: 0x1406,
        HALF_FLOAT: 0x140b,
        UNSIGNED_BYTE: 0x1401,
        TRIANGLES: 0x0004,
        TEXTURE0: 0x84c0,
        TEXTURE1: 0x84c1,
        TEXTURE2: 0x84c2,
        TEXTURE3: 0x84c3,
        TEXTURE_2D: 0x0de1,
        RGBA: 0x1908,
        RGBA32F: 0x8814,
        RGBA16F: 0x881a,
        TEXTURE_WRAP_S: 0x2802,
        TEXTURE_WRAP_T: 0x2803,
        TEXTURE_MIN_FILTER: 0x2801,
        TEXTURE_MAG_FILTER: 0x2800,
        CLAMP_TO_EDGE: 0x812f,
        LINEAR: 0x2601,
        NEAREST: 0x2600,
        MAX_VIEWPORT_DIMS: 0x0d3a,
        MAX_TEXTURE_SIZE: 0x0d33,
        UNPACK_FLIP_Y_WEBGL: 0x9240,
        UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
        FRAMEBUFFER: 0x8d40,
        FRAMEBUFFER_COMPLETE: 0x8cd5,
        COLOR_ATTACHMENT0: 0x8ce0,
        COLOR_ATTACHMENT1: 0x8ce1,
        NO_ERROR: 0,
        getParameter: vi.fn((param: number) =>
            param === 0x0d3a ? new Int32Array([4096, 4096]) : 4096,
        ),
        getExtension: vi.fn(() => ({})),
        createShader: vi.fn(() => ({})),
        shaderSource: vi.fn(),
        compileShader: vi.fn(),
        getShaderParameter: vi.fn(() => true),
        deleteShader: vi.fn(),
        createProgram: vi.fn(() => ({})),
        attachShader: vi.fn(),
        bindAttribLocation: vi.fn(),
        linkProgram: vi.fn(),
        getProgramParameter: vi.fn(() => true),
        deleteProgram: vi.fn(),
        useProgram: vi.fn(),
        createBuffer: vi.fn(() => ({})),
        bindBuffer: vi.fn(),
        bufferData: vi.fn(),
        deleteBuffer: vi.fn(),
        getAttribLocation: vi.fn(() => 0),
        enableVertexAttribArray: vi.fn(),
        vertexAttribPointer: vi.fn(),
        getUniformLocation: vi.fn((_prog: unknown, name: string) => {
            const loc = uniforms.get(name) ?? nextLocId++;
            uniforms.set(name, loc);
            locNames.set(loc, name);
            return loc as unknown as WebGLUniformLocation;
        }),
        activeTexture: vi.fn(),
        createTexture: vi.fn(() => ({})),
        bindTexture: vi.fn(),
        pixelStorei: vi.fn(),
        texParameteri: vi.fn(),
        texImage2D: vi.fn(),
        deleteTexture: vi.fn(),
        createFramebuffer: vi.fn(() => ({})),
        bindFramebuffer: vi.fn(),
        framebufferTexture2D: vi.fn(),
        drawBuffers: vi.fn(),
        checkFramebufferStatus: vi.fn(() => 0x8cd5),
        deleteFramebuffer: vi.fn(),
        getError: vi.fn(() => 0),
        uniform1i: vi.fn(),
        uniform1f: vi.fn((loc: unknown, val: number) => {
            uniform1fCalls.push({
                name: locNames.get(loc as number) ?? "unknown",
                val,
            });
        }),
        uniform2f: vi.fn((loc: unknown, horizontal: number, vertical: number) => {
            uniform2fCalls.push({
                name: locNames.get(loc as number) ?? "unknown",
                x: horizontal,
                y: vertical,
            });
        }),
        uniform4f: vi.fn(),
        viewport: vi.fn(),
        drawArrays: vi.fn(),
    } as unknown as WebGL2RenderingContext;

    return { gl, uniform2fCalls, uniform1fCalls };
}

function setBox(el: HTMLElement, width: number, height: number, left = 0, top = 0) {
    Object.defineProperty(el, "offsetWidth", { value: width, configurable: true });
    Object.defineProperty(el, "offsetHeight", { value: height, configurable: true });
    Object.defineProperty(el, "getBoundingClientRect", {
        configurable: true,
        value: () => ({
            width,
            height,
            left,
            top,
            right: left + width,
            bottom: top + height,
            x: left,
            y: top,
            toJSON: () => ({}),
        }),
    });
}

describe("WebGL pool, dynamic light tilt, and Kawase blur", () => {
    const originalIntersectionObserver = globalThis.IntersectionObserver;

    afterEach(() => {
        destroyLiquidGlass();
        document.body.innerHTML = "";
        globalThis.IntersectionObserver = originalIntersectionObserver;
        vi.restoreAllMocks();
        resetWebglPoolForTesting();
    });

    it("enforces the WebGL context budget, evicts offscreen slots, and restores visible CSS standbys", () => {
        vi.spyOn(renderBudget, "useSmallMemoryBudget").mockReturnValue(false);
        setMaxActiveWebglContextsForTesting(2);
        let ioCallback: IntersectionObserverCallback | null = null;
        class MockIo {
            constructor(callback: IntersectionObserverCallback) {
                ioCallback = callback;
            }
            observe = vi.fn();
            unobserve = vi.fn();
            disconnect = vi.fn();
            takeRecords = vi.fn(() => []);
            root = null;
            rootMargin = "120px";
            thresholds = [0];
        }
        globalThis.IntersectionObserver = MockIo as unknown as typeof IntersectionObserver;

        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((type: string) => {
            if (type === "webgl2") return createMockGl().gl as unknown as RenderingContext;
            return null;
        });

        const scene = document.createElement("div");
        const firstEl = document.createElement("div");
        const secondEl = document.createElement("div");
        const thirdEl = document.createElement("div");
        document.body.append(scene, firstEl, secondEl, thirdEl);
        setBox(scene, 600, 600);
        setBox(firstEl, 120, 60);
        setBox(secondEl, 120, 60);
        setBox(thirdEl, 120, 60);

        const firstGlass = createLiquidGlass(firstEl, { engine: "webgl", sceneElement: scene });
        const secondGlass = createLiquidGlass(secondEl, { engine: "webgl", sceneElement: scene });
        expect(firstGlass.engine).toBe("webgl");
        expect(secondGlass.engine).toBe("webgl");
        expect(getWebglPoolStats().activeCount).toBe(2);

        const thirdGlass = createLiquidGlass(thirdEl, { engine: "webgl", sceneElement: scene });
        expect(firstGlass.engine).toBe("css");
        expect(secondGlass.engine).toBe("webgl");
        expect(thirdGlass.engine).toBe("webgl");
        expect(getWebglPoolStats()).toEqual({
            activeCount: 2,
            standbyCount: 1,
            maxActiveContexts: 2,
        });

        thirdGlass.refresh();
        expect(firstGlass.engine).toBe("css");

        ioCallback!(
            [{ target: secondEl, isIntersecting: false } as unknown as IntersectionObserverEntry],
            {} as IntersectionObserver,
        );
        expect(secondGlass.engine).toBe("css");
        expect(firstGlass.engine).toBe("webgl");
        expect(thirdGlass.engine).toBe("webgl");

        firstGlass.destroy();
        ioCallback!(
            [{ target: secondEl, isIntersecting: true } as unknown as IntersectionObserverEntry],
            {} as IntersectionObserver,
        );
        expect(secondGlass.engine).toBe("webgl");
        secondGlass.destroy();
        thirdGlass.destroy();
    });

    it("drains failed standby restores without nesting callbacks", () => {
        setMaxActiveWebglContextsForTesting(1);
        const makeEntry = () => ({
            token: Symbol(),
            isVisible: true,
            lastUsedOrder: 0,
            evictToCss: vi.fn(),
            restoreWebgl: vi.fn(),
        });
        const active = makeEntry();
        const survivor = makeEntry();
        survivor.restoreWebgl.mockImplementation(() => acquireWebglSlot(survivor));
        acquireWebglSlot(active);
        acquireWebglSlot(survivor, false);
        let inRestore = false;
        for (let index = 0; index < 3; index += 1) {
            const broken = makeEntry();
            broken.restoreWebgl.mockImplementation(() => {
                expect(inRestore).toBe(false);
                inRestore = true;
                acquireWebglSlot(broken);
                releaseWebglSlot(broken);
                inRestore = false;
            });
            acquireWebglSlot(broken, false);
        }

        releaseWebglSlot(active);
        expect(survivor.restoreWebgl).toHaveBeenCalledOnce();
        expect(getWebglPoolStats().activeCount).toBe(1);
        expect(getWebglPoolStats().standbyCount).toBe(0);
    });

    it("tracks smooth 2D light tilt in interactive springs and updates uLightTilt in WebGL", () => {
        const frames: Array<{ tiltHorizontal: number; tiltVertical: number }> = [];
        let rested = false;
        let nowMs = 0;
        const rafQueue: FrameRequestCallback[] = [];
        vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
            rafQueue.push(cb);
            return rafQueue.length;
        });
        vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});

        const spring = createInteractiveSpring(
            (frame) => {
                frames.push({
                    tiltHorizontal: frame.tiltHorizontal,
                    tiltVertical: frame.tiltVertical,
                });
            },
            () => {
                rested = true;
            },
        );

        spring.setTilt(0.8, -0.5);
        for (let step = 0; step < 30 && rafQueue.length > 0; step++) {
            nowMs += 16;
            rafQueue.shift()!(nowMs);
        }
        expect(frames.length).toBeGreaterThan(0);
        const tilted = frames.at(-1)!;
        expect(tilted.tiltHorizontal).toBeGreaterThan(0.3);
        expect(tilted.tiltVertical).toBeLessThan(-0.15);

        spring.setTilt(0, 0);
        for (let step = 0; step < 60 && rafQueue.length > 0; step++) {
            nowMs += 16;
            rafQueue.shift()!(nowMs);
        }
        expect(rested).toBe(true);
        spring.destroy();

        const { gl, uniform2fCalls } = createMockGl();
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((type: string) => {
            if (type === "webgl2") return gl as unknown as RenderingContext;
            return null;
        });

        const scene = document.createElement("div");
        const button = document.createElement("button");
        document.body.append(scene, button);
        setBox(scene, 400, 300);
        setBox(button, 200, 100, 100, 100);

        const glass = createLiquidGlass(button, {
            engine: "webgl",
            sceneElement: scene,
            interactive: true,
        });

        const moveEvent = new Event("pointermove") as PointerEvent;
        Object.defineProperty(moveEvent, "clientX", { value: 280 });
        Object.defineProperty(moveEvent, "clientY", { value: 110 });
        button.dispatchEvent(moveEvent);

        for (let step = 0; step < 25 && rafQueue.length > 0; step++) {
            nowMs += 16;
            rafQueue.shift()!(nowMs);
        }

        const lightUniforms = uniform2fCalls.filter((call) => call.name === "uLightTilt");
        expect(lightUniforms.some((call) => call.x > 0.1 && call.y > 0.1)).toBe(true);
        glass.destroy();
    });

    it("activates lazy 2-pass half-res Kawase downsample FBOs above blur > 6 and disposes cleanly", () => {
        const { gl, uniform1fCalls } = createMockGl();
        const canvas = document.createElement("canvas");
        vi.spyOn(canvas, "getContext").mockReturnValue(gl);
        const renderer = GlassWebglRenderer.create(canvas)!;

        const sceneCanvas = document.createElement("canvas");
        sceneCanvas.width = 400;
        sceneCanvas.height = 300;
        renderer.setSceneCanvas(sceneCanvas);

        const baseFrame = {
            width: 240,
            height: 120,
            radius: 20,
            bezel: 14,
            thickness: 40,
            scaleRatio: 2,
            ior: 1.5,
            blur: 4,
            surface: "convex_squircle" as const,
            tintColor: [1, 1, 1] as [number, number, number],
            tintOpacity: 0.12,
            highlight: 0.72,
            pixelRatio: 2,
            sceneRect: { relX: 0.1, relY: 0.1, relW: 0.5, relH: 0.4 },
        };

        renderer.render(baseFrame);
        expect(gl.createFramebuffer).not.toHaveBeenCalled();

        renderer.render({ ...baseFrame, blur: 8 });
        expect(gl.createFramebuffer).toHaveBeenCalledTimes(2);
        expect(uniform1fCalls.filter((call) => call.name === "uAlignedDownsample").map((call) => call.val))
            .toEqual([1, 0]);
        const drawsAfterSecondFrame = vi.mocked(gl.drawArrays).mock.calls.length;
        expect(drawsAfterSecondFrame).toBe(4);

        renderer.render({ ...baseFrame, blur: 8 });
        const drawsAfterCacheBuild = vi.mocked(gl.drawArrays).mock.calls.length;
        expect(drawsAfterCacheBuild).toBe(6);

        renderer.render({ ...baseFrame, blur: 8, highlight: 0.8 });
        expect(vi.mocked(gl.drawArrays).mock.calls.length).toBe(drawsAfterCacheBuild + 1);

        renderer.render({ ...baseFrame, blur: 9 });
        expect(vi.mocked(gl.drawArrays).mock.calls.length).toBe(drawsAfterCacheBuild + 3);

        renderer.setSceneCanvas(sceneCanvas);
        renderer.render({ ...baseFrame, blur: 9 });
        expect(vi.mocked(gl.drawArrays).mock.calls.length).toBe(drawsAfterCacheBuild + 6);

        renderer.setSceneCanvas(null);
        expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(2);
        expect(gl.deleteTexture).toHaveBeenCalledTimes(3);
        renderer.setSceneCanvas(sceneCanvas);
        renderer.render({ ...baseFrame, blur: 9 });
        expect(gl.createFramebuffer).toHaveBeenCalledTimes(5);

        renderer.dispose();
        expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(5);
        expect(gl.deleteTexture).toHaveBeenCalledTimes(9);
    });

    it("activates webgl scene texture when sceneCanvas is provided without sceneElement", () => {
        const rafQueue: FrameRequestCallback[] = [];
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
            rafQueue.push(cb);
            return rafQueue.length;
        });
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((type: string) => {
            if (type === "webgl2" || type === "webgl") return createMockGl().gl as unknown as RenderingContext;
            return null;
        });

        const targetEl = document.createElement("div");
        setBox(targetEl, 200, 60);
        document.body.appendChild(targetEl);

        const customSceneCanvas = document.createElement("canvas");
        customSceneCanvas.width = 400;
        customSceneCanvas.height = 120;

        const glass = createLiquidGlass(targetEl, {
            engine: "webgl",
            sceneCanvas: customSceneCanvas,
        });

        expect(glass.engine).toBe("webgl");
        while (rafQueue.length > 0) {
            rafQueue.shift()!(16);
        }
        expect(targetEl.getAttribute("data-lg-webgl-scene")).toBe("1");
        expect(targetEl.style.getPropertyValue("--lg-filter")).toBe("");

        glass.destroy();
    });

    it("parses percentage rgb colors cleanly in parseCssColorToRgb", () => {
        expect(parseCssColorToRgb("rgb(100%, 50%, 0%)")).toEqual([1, 0.5, 0]);
        expect(parseCssColorToRgb("rgba(0%, 100%, 50%, 0.5)")).toEqual([0, 1, 0.5]);
        expect(parseCssColorToRgb("#ff8000")).toEqual([1, 128 / 255, 0]);
    });

    it("transitions properly to WebGL when setSceneCanvas is called dynamically", () => {
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((type: string) => {
            if (type === "webgl2" || type === "webgl") return createMockGl().gl as unknown as RenderingContext;
            return null;
        });

        const targetEl = document.createElement("div");
        setBox(targetEl, 200, 60);
        document.body.appendChild(targetEl);

        const glass = createLiquidGlass(targetEl, {
            engine: "webgl",
        });

        const sceneCanvas = document.createElement("canvas");
        sceneCanvas.width = 400;
        sceneCanvas.height = 120;

        glass.setSceneCanvas(sceneCanvas);
        expect(glass.engine).toBe("webgl");

        glass.destroy();
    });

    it("uploads uLightTilt uniform on initial render even with zero tilt (0, 0)", () => {
        const rafQueue: Array<(time: number) => void> = [];
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
            rafQueue.push(cb);
            return rafQueue.length;
        });

        const { gl, uniform2fCalls, uniform1fCalls } = createMockGl();
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((type: string) => {
            if (type === "webgl2" || type === "webgl") return gl as unknown as RenderingContext;
            return null;
        });

        const targetEl = document.createElement("div");
        setBox(targetEl, 200, 60);
        document.body.appendChild(targetEl);

        const glass = createLiquidGlass(targetEl, {
            engine: "webgl",
            blur: 0,
            interactive: false,
        });

        while (rafQueue.length > 0) {
            rafQueue.shift()!(16);
        }

        const initialLightUniform = uniform2fCalls.find((call) => call.name === "uLightTilt");
        expect(initialLightUniform).toBeDefined();
        expect(initialLightUniform?.x).toBe(0);
        expect(initialLightUniform?.y).toBe(0);

        const initialPeerCountUniform = uniform1fCalls.find((call) => call.name === "uPeerCount");
        expect(initialPeerCountUniform).toBeDefined();
        expect(initialPeerCountUniform?.val).toBe(0);

        glass.destroy();
    });

    it("activates WebGL fallback on iPhone / WebKit when sceneElement is provided", () => {
        (window as unknown as { __LG_FORCE_CHROMIUM__?: boolean }).__LG_FORCE_CHROMIUM__ = false;
        const { gl } = createMockGl();
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((type: string) => {
            if (type === "webgl2" || type === "webgl") return gl as unknown as RenderingContext;
            return null;
        });

        const rootEl = document.createElement("div");
        const navEl = document.createElement("nav");
        document.body.append(rootEl, navEl);
        setBox(rootEl, 800, 600);
        setBox(navEl, 300, 50);

        const instance = createLiquidGlass(navEl, {
            engine: "auto",
            sceneElement: rootEl,
            pill: true,
        });

        expect(instance.engine).toBe("webgl");
        expect(navEl.getAttribute("data-lg-engine")).toBe("webgl");
        expect(navEl.querySelector(".lg-webgl-canvas")).not.toBeNull();

        instance.destroy();
    });

    it("reuses a composited frame while its inputs are unchanged", () => {
        vi.useFakeTimers();
        const { gl } = createMockGl();
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(gl);
        const source = document.body.appendChild(document.createElement("section"));
        const element = source.appendChild(document.createElement("div"));
        const scene = document.createElement("canvas");
        setBox(source, 400, 200);
        setBox(element, 80, 32, 20, 10);
        const glass = createLiquidGlass(element, { engine: "webgl", sceneElement: source,
            sceneCanvas: scene, coalesce: false, interactive: false });
        const scroll = () => {
            window.dispatchEvent(new Event("scroll"));
            vi.advanceTimersByTime(32);
        };
        try {
            vi.advanceTimersByTime(32);
            vi.mocked(gl.drawArrays).mockClear();
            glass.refresh();
            glass.update({ onEngineChange: () => {} });
            vi.advanceTimersByTime(32);
            expect(gl.drawArrays).not.toHaveBeenCalled();
            setBox(source, 400, 200, 0, -20);
            setBox(element, 80, 32, 20, -10);
            scroll();
            expect(gl.drawArrays).not.toHaveBeenCalled();
            setBox(element, 80, 32, 21, -10);
            scroll();
            expect(gl.drawArrays).toHaveBeenCalledTimes(1);
            vi.mocked(gl.drawArrays).mockClear();
            glass.setLightTilt!(0.4, 0);
            vi.advanceTimersByTime(32);
            expect(gl.drawArrays).toHaveBeenCalled();
            vi.mocked(gl.drawArrays).mockClear();
            glass.setSceneCanvas(scene);
            scroll();
            expect(gl.drawArrays).toHaveBeenCalled();
        } finally {
            glass.destroy();
            vi.useRealTimers();
        }
    });

    it("batches motion, scene uploads and viewport changes around one read of a shared scene", () => {
        vi.useFakeTimers();
        const firstGl = createMockGl().gl;
        const secondGl = createMockGl().gl;
        vi.spyOn(HTMLCanvasElement.prototype, "getContext")
            .mockReturnValueOnce(firstGl)
            .mockReturnValue(secondGl);
        const source = document.body.appendChild(document.createElement("section"));
        const first = source.appendChild(document.createElement("div"));
        const second = source.appendChild(document.createElement("div"));
        setBox(source, 400, 200);
        setBox(first, 80, 32, 20, 10);
        setBox(second, 80, 32, 110, 10);
        const scene = document.createElement("canvas");
        const options = { engine: "webgl" as const, sceneElement: source, sceneCanvas: scene };
        const firstGlass = createLiquidGlass(first, options);
        const secondGlass = createLiquidGlass(second, options);
        try {
            vi.advanceTimersByTime(32);
            const readSource = vi.spyOn(source, "getBoundingClientRect");
            const readFirst = vi.spyOn(first, "getBoundingClientRect");
            const requestFrame = vi.spyOn(window, "requestAnimationFrame");
            vi.mocked(firstGl.drawArrays).mockClear();
            vi.mocked(secondGl.drawArrays).mockClear();

            firstGlass.refresh();
            firstGlass.setSceneCanvas(scene);
            secondGlass.setLightTilt!(0.4, 0);
            window.dispatchEvent(new Event("scroll"));
            firstGlass.refresh();
            expect(readFirst).not.toHaveBeenCalled();
            expect(requestFrame).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(32);
            expect(readSource).toHaveBeenCalledTimes(1);
            expect(readFirst).toHaveBeenCalledTimes(1);
            expect(firstGl.drawArrays).toHaveBeenCalledTimes(1);
            expect(secondGl.drawArrays).toHaveBeenCalledTimes(1);

            readFirst.mockClear();
            firstGlass.refresh();
            firstGlass.destroy();
            vi.advanceTimersByTime(32);
            expect(readFirst).not.toHaveBeenCalled();
        } finally {
            firstGlass.destroy();
            secondGlass.destroy();
            vi.useRealTimers();
        }
    });

    it("falls back to CSS when a scene upload fails and still renders the other queued surfaces", () => {
        vi.useFakeTimers();
        const firstGl = createMockGl().gl;
        const secondGl = createMockGl().gl;
        vi.mocked(firstGl.texImage2D).mockImplementationOnce(() => {
            throw new DOMException("Canvas texture unavailable", "SecurityError");
        });
        const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(HTMLCanvasElement.prototype, "getContext")
            .mockReturnValueOnce(firstGl)
            .mockReturnValue(secondGl);
        const first = document.body.appendChild(document.createElement("div"));
        const second = document.body.appendChild(document.createElement("div"));
        setBox(first, 80, 32);
        setBox(second, 80, 32, 110);
        const sceneCanvas = document.createElement("canvas");
        const firstGlass = createLiquidGlass(first, { engine: "webgl", sceneCanvas });
        const secondGlass = createLiquidGlass(second, { engine: "webgl", sceneCanvas });
        try {
            vi.advanceTimersByTime(32);
            expect(firstGlass.engine).toBe("css");
            expect(warning).toHaveBeenCalledTimes(1);
            expect(secondGlass.engine).toBe("webgl");
            expect(secondGl.drawArrays).toHaveBeenCalled();
        } finally {
            firstGlass.destroy();
            secondGlass.destroy();
            vi.useRealTimers();
        }
    });

    it("reuses a slider's composited texture while it scrolls with its backdrop", () => {
        vi.useFakeTimers();
        const { gl } = createMockGl();
        const blit = vi.fn();
        const context2d = {
            setTransform: vi.fn(),
            fillRect: vi.fn(),
            drawImage: blit,
        } as unknown as CanvasRenderingContext2D;
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((type) =>
            type === "2d" ? context2d : gl);
        const source = document.body.appendChild(document.createElement("section"));
        const input = source.appendChild(document.createElement("input"));
        input.type = "range";
        setBox(source, 400, 200);
        const slider = createGlassSlider(input, {
            engine: "webgl",
            sceneCanvas: document.createElement("canvas"),
            sceneElement: source,
        });
        const wrapper = input.parentElement!;
        const thumb = wrapper.querySelector<HTMLElement>(".lg-slider-thumb")!;
        setBox(wrapper, 240, 34, 20, 50);
        setBox(thumb, 50, 32, 100, 51);
        const scroll = () => {
            window.dispatchEvent(new Event("scroll"));
            vi.advanceTimersByTime(48);
        };
        try {
            slider.refresh();
            vi.advanceTimersByTime(32);
            expect(blit).toHaveBeenCalled();
            blit.mockClear();
            vi.mocked(gl.texImage2D).mockClear();

            setBox(source, 400, 200, 0, -20);
            setBox(wrapper, 240, 34, 20, 30);
            setBox(thumb, 50, 32, 100, 31);
            scroll();
            expect(blit).not.toHaveBeenCalled();
            expect(gl.texImage2D).not.toHaveBeenCalled();

            setBox(source, 400, 200, 0, -40);
            scroll();
            expect(blit).toHaveBeenCalledTimes(1);
            expect(gl.texImage2D).toHaveBeenCalledTimes(1);

            blit.mockClear();
            slider.refresh();
            vi.advanceTimersByTime(32);
            expect(blit).toHaveBeenCalledTimes(1);
        } finally {
            slider.destroy();
            vi.useRealTimers();
        }
    });

    it("reuses neighboring glass frames when the scene and both surfaces scroll together", () => {
        vi.useFakeTimers();
        const firstGl = createMockGl().gl;
        const secondGl = createMockGl().gl;
        vi.spyOn(HTMLCanvasElement.prototype, "getContext")
            .mockReturnValueOnce(firstGl)
            .mockReturnValue(secondGl);
        const source = document.body.appendChild(document.createElement("section"));
        const first = source.appendChild(document.createElement("div"));
        const second = source.appendChild(document.createElement("div"));
        const scene = document.createElement("canvas");
        setBox(source, 400, 200);
        setBox(first, 80, 32, 20, 10);
        setBox(second, 80, 32, 110, 10);
        const options = { engine: "webgl" as const, sceneElement: source, sceneCanvas: scene };
        const firstGlass = createLiquidGlass(first, options);
        const secondGlass = createLiquidGlass(second, options);
        const scroll = () => {
            window.dispatchEvent(new Event("scroll"));
            vi.advanceTimersByTime(32);
        };
        try {
            vi.advanceTimersByTime(32);
            expect(first.getAttribute("data-lg-coalescing")).toBe("1");
            expect(second.getAttribute("data-lg-coalescing")).toBe("1");
            vi.mocked(firstGl.drawArrays).mockClear();
            vi.mocked(secondGl.drawArrays).mockClear();

            setBox(source, 400, 200, 0, -20);
            setBox(first, 80, 32, 20, -10);
            setBox(second, 80, 32, 110, -10);
            scroll();
            expect(firstGl.drawArrays).not.toHaveBeenCalled();
            expect(secondGl.drawArrays).not.toHaveBeenCalled();

            setBox(second, 80, 32, 115, -10);
            scroll();
            expect(firstGl.drawArrays).toHaveBeenCalled();
            expect(secondGl.drawArrays).toHaveBeenCalled();
        } finally {
            firstGlass.destroy();
            secondGlass.destroy();
            vi.useRealTimers();
        }
    });

    it("keeps rounded corners at full HiDPI while rendering large blurred interiors at reduced pixel density", () => {
        const { gl, viewportCalls, uniform1fCalls } = (() => {
            const base = createMockGl();
            const vpCalls: Array<[number, number, number, number]> = [];
            base.gl.viewport = vi.fn((x: number, y: number, w: number, h: number) => {
                vpCalls.push([x, y, w, h]);
            });
            return { ...base, viewportCalls: vpCalls };
        })();

        const canvas = document.createElement("canvas");
        vi.spyOn(canvas, "getContext").mockReturnValue(gl);
        const renderer = GlassWebglRenderer.create(canvas)!;

        const sceneCanvas = document.createElement("canvas");
        sceneCanvas.width = 800;
        sceneCanvas.height = 600;
        renderer.setSceneCanvas(sceneCanvas);

        const largeFrame = {
            width: 400,
            height: 300,
            radius: 24,
            bezel: 14,
            thickness: 48,
            scaleRatio: 2.35,
            ior: 2.15,
            blur: 4,
            surface: "convex_squircle" as const,
            tintColor: [1, 1, 1] as [number, number, number],
            tintOpacity: 0.12,
            highlight: 0.72,
            pixelRatio: 3,
            sceneRect: { relX: 0.1, relY: 0.1, relW: 0.5, relH: 0.5 },
        };

        renderer.render(largeFrame);
        expect(canvas.width * canvas.height).toBeLessThanOrEqual(1_048_576);
        expect(canvas.width).toBeGreaterThan(1100);
        expect(viewportCalls).toContainEqual([0, 0, 200, 150]);
        expect(viewportCalls.at(-1)).toEqual([0, 0, canvas.width, canvas.height]);
        expect(uniform1fCalls.some((c) => c.name === "uUseInteriorTex" && c.val === 1)).toBe(true);

        const drawsAfterFirst = vi.mocked(gl.drawArrays).mock.calls.length;
        renderer.render(largeFrame);
        expect(vi.mocked(gl.drawArrays).mock.calls.length).toBe(drawsAfterFirst + 1);

        renderer.render({ ...largeFrame, saturation: 0 });
        expect(vi.mocked(gl.drawArrays).mock.calls.length).toBe(drawsAfterFirst + 3);
        expect(uniform1fCalls.filter((call) => call.name === "uSaturation" && call.val === 0)).toHaveLength(2);

        const shaderSources = vi.mocked(gl.shaderSource).mock.calls.map(([, src]) => src);
        expect(shaderSources.some((src) => src.includes("rimClarity"))).toBe(true);
        expect(shaderSources.some((src) => src.includes("smoothCornerEps"))).toBe(true);
        expect(shaderSources.some((src) => src.includes("sampleInteriorBlur5Tap"))).toBe(true);

        renderer.dispose();
    });

    it("compiles WebGL2 transfer/interior shaders with 16-bit NEAREST LUT, C^2 sminPoly, rational GGX, Nyquist downsample, and tightened rim", () => {
        const shaderSources: string[] = [];
        const uploadedUniforms: Array<{ name: string; args: number[] }> = [];
        const texParams: Array<{ pname: number; param: number }> = [];

        const mockGl2 = {
            TEXTURE0: 0x84c0, TEXTURE1: 0x84c1, TEXTURE2: 0x84c2, TEXTURE3: 0x84c3, TEXTURE4: 0x84c4,
            TEXTURE_2D: 0x0de1, TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
            TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800, CLAMP_TO_EDGE: 0x812f,
            LINEAR: 0x2601, NEAREST: 0x2600, RGBA: 0x1908, RGBA16F: 0x881a, HALF_FLOAT: 0x140b,
            UNSIGNED_BYTE: 0x1401, ARRAY_BUFFER: 0x8892, STATIC_DRAW: 0x88e4, FLOAT: 0x1406,
            TRIANGLES: 0x0004, VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30,
            COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82, MAX_VIEWPORT_DIMS: 0x0d3a,
            MAX_TEXTURE_SIZE: 0x0d33, UNPACK_FLIP_Y_WEBGL: 0x9240, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
            FRAMEBUFFER: 0x8d40, COLOR_ATTACHMENT0: 0x8ce0, COLOR_ATTACHMENT1: 0x8ce1,
            FRAMEBUFFER_COMPLETE: 0x8cd5,
            getExtension: (ext: string) => (ext === "EXT_color_buffer_float" ? {} : null),
            getParameter: (p: number) => (p === 0x0d3a ? [4096, 4096] : 4096),
            createShader: () => ({}),
            shaderSource: (_s: unknown, src: string) => shaderSources.push(src),
            compileShader: () => {}, getShaderParameter: () => true, deleteShader: () => {},
            createProgram: () => ({}), attachShader: () => {}, bindAttribLocation: () => {},
            linkProgram: () => {}, getProgramParameter: () => true, deleteProgram: () => {},
            useProgram: () => {}, createBuffer: () => ({}), bindBuffer: () => {}, bufferData: () => {},
            getAttribLocation: () => 0, enableVertexAttribArray: () => {}, vertexAttribPointer: () => {},
            createTexture: () => ({}), activeTexture: () => {}, bindTexture: () => {},
            texParameteri: (_t: number, pname: number, param: number) => texParams.push({ pname, param }),
            pixelStorei: () => {}, texImage2D: () => {}, deleteTexture: () => {},
            createFramebuffer: () => ({}), bindFramebuffer: () => {}, framebufferTexture2D: () => {},
            checkFramebufferStatus: () => 0x8cd5, drawBuffers: () => {}, deleteFramebuffer: () => {},
            getUniformLocation: (_p: unknown, name: string) => ({ name }),
            uniform1i: () => {},
            uniform1f: (loc: { name: string } | null, a: number) => {
                if (loc) uploadedUniforms.push({ name: loc.name, args: [a] });
            },
            uniform2f: (loc: { name: string } | null, a: number, b: number) => {
                if (loc) uploadedUniforms.push({ name: loc.name, args: [a, b] });
            },
            uniform4f: (loc: { name: string } | null, a: number, b: number, c: number, d: number) => {
                if (loc) uploadedUniforms.push({ name: loc.name, args: [a, b, c, d] });
            },
            viewport: () => {}, clearColor: () => {}, clear: () => {}, drawArrays: () => {},
            deleteBuffer: () => {}, isContextLost: () => false,
        };

        const canvas = document.createElement("canvas");
        vi.spyOn(canvas, "getContext").mockImplementation((type: string) =>
            type === "webgl2" ? (mockGl2 as unknown as RenderingContext) : null,
        );

        const renderer = GlassWebglRenderer.create(canvas)!;
        const sceneCanvas = document.createElement("canvas");
        sceneCanvas.width = 400;
        sceneCanvas.height = 300;
        renderer.setSceneCanvas(sceneCanvas);

        const baseFrame = {
            width: 300, height: 240, radius: 20, bezel: 14, thickness: 64,
            scaleRatio: 2.2, ior: 1.62, blur: 14, surface: "convex_squircle" as const,
            tintColor: [0.2, 0.5, 0.9] as [number, number, number], tintOpacity: 0.25,
            highlight: 0.44, pixelRatio: 2, abbeNumber: 25,
            sceneRect: { relX: 0.1, relY: 0.1, relW: 0.5, relH: 0.5 },
        };
        for (let i = 0; i < 4; i++) renderer.render(baseFrame);

        expect(texParams.some((p) => p.pname === 0x2801 && p.param === 0x2600)).toBe(true);
        const lutScaleUpload = uploadedUniforms.find((u) => u.name === "uLutScale");
        expect(lutScaleUpload).toBeDefined();
        expect(lutScaleUpload!.args[0]).toBe(1023);
        expect(lutScaleUpload!.args[1]).toBeCloseTo(1 / 1024, 8);

        const joined = shaderSources.join("\n");
        const transferSampleFrag = shaderSources.find(
            (src) => src.includes("#define LG_TRANSFER_SAMPLE") && src.includes("texelFetch"),
        );
        expect(transferSampleFrag).toContain("vec3 interferenceTint = vec3(0.0);");
        expect(transferSampleFrag).toContain("packedChromaClarity");
        expect(transferSampleFrag).not.toContain("float sdBlur");
        expect(transferSampleFrag).toContain("(dynamicQuad * dynamicQuad) / (12.0 - 11.0 * dynamicSq)");
        expect(transferSampleFrag).not.toContain("pow(dynamicNdh, 5.0)");
        expect(joined).toContain("sampleOpticalLut16");
        expect(joined).toContain("(safeK / 6.0) * h * h * h");
        expect(joined).toContain("smoothstep(0.48, 0.985, rimY)");
        expect(joined).toContain("cornerArc * cornerArc * 0.14");
        expect(joined).toContain("evalSquircleGeom(peerQPlus, peerProps.x)");
        expect(joined).toContain("saddlePerp = vec2(-saddleAxis.y, saddleAxis.x)");
        expect(joined).toContain("fresnelSq * fresnelSq * fresnelComplement");
        expect(joined).toContain("opticalTransmittance = exp(");
        expect(joined).toContain("chromaSpread * 0.72");
        expect(joined).toContain("chromaSpread * 1.28");

        expect(uploadedUniforms.find((u) => u.name === "uAlignedDownsample")?.args[0]).toBe(0);
        const halfPixel = uploadedUniforms.find((u) => u.name === "uHalfPixel");
        expect(halfPixel?.args[0]).toBeCloseTo(0.25 / 100, 6);
        expect(halfPixel?.args[1]).toBeCloseTo(0.25 / 75, 6);

        expect(uploadedUniforms.some((u) => u.name === "uOptical" && u.args[1] === 64 && u.args[3] === 0)).toBe(true);
        renderer.render({ ...baseFrame, thickness: 96 });
        expect(uploadedUniforms.some((u) => u.name === "uOptical" && u.args[1] === 96 && u.args[3] === 0)).toBe(true);
        expect(uploadedUniforms.some((u) => u.name === "uHighlight" && u.args[1] > 0)).toBe(true);

        renderer.dispose();
    });

    it("supports programmatic setLightTilt and cleans localSceneCapture on setSceneCanvas(null, null)", () => {
        const scene = document.createElement("div");
        const target = document.createElement("div");
        document.body.append(scene, target);
        vi.spyOn(scene, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 300, 300));
        vi.spyOn(target, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 20, 120, 50));

        const { gl, uniform2fCalls } = createMockGl();
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((type: string) => {
            if (type === "webgl" || type === "experimental-webgl") return gl as unknown as RenderingContext;
            if (type === "2d") {
                return { setTransform: () => {}, clearRect: () => {}, fillRect: () => {}, save: () => {}, restore: () => {} } as unknown as CanvasRenderingContext2D;
            }
            return null;
        });

        const rafQueue: FrameRequestCallback[] = [];
        vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
            rafQueue.push(cb);
            return rafQueue.length;
        });

        const instance = createLiquidGlass(target, {
            engine: "webgl",
            interactive: false,
            sceneElement: scene,
            lightTilt: { horizontal: 0.25, vertical: -0.5 },
        });
        while (rafQueue.length > 0) rafQueue.shift()!(16);
        expect(uniform2fCalls.some((c) => c.name === "uLightTilt" && c.x === 0.25 && c.y === -0.5)).toBe(true);

        instance.setLightTilt?.(-0.7, 0.35);
        while (rafQueue.length > 0) rafQueue.shift()!(32);
        expect(uniform2fCalls.some((c) => c.name === "uLightTilt" && c.x === -0.7 && c.y === 0.35)).toBe(true);

        instance.setSceneCanvas(null, null);
        while (rafQueue.length > 0) rafQueue.shift()!(48);
        expect(target.getAttribute("data-lg-webgl-scene")).toBe("0");
        instance.destroy();
    });

    it("skips redundant uPeerBounds/uPeerProps uniform4fv uploads when coalescence peers stay stationary", () => {
        const { gl } = createMockGl();
        const uniform4fvCalls: string[] = [];
        (gl as unknown as { uniform4fv: (loc: { name?: string } | null) => void }).uniform4fv = (loc) => {
            if (loc?.name) uniform4fvCalls.push(loc.name);
        };
        const origGetLoc = gl.getUniformLocation;
        gl.getUniformLocation = vi.fn((prog: WebGLProgram, name: string) => {
            if (name === "uPeerBounds[0]" || name === "uPeerProps[0]") {
                return { name: name.slice(0, -3) } as unknown as WebGLUniformLocation;
            }
            return origGetLoc(prog, name);
        });

        const canvas = document.createElement("canvas");
        vi.spyOn(canvas, "getContext").mockReturnValue(gl as unknown as RenderingContext);
        const renderer = GlassWebglRenderer.create(canvas)!;

        const peer = {
            relCenterX: 90,
            relCenterY: 0,
            halfWidth: 40,
            halfHeight: 24,
            radius: 16,
            mergeRadius: 12,
            wavePhase: 0.4,
            priorityWinsTie: true,
        };
        const frame = {
            width: 80,
            height: 48,
            radius: 16,
            bezel: 12,
            thickness: 40,
            scaleRatio: 2,
            ior: 1.5,
            blur: 0,
            surface: "convex_squircle" as const,
            tintColor: [1, 1, 1] as [number, number, number],
            tintOpacity: 0.12,
            highlight: 0.5,
            coalescePeers: [peer],
            bleedPx: 14,
        };

        renderer.render(frame);
        expect(uniform4fvCalls).toEqual(["uPeerBounds", "uPeerProps"]);

        renderer.render({ ...frame, highlight: 0.7 });
        expect(uniform4fvCalls).toEqual(["uPeerBounds", "uPeerProps"]);

        renderer.render({ ...frame, coalescePeers: [{ ...peer, relCenterX: 84 }] });
        expect(uniform4fvCalls).toEqual(["uPeerBounds", "uPeerProps", "uPeerBounds"]);

        renderer.dispose();
    });

    it("promotes the next visible standby WebGL entry when the top candidate fails to restore", () => {
        resetWebglPoolForTesting();
        setMaxActiveWebglContextsForTesting(1);
        const restored: string[] = [];

        const activeEntry = {
            token: Symbol("active"),
            isVisible: true,
            lastUsedOrder: 0,
            evictToCss: vi.fn(),
            restoreWebgl: vi.fn(),
        };
        const failingStandby = {
            token: Symbol("failing"),
            isVisible: true,
            lastUsedOrder: 0,
            evictToCss: vi.fn(),
            restoreWebgl: vi.fn(() => {
                restored.push("failing");
            }),
        };
        const healthyStandby = {
            token: Symbol("healthy"),
            isVisible: true,
            lastUsedOrder: 0,
            evictToCss: vi.fn(),
            restoreWebgl: vi.fn(() => {
                restored.push("healthy");
                acquireWebglSlot(healthyStandby, false);
            }),
        };

        expect(acquireWebglSlot(activeEntry, false)).toBe(true);
        expect(acquireWebglSlot(healthyStandby, false)).toBe(false);
        expect(acquireWebglSlot(failingStandby, false)).toBe(false);

        releaseWebglSlot(activeEntry);
        expect(restored).toEqual(["failing", "healthy"]);
        expect(getWebglPoolStats().activeCount).toBe(1);
        resetWebglPoolForTesting();
    });
});
