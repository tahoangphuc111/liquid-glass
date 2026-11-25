import {
    CHROMATIC_BLUE_SHIFT_RATIO,
    CHROMATIC_RED_SHIFT_RATIO,
    DEFAULT_ABBE_NUMBER,
    MAX_ABBE_NUMBER,
    MIN_ABBE_NUMBER,
} from "./config.js";
import type { GlassSurface } from "./types.js";

export const OPTICAL_LUT_SIZE = 1024;

export type GlassMediumCoefficients = readonly [number, number, number, number];

export function resolveGlassMedium(
    red: number,
    green: number,
    blue: number,
    opacity: number,
    thickness: number,
): GlassMediumCoefficients {
    const alpha = Math.min(0.85, Math.max(0, opacity));
    if (alpha === 0) return [1, 1, 1, 0];
    const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
    const absorptionWeight = Math.min(0.85, chroma * 1.1);
    // For a fixed material, tint and absorption are affine in the scene color.
    const frostedGain = (1 - alpha) * (1 - absorptionWeight);
    const tintWeight = alpha * (1 - absorptionWeight);
    if (absorptionWeight === 0) return [frostedGain, frostedGain, frostedGain, tintWeight];

    const opticalDepth = -alpha * (0.75 + Math.min(160, Math.max(0, thickness)) * 0.014);
    return [
        frostedGain + absorptionWeight * Math.exp(opticalDepth * (1 - red)),
        frostedGain + absorptionWeight * Math.exp(opticalDepth * (1 - green)),
        frostedGain + absorptionWeight * Math.exp(opticalDepth * (1 - blue)),
        tintWeight,
    ];
}

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
const FRAUNHOFER_E_NM = 546.074;
const FRAUNHOFER_F_NM = 486.1327;
const SRGB_BLUE_NM = 460.0;
const INV_LAMBDA_C_SQ = 1 / (FRAUNHOFER_C_NM * FRAUNHOFER_C_NM);
const INV_LAMBDA_D_SQ = 1 / (FRAUNHOFER_D_NM * FRAUNHOFER_D_NM);
const INV_LAMBDA_F_SQ = 1 / (FRAUNHOFER_F_NM * FRAUNHOFER_F_NM);
const CAUCHY_INV_DELTA = 1 / (INV_LAMBDA_F_SQ - INV_LAMBDA_C_SQ);

export interface ThinFilmInterferenceSample {
    readonly redReflectance: number;
    readonly greenReflectance: number;
    readonly blueReflectance: number;
    readonly opticalPathDifferenceNm: number;
    readonly transmittanceRgb: readonly [number, number, number];
}

function evalAiryPolarizedReflectance(r01: number, r12: number, cosPhase: number): number {
    const r01Sq = r01 * r01;
    const r12Sq = r12 * r12;
    const cross = 2 * r01 * r12 * cosPhase;
    const denom = 1 + r01Sq * r12Sq + cross;
    if (denom <= 1e-12) return 1;
    return Math.min(1, Math.max(0, (r01Sq + r12Sq + cross) / denom));
}

/**
 * Exact Airy / Fabry-Perot multiple-beam thin-film interference for an unpolarized
 * wave across ambient (n0) -> dielectric film (n1, thickness d) -> substrate (n2).
 * Captures Stokes phase shifts, quarter-wave AR minima, and half-wave absentee layers.
 */
