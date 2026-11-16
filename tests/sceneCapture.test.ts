import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiquidGlass, destroyLiquidGlass } from "../src/index.js";
import {
    captureDomToCanvas,
    createSceneCaptureController,
} from "../src/core/sceneCapture.js";

function createMockCanvas2dContext() {
    const context = {
        canvas: null as unknown as HTMLCanvasElement,
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        closePath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        arcTo: vi.fn(),
        rect: vi.fn(),
        clip: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        strokeRect: vi.fn(),
        fillRect: vi.fn(),
        fillText: vi.fn(),
        drawImage: vi.fn(),
        setTransform: vi.fn(),
        translate: vi.fn(),
        transform: vi.fn(),
        measureText: vi.fn(() => ({ width: 20 })),
        createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
        createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
        fillStyle: "#000000",
        strokeStyle: "#000000",
        lineWidth: 1,
        shadowColor: "rgba(0,0,0,0)",
        shadowBlur: 0,
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        globalAlpha: 1,
        font: "16px sans-serif",
        textAlign: "left" as CanvasTextAlign,
        textBaseline: "top" as CanvasTextBaseline,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: "high" as ImageSmoothingQuality,
    };
    return context;
}

function setRect(el: Element, width: number, height: number, left = 0, top = 0) {
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

describe("sceneCapture upgrades and visibility gating", () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const originalIntersectionObserver = globalThis.IntersectionObserver;
    const originalImage = globalThis.Image;

    afterEach(() => {
        destroyLiquidGlass();
        document.body.innerHTML = "";
        Object.defineProperty(URL, "createObjectURL", {
            configurable: true,
            writable: true,
            value: originalCreateObjectURL,
        });
        Object.defineProperty(URL, "revokeObjectURL", {
            configurable: true,
            writable: true,
            value: originalRevokeObjectURL,
        });
        globalThis.IntersectionObserver = originalIntersectionObserver;
        globalThis.Image = originalImage;
        vi.restoreAllMocks();
    });

    it("draws outer box-shadow, inset shadow, uniform border, and per-side border", () => {
        const sceneEl = document.createElement("div");
        const cardEl = document.createElement("div");
        cardEl.style.backgroundColor = "rgb(255, 255, 255)";
        cardEl.style.borderRadius = "12px";
        cardEl.style.border = "2px solid rgb(20, 40, 80)";
        cardEl.style.boxShadow = "0px 4px 12px rgba(0, 0, 0, 0.25), inset 0px 2px 6px rgba(255, 255, 255, 0.4)";

        const accentEl = document.createElement("div");
        accentEl.style.borderTopWidth = "3px";
        accentEl.style.borderTopStyle = "solid";
        accentEl.style.borderTopColor = "rgb(220, 30, 50)";
        accentEl.style.borderBottomWidth = "0px";
        accentEl.style.borderLeftWidth = "0px";
        accentEl.style.borderRightWidth = "0px";

        sceneEl.append(cardEl, accentEl);
        document.body.appendChild(sceneEl);

        setRect(sceneEl, 400, 300);
        setRect(cardEl, 200, 100, 20, 20);
        setRect(accentEl, 120, 40, 20, 140);

        const canvas = document.createElement("canvas");
        const mockCtx = createMockCanvas2dContext();
        mockCtx.canvas = canvas;
        vi.spyOn(canvas, "getContext").mockReturnValue(mockCtx as unknown as CanvasRenderingContext2D);

        const rendered = captureDomToCanvas(sceneEl, canvas, document.createRange(), 1, 12);
        expect(rendered).toBe(true);
        expect(mockCtx.stroke).toHaveBeenCalled();
        expect(mockCtx.fill).toHaveBeenCalled();
        expect(mockCtx.fillRect).toHaveBeenCalled();
    });

    it("draws fitted <img> elements with object-fit cover and contain", () => {
        const sceneEl = document.createElement("div");
        const coverImg = document.createElement("img");
        coverImg.style.objectFit = "cover";
        coverImg.style.objectPosition = "50% 50%";
        Object.defineProperty(coverImg, "complete", { value: true });
        Object.defineProperty(coverImg, "naturalWidth", { value: 400 });
        Object.defineProperty(coverImg, "naturalHeight", { value: 200 });

        const containImg = document.createElement("img");
        containImg.style.objectFit = "contain";
        containImg.style.borderRadius = "8px";
        Object.defineProperty(containImg, "complete", { value: true });
        Object.defineProperty(containImg, "naturalWidth", { value: 100 });
        Object.defineProperty(containImg, "naturalHeight", { value: 200 });

        sceneEl.append(coverImg, containImg);
        document.body.appendChild(sceneEl);
        setRect(sceneEl, 300, 300);
        setRect(coverImg, 100, 100, 10, 10);
        setRect(containImg, 100, 100, 130, 10);

        const canvas = document.createElement("canvas");
        const mockCtx = createMockCanvas2dContext();
        mockCtx.canvas = canvas;
        vi.spyOn(canvas, "getContext").mockReturnValue(mockCtx as unknown as CanvasRenderingContext2D);

        const rendered = captureDomToCanvas(sceneEl, canvas, document.createRange(), 1, 0);
        expect(rendered).toBe(true);
        expect(mockCtx.drawImage).toHaveBeenCalledTimes(2);

        const coverCall = mockCtx.drawImage.mock.calls[0];
        expect(coverCall[0]).toBe(coverImg);
        expect(coverCall[3]).toBeCloseTo(200, 3);
        expect(coverCall[4]).toBeCloseTo(100, 3);

        const containCall = mockCtx.drawImage.mock.calls[1];
        expect(containCall[0]).toBe(containImg);
        expect(containCall[3]).toBeCloseTo(50, 3);
        expect(containCall[4]).toBeCloseTo(100, 3);
    });

    it("rasterizes inline <svg> asynchronously, calls onAsyncAssetReady, and draws cached result on recapture", () => {
        const createdImages: Array<{ src: string; onload: (() => void) | null; complete: boolean; naturalWidth: number; naturalHeight: number }> = [];
        class MockImage {
            src = "";
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            complete = false;
            naturalWidth = 64;
            naturalHeight = 64;
            constructor() {
                createdImages.push(this);
            }
        }
        globalThis.Image = MockImage as unknown as typeof Image;
        Object.defineProperty(URL, "createObjectURL", {
            configurable: true,
            value: vi.fn(() => "blob:inline-svg"),
        });
        Object.defineProperty(URL, "revokeObjectURL", {
            configurable: true,
            value: vi.fn(),
        });

        const sceneEl = document.createElement("div");
        const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svgEl.setAttribute("width", "64");
        svgEl.setAttribute("height", "64");
        const rectNode = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rectNode.setAttribute("width", "64");
        rectNode.setAttribute("height", "64");
        svgEl.appendChild(rectNode);
        sceneEl.appendChild(svgEl);
        document.body.appendChild(sceneEl);

        setRect(sceneEl, 200, 200);
        setRect(svgEl, 64, 64, 20, 20);

        const canvas = document.createElement("canvas");
        const mockCtx = createMockCanvas2dContext();
        mockCtx.canvas = canvas;
        vi.spyOn(canvas, "getContext").mockReturnValue(mockCtx as unknown as CanvasRenderingContext2D);

        const onAsyncReady = vi.fn();
        captureDomToCanvas(sceneEl, canvas, document.createRange(), 1, 0, null, onAsyncReady);
        expect(createdImages.length).toBe(1);
        expect(mockCtx.drawImage).not.toHaveBeenCalled();

        createdImages[0].complete = true;
        createdImages[0].onload?.();
        expect(onAsyncReady).toHaveBeenCalledTimes(1);

        captureDomToCanvas(sceneEl, canvas, document.createRange(), 1, 0, null, onAsyncReady);
        expect(mockCtx.drawImage).toHaveBeenCalledTimes(1);
    });

    it("gates sceneCapture scheduling with setActive and resumes dirty capture", () => {
        const queuedCallbacks: FrameRequestCallback[] = [];
        vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
            queuedCallbacks.push(cb);
            return queuedCallbacks.length;
        });
        vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});

        const sceneEl = document.createElement("div");
        document.body.appendChild(sceneEl);
        setRect(sceneEl, 240, 120);

        const controller = createSceneCaptureController(sceneEl);
        expect(queuedCallbacks.length).toBe(1);

        controller.setActive?.(false);
        const pausedCount = queuedCallbacks.length;
        controller.scheduleCapture();
        expect(queuedCallbacks.length).toBe(pausedCount);

        controller.setActive?.(true);
        expect(queuedCallbacks.length).toBe(pausedCount + 1);
        controller.destroy();
    });

    it("pauses WebGL render and scene capture when IntersectionObserver reports offscreen", () => {
        let ioCallback: IntersectionObserverCallback | null = null;
        class MockIntersectionObserver {
            constructor(cb: IntersectionObserverCallback) {
                ioCallback = cb;
            }
            observe = vi.fn();
            unobserve = vi.fn();
            disconnect = vi.fn();
            takeRecords = vi.fn(() => []);
            root = null;
            rootMargin = "120px";
            thresholds = [0];
        }
        globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;

        const rafQueue: FrameRequestCallback[] = [];
        vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
            rafQueue.push(cb);
            return rafQueue.length;
        });
        vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});

        const canvasGetContextOrig = HTMLCanvasElement.prototype.getContext;
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
            this: HTMLCanvasElement,
            type: string,
        ) {
            if (type === "2d") {
                return createMockCanvas2dContext() as unknown as CanvasRenderingContext2D;
            }
            if (type === "webgl2") {
                return {
                    getParameter: vi.fn((param: number) => (param === 0x0d33 ? 4096 : 0)),
                    getExtension: vi.fn(() => ({})),
                    createShader: vi.fn(() => ({})),
                    shaderSource: vi.fn(),
                    compileShader: vi.fn(),
                    getShaderParameter: vi.fn(() => true),
                    createProgram: vi.fn(() => ({})),
                    attachShader: vi.fn(),
                    bindAttribLocation: vi.fn(),
                    linkProgram: vi.fn(),
                    getProgramParameter: vi.fn(() => true),
                    deleteShader: vi.fn(),
                    getUniformLocation: vi.fn(() => ({})),
                    getAttribLocation: vi.fn(() => 0),
                    clearColor: vi.fn(),
                    clear: vi.fn(),
                    createBuffer: vi.fn(() => ({})),
                    bindBuffer: vi.fn(),
                    bufferData: vi.fn(),
                    enableVertexAttribArray: vi.fn(),
                    vertexAttribPointer: vi.fn(),
                    createTexture: vi.fn(() => ({})),
                    bindTexture: vi.fn(),
                    texParameteri: vi.fn(),
                    texImage2D: vi.fn(),
                    createFramebuffer: vi.fn(() => ({})),
                    bindFramebuffer: vi.fn(),
                    framebufferTexture2D: vi.fn(),
                    drawBuffers: vi.fn(),
                    checkFramebufferStatus: vi.fn(() => 0x8cd5),
                    viewport: vi.fn(),
                    useProgram: vi.fn(),
                    activeTexture: vi.fn(),
                    uniform1i: vi.fn(),
                    uniform1f: vi.fn(),
                    uniform2f: vi.fn(),
                    uniform3f: vi.fn(),
                    uniform4f: vi.fn(),
                    drawArrays: vi.fn(),
                    deleteFramebuffer: vi.fn(),
                    deleteTexture: vi.fn(),
                    deleteBuffer: vi.fn(),
                    deleteProgram: vi.fn(),
                } as unknown as WebGL2RenderingContext;
            }
            return canvasGetContextOrig.call(this, type as "2d");
        });

        const sceneEl = document.createElement("div");
        const targetEl = document.createElement("div");
        document.body.append(sceneEl, targetEl);
        setRect(sceneEl, 400, 400);
        setRect(targetEl, 180, 60, 40, 40);

        const glass = createLiquidGlass(targetEl, {
            engine: "webgl",
            sceneElement: sceneEl,
        });

        expect(ioCallback).not.toBeNull();
        const queuedBeforeOffscreen = rafQueue.length;
        ioCallback!(
            [{ target: targetEl, isIntersecting: false } as unknown as IntersectionObserverEntry],
            {} as IntersectionObserver,
        );
        glass.refresh();
        expect(rafQueue.length).toBe(queuedBeforeOffscreen);

        ioCallback!(
            [{ target: targetEl, isIntersecting: true } as unknown as IntersectionObserverEntry],
            {} as IntersectionObserver,
        );
        expect(rafQueue.length).toBeGreaterThan(queuedBeforeOffscreen);

        glass.destroy();
    });

    it("zeroes capture canvas dimensions on destroy to free GPU memory", () => {
        const sceneEl = document.createElement("div");
        document.body.appendChild(sceneEl);
        setRect(sceneEl, 200, 200);

        const controller = createSceneCaptureController(sceneEl);
        controller.destroy();
        expect(controller.canvas).toBeNull();
    });
});
