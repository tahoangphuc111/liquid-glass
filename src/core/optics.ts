import type { GlassSurface } from "./types.js";

export const OPTICAL_LUT_SIZE = 1024;

const opticalLutCache = new Map<string, Uint8Array>();

export function evaluateOpticalProfile(depth: number, surface: GlassSurface, ior: number): [number, number] {
    const x = Math.min(0.999, Math.max(0.001, depth));
    const u = 1 - x;
    const u2 = u * u;
    let slope: number;
    if (surface === "convex_circle") {
        slope = u / Math.sqrt(Math.max(1e-6, 1 - u2));
    } else if (surface === "linear") {
        slope = 1;
    } else if (surface === "lip") {
        slope = 6 * x * u + (1 - 2 * x) * 1.2;
    } else {
        slope = u * (0.30 / Math.sqrt(Math.max(1e-6, 1 - u2)) +
            0.70 * u2 / Math.pow(Math.max(1e-6, 1 - u2 * u2), 0.75));
    }
    const fade = Math.min(1, Math.max(0, (depth - 0.90) * 10));
    const mask = 1 - fade * fade * (3 - 2 * fade);
    const denom = 1 + depth * (0.725 + 0.21 * depth);
    const tilt = mask / (denom * denom);
    const xy = Math.min(0.98, Math.max(0, tilt * (0.50 + 0.50 * Math.min(2, slope))));
    const eta = 1 / Math.max(1.01, ior);
    const displacement = (1 - eta * eta) * tilt / (1 + eta * Math.sqrt(1 + slope * slope));
    return [xy, displacement];
}

export function buildOpticalLut(surface: GlassSurface, ior: number, size = OPTICAL_LUT_SIZE): Uint8Array {
    if (!Number.isInteger(size) || size < 2) {
        throw new RangeError("Optical LUT size must be an integer of at least 2");
    }
    const key = `${surface}:${Math.max(1.01, ior)}:${size}`;
    const cached = opticalLutCache.get(key);
    if (cached) {
        opticalLutCache.delete(key);
        opticalLutCache.set(key, cached);
        return cached;
    }
    const data = new Uint8Array(size * 4);
    for (let index = 0; index < size; index++) {
        const [xy, displacement] = evaluateOpticalProfile(index / (size - 1), surface, ior);
        const normal = Math.round(xy * 65535);
        const offset = Math.round(displacement * 65535);
        data[index * 4] = normal >>> 8;
        data[index * 4 + 1] = normal & 255;
        data[index * 4 + 2] = offset >>> 8;
        data[index * 4 + 3] = offset & 255;
    }
    if (opticalLutCache.size >= 32) {
        opticalLutCache.delete(opticalLutCache.keys().next().value!);
    }
    opticalLutCache.set(key, data);
    return data;
}