export function evaluateThinFilmInterference(
    filmThicknessNm: number,
    cosIncidence: number,
    filmIor: number,
    substrateIor: number,
    ambientIor = 1.0,
): ThinFilmInterferenceSample {
    const dNm = Number.isFinite(filmThicknessNm) ? Math.max(0, filmThicknessNm) : 0;
    const n0 = Number.isFinite(ambientIor) ? Math.max(1.0, ambientIor) : 1.0;
    const n1 = Number.isFinite(filmIor) ? Math.max(1.0, filmIor) : 1.38;
    const n2 = Number.isFinite(substrateIor) ? Math.max(1.0, substrateIor) : 1.52;
    const cos0 = Number.isFinite(cosIncidence) ? Math.min(1, Math.max(0, Math.abs(cosIncidence))) : 1;
    const sin0Sq = Math.max(0, 1 - cos0 * cos0);

    const sin1Sq = (n0 / n1) * (n0 / n1) * sin0Sq;
    if (sin1Sq >= 1) {
        return {
            redReflectance: 1,
            greenReflectance: 1,
            blueReflectance: 1,
            opticalPathDifferenceNm: 0,
            transmittanceRgb: [0, 0, 0],
        };
    }
    const cos1 = Math.sqrt(Math.max(0, 1 - sin1Sq));
    const opdNm = 2 * n1 * dNm * cos1;

    const sin2Sq = (n0 / n2) * (n0 / n2) * sin0Sq;
    if (sin2Sq >= 1) {
        return {
            redReflectance: 1,
            greenReflectance: 1,
            blueReflectance: 1,
            opticalPathDifferenceNm: opdNm,
            transmittanceRgb: [0, 0, 0],
        };
    }
    const cos2 = Math.sqrt(Math.max(0, 1 - sin2Sq));

    const rs01 = (n0 * cos0 - n1 * cos1) / Math.max(1e-12, n0 * cos0 + n1 * cos1);
    const rp01 = (n1 * cos0 - n0 * cos1) / Math.max(1e-12, n1 * cos0 + n0 * cos1);
    const rs12 = (n1 * cos1 - n2 * cos2) / Math.max(1e-12, n1 * cos1 + n2 * cos2);
    const rp12 = (n2 * cos1 - n1 * cos2) / Math.max(1e-12, n2 * cos1 + n1 * cos2);

    const evalChannel = (wavelengthNm: number): number => {
        const phase = (2 * Math.PI * opdNm) / wavelengthNm;
        const cosPhase = Math.cos(phase);
        const rS = evalAiryPolarizedReflectance(rs01, rs12, cosPhase);
        const rP = evalAiryPolarizedReflectance(rp01, rp12, cosPhase);
        return 0.5 * (rS + rP);
    };

    const redReflectance = evalChannel(FRAUNHOFER_C_NM);
    const greenReflectance = evalChannel(FRAUNHOFER_E_NM);
    const blueReflectance = evalChannel(SRGB_BLUE_NM);
    return {
        redReflectance,
        greenReflectance,
        blueReflectance,
        opticalPathDifferenceNm: opdNm,
        transmittanceRgb: [1 - redReflectance, 1 - greenReflectance, 1 - blueReflectance],
    };
}

/**
 * Derjaguin harmonic effective curvature radius R_eff = 2*R1*R2 / (R1 + R2)
 * governing capillary bridge geometry between two unequal menisci.
 */
export function evaluateDerjaguinEffectiveRadius(radiusA: number, radiusB: number): number {
    if (!Number.isFinite(radiusA) || !Number.isFinite(radiusB) || radiusA <= 0 || radiusB <= 0) {
        return 0;
    }
    return (2 * radiusA * radiusB) / (radiusA + radiusB);
}

/**
 * Young-Laplace capillary pressure jump DeltaP = gamma * (1/R1 + 1/R2) across
 * a curved liquid interface with principal radii of curvature R1, R2 (signed;
 * Infinity denotes a flat principal direction).
 */
export function evaluateYoungLaplacePressure(
    principalRadius1: number,
    principalRadius2: number,
    surfaceTension = 0.0728,
): number {
    if (!Number.isFinite(surfaceTension) || surfaceTension < 0) return 0;
    const invR1 =
        Number.isNaN(principalRadius1) || principalRadius1 === 0
            ? 0
            : Number.isFinite(principalRadius1)
              ? 1 / principalRadius1
              : 0;
    const invR2 =
        Number.isNaN(principalRadius2) || principalRadius2 === 0
            ? 0
            : Number.isFinite(principalRadius2)
              ? 1 / principalRadius2
              : 0;
    return surfaceTension * (invR1 + invR2);
}

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

export interface SellmeierCoefficients {
    readonly b1: number;
    readonly b2: number;
    readonly b3: number;
    readonly c1: number;
    readonly c2: number;
    readonly c3: number;
}

/** Standard Schott N-BK7 borosilicate crown glass Sellmeier coefficients (C_i in um^2). */
export const SCHOTT_BK7_SELLMEIER: SellmeierCoefficients = Object.freeze({
    b1: 1.03961212,
    b2: 0.231792344,
    b3: 1.01046945,
    c1: 0.00600069867,
    c2: 0.0200179144,
    c3: 103.560653,
});

/** Standard Schott SF11 high-dispersion dense flint glass Sellmeier coefficients (C_i in um^2). */
export const SCHOTT_SF11_SELLMEIER: SellmeierCoefficients = Object.freeze({
    b1: 1.73759695,
    b2: 0.313747346,
    b3: 1.89878101,
    c1: 0.013188707,
    c2: 0.0623068142,
    c3: 155.23629,
});

