import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiquidGlass, destroyLiquidGlass } from "../src/index.js";
import { createInteractiveSpring } from "../src/core/spring.js";
import {
    getWebglPoolStats,
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
        resetWebglPoolForTesting();
        document.body.innerHTML = "";
        globalThis.IntersectionObserver = originalIntersectionObserver;
        vi.restoreAllMocks();
    });

    it("enforces the WebGL context budget, evicts offscreen slots, and restores visible CSS standbys", () => {
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
        const { gl } = createMockGl();
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

        renderer.dispose();
        expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(3);
        expect(gl.deleteTexture).toHaveBeenCalledTimes(6);
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

        // Created without scene canvas initially with engine "webgl"
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
});
