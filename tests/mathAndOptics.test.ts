import { afterEach, describe, expect, it, vi } from "vitest";
import {
    GLASS_PRESETS,
    SCHOTT_BK7_SELLMEIER,
    SCHOTT_SF11_SELLMEIER,
    buildOpticalLut,
    computeRelativeLuminance,
    computeWcagContrastRatio,
    evaluateBeerLambertTransmittance,
    evaluateBrewsterAngle,
    evaluateCauchyIndex,
    evaluateChromaticDispersion,
    evaluateCriticalAngle,
    evaluateDerjaguinEffectiveRadius,
    evaluateFresnelReflectance,
    evaluateOpticalProfile,
    evaluateRayleighDissipationRate,
    evaluateSellmeierIndex,
    evaluateSpectralRefraction,
    evaluateThinFilmInterference,
    evaluateYoungLaplacePressure,
    parseCssColorToRgb,
    parseCssColorToRgba,
    predictMomentumOffset,
    resolveChromaticAberration,
    resolveGlassConfig,
    resolveSurfaceId,
    solveRefractionRay,
} from "../src/index.js";
import { resetOpticalLutCacheForTesting, resolveGlassMedium } from "../src/core/optics.js";
import {
    buildSpringPropagator,
    createInteractiveSpring,
    evaluateSpringEnergy,
    stepSpring,
} from "../src/core/spring.js";

function decodeSignedLutWord(lut: Uint8Array, byteOffset: number): number {
    const encoded = (lut[byteOffset]! << 8) | lut[byteOffset + 1]!;
    return (encoded - 32767) / 32767;
}

