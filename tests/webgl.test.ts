import { afterEach, describe, expect, it, vi } from "vitest";
import { destroyLiquidGlass } from "../src/index.js";
import {
    captureDomToCanvas,
    createSceneCaptureController,
    resolveCaptureDimensions,
} from "../src/core/sceneCapture.js";
import { GlassWebglRenderer, resolveWebglPixelRatio } from "../src/core/webglRenderer.js";

function createMockWebglContext(options?: {
    maxViewportDims?: [number, number];
    maxTextureSize?: number;
    transferCache?: boolean;
    incompleteFramebuffer?: boolean;
}) {
    const uniforms = new Map<string, number>();
    let nextLocId = 1;
    const viewportCalls: Array<[number, number, number, number]> = [];
    const uniform1fCalls: Array<{ loc: unknown; val: number }> = [];
    const uniform4fCalls: Array<{ loc: unknown; values: [number, number, number, number] }> = [];

    const gl = {
        VERTEX_SHADER: 0x8b31,
        FRAGMENT_SHADER: 0x8b30,
        COMPILE_STATUS: 0x8b81,
        LINK_STATUS: 0x8b82,
        ARRAY_BUFFER: 0x8892,
        STATIC_DRAW: 0x88e4,
        FLOAT: 0x1406,
        COLOR_BUFFER_BIT: 0x4000,
        TRIANGLES: 0x0004,
        TEXTURE0: 0x84c0,
        TEXTURE1: 0x84c1,
        TEXTURE2: 0x84c2,
        TEXTURE3: 0x84c3,
        TEXTURE_2D: 0x0de1,
        RGBA: 0x1908,
        UNSIGNED_BYTE: 0x1401,
        UNPACK_FLIP_Y_WEBGL: 0x9240,
        TEXTURE_WRAP_S: 0x2802,
        TEXTURE_WRAP_T: 0x2803,
        TEXTURE_MAG_FILTER: 0x2800,
        TEXTURE_MIN_FILTER: 0x2801,
        CLAMP_TO_EDGE: 0x812f,
        LINEAR: 0x2601,
        NEAREST: 0x2600,
        RGBA16F: 0x881a,
        RGBA32F: 0x8814,
        HALF_FLOAT: 0x140b,
        FRAMEBUFFER: 0x8d40,
        NO_ERROR: 0,
        FRAMEBUFFER_COMPLETE: 0x8cd5,
        COLOR_ATTACHMENT0: 0x8ce0,
        COLOR_ATTACHMENT1: 0x8ce1,
        MAX_VIEWPORT_DIMS: 0x0d3a,
        MAX_TEXTURE_SIZE: 0x0d33,
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
        createBuffer: vi.fn(() => ({})),
        bindBuffer: vi.fn(),
        bufferData: vi.fn(),
        deleteBuffer: vi.fn(),
        getAttribLocation: vi.fn(() => 0),
        enableVertexAttribArray: vi.fn(),
        vertexAttribPointer: vi.fn(),
        useProgram: vi.fn(),
        getParameter: vi.fn((pname: number) => {
            if (pname === 0x0d3a) return options?.maxViewportDims ?? [8192, 8192];
            if (pname === 0x0d33) return options?.maxTextureSize ?? 8192;
            return null;
        }),
        getUniformLocation: vi.fn((_program: unknown, name: string) => {
            const loc = { name, id: nextLocId++ };
            uniforms.set(name, loc.id);
            return loc;
        }),
        uniform1i: vi.fn(),
        uniform1f: vi.fn((loc: unknown, val: number) => {
            uniform1fCalls.push({ loc, val });
        }),
        uniform2f: vi.fn(),
        uniform4f: vi.fn((loc: unknown, x: number, y: number, z: number, w: number) => {
            uniform4fCalls.push({ loc, values: [x, y, z, w] });
        }),
        viewport: vi.fn((x: number, y: number, w: number, h: number) => {
            viewportCalls.push([x, y, w, h]);
        }),
        clearColor: vi.fn(),
        clear: vi.fn(),
        drawArrays: vi.fn(),
        createTexture: vi.fn(() => ({})),
        deleteTexture: vi.fn(),
        activeTexture: vi.fn(),
        bindTexture: vi.fn(),
        pixelStorei: vi.fn(),
        texImage2D: vi.fn(),
        texParameteri: vi.fn(),
        getExtension: vi.fn(() => options?.transferCache ? {} : null),
        drawBuffers: options?.transferCache ? vi.fn() : undefined,
        createFramebuffer: vi.fn(() => ({})),
        bindFramebuffer: vi.fn(),
        framebufferTexture2D: vi.fn(),
        checkFramebufferStatus: vi.fn(() => options?.incompleteFramebuffer ? 0x8cd6 : 0x8cd5),
        deleteFramebuffer: vi.fn(),
        getError: vi.fn(() => 0),
    } as unknown as WebGLRenderingContext;

    return { gl, viewportCalls, uniform1fCalls, uniform4fCalls };
}

