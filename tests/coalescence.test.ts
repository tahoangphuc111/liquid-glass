import { afterEach, describe, expect, it, vi } from "vitest";
import {
    collectCoalescenceSnapshot,
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

        // B collects snapshot and sees A
        const snapB = collectCoalescenceSnapshot(elB);
        expect(snapB.peers.length).toBe(1);

        notifyB.mockClear();
        // Unregister A - B must be notified to clear ghost blend
        unregisterA();
        expect(notifyB).toHaveBeenCalled();

        unregisterB();
    });
});
