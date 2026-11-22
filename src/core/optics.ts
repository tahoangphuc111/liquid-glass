import type { GlassSurface } from "./types.js";

export const OPTICAL_LUT_SIZE = 1024;

interface SurfaceGeometryBasis {
    readonly sinI: Float32Array;
    readonly cosI: Float32Array;
    readonly scaledTilt: Float32Array;
    readonly normalHi: Uint8Array;
    readonly normalLo: Uint8Array;
}

const opticalLutCache = new Map<string, Uint8Array>();
const surfaceBasisCache = new Map<string, SurfaceGeometryBasis>();
let lastLutSurface: GlassSurface | "" = "";
let lastLutIorRounded = -1;
let lastLutSize = 0;
let lastLutData: Uint8Array | null = null;

function evaluateSurfaceSample(
    depth: number,
    surface: GlassSurface,
): { sinI: number; cosI: number; tilt: number; xy: number } {
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
    } else if (surface === "concave") {
        slope = -(u / Math.sqrt(Math.max(1e-6, 1 - u2)));
    } else {
        const oneMinusU4 = Math.max(1e-6, 1 - u2 * u2);
        const root4 = Math.sqrt(Math.sqrt(oneMinusU4));
        slope =
            u *
            (0.30 / Math.sqrt(Math.max(1e-6, 1 - u2)) +
                (0.70 * u2) / (root4 * root4 * root4));
    }
    const fade = Math.min(1, Math.max(0, (depth - 0.90) * 10));
    const mask = 1 - fade * fade * (3 - 2 * fade);
    const denom = 1 + depth * (0.725 + 0.21 * depth);
    const tilt = mask / (denom * denom);

    const invNorm = 1 / Math.sqrt(1 + slope * slope);
    const sinI = slope * invNorm;
    const cosI = invNorm;
    const xy = Math.min(0.98, Math.max(-0.98, tilt * sinI));
    return { sinI, cosI, tilt, xy };
}

function encodeSignedUnit16(value: number): number {
    const clamped = Math.min(1, Math.max(-1, value));
    return Math.min(65534, Math.max(0, Math.round(32767 + clamped * 32767)));
}

const FRAUNHOFER_C_NM = 656.2725;
const FRAUNHOFER_D_NM = 587.5618;
const FRAUNHOFER_F_NM = 486.1327;
const INV_LAMBDA_C_SQ = 1 / (FRAUNHOFER_C_NM * FRAUNHOFER_C_NM);
const INV_LAMBDA_D_SQ = 1 / (FRAUNHOFER_D_NM * FRAUNHOFER_D_NM);
const INV_LAMBDA_F_SQ = 1 / (FRAUNHOFER_F_NM * FRAUNHOFER_F_NM);
const CAUCHY_INV_DELTA = 1 / (INV_LAMBDA_F_SQ - INV_LAMBDA_C_SQ);

export interface FresnelReflectanceSample {
    readonly reflectanceS: number;
    readonly reflectanceP: number;
    readonly reflectance: number;
    readonly transmittance: number;
    readonly totalInternalReflection: boolean;
}

export interface SpectralRefractionSample {
    readonly redDisplacement: number;
    readonly greenDisplacement: number;
    readonly blueDisplacement: number;
    readonly reflectance: number;
    readonly normalXy: number;
}

export function evaluateFresnelReflectance(
    cosIncidence: number,
    ior: number,
    internal = false,
): FresnelReflectanceSample {
    const safeIor = Number.isFinite(ior) ? Math.max(1.0001, ior) : 1.49;
    const cosI = Number.isFinite(cosIncidence) ? Math.min(1, Math.max(0, Math.abs(cosIncidence))) : 1;
    const n1 = internal ? safeIor : 1;
    const n2 = internal ? 1 : safeIor;
    const sinISq = Math.max(0, 1 - cosI * cosI);
    const eta = n1 / n2;
    const sinTSq = eta * eta * sinISq;

    if (sinTSq >= 1) {
        return {
            reflectanceS: 1,
            reflectanceP: 1,
            reflectance: 1,
            transmittance: 0,
            totalInternalReflection: true,
        };
    }

    const cosT = Math.sqrt(Math.max(0, 1 - sinTSq));
    const rsNum = n1 * cosI - n2 * cosT;
    const rsDen = n1 * cosI + n2 * cosT;
    const rpNum = n1 * cosT - n2 * cosI;
    const rpDen = n1 * cosT + n2 * cosI;
    const reflectanceS = rsDen > 0 ? (rsNum / rsDen) * (rsNum / rsDen) : 1;
    const reflectanceP = rpDen > 0 ? (rpNum / rpDen) * (rpNum / rpDen) : 1;
    const reflectance = 0.5 * (reflectanceS + reflectanceP);

    return {
        reflectanceS,
        reflectanceP,
        reflectance,
        transmittance: Math.max(0, 1 - reflectance),
        totalInternalReflection: false,
    };
}

