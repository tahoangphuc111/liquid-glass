import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiquidGlass, destroyLiquidGlass } from "../src/index.js";
import {
    acquireSharedSceneCapture,
    captureDomToCanvas,
    createSceneCaptureController,
    resolveCaptureDimensions,
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

    it("recaptures nested scroll changes and keeps subscriptions from independent leases", async () => {
        vi.useFakeTimers();
        const context = createMockCanvas2dContext();
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
        const source = document.body.appendChild(document.createElement("section"));
        const scrollBox = source.appendChild(document.createElement("div"));
        setRect(source, 200, 100);
        setRect(scrollBox, 180, 80);
        const leaseA = acquireSharedSceneCapture(source);
        const leaseB = acquireSharedSceneCapture(source);
        const listener = vi.fn();
        leaseA.subscribe(listener);
        leaseB.subscribe(listener);
        try {
            await vi.advanceTimersByTimeAsync(32);
            expect(listener).toHaveBeenCalledTimes(2);
            leaseA.destroy();
            scrollBox.dispatchEvent(new Event("scroll"));
            scrollBox.dispatchEvent(new Event("scroll"));
            await vi.advanceTimersByTimeAsync(140);
            expect(listener).toHaveBeenCalledTimes(3);
            expect(listener.mock.calls[2]?.[0]).toBe(listener.mock.calls[0]?.[0]);
        } finally {
            leaseA.destroy();
            leaseB.destroy();
            vi.useRealTimers();
        }
    });

    it("ignores scroll and load events inside descendant glass surfaces omitted from the capture", async () => {
        vi.useFakeTimers();
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
            createMockCanvas2dContext() as unknown as CanvasRenderingContext2D,
        );
        const source = document.body.appendChild(document.createElement("section"));
        source.setAttribute("data-lg-surface", "convex_squircle");
        setRect(source, 200, 100);
        const managed = source.appendChild(document.createElement("div"));
        managed.setAttribute("data-lg-surface", "convex_squircle");
        const excluded = managed.appendChild(document.createElement("div"));
        const included = source.appendChild(document.createElement("div"));
        const capture = createSceneCaptureController(source);
        const listener = vi.fn();
        capture.subscribe(listener);
        try {
            await vi.advanceTimersByTimeAsync(32);
            expect(listener).toHaveBeenCalledTimes(1);
            excluded.dispatchEvent(new Event("load"));
            excluded.dispatchEvent(new Event("scroll"));
            await vi.advanceTimersByTimeAsync(160);
            expect(listener).toHaveBeenCalledTimes(1);
            included.dispatchEvent(new Event("scroll"));
            await vi.advanceTimersByTimeAsync(32);
            expect(listener).toHaveBeenCalledTimes(2);
        } finally {
            capture.destroy();
            vi.useRealTimers();
        }
    });

    it("notifies only visible leases and replays the newest shared capture once on resume", async () => {
        vi.useFakeTimers();
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
            createMockCanvas2dContext() as unknown as CanvasRenderingContext2D,
        );
        const source = document.body.appendChild(document.createElement("section"));
        setRect(source, 200, 100);
        const visible = acquireSharedSceneCapture(source);
        const paused = acquireSharedSceneCapture(source);
        const visibleListener = vi.fn();
        const pausedListener = vi.fn();
        const lateListener = vi.fn();
        const removedListener = vi.fn();
        visible.subscribe(visibleListener);
        paused.subscribe(pausedListener);
        try {
            await vi.advanceTimersByTimeAsync(32);
            expect(visibleListener).toHaveBeenCalledTimes(1);
            expect(pausedListener).toHaveBeenCalledTimes(1);

            paused.setActive?.(false);
            paused.subscribe(lateListener);
            const unsubscribe = paused.subscribe(removedListener);
            for (let index = 0; index < 3; index++) {
                visible.scheduleCapture();
                await vi.advanceTimersByTimeAsync(32);
            }
            expect(visibleListener).toHaveBeenCalledTimes(4);
            expect(pausedListener).toHaveBeenCalledTimes(1);
            expect(lateListener).not.toHaveBeenCalled();
            unsubscribe();

            paused.setActive?.(true);
            expect(pausedListener).toHaveBeenCalledTimes(2);
            expect(pausedListener).toHaveBeenLastCalledWith(visible.canvas, source);
            expect(lateListener).toHaveBeenCalledOnce();
            expect(removedListener).not.toHaveBeenCalled();
            paused.setActive?.(false);
            paused.setActive?.(true);
            await vi.advanceTimersByTimeAsync(160);
            expect(visibleListener).toHaveBeenCalledTimes(4);
            expect(pausedListener).toHaveBeenCalledTimes(2);
            expect(lateListener).toHaveBeenCalledOnce();
        } finally {
            visible.destroy();
            paused.destroy();
            vi.useRealTimers();
        }
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

    it("resolves percentage border-radius values relative to element dimensions", () => {
        const sceneEl = document.createElement("div");
        const circleEl = document.createElement("div");
        circleEl.style.backgroundColor = "rgb(20, 120, 220)";
        circleEl.style.borderTopLeftRadius = "50%";
        sceneEl.appendChild(circleEl);
        document.body.appendChild(sceneEl);

        setRect(sceneEl, 400, 400);
        setRect(circleEl, 200, 200);

        const roundRectSpy = vi.fn();
        const mockCtx = {
            imageSmoothingEnabled: true,
            imageSmoothingQuality: "high",
            setTransform: vi.fn(),
            fillRect: vi.fn(),
            fill: vi.fn(),
            beginPath: vi.fn(),
            roundRect: roundRectSpy,
            save: vi.fn(),
            restore: vi.fn(),
            fillStyle: "",
            globalAlpha: 1,
        } as unknown as CanvasRenderingContext2D;

        const outCanvas = document.createElement("canvas");
        vi.spyOn(outCanvas, "getContext").mockReturnValue(mockCtx);

        const ok = captureDomToCanvas(sceneEl, outCanvas, document.createRange(), 1, 20);
        expect(ok).toBe(true);
        expect(roundRectSpy).toHaveBeenCalledWith(0, 0, 200, 200, 100);
    });

    it("reuses a single shared scene capture controller and canvas across multiple leases on the same element", () => {
        vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
            cb(16);
            return 1;
        });
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
            return createMockCanvas2dContext() as unknown as RenderingContext;
        });

        const sceneEl = document.createElement("div");
        sceneEl.style.backgroundColor = "rgb(30, 60, 90)";
        document.body.appendChild(sceneEl);
        setRect(sceneEl, 320, 200);

        const leaseA = acquireSharedSceneCapture(sceneEl, () => ({ radius: 24 }));
        const leaseB = acquireSharedSceneCapture(sceneEl, () => ({ pixelRatio: 1, radius: 24 }));

        expect(leaseA.source).toBe(sceneEl);
        expect(leaseB.source).toBe(sceneEl);
        expect(leaseA.canvas).not.toBeNull();
        expect(leaseA.canvas).toBe(leaseB.canvas);

        leaseA.destroy();
        expect(leaseB.canvas).not.toBeNull();

        leaseB.destroy();
        expect(leaseB.canvas).toBeNull();
    });

    it("paces repeated invalidations by capture cost and flushes an explicit refresh immediately", () => {
        vi.useFakeTimers();
        const source = document.body.appendChild(document.createElement("div"));
        setRect(source, 240, 40);
        const clock = performance.now.bind(performance);
        let paintingTime = 0;
        vi.spyOn(performance, "now").mockImplementation(() => clock() + paintingTime);
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
            paintingTime += 40;
            return createMockCanvas2dContext() as unknown as RenderingContext;
        });
        const capture = createSceneCaptureController(source);
        const listener = vi.fn();
        capture.subscribe(listener);
        try {
            vi.advanceTimersByTime(16);
            expect(listener).toHaveBeenCalledTimes(1);
            for (let i = 0; i < 10; i++) source.dispatchEvent(new Event("load"));
            vi.advanceTimersByTime(320);
            expect(listener).toHaveBeenCalledTimes(1);
            vi.advanceTimersByTime(64);
            expect(listener).toHaveBeenCalledTimes(2);
            source.dispatchEvent(new Event("load"));
            capture.scheduleCapture();
            vi.advanceTimersByTime(16);
            expect(listener).toHaveBeenCalledTimes(3);
            vi.advanceTimersByTime(1000);
            expect(listener).toHaveBeenCalledTimes(3);
        } finally {
            capture.destroy();
            vi.useRealTimers();
        }
    });

    it("coalesces root style mutations while applying theme changes on the next frame", async () => {
        vi.useFakeTimers();
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
            createMockCanvas2dContext() as unknown as CanvasRenderingContext2D,
        );
        const source = document.body.appendChild(document.createElement("section"));
        setRect(source, 240, 40);
        const capture = createSceneCaptureController(source);
        const listener = vi.fn();
        capture.subscribe(listener);
        const root = document.documentElement;
        const previousTheme = root.getAttribute("data-theme");
        try {
            await vi.advanceTimersByTimeAsync(32);
            expect(listener).toHaveBeenCalledTimes(1);
            for (let index = 0; index < 5; index++) {
                root.style.setProperty("--lg-test-animated-style", String(index));
                await vi.advanceTimersByTimeAsync(16);
            }
            expect(listener).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(32);
            expect(listener).toHaveBeenCalledTimes(2);

            root.style.setProperty("--lg-test-animated-style", "5");
            root.setAttribute("data-theme", "lg-test-dark");
            await vi.advanceTimersByTimeAsync(16);
            expect(listener).toHaveBeenCalledTimes(3);
            await vi.advanceTimersByTimeAsync(160);
            expect(listener).toHaveBeenCalledTimes(3);

            source.style.setProperty("--lg-local-style", "1");
            source.setAttribute("data-theme", "dark");
            await vi.advanceTimersByTimeAsync(16);
            expect(listener).toHaveBeenCalledTimes(4);
        } finally {
            capture.destroy();
            root.style.removeProperty("--lg-test-animated-style");
            if (previousTheme === null) root.removeAttribute("data-theme");
            else root.setAttribute("data-theme", previousTheme);
            vi.useRealTimers();
        }
    });

    it("shares document listeners across scene sources and detaches after the last capture", async () => {
        vi.useFakeTimers();
        const addWindowListener = vi.spyOn(window, "addEventListener");
        const removeWindowListener = vi.spyOn(window, "removeEventListener");
        const addDocumentListener = vi.spyOn(document, "addEventListener");
        const removeDocumentListener = vi.spyOn(document, "removeEventListener");
        const observeMutations = vi.spyOn(MutationObserver.prototype, "observe");
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
            createMockCanvas2dContext() as unknown as CanvasRenderingContext2D,
        );
        const first = document.body.appendChild(document.createElement("section"));
        const second = document.body.appendChild(document.createElement("section"));
        setRect(first, 200, 80);
        setRect(second, 200, 80);
        const firstCapture = createSceneCaptureController(first);
        const secondCapture = createSceneCaptureController(second);
        const firstPaint = vi.fn();
        const secondPaint = vi.fn();
        firstCapture.subscribe(firstPaint);
        secondCapture.subscribe(secondPaint);
        const root = document.documentElement;
        const previousTheme = root.getAttribute("data-theme");
        try {
            const resizeListeners = addWindowListener.mock.calls.filter(([type]) => type === "resize");
            const visibilityListeners = addDocumentListener.mock.calls.filter(([type]) => type === "visibilitychange");
            expect(resizeListeners).toHaveLength(1);
            expect(visibilityListeners).toHaveLength(1);
            expect(observeMutations.mock.calls.filter(([target]) => target === root)).toHaveLength(1);
            expect(observeMutations.mock.calls.filter(([target]) => target === document.body)).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(32);
            root.setAttribute("data-theme", "lg-shared-signal-dark");
            await vi.advanceTimersByTimeAsync(16);
            expect(firstPaint).toHaveBeenCalledTimes(2);
            expect(secondPaint).toHaveBeenCalledTimes(2);

            firstCapture.destroy();
            expect(removeWindowListener).not.toHaveBeenCalledWith("resize", resizeListeners[0]![1]);
            root.setAttribute("data-theme", "lg-shared-signal-light");
            await vi.advanceTimersByTimeAsync(16);
            expect(firstPaint).toHaveBeenCalledTimes(2);
            expect(secondPaint).toHaveBeenCalledTimes(3);

            secondCapture.destroy();
            expect(removeWindowListener).toHaveBeenCalledWith("resize", resizeListeners[0]![1]);
            expect(removeDocumentListener).toHaveBeenCalledWith("visibilitychange", visibilityListeners[0]![1]);
        } finally {
            firstCapture.destroy();
            secondCapture.destroy();
            if (previousTheme === null) root.removeAttribute("data-theme");
            else root.setAttribute("data-theme", previousTheme);
            vi.useRealTimers();
        }
    });

    it("recaptures after hidden or SVG attribute changes and after a video becomes ready or seeks", async () => {
        vi.useFakeTimers();
        const context = createMockCanvas2dContext();
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
            context as unknown as CanvasRenderingContext2D,
        );
        const source = document.body.appendChild(document.createElement("section"));
        source.setAttribute("data-lg-surface", "");
        const content = source.appendChild(document.createElement("div"));
        const video = content.appendChild(document.createElement("video"));
        const svgNs = "http://www.w3.org/2000/svg";
        const svg = source.appendChild(document.createElementNS(svgNs, "svg"));
        const shape = svg.appendChild(document.createElementNS(svgNs, "rect"));
        setRect(source, 200, 80);
        setRect(content, 80, 40);
        setRect(video, 80, 40);
        let readyState = 0;
        Object.defineProperties(video, {
            readyState: { get: () => readyState },
            videoWidth: { value: 80 },
            videoHeight: { value: 40 },
        });
        const capture = createSceneCaptureController(source);
        const paint = vi.fn();
        capture.subscribe(paint);
        try {
            await vi.advanceTimersByTimeAsync(32);
            expect(paint).toHaveBeenCalledTimes(1);
            readyState = 2;
            video.dispatchEvent(new Event("loadeddata"));
            await vi.advanceTimersByTimeAsync(140);
            expect(paint).toHaveBeenCalledTimes(2);
            expect(context.drawImage.mock.calls[0]?.[0]).toBe(video);

            video.dispatchEvent(new Event("seeked"));
            await vi.advanceTimersByTimeAsync(140);
            expect(paint).toHaveBeenCalledTimes(3);

            shape.setAttribute("fill", "red");
            await vi.advanceTimersByTimeAsync(140);
            expect(paint).toHaveBeenCalledTimes(4);

            context.drawImage.mockClear();
            content.hidden = true;
            await vi.advanceTimersByTimeAsync(140);
            expect(paint).toHaveBeenCalledTimes(5);
            expect(context.drawImage).not.toHaveBeenCalled();
        } finally {
            capture.destroy();
            vi.useRealTimers();
        }
    });

    it("invalidates collapsed scenes once and tells a paused shared lease when it resumes", async () => {
        vi.useFakeTimers();
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
            createMockCanvas2dContext() as unknown as CanvasRenderingContext2D,
        );
        const source = document.body.appendChild(document.createElement("section"));
        setRect(source, 200, 80);
        const capture = acquireSharedSceneCapture(source);
        const paused = acquireSharedSceneCapture(source);
        const widths: number[] = [];
        const pausedWidths: number[] = [];
        capture.subscribe((canvas) => widths.push(canvas.width));
        paused.subscribe((canvas) => pausedWidths.push(canvas.width));
        try {
            await vi.advanceTimersByTimeAsync(32);
            const canvas = capture.canvas!;
            const initialWidth = canvas.width;
            paused.setActive?.(false);
            setRect(source, 0, 0);
            capture.scheduleCapture();
            await vi.advanceTimersByTimeAsync(32);
            expect(capture.canvas).toBeNull();
            expect(widths).toEqual([initialWidth, 0]);
            expect(pausedWidths).toEqual([initialWidth]);
            capture.scheduleCapture();
            await vi.advanceTimersByTimeAsync(32);
            expect(widths).toHaveLength(2);

            paused.setActive?.(true);
            expect(pausedWidths).toEqual([initialWidth, 0]);
            setRect(source, 200, 80);
            capture.scheduleCapture();
            await vi.advanceTimersByTimeAsync(32);
            expect(capture.canvas).toBe(canvas);
            expect(widths).toEqual([initialWidth, 0, initialWidth]);
            expect(pausedWidths).toEqual(widths);
        } finally {
            paused.destroy();
            capture.destroy();
            vi.useRealTimers();
        }
    });

    it("keeps overflowing content visible on the unclipped axis", () => {
        const source = document.body.appendChild(document.createElement("section"));
        const clip = source.appendChild(document.createElement("div"));
        clip.style.overflowX = "clip";
        clip.style.overflowY = "visible";
        const visible = clip.appendChild(document.createElement("div"));
        const clipped = clip.appendChild(document.createElement("div"));
        visible.style.backgroundColor = "lime";
        clipped.style.backgroundColor = "red";
        setRect(source, 200, 160);
        setRect(clip, 80, 40, 10, 10);
        setRect(visible, 30, 20, 20, 80);
        setRect(clipped, 30, 20, 100, 80);
        const canvas = document.createElement("canvas");
        const context = createMockCanvas2dContext();
        vi.spyOn(canvas, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);

        expect(captureDomToCanvas(source, canvas, document.createRange(), 1)).toBe(true);
        expect(context.fillRect).toHaveBeenCalledWith(20, 80, 30, 20);
        expect(context.fillRect).not.toHaveBeenCalledWith(100, 80, 30, 20);
    });

    it("paints the ancestor behind a nearly opaque scene on every capture", () => {
        const parent = document.body.appendChild(document.createElement("div"));
        parent.style.backgroundColor = "blue";
        const source = parent.appendChild(document.createElement("section"));
        source.style.backgroundColor = "rgba(255, 0, 0, 0.99)";
        setRect(source, 160, 100);
        const canvas = document.createElement("canvas");
        const context = createMockCanvas2dContext();
        vi.spyOn(canvas, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
        const colors: string[] = [];
        context.fillRect.mockImplementation(() => { colors.push(context.fillStyle); });
        const range = document.createRange();

        expect(captureDomToCanvas(source, canvas, range, 1)).toBe(true);
        parent.style.backgroundColor = "lime";
        expect(captureDomToCanvas(source, canvas, range, 1)).toBe(true);

        expect(colors).toEqual([
            "rgb(0, 0, 255)", "rgba(255, 0, 0, 0.99)",
            "rgb(0, 255, 0)", "rgba(255, 0, 0, 0.99)",
        ]);
    });

    it("skips canvas draws for clipped lines in long text", () => {
        const source = document.body.appendChild(document.createElement("section"));
        const paragraph = source.appendChild(document.createElement("pre"));
        paragraph.style.whiteSpace = "pre";
        paragraph.textContent = Array.from({ length: 100 }, (_, index) => `Line ${index}`).join("\n");
        setRect(source, 160, 60);
        const canvas = document.createElement("canvas");
        const context = createMockCanvas2dContext();
        vi.spyOn(canvas, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
        const range = document.createRange();
        Object.defineProperty(range, "getClientRects", {
            value: () => Array.from({ length: 100 }, (_, index) => new DOMRect(8, index * 20, 60, 20)),
        });

        expect(captureDomToCanvas(source, canvas, range, 1)).toBe(true);
        expect(context.fillText.mock.calls).toEqual([
            ["Line 0", 8, 10],
            ["Line 1", 8, 30],
            ["Line 2", 8, 50],
            ["Line 3", 8, 70],
        ]);
    });

    it("keeps automatic rounded capture quality when a second lease requests a lower or invalid scale", () => {
        vi.useFakeTimers();
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
            createMockCanvas2dContext() as unknown as CanvasRenderingContext2D,
        );
        const source = document.body.appendChild(document.createElement("section"));
        setRect(source, 160, 100);
        const low = acquireSharedSceneCapture(source, () => ({ pixelRatio: 0.5, radius: 0 }));
        let rounded: ReturnType<typeof acquireSharedSceneCapture> | undefined;
        let invalid: ReturnType<typeof acquireSharedSceneCapture> | undefined;
        try {
            vi.advanceTimersByTime(32);
            expect(low.canvas?.width).toBe(80);
            rounded = acquireSharedSceneCapture(source, () => ({ radius: 12 }));
            invalid = acquireSharedSceneCapture(source, () => ({ radius: 0, pixelRatio: NaN }));
            vi.advanceTimersByTime(32);
            const { texWidth } = resolveCaptureDimensions(160, 100, undefined, 12);
            expect(low.canvas?.width).toBe(texWidth);
            rounded.destroy();
            vi.advanceTimersByTime(32);
            expect(low.canvas?.width).toBe(80);
        } finally {
            low.destroy();
            rounded?.destroy();
            invalid?.destroy();
            vi.useRealTimers();
        }
    });

    it("shrinks a shared capture when its last rounded consumer leaves", () => {
        vi.useFakeTimers();
        try {
            vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() =>
                createMockCanvas2dContext() as unknown as RenderingContext);
            const source = document.body.appendChild(document.createElement("div"));
            setRect(source, 320, 200);
            const square = acquireSharedSceneCapture(source, () => ({ radius: 0 }));
            const rounded = acquireSharedSceneCapture(source, () => ({ radius: 1 }));
            vi.advanceTimersByTime(32);
            expect(square.canvas!.width).toBeGreaterThan(320);
            rounded.destroy();
            vi.advanceTimersByTime(32);
            expect(square.canvas!.width).toBe(32);
            square.destroy();
        } finally {
            vi.useRealTimers();
        }
    });

    it("draws text nodes using range.getClientRects without redundant range.getBoundingClientRect", () => {
        const sceneEl = document.createElement("div");
        sceneEl.textContent = "Hello Glass";
        document.body.appendChild(sceneEl);
        setRect(sceneEl, 300, 100);

        const range = document.createRange();
        const getClientRectsSpy = vi.fn().mockReturnValue([
            {
                left: 12,
                top: 20,
                right: 112,
                bottom: 40,
                width: 100,
                height: 20,
                x: 12,
                y: 20,
                toJSON: () => ({}),
            },
        ] as unknown as DOMRectList);
        const getBoundingClientRectSpy = vi.fn();
        Object.defineProperty(range, "getClientRects", {
            configurable: true,
            value: getClientRectsSpy,
        });
        Object.defineProperty(range, "getBoundingClientRect", {
            configurable: true,
            value: getBoundingClientRectSpy,
        });

        const canvas = document.createElement("canvas");
        const mockCtx = createMockCanvas2dContext();
        mockCtx.canvas = canvas;
        vi.spyOn(canvas, "getContext").mockReturnValue(mockCtx as unknown as CanvasRenderingContext2D);

        const ok = captureDomToCanvas(sceneEl, canvas, range, 1, 0);
        expect(ok).toBe(true);
        expect(getClientRectsSpy).toHaveBeenCalledTimes(1);
        expect(getBoundingClientRectSpy).not.toHaveBeenCalled();
        expect(mockCtx.fillText).toHaveBeenCalledWith("Hello Glass", 12, 30);
    });

    it("reuses wrapped text during scrolling and refits when text, widths, or typography change", () => {
        const scene = document.body.appendChild(document.createElement("section"));
        const paragraph = scene.appendChild(document.createElement("p"));
        paragraph.style.fontSize = "16px";
        paragraph.textContent = "One two three four five six seven eight nine";
        setRect(scene, 160, 110);
        const ctx = Object.assign(createMockCanvas2dContext(), { letterSpacing: "0px" });
        ctx.measureText = vi.fn((text: string) => ({ width: text.length * 6 }));
        const canvas = document.createElement("canvas");
        vi.spyOn(canvas, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
        const range = document.createRange();
        let top = 30;
        let width = 100;
        Object.defineProperty(range, "getClientRects", {
            value: () => [0, 1, 2].map((index) => new DOMRect(8, top + index * 18, width, 18)),
        });
        const capture = () => expect(captureDomToCanvas(scene, canvas, range, 1)).toBe(true);

        capture();
        expect(ctx.measureText).toHaveBeenCalled();
        const initialLines = ctx.fillText.mock.calls.slice();
        expect(initialLines.length).toBeGreaterThan(1);
        ctx.measureText.mockClear();
        ctx.fillText.mockClear();
        top -= 12;
        capture();
        expect(ctx.measureText).not.toHaveBeenCalled();
        expect(ctx.fillText.mock.calls).toEqual(initialLines.map(([text, x, y]) => [text, x, y - 12]));

        for (const change of [
            () => { width = 60; },
            () => { paragraph.style.fontSize = "20px"; },
            () => { paragraph.style.letterSpacing = "2px"; },
            () => { paragraph.firstChild!.textContent += " ten"; },
        ]) {
            change();
            ctx.measureText.mockClear();
            capture();
            expect(ctx.measureText).toHaveBeenCalled();
        }
    });

    it("refits wrapped text when the loaded font set changes at the same size", () => {
        const scene = document.body.appendChild(document.createElement("section"));
        scene.textContent = "Wrapped text uses a downloadable font when it is available";
        setRect(scene, 160, 110);
        const canvas = document.createElement("canvas");
        const ctx = createMockCanvas2dContext();
        vi.spyOn(canvas, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
        const range = document.createRange();
        Object.defineProperty(range, "getClientRects", {
            value: () => [new DOMRect(4, 0, 70, 18), new DOMRect(4, 18, 65, 18)],
        });
        const firstFont = { family: "WebFont", status: "loaded" };
        const fontSet = Object.assign(new Set([firstFont]), { status: "loaded" });
        const descriptor = Object.getOwnPropertyDescriptor(document, "fonts");
        Object.defineProperty(document, "fonts", { value: fontSet, configurable: true });
        const capture = () => expect(captureDomToCanvas(scene, canvas, range, 1)).toBe(true);
        try {
            capture();
            ctx.measureText.mockClear();
            capture();
            expect(ctx.measureText).not.toHaveBeenCalled();

            fontSet.delete(firstFont);
            fontSet.add({ ...firstFont });
            capture();
            expect(ctx.measureText).toHaveBeenCalled();
            ctx.measureText.mockClear();

            fontSet.status = "loading";
            capture();
            expect(ctx.measureText).toHaveBeenCalled();
        } finally {
            if (descriptor) Object.defineProperty(document, "fonts", descriptor);
            else Reflect.deleteProperty(document, "fonts");
        }
    });

    it("walks translucent ancestors, resolves repeating/double-position/stacked gradients, clips overflow, draws url()/video, wraps unbroken text, deduplicates SVG text, and cleans leases", () => {
        const outer = document.createElement("div");
        outer.style.backgroundColor = "rgb(12, 34, 56)";
        const translucent = document.createElement("div");
        translucent.style.backgroundColor = "rgba(255, 255, 255, 0.2)";
        const clippedBox = document.createElement("div");
        clippedBox.style.overflow = "hidden";
        clippedBox.style.borderRadius = "16px";

        const repeatingEl = document.createElement("div");
        repeatingEl.style.backgroundImage = "repeating-linear-gradient(90deg, #ff0000 10px, #00ff00, #0000ff 30px)";
        const doubleStopEl = document.createElement("div");
        doubleStopEl.style.backgroundImage = "linear-gradient(90deg, #ff0000 20% 40%, #00ff00 80%)";
        const stackedEl = document.createElement("div");
        stackedEl.style.backgroundImage =
            "linear-gradient(180deg, #ff0000, #00ff00 20%, #0000ff, #ffff00), conic-gradient(from 90deg at 50% 50%, #000000, #ffffff)";
        const bgUrlEl = document.createElement("div");
        bgUrlEl.style.backgroundImage = 'url("https://example.test/hero.png")';
        bgUrlEl.style.backgroundSize = "cover";
        const video = document.createElement("video");
        Object.defineProperties(video, {
            readyState: { value: 2 },
            videoWidth: { value: 320 },
            videoHeight: { value: 180 },
            offsetWidth: { value: 100 },
            offsetHeight: { value: 100 },
        });
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        const svgText = document.createElementNS("http://www.w3.org/2000/svg", "text");
        svgText.textContent = "VectorLabel";
        svg.appendChild(svgText);
        const longPara = document.createElement("p");
        const longToken = "LiquidGlassContinuousTokenWithoutSpaces123456";
        longPara.appendChild(document.createTextNode(longToken));

        clippedBox.append(repeatingEl, doubleStopEl, stackedEl, bgUrlEl, video, svg, longPara);
        translucent.appendChild(clippedBox);
        outer.appendChild(translucent);
        document.body.appendChild(outer);

        for (const el of [outer, translucent, clippedBox, repeatingEl, doubleStopEl, stackedEl, bgUrlEl, video, svg, svgText]) {
            vi.spyOn(el, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 100));
        }
        vi.spyOn(longPara, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 10, 120, 40));

        vi.stubGlobal(
            "Image",
            class {
                crossOrigin = "";
                onload: (() => void) | null = null;
                onerror: (() => void) | null = null;
                naturalWidth = 200;
                naturalHeight = 100;
                complete = true;
                src = "";
            },
        );

        const fillColors: string[] = [];
        const gradientOrder: string[] = [];
        const gradientStopGroups: Array<Array<{ pos: number; color: string }>> = [];
        const fillTexts: string[] = [];
        const drawnImages: unknown[] = [];
        const clipCalls = vi.fn();
        let currentFill = "";

        const mockCtx = {
            set fillStyle(val: string) {
                currentFill = val;
                if (typeof val === "string") fillColors.push(val);
            },
            get fillStyle() {
                return currentFill;
            },
            setTransform: () => {},
            clearRect: () => {},
            fillRect: () => {},
            fill: () => {},
            beginPath: () => {},
            rect: () => {},
            roundRect: () => {},
            save: () => {},
            restore: () => {},
            clip: clipCalls,
            translate: () => {},
            drawImage: (img: unknown) => drawnImages.push(img),
            fillText: (text: string) => fillTexts.push(text),
            measureText: (str: string) => ({ width: str.length * 8 }),
            createLinearGradient: () => {
                gradientOrder.push("linear");
                const stops: Array<{ pos: number; color: string }> = [];
                gradientStopGroups.push(stops);
                return { addColorStop: (pos: number, color: string) => stops.push({ pos, color }) };
            },
            createConicGradient: () => {
                gradientOrder.push("conic");
                return { addColorStop: () => {} };
            },
        } as unknown as CanvasRenderingContext2D;

        const fakeRange = {
            setStart: () => {},
            setEnd: () => {},
            selectNodeContents: () => {},
            getClientRects: () => [new DOMRect(0, 10, 180, 20), new DOMRect(0, 30, 180, 20)],
            getBoundingClientRect: () => new DOMRect(0, 10, 120, 40),
        } as unknown as Range;

        const outCanvas = document.createElement("canvas");
        vi.spyOn(outCanvas, "getContext").mockReturnValue(mockCtx);
        expect(captureDomToCanvas(translucent, outCanvas, fakeRange)).toBe(true);

        expect(fillColors).toContain("rgb(12, 34, 56)");
        expect(clipCalls).toHaveBeenCalled();
        expect(drawnImages).toContain(video);
        expect(drawnImages.length).toBeGreaterThanOrEqual(2);

        const repeatingStops = gradientStopGroups[0]!;
        expect(repeatingStops.some((s) => s.color === "#ff0000" && Math.abs(s.pos - 0.1) < 1e-4)).toBe(true);
        expect(repeatingStops.some((s) => s.color === "#00ff00" && Math.abs(s.pos - 0.2) < 1e-4)).toBe(true);
        expect(repeatingStops.some((s) => s.color === "#0000ff" && Math.abs(s.pos - 0.3) < 1e-4)).toBe(true);
        expect(repeatingStops.some((s) => s.pos === 0)).toBe(true);

        expect(gradientStopGroups[1]!.filter((s) => s.color === "#ff0000").map((s) => s.pos)).toEqual([0.2, 0.4]);

        expect(gradientOrder.slice(-2)).toEqual(["conic", "linear"]);
        expect(gradientStopGroups[2]![2]?.pos).toBeCloseTo(0.6, 5);

        expect(fillTexts).not.toContain("VectorLabel");
        expect(fillTexts.join("")).toBe(longToken);

        vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1);
        const lease1 = acquireSharedSceneCapture(clippedBox);
        const lease2 = acquireSharedSceneCapture(clippedBox);
        const listener1 = vi.fn();
        lease1.subscribe(listener1);
        lease1.destroy();
        expect(listener1).not.toHaveBeenCalled();
        lease2.destroy();
        vi.unstubAllGlobals();
    });

    it("prunes descendants outside nested active clip bounds and reuses compiled gradients", () => {
        const scene = document.createElement("div");
        const outerClip = document.createElement("div");
        outerClip.style.overflow = "hidden";
        const innerOffClip = document.createElement("div");
        innerOffClip.style.backgroundColor = "rgb(200, 30, 30)";
        const innerVisible = document.createElement("div");
        innerVisible.style.backgroundImage = "linear-gradient(135deg, rgb(10, 20, 30) 0%, rgb(200, 210, 220) 100%)";
        outerClip.append(innerOffClip, innerVisible);
        scene.appendChild(outerClip);
        document.body.appendChild(scene);

        setRect(scene, 200, 200, 0, 0);
        setRect(outerClip, 80, 80, 0, 0);
        setRect(innerOffClip, 50, 50, 120, 120);
        setRect(innerVisible, 60, 60, 10, 10);

        const canvas = document.createElement("canvas");
        const mockCtx = createMockCanvas2dContext();
        mockCtx.canvas = canvas;
        const fills: unknown[] = [];
        mockCtx.fillRect = vi.fn(() => fills.push(mockCtx.fillStyle));
        vi.spyOn(canvas, "getContext").mockReturnValue(mockCtx as unknown as CanvasRenderingContext2D);

        expect(captureDomToCanvas(scene, canvas, document.createRange(), 1, 0)).toBe(true);
        expect(fills).not.toContain("rgb(200, 30, 30)");
        expect(mockCtx.createLinearGradient).toHaveBeenCalledTimes(1);

        expect(captureDomToCanvas(scene, canvas, document.createRange(), 1, 0)).toBe(true);
        expect(mockCtx.createLinearGradient).toHaveBeenCalledTimes(2);
    });

    it("clips overflow:auto and direct text, resolves multi-layer backgroundSize, preserves trailing/pre-line text, and honors text-clip gradient angles", () => {
        const scene = document.createElement("div");

        const scrollBox = document.createElement("div");
        scrollBox.style.overflow = "auto";
        const hiddenDirectText = document.createElement("div");
        hiddenDirectText.style.overflow = "hidden";
        hiddenDirectText.appendChild(document.createTextNode("DirectClippedText"));
        scrollBox.appendChild(hiddenDirectText);

        const gradientText = document.createElement("div");
        gradientText.style.backgroundClip = "text";
        gradientText.style.backgroundImage = "linear-gradient(90deg, #ff0000 25%, #0000ff 75%)";
        gradientText.appendChild(document.createTextNode("GradHeading"));

        const preLineEl = document.createElement("p");
        preLineEl.style.whiteSpace = "pre-line";
        preLineEl.appendChild(document.createTextNode("Line One\nLine Two Trailing"));

        const multiBg = document.createElement("div");
        multiBg.style.backgroundImage =
            'linear-gradient(180deg, rgba(0, 0, 0, 0.2), transparent), url("https://example.test/multi-layer.png")';
        multiBg.style.backgroundSize = "auto, contain";
        multiBg.style.backgroundPosition = "0% 0%, 50% 50%";

        scene.append(scrollBox, gradientText, preLineEl, multiBg);
        document.body.appendChild(scene);

        for (const el of [scene, scrollBox, hiddenDirectText, gradientText, preLineEl, multiBg]) {
            setRect(el, 100, 100, 0, 0);
        }

        vi.stubGlobal(
            "Image",
            class {
                crossOrigin = "";
                onload: (() => void) | null = null;
                onerror: (() => void) | null = null;
                naturalWidth = 200;
                naturalHeight = 100;
                complete = true;
                src = "";
            },
        );

        const fillTexts: string[] = [];
        const linearGradCoords: Array<[number, number, number, number]> = [];
        const linearGradStops: Array<Array<[number, string]>> = [];
        const drawImageCalls: Array<[number, number, number, number]> = [];
        const mockCtx = createMockCanvas2dContext();
        mockCtx.fillText = vi.fn((text: string) => fillTexts.push(text));
        mockCtx.measureText = vi.fn((str: string) => ({ width: str.length * 10 }));
        mockCtx.drawImage = vi.fn((_img: unknown, dx: number, dy: number, dw: number, dh: number) => {
            drawImageCalls.push([dx, dy, dw, dh]);
        });
        mockCtx.createLinearGradient = vi.fn((x0: number, y0: number, x1: number, y1: number) => {
            linearGradCoords.push([x0, y0, x1, y1]);
            const stops: Array<[number, string]> = [];
            linearGradStops.push(stops);
            return { addColorStop: (pos: number, color: string) => stops.push([pos, color]) };
        });

        let currentNode: Node | null = null;
        const customRange = {
            setStart(node: Node) {
                currentNode = node;
            },
            setEnd() {},
            getClientRects() {
                if (currentNode?.textContent?.includes("\n")) {
                    return [new DOMRect(0, 0, 100, 20), new DOMRect(0, 20, 80, 20)];
                }
                return [new DOMRect(0, 0, 100, 20)];
            },
            getBoundingClientRect: () => new DOMRect(0, 0, 100, 40),
        } as unknown as Range;

        const outCanvas = document.createElement("canvas");
        mockCtx.canvas = outCanvas;
        vi.spyOn(outCanvas, "getContext").mockReturnValue(mockCtx as unknown as CanvasRenderingContext2D);

        try {
            expect(captureDomToCanvas(scene, outCanvas, customRange, 1, 0)).toBe(true);
            expect(mockCtx.clip.mock.calls.length).toBeGreaterThanOrEqual(3);
            expect(fillTexts).toContain("Line One");
            expect(fillTexts).toContain("Line Two Trailing");

            const textGradIdx = linearGradStops.findIndex(
                (stops) => stops.length === 2 && stops[0]![0] === 0.25 && stops[1]![0] === 0.75,
            );
            expect(textGradIdx).toBeGreaterThanOrEqual(0);
            const [, gy0, , gy1] = linearGradCoords[textGradIdx]!;
            expect(gy0).toBeCloseTo(gy1, 5);

            expect(drawImageCalls[0]?.[2]).toBeCloseTo(100, 3);
            expect(drawImageCalls[0]?.[3]).toBeCloseTo(50, 3);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("multiplies ancestor opacity down nested subtrees and clips rounded canvas elements", () => {
        const scene = document.createElement("div");
        const group = document.createElement("div");
        group.style.opacity = "0.5";
        const nestedChild = document.createElement("div");
        nestedChild.style.opacity = "0.5";
        nestedChild.style.backgroundColor = "rgb(20, 40, 60)";
        group.appendChild(nestedChild);

        const sibling = document.createElement("div");
        sibling.style.backgroundColor = "rgb(80, 90, 100)";

        const innerCanvas = document.createElement("canvas");
        innerCanvas.width = 40;
        innerCanvas.height = 40;
        innerCanvas.style.borderTopLeftRadius = "12px";

        scene.append(group, sibling, innerCanvas);
        document.body.appendChild(scene);

        setRect(scene, 200, 200, 0, 0);
        setRect(group, 100, 100, 0, 0);
        setRect(nestedChild, 50, 50, 10, 10);
        setRect(sibling, 50, 50, 100, 10);
        setRect(innerCanvas, 40, 40, 10, 100);

        const alphaByFill = new Map<string, number>();
        const mockCtx = { ...createMockCanvas2dContext(), roundRect: vi.fn() };
        mockCtx.fillRect = vi.fn(() => {
            if (typeof mockCtx.fillStyle === "string") {
                alphaByFill.set(mockCtx.fillStyle, mockCtx.globalAlpha);
            }
        });
        const outCanvas = document.createElement("canvas");
        mockCtx.canvas = outCanvas;
        vi.spyOn(outCanvas, "getContext").mockReturnValue(mockCtx as unknown as CanvasRenderingContext2D);

        expect(captureDomToCanvas(scene, outCanvas, document.createRange(), 1, 0)).toBe(true);
        expect(alphaByFill.get("rgb(20, 40, 60)")).toBeCloseTo(0.25, 5);
        expect(alphaByFill.get("rgb(80, 90, 100)")).toBeCloseTo(1, 5);
        expect(mockCtx.clip).toHaveBeenCalled();
        expect(mockCtx.drawImage).toHaveBeenCalledWith(innerCanvas, 10, 100, 40, 40);
    });

    it("parses nested color-mix in box-shadows and gradient stops, applies dashed borders, skips hidden borders, and wraps emoji surrogate pairs safely", () => {
        const scene = document.createElement("div");
        scene.style.backgroundImage =
            "linear-gradient(90deg, color-mix(in srgb, color-mix(in srgb, #ff0000 50%, #0000ff), #ffffff) 25%, #000000 100%)";
        const shadowCard = document.createElement("div");
        shadowCard.style.boxShadow =
            "0px 4px 12px color-mix(in srgb, color-mix(in srgb, red 50%, blue), white)";
        const dashedCard = document.createElement("div");
        dashedCard.style.borderTopWidth = "2px";
        dashedCard.style.borderRightWidth = "2px";
        dashedCard.style.borderBottomWidth = "2px";
        dashedCard.style.borderLeftWidth = "2px";
        dashedCard.style.borderTopStyle = "dashed";
        dashedCard.style.borderRightStyle = "dashed";
        dashedCard.style.borderBottomStyle = "dashed";
        dashedCard.style.borderLeftStyle = "dashed";
        dashedCard.style.borderTopColor = "rgb(10, 20, 30)";
        dashedCard.style.borderRightColor = "rgb(10, 20, 30)";
        dashedCard.style.borderBottomColor = "rgb(10, 20, 30)";
        dashedCard.style.borderLeftColor = "rgb(10, 20, 30)";

        const hiddenBorderCard = document.createElement("div");
        hiddenBorderCard.style.borderTopWidth = "3px";
        hiddenBorderCard.style.borderTopStyle = "hidden";
        hiddenBorderCard.style.borderTopColor = "rgb(200, 10, 10)";

        const emojiBox = document.createElement("div");
        emojiBox.style.width = "36px";
        emojiBox.style.overflowWrap = "break-word";
        emojiBox.textContent = "🚀🔥✨🌟💎";

        scene.append(shadowCard, dashedCard, hiddenBorderCard, emojiBox);
        document.body.appendChild(scene);

        setRect(scene, 200, 200, 0, 0);
        setRect(shadowCard, 60, 40, 10, 10);
        setRect(dashedCard, 60, 40, 10, 60);
        setRect(emojiBox, 36, 60, 10, 110);
        const hiddenRectSpy = vi.fn(() => ({
            left: 10, top: 120, right: 70, bottom: 160, width: 60, height: 40, x: 10, y: 120, toJSON() {},
        }));
        hiddenBorderCard.getBoundingClientRect = hiddenRectSpy as unknown as HTMLElement["getBoundingClientRect"];

        const shadowColors: string[] = [];
        const lineDashCalls: number[][] = [];
        const gradientStops: Array<{ offset: number; color: string }> = [];
        const drawnLines: string[] = [];
        const mockCtx = {
            ...createMockCanvas2dContext(),
            strokeRect: vi.fn(),
            setLineDash: vi.fn((segments: number[]) => {
                lineDashCalls.push([...segments]);
            }),
        };
        mockCtx.createLinearGradient = vi.fn(() => ({
            addColorStop: vi.fn((offset: number, color: string) => {
                gradientStops.push({ offset, color });
            }),
        }));
        mockCtx.measureText = vi.fn((text: string) => ({ width: text.length * 10 }));
        mockCtx.fillText = vi.fn((text: string) => {
            drawnLines.push(text);
        });
        const origFillRect = mockCtx.fillRect;
        mockCtx.fillRect = vi.fn((...args: unknown[]) => {
            if (mockCtx.shadowColor) shadowColors.push(mockCtx.shadowColor);
            origFillRect(...args);
        });
        const fakeRange = {
            setStart: vi.fn(),
            setEnd: vi.fn(),
            getClientRects: () => [
                new DOMRect(10, 110, 36, 18),
                new DOMRect(10, 128, 36, 18),
                new DOMRect(10, 146, 36, 18),
            ],
        } as unknown as Range;
        const outCanvas = document.createElement("canvas");
        mockCtx.canvas = outCanvas;
        vi.spyOn(outCanvas, "getContext").mockReturnValue(mockCtx as unknown as CanvasRenderingContext2D);

        expect(captureDomToCanvas(scene, outCanvas, fakeRange, 1, 0)).toBe(true);
        expect(shadowColors.some((c) => c.includes("191") && c.includes("128"))).toBe(true);
        expect(lineDashCalls).toContainEqual([6, 4]);
        expect(hiddenRectSpy).not.toHaveBeenCalled();
        expect(gradientStops[0]?.offset).toBeCloseTo(0.25, 5);
        expect(gradientStops[0]?.color).toBe("rgb(191, 128, 191)");
        expect(drawnLines.join("")).toBe("🚀🔥✨🌟💎");
        for (const line of drawnLines) {
            expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(line)).toBe(false);
        }
    });

    it("skips fallback DOM children and text inside video and canvas elements, and honors explicit light data-theme inside a dark document", () => {
        const root = document.documentElement;
        const hadDark = root.classList.contains("dark");
        root.classList.add("dark");

        try {
            const scene = document.createElement("div");
            scene.setAttribute("data-theme", "light");
            const unloadedVideo = document.createElement("video");
            Object.defineProperty(unloadedVideo, "readyState", { value: 0, configurable: true });
            unloadedVideo.textContent = "Video fallback text";
            const webglCanvas = document.createElement("canvas");
            webglCanvas.className = "lg-webgl-canvas";
            const fallbackDiv = document.createElement("div");
            fallbackDiv.style.backgroundColor = "rgb(255, 0, 0)";
            fallbackDiv.textContent = "Canvas fallback text";
            webglCanvas.appendChild(fallbackDiv);
            scene.append(unloadedVideo, webglCanvas);
            document.body.appendChild(scene);

            setRect(scene, 120, 80, 0, 0);
            setRect(unloadedVideo, 100, 60, 0, 0);
            setRect(webglCanvas, 100, 60, 0, 0);
            setRect(fallbackDiv, 100, 60, 0, 0);

            const fillRectColors: string[] = [];
            const mockCtx = createMockCanvas2dContext();
            mockCtx.fillRect = vi.fn(() => {
                if (typeof mockCtx.fillStyle === "string") {
                    fillRectColors.push(mockCtx.fillStyle);
                }
            });
            const outCanvas = document.createElement("canvas");
            mockCtx.canvas = outCanvas;
            vi.spyOn(outCanvas, "getContext").mockReturnValue(mockCtx as unknown as CanvasRenderingContext2D);

            const fakeRange = {
                setStart: vi.fn(),
                setEnd: vi.fn(),
                getClientRects: () => [new DOMRect(0, 0, 80, 16)],
            } as unknown as Range;

            expect(captureDomToCanvas(scene, outCanvas, fakeRange, 1, 0)).toBe(true);
            expect(mockCtx.fillText).not.toHaveBeenCalled();
            expect(fillRectColors).not.toContain("rgb(255, 0, 0)");
            expect(fillRectColors[0]).toBe("#f3f2f6");
        } finally {
            if (!hadDark) root.classList.remove("dark");
        }
    });
});