describe("optical transfer caching", () => {
    const frame = {
        width: 240, height: 120, radius: 20, bezel: 14, thickness: 40,
        scaleRatio: 2, ior: 1.5, blur: 0, surface: "convex_squircle" as const,
        tintColor: [1, 1, 1] as [number, number, number], tintOpacity: 0.12,
        highlight: 0.7, pixelRatio: 2,
    };

    function setup(options: Parameters<typeof createMockWebglContext>[0] = {}) {
        const { gl } = createMockWebglContext({ transferCache: true, ...options });
        const canvas = document.createElement("canvas");
        vi.spyOn(canvas, "getContext").mockReturnValue(gl);
        const renderer = GlassWebglRenderer.create(canvas)!;
        return { gl: gl as WebGL2RenderingContext, renderer };
    }

    it("builds once after geometry stabilizes and reuses optics across scene and lighting updates", () => {
        const { gl, renderer } = setup();
        renderer.render(frame);
        renderer.render(frame);
        expect(gl.createFramebuffer).not.toHaveBeenCalled();
        renderer.render(frame);
        expect(gl.drawArrays).toHaveBeenCalledTimes(4);
        expect(gl.framebufferTexture2D).toHaveBeenCalledTimes(2);
        const allocations = vi.mocked(gl.texImage2D).mock.calls.length;
        renderer.setSceneCanvas(document.createElement("canvas"));
        const uploads = vi.mocked(gl.texImage2D).mock.calls.length;
        for (const update of [
            { thickness: 80 }, { scaleRatio: 3 }, { tintOpacity: 0.5 }, { highlight: 0.9 },
            { blur: 6 }, { chromaticAberration: 0.12 },
            { sceneRect: { relX: 0.2, relY: 0.3, relW: 0.4, relH: 0.5 } },
        ]) renderer.render({ ...frame, ...update });
        expect(gl.drawArrays).toHaveBeenCalledTimes(11);
        expect(gl.texImage2D).toHaveBeenCalledTimes(uploads);
        expect(uploads).toBe(allocations + 1);
        expect(gl.framebufferTexture2D).toHaveBeenCalledTimes(2);
        renderer.dispose();
        expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(1);
        expect(gl.deleteTexture).toHaveBeenCalledTimes(4);
    });

    it.each([
        { width: 241 }, { width: 240.1 }, { height: 121 }, { radius: 28 }, { bezel: 22 },
        { pixelRatio: 3 }, { ior: 1.8 }, { surface: "lip" as const },
    ])("invalidates cached geometry for %j without rebuilding during continuous changes", (update) => {
        const { gl, renderer } = setup();
        for (let i = 0; i < 3; i++) renderer.render(frame);
        const draws = vi.mocked(gl.drawArrays).mock.calls.length;
        renderer.render({ ...frame, ...update });
        expect(gl.drawArrays).toHaveBeenCalledTimes(draws + 1);
        renderer.render({ ...frame, ...update });
        renderer.render({ ...frame, ...update });
        expect(gl.drawArrays).toHaveBeenCalledTimes(draws + 4);
        for (let i = 0; i < 6; i++) renderer.render({ ...frame, radius: 30 + i });
        expect(gl.drawArrays).toHaveBeenCalledTimes(draws + 10);
        renderer.dispose();
    });

    it.each([
        { transferCache: false }, { incompleteFramebuffer: true }, { maxTextureSize: 256 },
    ])("keeps the analytical WebGL shader when transfer targets are unavailable: %j", (options) => {
        const { gl, renderer } = setup(options);
        for (let i = 0; i < 6; i++) renderer.render(frame);
        expect(gl.drawArrays).toHaveBeenCalledTimes(6);
        renderer.dispose();
    });
});