/**
 * 3-term Sellmeier dispersion equation:
 * n^2(lambda) = 1 + sum_i (B_i * lambda^2) / (lambda^2 - C_i), with lambda in micrometers.
 */
export function evaluateSellmeierIndex(
    wavelengthNm: number,
    coefficients: SellmeierCoefficients = SCHOTT_BK7_SELLMEIER,
): number {
    const safeLambdaUm =
        (Number.isFinite(wavelengthNm) ? Math.min(2500, Math.max(200, wavelengthNm)) : FRAUNHOFER_D_NM) *
        0.001;
    const lambdaSq = safeLambdaUm * safeLambdaUm;
    const d1 = lambdaSq - coefficients.c1;
    const d2 = lambdaSq - coefficients.c2;
    const d3 = lambdaSq - coefficients.c3;
    const term1 = Math.abs(d1) < 1e-9 ? 0 : (coefficients.b1 * lambdaSq) / d1;
    const term2 = Math.abs(d2) < 1e-9 ? 0 : (coefficients.b2 * lambdaSq) / d2;
    const term3 = Math.abs(d3) < 1e-9 ? 0 : (coefficients.b3 * lambdaSq) / d3;
    return Math.sqrt(Math.max(1.0002, 1 + term1 + term2 + term3));
}

/**
 * Bouguer-Beer-Lambert volumetric transmittance along the Snell-refracted
 * optical path L(theta_t) = thickness / cos(theta_t):
 * T_c = exp(-absorption_c * L(theta_t)).
 */
export function evaluateBeerLambertTransmittance(
    absorptionRgb: readonly [number, number, number],
    thickness: number,
    cosIncidence = 1.0,
    ior = 1.52,
): readonly [number, number, number] {
    const safeThickness = Number.isFinite(thickness) ? Math.max(0, thickness) : 0;
    if (safeThickness === 0) return [1, 1, 1];
    const safeIor = Number.isFinite(ior) ? Math.max(1.0001, ior) : 1.52;
    const cosI = Number.isFinite(cosIncidence) ? Math.min(1, Math.max(0, Math.abs(cosIncidence))) : 1;
    const sinTSq = Math.max(0, 1 - cosI * cosI) / (safeIor * safeIor);
    const cosT = Math.sqrt(Math.max(1e-6, 1 - sinTSq));
    const opticalPathLength = safeThickness / cosT;
    const sigmaR = Number.isFinite(absorptionRgb[0]) ? Math.max(0, absorptionRgb[0]) : 0;
    const sigmaG = Number.isFinite(absorptionRgb[1]) ? Math.max(0, absorptionRgb[1]) : 0;
    const sigmaB = Number.isFinite(absorptionRgb[2]) ? Math.max(0, absorptionRgb[2]) : 0;
    return [
        Math.exp(-sigmaR * opticalPathLength),
        Math.exp(-sigmaG * opticalPathLength),
        Math.exp(-sigmaB * opticalPathLength),
    ];
}

export function evaluateCauchyIndex(
    wavelengthNm: number,
    ior: number,
    abbeNumber = DEFAULT_ABBE_NUMBER,
): number {
    const safeIor = Number.isFinite(ior) ? Math.max(1.0001, ior) : 1.49;
    const safeAbbe = Number.isFinite(abbeNumber)
        ? Math.min(MAX_ABBE_NUMBER, Math.max(MIN_ABBE_NUMBER, abbeNumber))
        : DEFAULT_ABBE_NUMBER;
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
    abbeNumber = DEFAULT_ABBE_NUMBER,
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
    return [xy, evaluateRefractedDisplacement(sinI, cosI, tilt * 0.52, safeIor)];
}

export function evaluateChromaticDispersion(
    depth: number,
    surface: GlassSurface,
    ior: number,
    abbeNumber = DEFAULT_ABBE_NUMBER,
): ChromaticDispersionSample {
    const { sinI, cosI, tilt } = evaluateSurfaceSample(depth, surface);
    const safeIor = Number.isFinite(ior) ? Math.max(1.01, ior) : 1.49;
    const safeAbbe = Number.isFinite(abbeNumber)
        ? Math.min(MAX_ABBE_NUMBER, Math.max(MIN_ABBE_NUMBER, abbeNumber))
        : DEFAULT_ABBE_NUMBER;
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
        redShift: Math.min(1, Math.max(-1, displacement - CHROMATIC_RED_SHIFT_RATIO * 0.5 * lateralSpread)),
        blueShift: Math.min(1, Math.max(-1, displacement + CHROMATIC_BLUE_SHIFT_RATIO * 0.5 * lateralSpread)),
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
