import { afterEach, describe, expect, it, vi } from "vitest";
import {
    collectCoalescenceSnapshot,
    getLastCoalescenceSearchStatsForTesting,
    registerCoalescenceParticipant,
    resetCoalescenceForTesting,
    syncCoalescenceGeometry,
} from "../src/core/coalescence.js";
import { createLiquidGlass } from "../src/core/controller.js";
import { createInteractiveSpring } from "../src/core/spring.js";
import { GlassWebglRenderer } from "../src/core/webglRenderer.js";

function createCoalescenceMockWebglContext() {
    let nextLocId = 1;
    const uniform1fCalls: Array<{ name: string; val: number }> = [];
    const uniform4fCalls: Array<{ name: string; values: [number, number, number, number] }> = [];
    const uniform4fvCalls: Array<{ name: string; values: number[] }> = [];

    const gl = {
        VERTEX_SHADER: 0x8b31,
        FRAGMENT_SHADER: 0x8b30,
        COMPILE_STATUS: 0x8b81,
        LINK_STATUS: 0x8b82,
        ARRAY_BUFFER: 0x8892,
        STATIC_DRAW: 0x88e4,
        FLOAT: 0x1406,
        TRIANGLES: 0x0004,
        TEXTURE0: 0x84c0,
        TEXTURE1: 0x84c1,
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
            if (pname === 0x0d3a) return [8192, 8192];
            if (pname === 0x0d33) return 8192;
            return null;
        }),
        getUniformLocation: vi.fn((_program: unknown, name: string) => ({ name, id: nextLocId++ })),
        uniform1i: vi.fn(),
        uniform1f: vi.fn((loc: { name?: string }, val: number) => {
            uniform1fCalls.push({ name: loc?.name ?? "", val });
        }),
        uniform2f: vi.fn(),
        uniform4f: vi.fn((loc: { name?: string }, x: number, y: number, z: number, w: number) => {
            uniform4fCalls.push({ name: loc?.name ?? "", values: [x, y, z, w] });
        }),
        uniform4fv: vi.fn((loc: { name?: string }, data: Float32Array) => {
            uniform4fvCalls.push({ name: loc?.name ?? "", values: Array.from(data) });
        }),
        viewport: vi.fn(),
        drawArrays: vi.fn(),
        createTexture: vi.fn(() => ({})),
        deleteTexture: vi.fn(),
        activeTexture: vi.fn(),
        bindTexture: vi.fn(),
        pixelStorei: vi.fn(),
        texImage2D: vi.fn(),
        texParameteri: vi.fn(),
        getExtension: vi.fn(() => null),
        getError: vi.fn(() => 0),
    } as unknown as WebGLRenderingContext;

    return { gl, uniform1fCalls, uniform4fCalls, uniform4fvCalls };
}

function createPointerEventLike(type: string, init: { clientX: number; clientY: number; pointerId: number; button?: number }) {
    return Object.assign(
        new MouseEvent(type, {
            clientX: init.clientX,
            clientY: init.clientY,
            button: init.button ?? 0,
            bubbles: true,
            cancelable: true,
        }),
        { pointerId: init.pointerId, pointerType: "mouse" },
    );
}