describe("Optical physics, exact spring propagators, and CSS Color 4/5", () => {
    afterEach(() => {
        resetOpticalLutCacheForTesting();
        vi.restoreAllMocks();
    });

    it("matches per-pixel tint and absorption with precomputed medium coefficients", () => {
        for (const [tint, opacity, thickness] of [
            [[1, 1, 1], 0.12, 60],
            [[0.1, 0.1, 0.1], 0.24, 40],
            [[0.2, 0.55, 0.9], 0.48, 82],
            [[0, 0.8, 1], 1, 200],
            [[0.1, 0.5, 0.2], 0, 0],
        ] as const) {
            const [red, green, blue] = tint;
            const coefficients = resolveGlassMedium(red, green, blue, opacity, thickness);
            const a = Math.min(opacity, 0.85);
            const path = 0.75 + Math.min(thickness, 160) * 0.014;
            const weight = Math.min((Math.max(...tint) - Math.min(...tint)) * 1.1, 0.85);
            for (const [channel, tintValue] of tint.entries()) {
                for (const scene of [0, 0.13, 0.53, 1]) {
                    const frosted = scene * (1 - a) + tintValue * a;
                    const absorbed = scene * Math.exp(-a * path * (1 - tintValue));
                    const expected = frosted * (1 - weight) + absorbed * weight;
                    expect(scene * coefficients[channel]! + tintValue * coefficients[3]).toBeCloseTo(expected, 14);
                }
            }
        }
    });

    it("satisfies exact Fresnel equations, Brewster/TIR angles, 3D Snell refraction, and Fraunhofer Cauchy-Abbe identities", () => {
        const normalCrown = evaluateFresnelReflectance(1.0, 1.5);
        expect(normalCrown.reflectanceS).toBeCloseTo(0.04, 12);
        expect(normalCrown.reflectanceP).toBeCloseTo(0.04, 12);
        expect(normalCrown.reflectance).toBeCloseTo(0.04, 12);
        expect(normalCrown.transmittance).toBeCloseTo(0.96, 12);
        expect(normalCrown.totalInternalReflection).toBe(false);

        const brewster = evaluateBrewsterAngle(1.52);
        expect(brewster).toBeCloseTo(Math.atan(1.52), 12);
        const atBrewster = evaluateFresnelReflectance(Math.cos(brewster), 1.52);
        expect(atBrewster.reflectanceP).toBeLessThan(1e-12);
        expect(atBrewster.reflectanceS).toBeGreaterThan(0.1);
        expect(atBrewster.reflectance + atBrewster.transmittance).toBeCloseTo(1, 12);

        const critical = evaluateCriticalAngle(1.5);
        expect(critical).toBeCloseTo(Math.asin(1 / 1.5), 12);
        const beyondTir = evaluateFresnelReflectance(Math.cos(critical + 0.05), 1.5, true);
        expect(beyondTir.totalInternalReflection).toBe(true);
        expect(beyondTir.reflectance).toBe(1);
        expect(beyondTir.transmittance).toBe(0);

        const sin45 = Math.SQRT1_2;
        const refractedRay = solveRefractionRay([sin45, 0, -sin45], [0, 0, 1], 1.0, 1.5);
        expect(refractedRay.totalInternalReflection).toBe(false);
        expect(refractedRay.refracted).not.toBeNull();
        expect(refractedRay.refracted![0]).toBeCloseTo(sin45 / 1.5, 10);
        expect(Math.hypot(...refractedRay.refracted!)).toBeCloseTo(1, 10);
        expect(refractedRay.reflected[0]).toBeCloseTo(sin45, 10);
        expect(refractedRay.reflected[2]).toBeCloseTo(sin45, 10);
        expect(refractedRay.reflectance + refractedRay.transmittance).toBeCloseTo(1, 12);

        const grazing = solveRefractionRay([1, 0, 0], [0, 0, 1], 1.52, 1.52);
        expect(grazing.refracted).toEqual([1, 0, 0]);
        expect(grazing.reflectance).toBe(0);
        expect(grazing.transmittance).toBe(1);
        expect(grazing.totalInternalReflection).toBe(false);

        const tirRay = solveRefractionRay([0.9, 0, -Math.sqrt(1 - 0.81)], [0, 0, 1], 1.5, 1.0);
        expect(tirRay.totalInternalReflection).toBe(true);
        expect(tirRay.refracted).toBeNull();
        expect(tirRay.reflectance).toBe(1);
        expect(tirRay.transmittance).toBe(0);

        for (const [nD, abbe] of [
            [1.5168, 64.17],
            [1.62, 36.37],
            [2.417, 55.3],
        ] as const) {
            expect(evaluateCauchyIndex(587.5618, nD, abbe)).toBeCloseTo(nD, 10);
            const nF = evaluateCauchyIndex(486.1327, nD, abbe);
            const nC = evaluateCauchyIndex(656.2725, nD, abbe);
            expect((nD - 1) / (nF - nC)).toBeCloseTo(abbe, 8);
            expect(nC).toBeLessThan(nD);
            expect(nD).toBeLessThan(nF);
        }

        const spectral = evaluateSpectralRefraction(0.2, "convex_squircle", 1.62, 36);
        expect(spectral.redDisplacement).toBeLessThan(spectral.greenDisplacement);
        expect(spectral.greenDisplacement).toBeLessThan(spectral.blueDisplacement);

        const crown = evaluateChromaticDispersion(0.25, "convex_squircle", 1.52, 58.5);
        const flint = evaluateChromaticDispersion(0.25, "convex_squircle", 1.75, 28);
        expect(flint.lateralSpread).toBeGreaterThan(crown.lateralSpread);
        expect(flint.blueShift - flint.displacement).toBeCloseTo(0.64 * flint.lateralSpread, 5);
        expect(flint.displacement - flint.redShift).toBeCloseTo(0.36 * flint.lateralSpread, 5);

        const defaultChroma = resolveChromaticAberration(true);
        expect(defaultChroma).toBeGreaterThan(0.1);
        expect(defaultChroma).toBeLessThan(0.25);
        expect(resolveChromaticAberration(true, 28)).toBeGreaterThan(defaultChroma);
        expect(resolveChromaticAberration(false, 28)).toBe(0);

        expect(resolveSurfaceId("concave")).toBe(4);
        const cfg = resolveGlassConfig({ surface: "concave", cornerStyle: "squircle" });
        expect(cfg.id).toContain("concave");
        expect(cfg.id).toContain("_sq");
        const [concaveXy, concaveDisp] = evaluateOpticalProfile(0.25, "concave", 1.8);
        expect(concaveXy).toBeLessThan(0);
        expect(concaveDisp).toBeLessThan(0);
        expect(evaluateOpticalProfile(0.1, "lip", 1.8)[1]).toBeGreaterThan(0);
        expect(evaluateOpticalProfile(0.88, "lip", 1.8)[1]).toBeLessThan(0);

        const concaveLut = buildOpticalLut("concave", 1.8);
        expect(decodeSignedLutWord(concaveLut, 256 * 4)).toBeLessThan(0);
        expect(decodeSignedLutWord(concaveLut, 256 * 4 + 2)).toBeLessThan(0);
        expect(decodeSignedLutWord(concaveLut, 1023 * 4 + 2)).toBeCloseTo(0, 4);
        const linearLut = buildOpticalLut("linear", 1.52);
        const [linearXy, linearDisp] = evaluateOpticalProfile(256 / 1023, "linear", 1.52);
        expect(decodeSignedLutWord(linearLut, 256 * 4)).toBeCloseTo(linearXy, 3);
        expect(decodeSignedLutWord(linearLut, 256 * 4 + 2)).toBeCloseTo(linearDisp, 3);
        expect(buildOpticalLut("linear", 1.52)).toBe(linearLut);
        const rounded = buildOpticalLut("linear", 1.5204);
        resetOpticalLutCacheForTesting();
        expect(buildOpticalLut("linear", 1.5196)).toEqual(rounded);
        expect(buildOpticalLut(GLASS_PRESETS.water.surface!, GLASS_PRESETS.water.ior!).length).toBe(1024 * 4);
    });

    it("satisfies Cayley-Hamilton semigroup, Liouville determinant, Lyapunov decay, overdamped/critical continuity, and sl(2,R) stretch", () => {
        const regimes = [
            { stiffness: 520, gamma: 10 },
            { stiffness: 400, gamma: 20 },
            { stiffness: 400.0001, gamma: 20 },
            { stiffness: 399.9999, gamma: 20 },
            { stiffness: 120, gamma: 22 },
        ];

        for (const params of regimes) {
            const t1 = 0.037;
            const t2 = 0.083;
            const p1 = buildSpringPropagator(t1, params);
            const p2 = buildSpringPropagator(t2, params);
            const pSum = buildSpringPropagator(t1 + t2, params);

            expect(p2.c00 * p1.c00 + p2.c01 * p1.c10).toBeCloseTo(pSum.c00, 11);
            expect(p2.c00 * p1.c01 + p2.c01 * p1.c11).toBeCloseTo(pSum.c01, 11);
            expect(p2.c10 * p1.c00 + p2.c11 * p1.c10).toBeCloseTo(pSum.c10, 11);
            expect(p2.c10 * p1.c01 + p2.c11 * p1.c11).toBeCloseTo(pSum.c11, 11);
            expect(pSum.c00 * pSum.c11 - pSum.c01 * pSum.c10).toBeCloseTo(
                Math.exp(-2 * params.gamma * (t1 + t2)),
                11,
            );

            let x = 1.5;
            let v = -12.0;
            let prevEnergy = evaluateSpringEnergy(x, v, params.stiffness);
            for (let step = 0; step < 30; step++) {
                const next = stepSpring(x, v, 0, 0.016, params);
                x = next.value;
                v = next.velocity;
                const nextEnergy = evaluateSpringEnergy(x, v, params.stiffness);
                expect(nextEnergy).toBeLessThanOrEqual(prevEnergy + 1e-12);
                prevEnergy = nextEnergy;
            }
        }

        const r1 = -20 + Math.sqrt(300);
        const r2 = -20 - Math.sqrt(300);
        const t = 0.05;
        const expectedOver = (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
        expect(stepSpring(1, 0, 0, t, { stiffness: 100, gamma: 20, settleDisplacement: 1e-6, settleVelocity: 1e-6 }).value).toBeCloseTo(expectedOver, 6);

        const slightlyUnder = stepSpring(1, 0, 0, 0.016, { stiffness: 400.00001, gamma: 20 });
        const exactCritical = stepSpring(1, 0, 0, 0.016, { stiffness: 400, gamma: 20 });
        const slightlyOver = stepSpring(1, 0, 0, 0.016, { stiffness: 399.99999, gamma: 20 });
        expect(Math.abs(slightlyUnder.value - exactCritical.value)).toBeLessThan(1e-7);
        expect(Math.abs(slightlyOver.value - exactCritical.value)).toBeLessThan(1e-7);

        const passiveProp = buildSpringPropagator(0.5, { stiffness: -100, gamma: -5 });
        expect(passiveProp.c00).toBe(1);
        expect(passiveProp.c11).toBe(1);
        expect(predictMomentumOffset(120, 500, 5)).toBeCloseTo(220, 10);

        const rafQueue: FrameRequestCallback[] = [];
        vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
            rafQueue.push(cb);
            return rafQueue.length;
        });
        let lastFrame: { stretchMatrix: readonly [number, number, number, number] } | null = null;
        let restCalls = 0;
        const spring = createInteractiveSpring(
            (frame) => {
                lastFrame = frame;
            },
            () => {
                restCalls++;
            },
        );
        spring.setDrag(8, -6, false);
        for (let tick = 1; tick <= 6; tick++) rafQueue.shift()?.(tick * 16);
        const [m11, m12, m21, m22] = lastFrame!.stretchMatrix;
        expect(m11 * m22 - m12 * m21).toBeCloseTo(1, 10);
        expect(restCalls).toBe(0);
        spring.destroy();

        const freeRafQueue: FrameRequestCallback[] = [];
        vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
            freeRafQueue.push(cb);
            return freeRafQueue.length;
        });
        let freeRestCalls = 0;
        let lastFreeX = 0;
        const freeSpring = createInteractiveSpring(
            (frame) => {
                lastFreeX = frame.dragX;
            },
            () => {
                freeRestCalls++;
            },
        );
        freeSpring.setFreeDragMode?.(true);
        freeSpring.press();
        freeSpring.setDrag(18, -10, false);
        freeSpring.release(false);
        for (let tick = 1; tick <= 120 && freeRafQueue.length > 0; tick++) {
            freeRafQueue.shift()?.(tick * 16);
        }
        expect(lastFreeX).toBeCloseTo(18, 1);
        expect(freeRestCalls).toBe(1);
        freeSpring.destroy();

        const highIor = 2.4;
        const rimDepth = 0.01;
        const eps = 1e-4;
        const abbe = 58.5;
        const deltaN = (highIor - 1) / abbe;
        const dispPlus = evaluateOpticalProfile(rimDepth, "convex_circle", highIor + eps)[1];
        const dispMinus = evaluateOpticalProfile(rimDepth, "convex_circle", highIor - eps)[1];
        const numericSpread = ((dispPlus - dispMinus) / (2 * eps)) * deltaN;
        const dispersion = evaluateChromaticDispersion(rimDepth, "convex_circle", highIor, abbe);
        expect(dispersion.lateralSpread).toBeCloseTo(Math.min(0.25, Math.max(-0.25, numericSpread)), 4);
    });

    it("parses CSS Color 4/5 spaces, angles, strict hex, nested color-mix(), powerless hue, and WCAG contrast", () => {
        expect(parseCssColorToRgb("transparent")).toEqual([1, 1, 1]);
        expect(parseCssColorToRgba("transparent")).toEqual([0, 0, 0, 0]);
        expect(parseCssColorToRgba("#0f08")).toEqual([0, 1, 0, 0x88 / 255]);
        expect(parseCssColorToRgba("#1g2h3i")).toBeNull();
        expect(parseCssColorToRgba("#12z")).toBeNull();
        expect(parseCssColorToRgb("crimson")[0]).toBeCloseTo(220 / 255, 3);
        expect(parseCssColorToRgba("tomato")).not.toBeNull();

        const grad100 = parseCssColorToRgba("hsl(100grad 100% 50%)");
        const deg90 = parseCssColorToRgba("hsl(90deg 100% 50%)");
        expect(grad100![0]).toBeCloseTo(deg90![0], 5);
        expect(grad100![1]).toBeCloseTo(deg90![1], 5);

        const hwbGreen = parseCssColorToRgba("hwb(120deg 0% 0%)")!;
        expect(hwbGreen[1]).toBeCloseTo(1, 3);
        const hwbGray = parseCssColorToRgba("hwb(0 60% 60%)")!;
        expect(hwbGray[0]).toBeCloseTo(0.5, 3);

        expect(parseCssColorToRgb("oklab(0.62796 0.22486 0.12585)")[0]).toBeCloseTo(1, 2);
        expect(parseCssColorToRgb("oklch(86.64% 0.2948 142.5deg)")[1]).toBeGreaterThan(0.9);
        expect(parseCssColorToRgb("lab(53.23 80.11 67.22)")[0]).toBeGreaterThan(0.9);
        expect(parseCssColorToRgb("color(display-p3 0 0.8 0.2)")[1]).toBeGreaterThan(0.75);
        expect(parseCssColorToRgba("color(rec2020 0 1 0)")![1]).toBeGreaterThan(0.8);
        expect(parseCssColorToRgba("color(a98-rgb 0 1 0)")![1]).toBeCloseTo(1, 3);
        const proPhotoMid = parseCssColorToRgba("color(prophoto-rgb 0.5 0.5 0.5)")!;
        expect(proPhotoMid[0]).toBeCloseTo(0.5723, 3);
        expect(proPhotoMid[1]).toBeCloseTo(proPhotoMid[0], 4);
        expect(proPhotoMid[2]).toBeCloseTo(proPhotoMid[0], 4);
        expect(parseCssColorToRgba("rgba(12, 34, 56, .25)")).toEqual([12 / 255, 34 / 255, 56 / 255, 0.25]);
        expect(parseCssColorToRgba("#11223380")).toEqual([0x11 / 255, 0x22 / 255, 0x33 / 255, 0x80 / 255]);

        const deepMix = parseCssColorToRgba("color-mix(in srgb, color-mix(in srgb, red 50%, blue), white)")!;
        expect(deepMix[0]).toBeCloseTo(0.75, 3);
        expect(deepMix[1]).toBeCloseTo(0.5, 3);
        expect(deepMix[2]).toBeCloseTo(0.75, 3);

        expect(parseCssColorToRgba("color-mix(\n  in display-p3,\n  #ff0000 50%,\n  #0000ff 50%\n)")![0]).toBeGreaterThan(0.4);
        expect(parseCssColorToRgba("color-mix(in lab, #ffffff, #000000)")![0]).toBeGreaterThan(0.4);
        expect(parseCssColorToRgba("color-mix(in lch, #ff0000, #00ff00)")).not.toBeNull();
        expect(parseCssColorToRgba("color-mix(in hwb, #ff0000, #0000ff)")).not.toBeNull();
        expect(parseCssColorToRgba("color-mix(in xyz-d65, #ffffff, #000000)")).not.toBeNull();
        expect(parseCssColorToRgba("color-mix(in xyz-d50, #ffffff, #000000)")).not.toBeNull();

        const mixTransparentGreen = parseCssColorToRgba("color-mix(in oklch, transparent 50%, #00ff00 50%)")!;
        expect(mixTransparentGreen[1]).toBeGreaterThan(0.9);
        expect(mixTransparentGreen[3]).toBeCloseTo(0.5, 4);

        const mixLongerSame = parseCssColorToRgba("color-mix(in hsl longer hue, hsl(0deg 100% 50%), hsl(0deg 100% 50%))")!;
        expect(mixLongerSame[0]).toBeLessThan(0.05);
        expect(mixLongerSame[1]).toBeGreaterThan(0.95);
        expect(mixLongerSame[2]).toBeGreaterThan(0.95);

        expect(computeRelativeLuminance("#ffffff")).toBeCloseTo(1, 5);
        expect(computeRelativeLuminance("#000000")).toBeCloseTo(0, 5);
        expect(computeWcagContrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);

        const hotColor = "rgb(17, 134, 211)";
        expect(parseCssColorToRgba(hotColor)).toEqual([17 / 255, 134 / 255, 211 / 255, 1]);
        for (let i = 0; i < 280; i++) {
            parseCssColorToRgba(`rgb(${i % 256}, ${(i * 3) % 256}, ${(i * 7) % 256})`);
            if (i % 100 === 0) parseCssColorToRgba(hotColor);
        }
        expect(parseCssColorToRgba(hotColor)).toEqual([17 / 255, 134 / 255, 211 / 255, 1]);
    });

    it("satisfies extreme overdamped stability, Rayleigh dissipation, Airy thin-film theorems, and Young-Laplace capillary law", () => {
        // Extreme overdamped regime where naive -gamma + sqrt(gamma^2 - k) suffers catastrophic cancellation.
        const extremeOverdamped = { stiffness: 1, gamma: 1e5, settleDisplacement: 0, settleVelocity: 0 };
        const p1 = buildSpringPropagator(10, extremeOverdamped);
        const p2 = buildSpringPropagator(20, extremeOverdamped);
        const pSum = buildSpringPropagator(30, extremeOverdamped);
        const exactLambda = Math.sqrt(1e10 - 1);
        const exactSlowRate = -1 / (1e5 + exactLambda);
        const exactC00 = ((1e5 + exactLambda) / (2 * exactLambda)) * Math.exp(exactSlowRate * 10);
        expect(p1.c00).toBeCloseTo(exactC00, 14);
        expect(p1.c00).toBeLessThan(1);
        expect(p2.c00 * p1.c00 + p2.c01 * p1.c10).toBeCloseTo(pSum.c00, 14);
        expect(p1.c11).toBeLessThan(0);

        // Rayleigh dissipation function: dE/dt = -2 * gamma * v^2 matches finite-difference dE/dt.
        const springParams = { stiffness: 380, gamma: 6.75 };
        const x0 = 0.8;
        const v0 = -4.2;
        const epsDt = 1e-6;
        const stepFwd = stepSpring(x0, v0, 0, epsDt, springParams);
        const dEdtNumeric =
            (evaluateSpringEnergy(stepFwd.value, stepFwd.velocity, springParams.stiffness) -
                evaluateSpringEnergy(x0, v0, springParams.stiffness)) /
            epsDt;
        const rayleighRate = evaluateRayleighDissipationRate(
            0.5 * (v0 + stepFwd.velocity),
            springParams.gamma,
        );
        expect(rayleighRate).toBeLessThan(0);
        expect(dEdtNumeric).toBeCloseTo(rayleighRate, 4);

        // Airy / Fabry-Perot thin-film interference theorems:
        // 1. Quarter-wave anti-reflection (AR) coating: n1 = sqrt(n0 * n2), d = lambda_e / (4 * n1) -> R(lambda_e) = 0.
        const nSubstrate = 1.52;
        const nArFilm = Math.sqrt(1.0 * nSubstrate);
        const quarterWaveGreenNm = 546.074 / (4 * nArFilm);
        const arSample = evaluateThinFilmInterference(quarterWaveGreenNm, 1.0, nArFilm, nSubstrate, 1.0);
        expect(arSample.greenReflectance).toBeLessThan(1e-12);
        expect(arSample.redReflectance + arSample.transmittanceRgb[0]).toBeCloseTo(1, 12);
        expect(arSample.greenReflectance + arSample.transmittanceRgb[1]).toBeCloseTo(1, 12);
        expect(arSample.blueReflectance + arSample.transmittanceRgb[2]).toBeCloseTo(1, 12);

        // 2. Half-wave absentee-layer theorem: d = lambda_e / (2 * n1) -> R(lambda_e) equals bare air-substrate Fresnel reflectance.
        const halfWaveGreenNm = 546.074 / (2 * 1.38);
        const absentee = evaluateThinFilmInterference(halfWaveGreenNm, 1.0, 1.38, nSubstrate, 1.0);
        const bareFresnel = evaluateFresnelReflectance(1.0, nSubstrate);
        expect(absentee.greenReflectance).toBeCloseTo(bareFresnel.reflectance, 12);

        // Young-Laplace capillary pressure & Derjaguin effective curvature radius:
        expect(evaluateDerjaguinEffectiveRadius(12, 12)).toBeCloseTo(12, 12);
        expect(evaluateDerjaguinEffectiveRadius(12, 24)).toBeCloseTo(16, 12);
        expect(evaluateYoungLaplacePressure(0.01, 0.01, 0.0728)).toBeCloseTo(2 * 0.0728 / 0.01, 10);
        expect(evaluateYoungLaplacePressure(0.01, Infinity, 0.0728)).toBeCloseTo(0.0728 / 0.01, 10);
        // Minimal catenoid saddle meniscus (R1 = -R2) has zero net Laplace pressure jump.
        expect(evaluateYoungLaplacePressure(0.02, -0.02, 0.0728)).toBeCloseTo(0, 12);

        // 3-term Sellmeier dispersion vs Schott datasheet values (N-BK7 & N-SF11):
        const bk7Nd = evaluateSellmeierIndex(587.5618, SCHOTT_BK7_SELLMEIER);
        const bk7Nf = evaluateSellmeierIndex(486.1327, SCHOTT_BK7_SELLMEIER);
        const bk7Nc = evaluateSellmeierIndex(656.2725, SCHOTT_BK7_SELLMEIER);
        expect(bk7Nd).toBeCloseTo(1.5168, 4);
        expect((bk7Nd - 1) / (bk7Nf - bk7Nc)).toBeCloseTo(64.17, 1);

        const sf11Nd = evaluateSellmeierIndex(587.5618, SCHOTT_SF11_SELLMEIER);
        const sf11Nf = evaluateSellmeierIndex(486.1327, SCHOTT_SF11_SELLMEIER);
        const sf11Nc = evaluateSellmeierIndex(656.2725, SCHOTT_SF11_SELLMEIER);
        expect(sf11Nd).toBeCloseTo(1.7847, 4);
        expect((sf11Nd - 1) / (sf11Nf - sf11Nc)).toBeCloseTo(25.68, 2);

        // Bouguer-Beer-Lambert refracted optical path transmittance:
        const sigma: readonly [number, number, number] = [0.2, 0.05, 0.01];
        const tNormal = evaluateBeerLambertTransmittance(sigma, 2.0, 1.0, 1.52);
        const tOblique = evaluateBeerLambertTransmittance(sigma, 2.0, 0.5, 1.52);
        expect(tNormal[0]).toBeCloseTo(Math.exp(-0.4), 12);
        expect(tOblique[0]).toBeLessThan(tNormal[0]);
        // Multiplicative semigroup property T(d1 + d2) = T(d1) * T(d2)
        const tHalf = evaluateBeerLambertTransmittance(sigma, 1.0, 0.5, 1.52);
        expect(tHalf[0] * tHalf[0]).toBeCloseTo(tOblique[0], 12);
        expect(tHalf[1] * tHalf[1]).toBeCloseTo(tOblique[1], 12);
        expect(tHalf[2] * tHalf[2]).toBeCloseTo(tOblique[2], 12);
    });
});