export function evaluateBrewsterAngle(ior: number): number {
    const safeIor = Number.isFinite(ior) ? Math.max(1.0001, ior) : 1.49;
    return Math.atan(safeIor);
}

export function evaluateCriticalAngle(ior: number): number {
    const safeIor = Number.isFinite(ior) ? Math.max(1.0001, ior) : 1.49;
    return Math.asin(1 / safeIor);
}

export function evaluateCauchyIndex(
    wavelengthNm: number,
    ior: number,
    abbeNumber = 58.5,
): number {
    const safeIor = Number.isFinite(ior) ? Math.max(1.0001, ior) : 1.49;
    const safeAbbe = Number.isFinite(abbeNumber) ? Math.min(120, Math.max(10, abbeNumber)) : 58.5;
    const safeWavelength = Number.isFinite(wavelengthNm) ? Math.min(2000, Math.max(200, wavelengthNm)) : FRAUNHOFER_D_NM;
    const cauchyB = ((safeIor - 1) / safeAbbe) * CAUCHY_INV_DELTA;
    const cauchyA = safeIor - cauchyB * INV_LAMBDA_D_SQ;
    return Math.max(1.0001, cauchyA + cauchyB / (safeWavelength * safeWavelength));
}

function evaluateRefractedDisplacement(
    sinI: number,
    cosI: number,
    scaledTilt: number,
    ior: number,
): number {
    const eta = 1 / Math.max(1.01, ior);
    const sinT = Math.min(0.999, Math.max(-0.999, eta * sinI));
    const cosT = Math.sqrt(Math.max(1e-6, 1 - sinT * sinT));
    const sinDelta = sinI * cosT - cosI * sinT;
    const cosDelta = Math.max(0.55, cosI * cosT + sinI * sinT);
    return Math.min(1, Math.max(-1, scaledTilt * (sinDelta / cosDelta)));
}

export interface VectorRefractionResult {
    readonly refracted: readonly [number, number, number] | null;
    readonly reflected: readonly [number, number, number];
    readonly reflectance: number;
    readonly transmittance: number;
    readonly totalInternalReflection: boolean;
}

export function solveRefractionRay(
    incident: readonly [number, number, number],
    normal: readonly [number, number, number],
    iorFrom: number,
    iorTo: number,
): VectorRefractionResult {
    const iLen = Math.hypot(incident[0], incident[1], incident[2]) || 1;
    const ix = incident[0] / iLen;
    const iy = incident[1] / iLen;
    const iz = incident[2] / iLen;

    const nLen = Math.hypot(normal[0], normal[1], normal[2]) || 1;
    let nx = normal[0] / nLen;
    let ny = normal[1] / nLen;
    let nz = normal[2] / nLen;

    let cosI = -(ix * nx + iy * ny + iz * nz);
    if (cosI < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
        cosI = -cosI;
    }
    cosI = Math.min(1, Math.max(0, cosI));

    const rx = ix + 2 * cosI * nx;
    const ry = iy + 2 * cosI * ny;
    const rz = iz + 2 * cosI * nz;
    const rLen = Math.hypot(rx, ry, rz) || 1;
    const reflected: readonly [number, number, number] = [rx / rLen, ry / rLen, rz / rLen];

    const n1 = Number.isFinite(iorFrom) ? Math.max(1.0, iorFrom) : 1.0;
    const n2 = Number.isFinite(iorTo) ? Math.max(1.0, iorTo) : 1.5;
    if (n1 === n2) {
        return {
            refracted: [ix, iy, iz],
            reflected,
            reflectance: 0,
            transmittance: 1,
            totalInternalReflection: false,
        };
    }
    const eta = n1 / n2;
    const sinTSq = eta * eta * Math.max(0, 1 - cosI * cosI);

    if (sinTSq >= 1) {
        return {
            refracted: null,
            reflected,
            reflectance: 1,
            transmittance: 0,
            totalInternalReflection: true,
        };
    }

    const cosT = Math.sqrt(Math.max(0, 1 - sinTSq));
    const k = eta * cosI - cosT;
    const tx = eta * ix + k * nx;
    const ty = eta * iy + k * ny;
    const tz = eta * iz + k * nz;
    const tLen = Math.hypot(tx, ty, tz) || 1;

    const rsNum = n1 * cosI - n2 * cosT;
    const rsDen = n1 * cosI + n2 * cosT;
    const rpNum = n1 * cosT - n2 * cosI;
    const rpDen = n1 * cosT + n2 * cosI;
    const rs = rsDen > 0 ? (rsNum / rsDen) * (rsNum / rsDen) : 1;
    const rp = rpDen > 0 ? (rpNum / rpDen) * (rpNum / rpDen) : 1;
    const reflectance = 0.5 * (rs + rp);

    return {
        refracted: [tx / tLen, ty / tLen, tz / tLen],
        reflected,
        reflectance,
        transmittance: Math.max(0, 1 - reflectance),
        totalInternalReflection: false,
    };
}

