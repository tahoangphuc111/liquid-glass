import { describe, expect, it } from "vitest";
import { buildOpticalLut, evaluateOpticalProfile, OPTICAL_LUT_SIZE } from "../src/core/optics.js";
import type { GlassSurface } from "../src/core/types.js";

const surfaces: GlassSurface[] = ["convex_squircle", "convex_circle", "linear", "lip"];

function sample(data: Uint8Array, depth: number, channel: number): number {
    const position = depth * (data.length / 4 - 1);
    const left = Math.floor(position);
    const right = Math.min(left + 1, data.length / 4 - 1);
    const decode = (index: number) => (data[index * 4 + channel] * 256 + data[index * 4 + channel + 1]) / 65535;
    return decode(left) + (decode(right) - decode(left)) * (position - left);
}

describe("optical lookup", () => {
    it("bounds interpolation error against the analytical optical profile", () => {
        for (const surface of surfaces) {
            for (const ior of [1.01, 1.5, 2.05, 4]) {
                const data = buildOpticalLut(surface, ior);
                expect(data.length).toBe(OPTICAL_LUT_SIZE * 4);
                for (let i = 0; i <= 10000; i++) {
                    const depth = i / 10000;
                    const exact = evaluateOpticalProfile(depth, surface, ior);
                    expect(Math.abs(sample(data, depth, 0) - exact[0])).toBeLessThan(0.002);
                    expect(Math.abs(sample(data, depth, 2) - exact[1])).toBeLessThan(0.0021);
                }
            }
        }
    });

    it("reuses equal profiles across renderers without conflating parameters", () => {
        const data = buildOpticalLut("lip", 1.7);
        expect(buildOpticalLut("lip", 1.7)).toBe(data);
        expect(buildOpticalLut("lip", 1.8)).not.toBe(data);
        expect(buildOpticalLut("linear", 1.7)).not.toBe(data);
        expect(buildOpticalLut("lip", 1.7, 256)).not.toBe(data);
        expect(buildOpticalLut("lip", 1)).toBe(buildOpticalLut("lip", 1.01));
    });

    it("evicts old entries and rejects invalid table dimensions", () => {
        const data = buildOpticalLut("linear", 7);
        for (let i = 0; i < 33; i++) buildOpticalLut("linear", 8 + i);
        expect(buildOpticalLut("linear", 7)).not.toBe(data);
        for (const size of [0, 1, -1, 1.5, NaN]) {
            expect(() => buildOpticalLut("linear", 1.5, size)).toThrow(RangeError);
        }
    });
});