describe("360 droplet button drag and liquid coalescence", () => {
    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = "";
        resetCoalescenceForTesting();
        vi.restoreAllMocks();
    });

    it("produces volume-preserving 360 degree stretch matrices for diagonal motion", () => {
        vi.useFakeTimers();
        const frames: Array<{
            stretchMatrix: readonly [number, number, number, number];
            dragX: number;
            dragY: number;
        }> = [];
        const spring = createInteractiveSpring(
            (frame) => {
                frames.push({
                    stretchMatrix: frame.stretchMatrix,
                    dragX: frame.dragX,
                    dragY: frame.dragY,
                });
            },
            () => {},
        );

        spring.setDrag(6, 6, true);
        spring.impulseDrag(400, 400);
        vi.advanceTimersByTime(16);

        const latest = frames.at(-1);
        expect(latest).toBeDefined();
        const [m11, m12, m21, m22] = latest!.stretchMatrix;
        expect(m12).toBeGreaterThan(0.01);
        expect(m12).toBeCloseTo(m21, 5);
        expect(m11).toBeCloseTo(m22, 5);
        expect(m11 * m22 - m12 * m21).toBeCloseTo(1, 4);

        spring.destroy();
    });

    it("limits button drag to ultra-short travel across 360 degrees and skips panel elements", () => {
        vi.useFakeTimers();
        const buttonEl = document.createElement("button");
        buttonEl.textContent = "pill";
        const panelEl = document.createElement("div");
        document.body.appendChild(buttonEl);
        document.body.appendChild(panelEl);

        vi.spyOn(buttonEl, "getBoundingClientRect").mockReturnValue({
            left: 100,
            top: 200,
            right: 220,
            bottom: 248,
            width: 120,
            height: 48,
            x: 100,
            y: 200,
            toJSON: () => ({}),
        });
        Object.defineProperty(buttonEl, "offsetWidth", { value: 120, configurable: true });
        Object.defineProperty(buttonEl, "offsetHeight", { value: 48, configurable: true });

        const buttonGlass = createLiquidGlass(buttonEl, { engine: "css", pill: true });
        const panelGlass = createLiquidGlass(panelEl, { engine: "css", draggable: true });

        expect(buttonEl.getAttribute("data-lg-draggable")).toBe("elastic");
        expect(panelEl.hasAttribute("data-lg-draggable")).toBe(false);

        buttonEl.dispatchEvent(createPointerEventLike("pointerdown", { clientX: 160, clientY: 224, pointerId: 1, button: 0 }));
        buttonEl.dispatchEvent(createPointerEventLike("pointermove", { clientX: 460, clientY: 524, pointerId: 1 }));
        vi.advanceTimersByTime(120);

        const dragX = parseFloat(buttonEl.style.getPropertyValue("--lg-drag-x"));
        const dragY = parseFloat(buttonEl.style.getPropertyValue("--lg-drag-y"));
        const totalOffset = Math.hypot(dragX, dragY);
        expect(totalOffset).toBeGreaterThan(2);
        expect(totalOffset).toBeLessThanOrEqual(9);
        expect(dragX).toBeCloseTo(dragY, 1);
        expect(buttonEl.style.getPropertyValue("--lg-stretch-matrix")).toContain("matrix(");

        const clickHandler = vi.fn();
        buttonEl.addEventListener("click", clickHandler);
        buttonEl.dispatchEvent(createPointerEventLike("pointerup", { clientX: 460, clientY: 524, pointerId: 1 }));
        buttonEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        expect(clickHandler).not.toHaveBeenCalled();

        buttonEl.dispatchEvent(createPointerEventLike("pointerdown", { clientX: 160, clientY: 224, pointerId: 2, button: 0 }));
        buttonEl.dispatchEvent(createPointerEventLike("pointermove", { clientX: 161, clientY: 225, pointerId: 2 }));
        buttonEl.dispatchEvent(createPointerEventLike("pointerup", { clientX: 161, clientY: 225, pointerId: 2 }));
        buttonEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        expect(clickHandler).toHaveBeenCalledTimes(1);

        buttonGlass.destroy();
        panelGlass.destroy();
    });

    it("detects nearby peers, preserves asymmetric Voronoi tie priority, and notifies neighbors", () => {
        const firstEl = document.createElement("button");
        const secondEl = document.createElement("button");
        const farEl = document.createElement("button");
        document.body.append(firstEl, secondEl, farEl);

        const notifyFirst = vi.fn();
        const notifySecond = vi.fn();
        const notifyFar = vi.fn();

        const stopFirst = registerCoalescenceParticipant({
            element: firstEl,
            notifyPeerUpdate: notifyFirst,
            readBounds: () => ({ left: 100, top: 100, width: 100, height: 48, radius: 24, bezel: 14 }),
        });
        const stopSecond = registerCoalescenceParticipant({
            element: secondEl,
            notifyPeerUpdate: notifySecond,
            readBounds: () => ({ left: 214, top: 100, width: 56, height: 56, radius: 28, bezel: 16 }),
        });
        const stopFar = registerCoalescenceParticipant({
            element: farEl,
            notifyPeerUpdate: notifyFar,
            readBounds: () => ({ left: 600, top: 100, width: 80, height: 48, radius: 24, bezel: 14 }),
        });

        syncCoalescenceGeometry(firstEl, 100, 100, 100, 48, 24, 14, 0, true);
        syncCoalescenceGeometry(secondEl, 214, 100, 56, 56, 28, 16, 120, true);
        syncCoalescenceGeometry(farEl, 600, 100, 80, 48, 24, 14, 0, true);

        const snapFirst = collectCoalescenceSnapshot(firstEl);
        const snapSecond = collectCoalescenceSnapshot(secondEl);
        const snapFar = collectCoalescenceSnapshot(farEl);

        expect(snapFirst.peers).toHaveLength(1);
        expect(snapFirst.peers[0]!.priorityWinsTie).toBe(true);
        expect(snapFirst.requiredBleedPx).toBeGreaterThan(12);
        expect(snapFirst.requiredBleedPx).toBeLessThanOrEqual(24);
        expect(snapSecond.peers).toHaveLength(1);
        expect(snapSecond.peers[0]!.priorityWinsTie).toBe(false);
        expect(snapFar.peers).toHaveLength(0);
        expect(notifyFirst).toHaveBeenCalled();

        const nestedChild = document.createElement("span");
        firstEl.appendChild(nestedChild);
        const stopNested = registerCoalescenceParticipant({
            element: nestedChild,
            notifyPeerUpdate: vi.fn(),
            readBounds: () => ({ left: 104, top: 104, width: 48, height: 40, radius: 20, bezel: 12 }),
        });
        syncCoalescenceGeometry(nestedChild, 104, 104, 48, 40, 20, 12, 0, true);
        expect(collectCoalescenceSnapshot(firstEl).peers).toHaveLength(1);
        expect(collectCoalescenceSnapshot(nestedChild).peers).toHaveLength(0);
        stopNested();

        stopFirst();
        stopSecond();
        stopFar();
    });

    it("uploads WebGL coalescence uniforms and expands bleed canvas cleanly when peers approach", () => {
        Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
        const { gl, uniform1fCalls, uniform4fCalls, uniform4fvCalls } = createCoalescenceMockWebglContext();
        const canvas = document.createElement("canvas");
        vi.spyOn(canvas, "getContext").mockReturnValue(gl as unknown as RenderingContext);

        const renderer = GlassWebglRenderer.create(canvas);
        expect(renderer).not.toBeNull();

        renderer!.render({
            width: 120,
            height: 48,
            radius: 24,
            bezel: 14,
            thickness: 48,
            scaleRatio: 2.35,
            ior: 2.15,
            blur: 2,
            surface: "convex_squircle",
            tintColor: [1, 1, 1],
            tintOpacity: 0.12,
            highlight: 0.72,
            coalescePeers: [
                {
                    relCenterX: 110,
                    relCenterY: -8,
                    halfWidth: 28,
                    halfHeight: 28,
                    radius: 28,
                    mergeRadius: 24,
                    wavePhase: 1.2,
                    priorityWinsTie: true,
                },
            ],
            bleedPx: 20,
        });

        expect(canvas.width).toBe(320);
        expect(canvas.height).toBe(176);

        expect(uniform1fCalls.filter((entry) => entry.name === "uPeerCount").at(-1)?.val).toBe(1);
        expect(
            uniform4fCalls.filter((entry) => entry.name === "uCoalesceBleed").at(-1)?.values,
        ).toEqual([40 / 120, 40 / 48, -20 / 120, -20 / 48]);

        const boundsVec = uniform4fvCalls
            .filter((entry) => entry.name === "uPeerBounds[0]")
            .at(-1)?.values;
        expect(boundsVec?.slice(0, 4)).toEqual([110, 8, 28, 28]);

        renderer!.render({
            width: 120,
            height: 48,
            radius: 24,
            bezel: 14,
            thickness: 48,
            scaleRatio: 2.35,
            ior: 2.15,
            blur: 2,
            surface: "convex_squircle",
            tintColor: [1, 1, 1],
            tintOpacity: 0.12,
            highlight: 0.72,
            coalescePeers: [],
            bleedPx: 0,
        });

        expect(canvas.width).toBe(240);
        expect(canvas.height).toBe(96);
        expect(uniform1fCalls.filter((entry) => entry.name === "uPeerCount").at(-1)?.val).toBe(0);
        expect(
            uniform4fCalls.filter((entry) => entry.name === "uCoalesceBleed").at(-1)?.values,
        ).toEqual([0, 0, 0, 0]);

        renderer!.dispose();
    });

    it("notifies surviving peers on unregister when any peer had active coalescence", () => {
        const elA = document.createElement("div");
        const elB = document.createElement("div");

        const notifyA = vi.fn();
        const notifyB = vi.fn();

        const unregisterA = registerCoalescenceParticipant({
            element: elA,
            notifyPeerUpdate: notifyA,
            readBounds: () => ({ left: 0, top: 0, width: 100, height: 50, radius: 20, bezel: 14 }),
        });

        const unregisterB = registerCoalescenceParticipant({
            element: elB,
            notifyPeerUpdate: notifyB,
            readBounds: () => ({ left: 110, top: 0, width: 100, height: 50, radius: 20, bezel: 14 }),
        });

        syncCoalescenceGeometry(elA, 0, 0, 100, 50, 20, 14, 0, true);
        syncCoalescenceGeometry(elB, 110, 0, 100, 50, 20, 14, 0, true);

        const snapB = collectCoalescenceSnapshot(elB);
        expect(snapB.peers.length).toBe(1);

        notifyB.mockClear();
        unregisterA();
        expect(notifyB).toHaveBeenCalled();

        unregisterB();
    });

    it("stops merging with collapsed glass and resumes after its layout returns", () => {
        let onResize: ResizeObserverCallback | undefined;
        vi.stubGlobal("ResizeObserver", class {
            constructor(callback: ResizeObserverCallback) { onResize = callback; }
            observe() {}
            unobserve() {}
            disconnect() {}
        });
        const first = document.body.appendChild(document.createElement("div"));
        const second = document.body.appendChild(document.createElement("div"));
        vi.spyOn(first, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 80, 48));
        const secondBounds = vi.spyOn(second, "getBoundingClientRect").mockReturnValue(new DOMRect(84, 0, 80, 48));
        const firstGlass = createLiquidGlass(first, { engine: "css" });
        const secondGlass = createLiquidGlass(second, { engine: "css" });
        const resized = () => onResize!([{
            target: second,
            contentRect: second.getBoundingClientRect(),
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
        }], {} as ResizeObserver);
        try {
            expect(first.getAttribute("data-lg-coalescing")).toBe("1");
            secondBounds.mockReturnValue(new DOMRect(0, 0, 0, 0));
            resized();
            expect(first.hasAttribute("data-lg-coalescing")).toBe(false);
            expect(second.hasAttribute("data-lg-coalescing")).toBe(false);

            secondBounds.mockReturnValue(new DOMRect(84, 0, 80, 48));
            resized();
            expect(first.getAttribute("data-lg-coalescing")).toBe("1");
            expect(second.getAttribute("data-lg-coalescing")).toBe("1");
        } finally {
            secondGlass.destroy();
            firstGlass.destroy();
            vi.unstubAllGlobals();
        }
    });

    it("accounts for rounded-corner clearance when elements are diagonally adjacent", () => {
        const elemA = document.createElement("div");
        const elemB = document.createElement("div");
        const elemSharpA = document.createElement("div");
        const elemSharpB = document.createElement("div");

        const unregA = registerCoalescenceParticipant({
            element: elemA,
            notifyPeerUpdate: () => {},
            readBounds: () => ({ left: 0, top: 0, width: 100, height: 60, radius: 30, bezel: 14 }),
        });
        const unregB = registerCoalescenceParticipant({
            element: elemB,
            notifyPeerUpdate: () => {},
            readBounds: () => ({ left: 124, top: 84, width: 100, height: 60, radius: 30, bezel: 14 }),
        });
        const unregSharpA = registerCoalescenceParticipant({
            element: elemSharpA,
            notifyPeerUpdate: () => {},
            readBounds: () => ({ left: 0, top: 400, width: 100, height: 60, radius: 0, bezel: 14 }),
        });
        const unregSharpB = registerCoalescenceParticipant({
            element: elemSharpB,
            notifyPeerUpdate: () => {},
            readBounds: () => ({ left: 124, top: 484, width: 100, height: 60, radius: 0, bezel: 14 }),
        });

        syncCoalescenceGeometry(elemA, 0, 0, 100, 60, 30, 14);
        syncCoalescenceGeometry(elemB, 124, 84, 100, 60, 30, 14);
        const roundedSnap = collectCoalescenceSnapshot(elemA);
        expect(roundedSnap.peers).toHaveLength(0);

        syncCoalescenceGeometry(elemSharpA, 0, 400, 100, 60, 0, 14);
        syncCoalescenceGeometry(elemSharpB, 124, 484, 100, 60, 0, 14);
        const sharpSnap = collectCoalescenceSnapshot(elemSharpA);
        expect(sharpSnap.peers).toHaveLength(1);

        unregA();
        unregB();
        unregSharpA();
        unregSharpB();
    });

    it("returns shared frozen empty snapshot for out-of-range participants without invoking DOM contains", () => {
        const elemA = document.createElement("div");
        const elemB = document.createElement("div");
        const containsSpy = vi.spyOn(elemA, "contains");
        const notifyB = vi.fn();

        const unregA = registerCoalescenceParticipant({
            element: elemA,
            notifyPeerUpdate: () => {},
            readBounds: () => ({ left: 0, top: 0, width: 100, height: 60, radius: 18, bezel: 14 }),
        });
        const unregB = registerCoalescenceParticipant({
            element: elemB,
            notifyPeerUpdate: notifyB,
            readBounds: () => ({ left: 400, top: 0, width: 100, height: 60, radius: 18, bezel: 14 }),
        });

        syncCoalescenceGeometry(elemA, 0, 0, 100, 60, 18, 14);
        syncCoalescenceGeometry(elemB, 400, 0, 100, 60, 18, 14);
        const snap1 = collectCoalescenceSnapshot(elemA);
        const snap2 = collectCoalescenceSnapshot(elemB);

        expect(snap1).toBe(snap2);
        expect(snap1.peers).toHaveLength(0);
        expect(containsSpy).not.toHaveBeenCalled();
        expect(notifyB).not.toHaveBeenCalled();

        unregA();
        unregB();
    });

    it("notifies both endpoints of a jump once, including a peer spanning both", () => {
        const add = (left: number, width: number) => {
            const element = document.createElement("div");
            const notify = vi.fn();
            registerCoalescenceParticipant({ element, notifyPeerUpdate: notify, readBounds: () => null });
            syncCoalescenceGeometry(element, left, 0, width, 48, 12, 8, 0, false);
            return { element, notify };
        };
        const moving = add(-10, 80);
        const origin = add(80, 40);
        const destination = add(10030, 40);
        const middle = add(5000, 40);
        const spanning = add(0, 10100);
        for (let i = 0; i < 20; i++) add(20000 + 250 * i, 40);
        collectCoalescenceSnapshot(moving.element);
        syncCoalescenceGeometry(moving.element, 10000, 0, 80, 48, 12, 8);
        expect(origin.notify).toHaveBeenCalledOnce();
        expect(destination.notify).toHaveBeenCalledOnce();
        expect(spanning.notify).toHaveBeenCalledOnce();
        expect(middle.notify).not.toHaveBeenCalled();
    });

    it("deduplicates grid cells, indexes large bounds, and refreshes only affected peers", () => {
        const registerAt = (left: number, top: number, width = 72) => {
            const element = document.createElement("div");
            const notify = vi.fn();
            const bounds = { left, top, width, height: 48, radius: 14, bezel: 12 };
            const unregister = registerCoalescenceParticipant({
                element,
                notifyPeerUpdate: notify,
                readBounds: () => bounds,
            });
            syncCoalescenceGeometry(element, left, top, width, 48, 14, 12, 0, false);
            return { element, notify, unregister };
        };
        const glass = registerAt(-18, 118);
        const acrossCell = registerAt(62, 118);
        const wide = registerAt(-3000, 118, 2975);
        const far = registerAt(1000, 1000);
        registerAt(1080, 1000);
        for (let idx = 0; idx < 16; idx += 1) registerAt(4000 + idx * 200, 4000);

        const snapshot = collectCoalescenceSnapshot(glass.element);
        expect(snapshot.peers.map((peer) => peer.halfWidth)).toEqual([1487.5, 36]);
        expect(collectCoalescenceSnapshot(far.element).peers).toHaveLength(1);

        syncCoalescenceGeometry(wide.element, -4000, 2500, 2975, 48, 14, 12, 0, false);
        syncCoalescenceGeometry(wide.element, -4000, 2500, 2975, 48, 14, 12, 1);
        expect(glass.notify).toHaveBeenCalledTimes(1);
        expect(far.notify).not.toHaveBeenCalled();
        expect(collectCoalescenceSnapshot(glass.element).peers).toHaveLength(1);

        acrossCell.unregister();
        expect(glass.notify).toHaveBeenCalledTimes(2);
        expect(collectCoalescenceSnapshot(glass.element).peers).toHaveLength(0);
    });

    it("does not repeatedly poll readBounds for hidden collapsed participants", () => {
        const visibleEl = document.createElement("div");
        const hiddenEl = document.createElement("div");
        const readHiddenBounds = vi.fn(() => ({ left: 0, top: 0, width: 0, height: 0, radius: 0, bezel: 12 }));

        const unregVisible = registerCoalescenceParticipant({
            element: visibleEl,
            notifyPeerUpdate: () => {},
            readBounds: () => ({ left: 0, top: 0, width: 80, height: 48, radius: 14, bezel: 12 }),
        });
        const unregHidden = registerCoalescenceParticipant({
            element: hiddenEl,
            notifyPeerUpdate: () => {},
            readBounds: readHiddenBounds,
        });

        syncCoalescenceGeometry(visibleEl, 0, 0, 80, 48, 14, 12, 0, false);
        for (let idx = 0; idx < 5; idx += 1) {
            collectCoalescenceSnapshot(visibleEl);
        }
        expect(readHiddenBounds).toHaveBeenCalledTimes(1);

        unregVisible();
        unregHidden();
    });

    it("uses A* best-first k-NN pruning to match exact brute-force top-4 peers while skipping distant cells", () => {
        const selfEl = document.createElement("div");
        document.body.appendChild(selfEl);
        const unregs: Array<() => void> = [];
        unregs.push(
            registerCoalescenceParticipant({
                element: selfEl,
                notifyPeerUpdate: () => {},
                readBounds: () => ({ left: 128, top: 128, width: 64, height: 64, radius: 16, bezel: 12 }),
            }),
        );
        syncCoalescenceGeometry(selfEl, 128, 128, 64, 64, 16, 12, 0, false);

        const boxes: Array<{
            element: HTMLElement;
            left: number;
            top: number;
            width: number;
            height: number;
            radius: number;
            bezel: number;
            order: number;
        }> = [];

        const addBox = (
            left: number,
            top: number,
            width: number,
            height: number,
            radius: number,
            bezel: number,
        ) => {
            const element = document.createElement("div");
            document.body.appendChild(element);
            const order = boxes.length + 2;
            unregs.push(
                registerCoalescenceParticipant({
                    element,
                    notifyPeerUpdate: () => {},
                    readBounds: () => ({ left, top, width, height, radius, bezel }),
                }),
            );
            syncCoalescenceGeometry(element, left, top, width, height, radius, bezel, 0, false);
            boxes.push({ element, left, top, width, height, radius, bezel, order });
        };

        // 4 ultra-close peers inside cell (1,1) around [128..192]
        addBox(194, 130, 20, 20, 6, 12); // gap = 2px
        addBox(195, 160, 20, 20, 6, 24); // gap = 3px (unequal bezel -> Derjaguin mean)
        addBox(150, 196, 20, 20, 6, 12); // gap = 4px
        addBox(130, 197, 20, 20, 6, 12); // gap = 5px

        // 24 farther peers in adjacent cells (still within 42px range, e.g. 20..40px away in cells (0,0), (0,1), (2,2), etc.)
        for (let idx = 0; idx < 6; idx++) {
            addBox(82, 82 + idx * 14, 24, 12, 4, 12);
            addBox(82, 212 + idx * 4, 24, 12, 4, 12);
            addBox(222, 82 + idx * 14, 24, 12, 4, 12);
            addBox(222, 214 + idx * 4, 24, 12, 4, 12);
        }

        const snapshot = collectCoalescenceSnapshot(selfEl);
        const stats = getLastCoalescenceSearchStatsForTesting();

        expect(snapshot.peers).toHaveLength(4);
        expect(stats.prunedCells).toBeGreaterThan(0);
        expect(stats.expandedCells).toBeLessThan(stats.expandedCells + stats.prunedCells);

        // Verify exact match with brute-force top-4
        const expectedCenters = [
            { x: 194 + 10 - 160, y: 130 + 10 - 160 },
            { x: 195 + 10 - 160, y: 160 + 10 - 160 },
            { x: 150 + 10 - 160, y: 196 + 10 - 160 },
            { x: 130 + 10 - 160, y: 197 + 10 - 160 },
        ];
        snapshot.peers.forEach((peer, index) => {
            expect(peer.relCenterX).toBeCloseTo(expectedCenters[index]!.x, 6);
            expect(peer.relCenterY).toBeCloseTo(expectedCenters[index]!.y, 6);
        });

        // Verify Derjaguin harmonic mean curvature radius for unequal bezels (12 and 24 -> 16)
        const derjaguinEffective = (2 * 12 * 24) / (12 + 24);
        expect(snapshot.peers[1]!.mergeRadius).toBeCloseTo(Math.min(48, Math.max(28, derjaguinEffective * 2.85)), 5);

        for (const unreg of unregs) unreg();
    });
});
