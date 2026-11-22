import { describe, expect, it, vi } from "vitest";
import {
    acquireCachedDisplacementBlobUrl,
    clearDisplacementCache,
    getDisplacementCacheStats,
    getWasmDisplacementBmp,
    initWasmSimdModule,
    isWasmReady,
    releaseCachedDisplacementBlobUrl,
    resetWasmModuleForTesting,
} from "../src/core/wasm.js";
import type { GlassSurface } from "../src/core/types.js";

function readBlobBytes(blob: Blob): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
    });
}

function readBlobHeader(blob: Blob): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob.slice(0, 2));
    });
}

describe("WASM displacement generator", () => {
    it("initializes the embedded module", () => {
        initWasmSimdModule();
        expect(isWasmReady()).toBe(true);
    });

    it("rejects dimensions that could wrap at the WASM boundary and handles extreme finite thickness", () => {
        const generate = (width: number, thickness: number, scale: number) =>
            getWasmDisplacementBmp(width, 32, 16, 12, thickness, scale, 2.05, "convex_squircle", false, false);
        expect(generate(2 ** 32 + 64, 42, 1)).toBeNull();
        expect(generate(64.5, 42, 1)).toBeNull();
        const extreme = generate(64, 3e38, 4);
        expect(extreme?.blob.size).toBe(64 + 64 * 32 * 4);
        expect(extreme!.maxDisplacement).toBeGreaterThan(0);
        expect(Number.isFinite(extreme!.maxDisplacement)).toBe(true);
    });

    it("writes a valid 64-byte BMP header and displacement pixels for every surface", async () => {
        initWasmSimdModule();

        const surfaces: GlassSurface[] = ["convex_squircle", "convex_circle", "linear", "lip"];

        for (const surface of surfaces) {
            const result = getWasmDisplacementBmp(64, 32, 16, 12, 42, 1.0, 2.05, surface, false, false);

            expect(result).not.toBeNull();
            expect(result!.maxDisplacement).toBeGreaterThan(0);
            expect(result!.blob).toBeInstanceOf(Blob);
            expect(result!.blob.size).toBe(64 + 64 * 32 * 4);

            const header = await readBlobHeader(result!.blob);
            expect(header[0]).toBe(0x42);
            expect(header[1]).toBe(0x4d);
        }
    });

    it("supports 1D horizontal strips when pill axis-X mode is enabled", async () => {
        initWasmSimdModule();

        const strip = getWasmDisplacementBmp(128, 1, 20, 18, 60, 1.0, 2.05, "convex_squircle", true, true);

        expect(strip).not.toBeNull();
        expect(strip!.blob.size).toBe(64 + 128 * 1 * 4);
        expect(strip!.maxDisplacement).toBeGreaterThan(0);

        const bytes = await readBlobBytes(strip!.blob);
        for (let x = 0; x < 18; x++) {
            const leftR = bytes[64 + x * 4 + 2]!;
            const rightR = bytes[64 + (127 - x) * 4 + 2]!;
            if (x < 15) {
                expect(leftR).toBeGreaterThan(128);
                expect(rightR).toBeLessThan(128);
            } else {
                expect(leftR).toBeGreaterThanOrEqual(128);
                expect(rightR).toBeLessThanOrEqual(128);
            }
            expect(Math.abs(leftR + rightR - 256)).toBeLessThanOrEqual(1);
            expect(bytes[64 + x * 4 + 1]).toBe(128);
            expect(bytes[64 + x * 4 + 3]).toBe(255);
        }
        const centerOffset = 64 + 64 * 4;
        expect(Array.from(bytes.slice(centerOffset, centerOffset + 4))).toEqual([128, 128, 128, 255]);
    });

    it("keeps directional refraction at the caps and neutralizes the cross-axis edges", async () => {
        const makeMap = (w: number, h: number, direction: "horizontal" | "vertical", fade: number) =>
            getWasmDisplacementBmp(w, h, 0, 8, 32, 1, 1.5, "convex_squircle", true, false, "squircle", {
                refractionDirection: direction, refractionEdgeFade: fade,
            })!.blob;

        const horizontal = await readBlobBytes(makeMap(81, 21, "horizontal", 0.75));
        const vertical = await readBlobBytes(makeMap(21, 81, "vertical", 0.75));
        const offset = (x: number, y: number, width: number) => 64 + 4 * (y * width + x);
        const distortion = (x: number, y: number) => horizontal[offset(x, y, 81) + 2]!;

        for (let y = 0; y < 21; y++) {
            for (let x = 0; x < 81; x++) {
                expect(horizontal[offset(x, y, 81) + 1]).toBe(128);
                expect(vertical[offset(y, x, 21) + 2]).toBe(128);
                expect(vertical[offset(y, x, 21) + 1]).toBe(distortion(x, y));
                if (y === 0 || y === 20 || x === 40) expect(distortion(x, y)).toBe(128);
            }
        }

        expect(distortion(1, 10)).toBeGreaterThan(152);
        expect(distortion(79, 10)).toBeLessThan(104);
        expect(distortion(4, 3)).toBeLessThan(distortion(4, 10));
        const quickFade = await readBlobBytes(makeMap(81, 21, "horizontal", 0));
        expect(quickFade[offset(4, 3, 81) + 2]).toBeGreaterThan(distortion(4, 3));

        for (const cornerStyle of ["circular", "squircle"] as const) {
            const rectHoriz = await readBlobBytes(
                getWasmDisplacementBmp(72, 40, 10, 12, 36, 1, 1.55, "convex_squircle", false, false, cornerStyle, {
                    refractionDirection: "horizontal",
                    refractionEdgeFade: 0.35,
                })!.blob,
            );
            const rectVert = await readBlobBytes(
                getWasmDisplacementBmp(40, 72, 10, 12, 36, 1, 1.55, "convex_squircle", false, false, cornerStyle, {
                    refractionDirection: "vertical",
                    refractionEdgeFade: 0.35,
                })!.blob,
            );
            for (let y = 0; y < 40; y++) {
                for (let x = 0; x < 72; x++) {
                    const horizR = rectHoriz[offset(x, y, 72) + 2]!;
                    const vertG = rectVert[offset(y, x, 40) + 1]!;
                    expect(Math.abs(horizR - vertG)).toBeLessThanOrEqual(1);
                }
            }
        }
    });

    it("reuses cached displacement blobs and ref-counted blob URLs across identical geometry", () => {
        initWasmSimdModule();
        clearDisplacementCache();

        const originalCreateObjectUrl = URL.createObjectURL;
        const originalRevokeObjectUrl = URL.revokeObjectURL;
        let urlCounter = 0;
        const createSpy = vi.fn(() => `blob:test/${++urlCounter}`);
        const revokeSpy = vi.fn();
        URL.createObjectURL = createSpy;
        URL.revokeObjectURL = revokeSpy;

        try {
            const first = getWasmDisplacementBmp(84, 36, 18, 14, 48, 1.0, 2.15, "convex_squircle", true, false);
            expect(first).not.toBeNull();
            const acquireA = acquireCachedDisplacementBlobUrl(first!.blob);
            expect(acquireA.createdNew).toBe(true);

            for (let index = 0; index < 19; index++) {
                const repeated = getWasmDisplacementBmp(84, 36, 18, 14, 48, 1.0, 2.15, "convex_squircle", true, false);
                expect(repeated?.blob).toBe(first!.blob);
                const acquired = acquireCachedDisplacementBlobUrl(repeated!.blob);
                expect(acquired.blobUrl).toBe(acquireA.blobUrl);
                expect(acquired.createdNew).toBe(false);
            }

            expect(createSpy).toHaveBeenCalledTimes(1);
            expect(getDisplacementCacheStats().entries).toBe(1);

            for (let index = 0; index < 65; index++) {
                getWasmDisplacementBmp(64 + index * 2, 32, 12, 10, 40, 1.0, 1.5, "convex_circle", false, false);
            }
            expect(getDisplacementCacheStats().entries).toBeLessThanOrEqual(64);
            expect(revokeSpy).not.toHaveBeenCalledWith(acquireA.blobUrl);

            for (let index = 0; index < 19; index++) {
                expect(releaseCachedDisplacementBlobUrl(acquireA.blobUrl)).toBe(false);
            }
            expect(releaseCachedDisplacementBlobUrl(acquireA.blobUrl)).toBe(true);
            expect(revokeSpy).toHaveBeenCalledWith(acquireA.blobUrl);
        } finally {
            clearDisplacementCache();
            URL.createObjectURL = originalCreateObjectUrl;
            URL.revokeObjectURL = originalRevokeObjectUrl;
        }
    });

    it("sanitizes NaN geometry parameters and supports concave + squircle surfaces", () => {
        initWasmSimdModule();
        const sanitized = getWasmDisplacementBmp(
            48,
            24,
            Number.NaN,
            Number.NaN,
            Number.NaN,
            Number.NaN,
            Number.NaN,
            "convex_squircle",
            false,
            false,
        );
        expect(sanitized).not.toBeNull();
        expect(Number.isFinite(sanitized!.maxDisplacement)).toBe(true);
        expect(sanitized!.maxDisplacement).toBeGreaterThan(0);
        expect(sanitized!.blob.size).toBe(64 + 48 * 24 * 4);

        const wasmConcave = getWasmDisplacementBmp(64, 32, 16, 12, 42, 1, 2.05, "concave", false, false);
        expect(wasmConcave).not.toBeNull();
        expect(wasmConcave!.maxDisplacement).toBeGreaterThan(0);

        const circBmp = getWasmDisplacementBmp(64, 64, 24, 14, 42, 1, 2.05, "convex_squircle", false, false, "circular");
        const sqBmp = getWasmDisplacementBmp(64, 64, 24, 14, 42, 1, 2.05, "convex_squircle", false, false, "squircle");
        expect(circBmp).not.toBeNull();
        expect(sqBmp).not.toBeNull();
        expect(sqBmp!.blob).not.toBe(circBmp!.blob);
    });

    it("keeps maxDisplacement invariant across raster scale factors", () => {
        initWasmSimdModule();
        const halfScale = getWasmDisplacementBmp(64, 32, 16, 12, 48, 0.5, 1.85, "convex_squircle", false, false);
        const unitScale = getWasmDisplacementBmp(128, 64, 16, 12, 48, 1.0, 1.85, "convex_squircle", false, false);
        const doubleScale = getWasmDisplacementBmp(256, 128, 16, 12, 48, 2.0, 1.85, "convex_squircle", false, false);

        expect(halfScale).not.toBeNull();
        expect(unitScale).not.toBeNull();
        expect(doubleScale).not.toBeNull();
        expect(halfScale!.maxDisplacement).toBeCloseTo(unitScale!.maxDisplacement, 3);
        expect(doubleScale!.maxDisplacement).toBeCloseTo(unitScale!.maxDisplacement, 3);
    });

    it("resets WASM module cleanly and handles re-initialization", () => {
        resetWasmModuleForTesting();
        expect(isWasmReady()).toBe(false);
        initWasmSimdModule();
        expect(isWasmReady()).toBe(true);
    });
});