export function evaluateSpectralRefraction(
    depth: number,
    surface: GlassSurface,
    ior: number,
    abbeNumber = 58.5,
): SpectralRefractionSample {
    const { sinI, cosI, tilt, xy } = evaluateSurfaceSample(depth, surface);
    const safeIor = Number.isFinite(ior) ? Math.max(1.01, ior) : 1.49;
    const scaledTilt = tilt * 0.52;
    const nRed = evaluateCauchyIndex(FRAUNHOFER_C_NM, safeIor, abbeNumber);
    const nBlue = evaluateCauchyIndex(FRAUNHOFER_F_NM, safeIor, abbeNumber);

    return {
        redDisplacement: evaluateRefractedDisplacement(sinI, cosI, scaledTilt, nRed),
        greenDisplacement: evaluateRefractedDisplacement(sinI, cosI, scaledTilt, safeIor),
        blueDisplacement: evaluateRefractedDisplacement(sinI, cosI, scaledTilt, nBlue),
        reflectance: evaluateFresnelReflectance(cosI, safeIor, false).reflectance,
        normalXy: xy,
    };
}

function getSurfaceGeometryBasis(surface: GlassSurface, size: number): SurfaceGeometryBasis {
    const basisKey = `${surface}:${size}`;
    const existing = surfaceBasisCache.get(basisKey);
    if (existing) {
        surfaceBasisCache.delete(basisKey);
        surfaceBasisCache.set(basisKey, existing);
        return existing;
    }
    const sinI = new Float32Array(size);
    const cosI = new Float32Array(size);
    const scaledTilt = new Float32Array(size);
    const normalHi = new Uint8Array(size);
    const normalLo = new Uint8Array(size);
    const invSpan = 1 / (size - 1);
    for (let index = 0; index < size; index++) {
        const sample = evaluateSurfaceSample(index * invSpan, surface);
        sinI[index] = sample.sinI;
        cosI[index] = sample.cosI;
        scaledTilt[index] = sample.tilt * 0.52;
        const normal = encodeSignedUnit16(sample.xy);
        normalHi[index] = normal >>> 8;
        normalLo[index] = normal & 255;
    }
    const basis: SurfaceGeometryBasis = { sinI, cosI, scaledTilt, normalHi, normalLo };
    if (surfaceBasisCache.size >= 16) {
        surfaceBasisCache.delete(surfaceBasisCache.keys().next().value!);
    }
    surfaceBasisCache.set(basisKey, basis);
    return basis;
}

export interface ChromaticDispersionSample {
    displacement: number;
    lateralSpread: number;
    redShift: number;
    blueShift: number;
}

export function evaluateOpticalProfile(depth: number, surface: GlassSurface, ior: number): [number, number] {
    const { sinI, cosI, tilt, xy } = evaluateSurfaceSample(depth, surface);
    const safeIor = Number.isFinite(ior) ? Math.max(1.01, ior) : 1.49;
    const eta = 1 / safeIor;
    const sinT = Math.min(0.999, Math.max(-0.999, eta * sinI));
    const cosT = Math.sqrt(Math.max(1e-6, 1 - sinT * sinT));
    const sinDelta = sinI * cosT - cosI * sinT;
    const cosDelta = Math.max(0.55, cosI * cosT + sinI * sinT);
    const displacement = Math.min(1, Math.max(-1, tilt * (sinDelta / cosDelta) * 0.52));
    return [xy, displacement];
}

