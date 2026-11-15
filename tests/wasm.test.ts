import { describe, expect, it, vi } from "vitest";
import {
    acquireCachedDisplacementBlobUrl,
    clearDisplacementCache,
    getDisplacementCacheStats,
    getWasmDisplacementBmp,
    initWasmSimdModule,
    isWasmReady,
    releaseCachedDisplacementBlobUrl,
} from "../src/core/wasm.js";
import type { GlassSurface } from "../src/core/types.js";

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

    it("supports 1D horizontal strips when pill axis-X mode is enabled", () => {
        initWasmSimdModule();

        const strip = getWasmDisplacementBmp(128, 1, 20, 18, 60, 1.0, 2.05, "convex_squircle", true, true);

        expect(strip).not.toBeNull();
        expect(strip!.blob.size).toBe(64 + 128 * 1 * 4);
        expect(strip!.maxDisplacement).toBeGreaterThan(0);
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
});
