import type { GlassRefractionDirection } from "./types.js";

export function resolveRefractionDirection(direction: unknown): GlassRefractionDirection {
    return direction === "horizontal" || direction === "vertical" ? direction : "all";
}

export function getRefractionDirectionId(direction?: GlassRefractionDirection): number {
    return direction === "horizontal" ? 1 : direction === "vertical" ? 2 : 0;
}

export function resolveRefractionEdgeFade(edgeFade?: number): number {
    return typeof edgeFade === "number" && Number.isFinite(edgeFade)
        ? Math.min(1, Math.max(0, edgeFade))
        : 0.35;
}

export function getRefractionSpan(width: number, height: number, direction?: GlassRefractionDirection): number {
    return direction === "horizontal" ? width : direction === "vertical" ? height : Math.min(width, height);
}

export function resolveRefractionBezel(span: number, bezel: number, adaptive = false): number {
    return Math.max(1, Math.min(bezel, span * 0.5 - 1, adaptive ? span / 3 : Infinity));
}

export function resolveRefractionTravel(span: number, bezel: number): number {
    return Math.max(0, span * 0.5 - bezel - 0.5);
}

export function getOpticalLutPeak(lut: Uint8Array): number {
    let peak = 0;
    let normal = (lut[0]! * 256 + lut[1]!) - 32767;
    let refraction = (lut[2]! * 256 + lut[3]!) - 32767;
    for (let i = 4; i < lut.length; i += 4) {
        const nextNormal = (lut[i]! * 256 + lut[i + 1]!) - 32767;
        const nextRefraction = (lut[i + 2]! * 256 + lut[i + 3]!) - 32767;
        const deltaNormal = nextNormal - normal;
        const deltaRefraction = nextRefraction - refraction;
        const quadratic = deltaNormal * deltaRefraction;
        const linear = normal * deltaRefraction + refraction * deltaNormal;
        if (quadratic !== 0) {
            const t = -linear / (2 * quadratic);
            if (t > 0 && t < 1) {
                peak = Math.max(peak, Math.abs((normal + t * deltaNormal) * (refraction + t * deltaRefraction)));
            }
        }
        peak = Math.max(peak, Math.abs(normal * refraction));
        normal = nextNormal;
        refraction = nextRefraction;
    }
    return Math.max(peak, Math.abs(normal * refraction)) / (32767 * 32767);
}