describe("WebGL high-DPI pixel resolution and scene capture scaling", () => {
    const originalDpr = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");

    afterEach(() => {
        destroyLiquidGlass();
        delete (window as unknown as { __LG_FORCE_CHROMIUM__?: boolean }).__LG_FORCE_CHROMIUM__;
        if (originalDpr) {
            Object.defineProperty(window, "devicePixelRatio", originalDpr);
        }
        document.documentElement.classList.remove("dark");
        document.documentElement.removeAttribute("data-theme");
        document.body.innerHTML = "";
        vi.restoreAllMocks();
    });

    it("keeps rounded WebGL corners sharp across 1x, 2x, and 3x displays and lowers unrounded shapes", () => {
        Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
        expect(resolveWebglPixelRatio(undefined, 18)).toBe(2);

        Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
        expect(resolveWebglPixelRatio(undefined, 18)).toBe(2);

        Object.defineProperty(window, "devicePixelRatio", { value: 3, configurable: true });
        expect(resolveWebglPixelRatio(undefined, 18)).toBe(3);

        expect(resolveWebglPixelRatio(undefined, 0)).toBe(0.375);
        expect(resolveWebglPixelRatio(undefined, 2)).toBe(0.375);
        expect(resolveWebglPixelRatio(3, 0)).toBe(3);
        expect(resolveWebglPixelRatio(12)).toBe(4);
        expect(resolveWebglPixelRatio(0.5)).toBe(0.5);
    });

    it("sizes the WebGL canvas and viewport sharply for rounded shapes, lightly for unrounded shapes, and respects GPU bounds", () => {
        Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });

        const { gl, viewportCalls, uniform1fCalls, uniform4fCalls } = createMockWebglContext({
            maxViewportDims: [2048, 2048],
            maxTextureSize: 4096,
        });
        const canvas = document.createElement("canvas");
        vi.spyOn(canvas, "getContext").mockReturnValue(gl as unknown as RenderingContext);

        const renderer = GlassWebglRenderer.create(canvas);
        expect(renderer).not.toBeNull();

        renderer!.render({
            width: 300,
            height: 100,
            radius: 20,
            bezel: 14,
            thickness: 48,
            scaleRatio: 2.35,
            ior: 2.15,
            blur: 0.6,
            surface: "convex_squircle",
            tintColor: [1, 1, 1],
            tintOpacity: 0.12,
            highlight: 0.72,
        });

        expect(canvas.width).toBe(600);
        expect(canvas.height).toBe(200);
        expect(viewportCalls.at(-1)).toEqual([0, 0, 600, 200]);
        expect(uniform1fCalls.some((c) => (c.loc as { name?: string })?.name === "uDpr" && c.val === 2)).toBe(
            true,
        );

        renderer!.render({
            width: 2400,
            height: 1200,
            radius: 20,
            bezel: 14,
            thickness: 48,
            scaleRatio: 1.35,
            ior: 2.15,
            blur: 0.6,
            surface: "convex_squircle",
            tintColor: [1, 1, 1],
            tintOpacity: 0.12,
            highlight: 0.72,
            pixelRatio: 4,
        });

        expect(canvas.width).toBeLessThanOrEqual(2048);
        expect(canvas.height).toBeLessThanOrEqual(2048);

        renderer!.render({
            width: 300,
            height: 100,
            radius: 0,
            bezel: 14,
            thickness: 48,
            scaleRatio: 2.35,
            ior: 2.15,
            blur: 0.6,
            surface: "convex_squircle",
            tintColor: [1, 1, 1],
            tintOpacity: 0.12,
            highlight: 0.72,
        });

        expect(canvas.width).toBe(113);
        expect(canvas.height).toBe(38);
        const highlightCalls = uniform4fCalls.filter(
            (c) => (c.loc as { name?: string })?.name === "uHighlight",
        );
        expect(highlightCalls.at(-1)?.values[1]).toBe(0);

        renderer!.render({
            width: 300,
            height: 100,
            radius: 20,
            bezel: 14,
            thickness: 48,
            scaleRatio: 2.35,
            ior: 2.15,
            blur: 0.6,
            surface: "convex_squircle",
            tintColor: [1, 1, 1],
            tintOpacity: 0.12,
            highlight: 0.72,
            chromaticAberration: true,
        });
        expect(
            uniform4fCalls
                .filter((c) => (c.loc as { name?: string })?.name === "uHighlight")
                .at(-1)?.values[1],
        ).toBe(0.085);

        renderer!.render({
            width: 300,
            height: 100,
            radius: 20,
            bezel: 14,
            thickness: 48,
            scaleRatio: 2.35,
            ior: 2.15,
            blur: 0.6,
            surface: "convex_squircle",
            tintColor: [1, 1, 1],
            tintOpacity: 0.12,
            highlight: 0.72,
            chromaticAberration: 0.14,
        });
        expect(
            uniform4fCalls
                .filter((c) => (c.loc as { name?: string })?.name === "uHighlight")
                .at(-1)?.values[1],
        ).toBe(0.14);

        renderer!.dispose();
    });

    it("captures sharp scene textures up to 3072px for rounded corners and downscales to 0.5x for unrounded corners", () => {
        Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });

        const medium = resolveCaptureDimensions(1000, 800, undefined, 18);
        expect(medium).toEqual({ texWidth: 2000, texHeight: 1600 });

        const unrounded = resolveCaptureDimensions(1000, 800, undefined, 0);
        expect(unrounded).toEqual({ texWidth: 200, texHeight: 160 });

        const largeUnrounded = resolveCaptureDimensions(2400, 1600, undefined, 2);
        expect(Math.max(largeUnrounded.texWidth, largeUnrounded.texHeight)).toBeLessThanOrEqual(448);

        const tall = resolveCaptureDimensions(1280, 1600);
        expect(Math.max(tall.texWidth, tall.texHeight)).toBeLessThanOrEqual(3072);
        expect(tall.texWidth * tall.texHeight).toBeLessThanOrEqual(8_388_608);
    });

    it("uses dark backdrop fallback and re-captures when html.dark is toggled", async () => {
        const sceneEl = document.createElement("div");
        sceneEl.style.backgroundColor = "transparent";
        document.body.appendChild(sceneEl);
        vi.spyOn(sceneEl, "getBoundingClientRect").mockReturnValue({
            left: 0,
            top: 0,
            right: 400,
            bottom: 300,
            width: 400,
            height: 300,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });

        const fillStyles: string[] = [];
        const mockCtx = {
            imageSmoothingEnabled: false,
            imageSmoothingQuality: "low",
            globalAlpha: 1,
            setTransform: vi.fn(),
            fillRect: vi.fn(),
            set fillStyle(val: string) {
                fillStyles.push(val);
            },
            get fillStyle() {
                return fillStyles.at(-1) ?? "";
            },
        } as unknown as CanvasRenderingContext2D;

        const canvas = document.createElement("canvas");
        vi.spyOn(canvas, "getContext").mockReturnValue(mockCtx);

        document.documentElement.classList.add("dark");
        const ok = captureDomToCanvas(sceneEl, canvas, document.createRange());
        expect(ok).toBe(true);
        expect(fillStyles[0]).toBe("#0b0f19");

        const rafQueue: FrameRequestCallback[] = [];
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
            rafQueue.push(cb);
            return rafQueue.length;
        });
        vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
        const origCreateElement = document.createElement.bind(document);
        vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
            const el = origCreateElement(tagName);
            if (tagName.toLowerCase() === "canvas") {
                vi.spyOn(el as HTMLCanvasElement, "getContext").mockReturnValue(mockCtx);
            }
            return el;
        }) as typeof document.createElement);

        const listener = vi.fn();
        const controller = createSceneCaptureController(sceneEl);
        controller.subscribe(listener);
        const countAfterSubscribe = listener.mock.calls.length;
        expect(rafQueue.length).toBeGreaterThan(0);
        rafQueue.shift()!(16);
        expect(listener).toHaveBeenCalledTimes(countAfterSubscribe + 1);
        expect(fillStyles.at(-1)).toBe("#0b0f19");

        document.documentElement.classList.remove("dark");
        await Promise.resolve();
        expect(rafQueue.length).toBeGreaterThan(0);
        rafQueue.shift()!(32);
        expect(listener).toHaveBeenCalledTimes(countAfterSubscribe + 2);
        expect(fillStyles.at(-1)).toBe("#f3f2f6");

        controller.destroy();
    });

    it("supports WebGL sliders with default wrapper scene, auto fallback, and active drag refreshes", () => {
        const { gl } = createMockWebglContext();
        const mock2dCtx = {
            imageSmoothingEnabled: true,
            imageSmoothingQuality: "high",
            fillStyle: "",
            globalAlpha: 1,
            filter: "none",
            font: "",
            textBaseline: "middle",
            save: vi.fn(),
            restore: vi.fn(),
            beginPath: vi.fn(),
            roundRect: vi.fn(),
            fill: vi.fn(),
            setTransform: vi.fn(),
            fillRect: vi.fn(),
            drawImage: vi.fn(),
            translate: vi.fn(),
            transform: vi.fn(),
            fillText: vi.fn(),
            measureText: vi.fn(() => ({ width: 20 })),
        } as unknown as CanvasRenderingContext2D;

        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((type: string) => {
            if (type === "webgl2" || type === "webgl") {
                return gl as unknown as RenderingContext;
            }
            if (type === "2d") {
                return mock2dCtx as unknown as RenderingContext;
            }
            return null;
        });

        const rafQueue: FrameRequestCallback[] = [];
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
            rafQueue.push(cb);
            return rafQueue.length;
        });
        vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

        document.body.innerHTML = `<input id="vol-webgl" type="range" min="0" max="100" value="40" />`;
        const input = document.getElementById("vol-webgl") as HTMLInputElement;

        const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
            this: HTMLElement,
        ) {
            if (this.classList.contains("lg-slider-thumb")) {
                return { left: 80, top: 20, right: 134, bottom: 52, width: 54, height: 32 } as DOMRect;
            }
            return { left: 20, top: 20, right: 280, bottom: 54, width: 260, height: 34 } as DOMRect;
        });

        (window as unknown as { __LG_FORCE_CHROMIUM__?: boolean }).__LG_FORCE_CHROMIUM__ = false;
        const slider = input.glassEffect({ engine: "auto" });
        expect(slider.engine).toBe("webgl");

        const wrapper = input.closest(".lg-slider") as HTMLElement;
        const thumb = wrapper.querySelector(".lg-slider-thumb") as HTMLElement;
        Object.defineProperty(thumb, "offsetWidth", { value: 54, configurable: true });
        Object.defineProperty(thumb, "offsetHeight", { value: 32, configurable: true });

        const flushRaf = (startMs = 16, maxFrames = 24) => {
            let timestamp = startMs;
            for (let frame = 0; frame < maxFrames && rafQueue.length > 0; frame++) {
                rafQueue.shift()!(timestamp);
                timestamp += 16;
            }
        };

        flushRaf(16);
        expect(thumb.getAttribute("data-lg-engine")).toBe("webgl");
        expect(thumb.getAttribute("data-lg-webgl-scene")).toBe("1");

        const drawCountBeforeDrag = (gl.drawArrays as ReturnType<typeof vi.fn>).mock.calls.length;
        input.value = "85";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        flushRaf(32);
        expect((gl.drawArrays as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
            drawCountBeforeDrag,
        );

        rectSpy.mockRestore();
        slider.destroy();
        expect(document.querySelector(".lg-slider")).toBeNull();
    });

    it("clamps oversized scene textures to maxTextureSize and skips lost WebGL contexts", () => {
        const { gl } = createMockWebglContext({ maxTextureSize: 1024 });
        let lost = false;
        (gl as unknown as { isContextLost: () => boolean }).isContextLost = () => lost;

        const webglCanvas = document.createElement("canvas");
        vi.spyOn(webglCanvas, "getContext").mockReturnValue(gl as unknown as RenderingContext);

        const drawImageSpy = vi.fn();
        const origCreateElement = document.createElement.bind(document);
        vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
            const el = origCreateElement(tagName);
            if (tagName.toLowerCase() === "canvas") {
                vi.spyOn(el as HTMLCanvasElement, "getContext").mockReturnValue({
                    imageSmoothingEnabled: true,
                    imageSmoothingQuality: "high",
                    clearRect: vi.fn(),
                    drawImage: drawImageSpy,
                } as unknown as CanvasRenderingContext2D);
            }
            return el;
        }) as typeof document.createElement);

        const renderer = GlassWebglRenderer.create(webglCanvas)!;
        expect(renderer).not.toBeNull();

        const oversizedScene = origCreateElement("canvas");
        oversizedScene.width = 2048;
        oversizedScene.height = 1024;
        renderer.setSceneCanvas(oversizedScene);

        expect(drawImageSpy).toHaveBeenCalledTimes(1);
        const uploadedArg = (gl.texImage2D as ReturnType<typeof vi.fn>).mock.calls[0][5] as HTMLCanvasElement;
        expect(uploadedArg.width).toBeLessThanOrEqual(1024);
        expect(uploadedArg.height).toBeLessThanOrEqual(1024);

        const bindCallsBeforeRender = (gl.bindTexture as ReturnType<typeof vi.fn>).mock.calls.length;
        renderer.render({
            width: 240,
            height: 120,
            radius: 20,
            bezel: 14,
            thickness: 40,
            scaleRatio: 2,
            ior: 1.8,
            blur: 0,
            surface: "convex_squircle",
            tintColor: [1, 1, 1],
            tintOpacity: 0.12,
            highlight: 0.7,
            sceneRect: { relX: 0.1, relY: 0.1, relW: 0.3, relH: 0.2 },
        });
        expect((gl.bindTexture as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
            bindCallsBeforeRender,
        );

        lost = true;
        const drawCallsBeforeLost = (gl.drawArrays as ReturnType<typeof vi.fn>).mock.calls.length;
        renderer.render({
            width: 240,
            height: 120,
            radius: 20,
            bezel: 14,
            thickness: 40,
            scaleRatio: 2,
            ior: 1.8,
            blur: 0,
            surface: "convex_squircle",
            tintColor: [1, 1, 1],
            tintOpacity: 0.12,
            highlight: 0.7,
        });
        expect((gl.drawArrays as ReturnType<typeof vi.fn>).mock.calls.length).toBe(drawCallsBeforeLost);
        renderer.dispose();
    });
});