export function evaluateChromaticDispersion(
    depth: number,
    surface: GlassSurface,
    ior: number,
    abbeNumber = 58.5,
): ChromaticDispersionSample {
    const { sinI, cosI, tilt } = evaluateSurfaceSample(depth, surface);
    const safeIor = Number.isFinite(ior) ? Math.max(1.01, ior) : 1.49;
    const safeAbbe = Number.isFinite(abbeNumber) ? Math.min(120, Math.max(10, abbeNumber)) : 58.5;
    const eta = 1 / safeIor;
    const sinT = Math.min(0.999, Math.max(-0.999, eta * sinI));
    const cosT = Math.sqrt(Math.max(1e-6, 1 - sinT * sinT));
    const sinDelta = sinI * cosT - cosI * sinT;
    const rawCosDelta = cosI * cosT + sinI * sinT;
    const cosDelta = Math.max(0.55, rawCosDelta);
    const scaledTilt = tilt * 0.52;
    const displacement = Math.min(1, Math.max(-1, scaledTilt * (sinDelta / cosDelta)));

    const deltaIor = (safeIor - 1) / safeAbbe;
    const dDisplacementDn =
        rawCosDelta >= 0.55
            ? (scaledTilt * sinT) / (safeIor * cosT * cosDelta * cosDelta)
            : (scaledTilt * rawCosDelta * sinT) / (safeIor * cosT * 0.55);
    const lateralSpread = Math.min(0.25, Math.max(-0.25, dDisplacementDn * deltaIor));

    return {
        displacement,
        lateralSpread,
        redShift: Math.min(1, Math.max(-1, displacement - 0.36 * lateralSpread)),
        blueShift: Math.min(1, Math.max(-1, displacement + 0.64 * lateralSpread)),
    };
}

export function buildOpticalLut(surface: GlassSurface, ior: number, size = OPTICAL_LUT_SIZE): Uint8Array {
    if (!Number.isInteger(size) || size < 2) {
        throw new RangeError("Optical LUT size must be an integer of at least 2");
    }
    const safeIor = Number.isFinite(ior) ? Math.max(1.01, ior) : 1.49;
    const roundedIor = Math.round(safeIor * 1000);
    if (
        lastLutData !== null &&
        surface === lastLutSurface &&
        roundedIor === lastLutIorRounded &&
        size === lastLutSize
    ) {
        return lastLutData;
    }
    const key = `${surface}:${roundedIor}:${size}`;
    const cached = opticalLutCache.get(key);
    if (cached) {
        opticalLutCache.delete(key);
        opticalLutCache.set(key, cached);
        lastLutSurface = surface;
        lastLutIorRounded = roundedIor;
        lastLutSize = size;
        lastLutData = cached;
        return cached;
    }
    const basis = getSurfaceGeometryBasis(surface, size);
    const { sinI: sinIArr, cosI: cosIArr, scaledTilt: tiltArr, normalHi, normalLo } = basis;
    const eta = 1 / (roundedIor / 1000);
    const data = new Uint8Array(size * 4);
    if (surface === "linear") {
        const sI = sinIArr[0]!;
        const cI = cosIArr[0]!;
        const sinT = eta * sI;
        const cosT = Math.sqrt(1 - sinT * sinT);
        const sinDelta = sI * (cosT - eta * cI);
        const cosDelta = Math.max(0.55, cI * cosT + sI * sinT);
        const tanDelta = sinDelta / cosDelta;
        for (let index = 0; index < size; index++) {
            const displacement = Math.min(1, Math.max(-1, tiltArr[index]! * tanDelta));
            const offset = encodeSignedUnit16(displacement);
            const baseIdx = index << 2;
            data[baseIdx] = normalHi[index]!;
            data[baseIdx + 1] = normalLo[index]!;
            data[baseIdx + 2] = offset >>> 8;
            data[baseIdx + 3] = offset & 255;
        }
    } else {
        for (let index = 0; index < size; index++) {
            const sI = sinIArr[index]!;
            const cI = cosIArr[index]!;
            const sinT = eta * sI;
            const cosT = Math.sqrt(1 - sinT * sinT);
            const sinDelta = sI * (cosT - eta * cI);
            const cosDelta = Math.max(0.55, cI * cosT + sI * sinT);
            const displacement = Math.min(1, Math.max(-1, tiltArr[index]! * (sinDelta / cosDelta)));
            const offset = encodeSignedUnit16(displacement);
            const baseIdx = index << 2;
            data[baseIdx] = normalHi[index]!;
            data[baseIdx + 1] = normalLo[index]!;
            data[baseIdx + 2] = offset >>> 8;
            data[baseIdx + 3] = offset & 255;
        }
    }
    if (opticalLutCache.size >= 32) {
        opticalLutCache.delete(opticalLutCache.keys().next().value!);
    }
    opticalLutCache.set(key, data);
    lastLutSurface = surface;
    lastLutIorRounded = roundedIor;
    lastLutSize = size;
    lastLutData = data;
    return data;
}

export function resetOpticalLutCacheForTesting(): void {
    opticalLutCache.clear();
    surfaceBasisCache.clear();
    lastLutSurface = "";
    lastLutIorRounded = -1;
    lastLutSize = 0;
    lastLutData = null;
}
