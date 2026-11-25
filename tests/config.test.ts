import { describe, expect, it } from "vitest";
import {
    CHROMATIC_BASE_SPREAD,
    CHROMATIC_BLUE_SHIFT_RATIO,
    CHROMATIC_RED_SHIFT_RATIO,
    DEFAULT_CHROMATIC_ABERRATION,
    DEFAULT_CLEAR_SHARPNESS,
    DEFAULT_GLASS_CONFIG,
    MAX_ABBE_NUMBER,
    MAX_CHROMATIC_IOR_SPREAD,
    MAX_CHROMATIC_SPREAD,
    MIN_ABBE_NUMBER,
    MIN_CHROMATIC_IOR_SPREAD,
    computeMergedOptionPatch,
    formatCssFallbackFilter,
    resolveAbbeNumber,
    resolveChromaticAberration,
    resolveChromaticChannelScales,
    resolveChromaticMaterialSpread,
    resolveEffectiveChromaticAberration,
    resolveGlassSharpness,
    resolveSharpnessPixelRatio,
    formatGlassFilterStyle,
    pickMapScale,
    parseElementGlassAttributes,
    resolveGlassConfig,
} from "../src/core/config.js";
import { parseCssColorToRgb } from "../src/core/webglRenderer.js";

describe("LiquidGlass configuration and helpers", () => {
    it("merges custom optical options with default glass config", () => {
        const defaults = resolveGlassConfig();
        expect(defaults.surface).toBe(DEFAULT_GLASS_CONFIG.surface);
        expect(defaults.thickness).toBe(DEFAULT_GLASS_CONFIG.thickness);
        expect(defaults.scaleRatio).toBe(2.35);
        expect(defaults.maxScaleMultiplier).toBe(5.5);

        const custom = resolveGlassConfig({
            surface: "lip",
            thickness: 96,
            bezel: 20,
            ior: 1.75,
            blur: 4,
            pill: true,
        });
        expect(custom.surface).toBe("lip");
        expect(custom.thickness).toBe(96);
        expect(custom.bezel).toBe(20);
        expect(custom.ior).toBe(1.75);
        expect(custom.blur).toBe(4);
        expect(custom.pill).toBe(true);
        expect(custom.scaleRatio).toBe(DEFAULT_GLASS_CONFIG.scaleRatio);

        const nanConfig = resolveGlassConfig({
            thickness: NaN,
            bezel: NaN,
            ior: NaN,
            blur: NaN,
            radius: NaN,
        });
        expect(nanConfig.thickness).toBe(DEFAULT_GLASS_CONFIG.thickness);
        expect(nanConfig.bezel).toBe(DEFAULT_GLASS_CONFIG.bezel);
        expect(nanConfig.ior).toBe(DEFAULT_GLASS_CONFIG.ior);
        expect(nanConfig.blur).toBe(DEFAULT_GLASS_CONFIG.blur);
        expect(nanConfig.radius).toBe(DEFAULT_GLASS_CONFIG.radius);
        expect(nanConfig.id).not.toContain("NaN");
    });

    it("supports opting into adaptive refraction from options and HTML", () => {
        const el = document.createElement("div");
        el.setAttribute("data-lg-adaptive-refraction", "true");
        expect(resolveGlassConfig().adaptiveRefraction).toBe(false);
        expect(resolveGlassConfig(parseElementGlassAttributes(el)!).adaptiveRefraction).toBe(true);
    });

    it("scales displacement maps higher for tight radii and lower for large soft shapes", () => {
        expect(pickMapScale(160, 40, 8, 12, 0, false)).toBe(1.0);
        expect(pickMapScale(340, 145, 16, 22, 0.75, false)).toBe(1.0);
        expect(pickMapScale(96, 48, 16, 24, 2.5, true)).toBe(1.0);
        expect(pickMapScale(800, 600, 20, 40, 1.0, false)).toBeLessThanOrEqual(0.75);
        expect(pickMapScale(1600, 1200, 24, 60, 0, false)).toBe(0.5);
        expect(pickMapScale(340, 145, 16, 0, 0.6, false)).toBe(0.0625);
    });

    it("formats backdrop-filter CSS strings per quality tier", () => {
        expect(formatGlassFilterStyle("lg-1", 2.5, 0)).toBe("blur(2.5px) saturate(200%) url(#lg-1)");
        expect(formatGlassFilterStyle("lg-1", 4, 1)).toBe("blur(2.00px) saturate(200%) url(#lg-1)");
        expect(formatGlassFilterStyle("lg-1", 0.6, 0)).toBe("blur(0.6px) url(#lg-1)");
        expect(formatGlassFilterStyle("lg-1", 0.6, 2)).toBe("url(#lg-1)");
        expect(formatGlassFilterStyle("lg-1", 0, 2)).toBe("url(#lg-1)");
        expect(formatGlassFilterStyle("lg-1", 4, 2)).toBe("saturate(200%) url(#lg-1)");
    });

    it("supports explicit color controls while preserving the automatic render values", () => {
        const el = document.createElement("div");
        el.setAttribute("data-lg-saturation", "0");
        el.setAttribute("data-lg-chromatic-aberration", "1");
        const htmlOptions = parseElementGlassAttributes(el)!;
        expect(htmlOptions).toEqual({ saturation: 0, chromaticAberration: 1 });
        expect(resolveGlassConfig().saturation).toBeUndefined();
        expect(resolveGlassConfig({ saturation: 8 }).saturation).toBe(4);
        expect(formatCssFallbackFilter(0)).toBe("blur(8px) saturate(0) brightness(1.04)");
        expect(formatGlassFilterStyle("glass", 4, 1, 0)).toBe("blur(2.00px) url(#glass) saturate(0)");
        expect(formatGlassFilterStyle("glass", 2, 0, 1)).toBe("blur(2px) url(#glass)");

        const expectedDefault =
            (DEFAULT_CHROMATIC_ABERRATION * CHROMATIC_BASE_SPREAD) /
            (1 + (DEFAULT_CHROMATIC_ABERRATION * CHROMATIC_BASE_SPREAD) / MAX_CHROMATIC_SPREAD);
        expect(resolveChromaticAberration()).toBe(0);
        expect(resolveChromaticAberration(true)).toBeCloseTo(expectedDefault, 10);
        expect(resolveChromaticAberration(true, 10)).toBeGreaterThan(expectedDefault);
        expect(resolveChromaticAberration(true, 10)).toBeLessThan(MAX_CHROMATIC_SPREAD);
        expect(resolveChromaticAberration(false, 10)).toBe(0);
        expect(resolveChromaticAberration(0.5)).toBeGreaterThan(expectedDefault);
        expect(resolveChromaticAberration(htmlOptions.chromaticAberration)).toBeGreaterThan(
            resolveChromaticAberration(0.5),
        );
        expect(resolveChromaticAberration(htmlOptions.chromaticAberration)).toBeLessThan(0.4);
    });

    it("parses hex and rgb() strings to normalized RGB", () => {
        expect(parseCssColorToRgb("rgb(255, 0, 128)")).toEqual([1, 0, 128 / 255]);
        expect(parseCssColorToRgb("rgba(10, 20, 30, 0.4)")).toEqual([10 / 255, 20 / 255, 30 / 255]);
        expect(parseCssColorToRgb("#336699")).toEqual([0x33 / 255, 0x66 / 255, 0x99 / 255]);
        expect(parseCssColorToRgb("#fff")).toEqual([1, 1, 1]);
        expect(parseCssColorToRgb("transparent")).toEqual([1, 1, 1]);
    });

    it("diffs previous and next options in computeMergedOptionPatch to omit unchanged keys", () => {
        const sharedCanvas = document.createElement("canvas");
        const previousOptions = {
            engine: "webgl" as const,
            blur: 16,
            tintColor: "#112233",
            sceneCanvas: sharedCanvas,
            lightTilt: { horizontal: 0.25, vertical: -0.5 },
        };
        const identicalNextOptions = {
            engine: "webgl" as const,
            blur: 16,
            tintColor: "#112233",
            sceneCanvas: sharedCanvas,
            lightTilt: { horizontal: 0.25, vertical: -0.5 },
        };
        expect(computeMergedOptionPatch(previousOptions, identicalNextOptions)).toEqual({});

        const modifiedNextOptions = {
            engine: "webgl" as const,
            blur: 24,
            sceneCanvas: sharedCanvas,
            lightTilt: { horizontal: 0.75, vertical: -0.5 },
        };
        expect(computeMergedOptionPatch(previousOptions, modifiedNextOptions)).toEqual({
            blur: 24,
            tintColor: undefined,
            lightTilt: { horizontal: 0.75, vertical: -0.5 },
        });
    });

    it("normalizes chromatic aberration options, HTML boolean attributes, and material dispersion helpers", () => {
        const boolEl = document.createElement("div");
        boolEl.setAttribute("data-lg-chromatic-aberration", "");
        expect(parseElementGlassAttributes(boolEl)).toEqual({ chromaticAberration: true });

        boolEl.setAttribute("data-lg-chromatic-aberration", "0");
        expect(parseElementGlassAttributes(boolEl)).toEqual({ chromaticAberration: 0 });

        expect(resolveAbbeNumber(-5)).toBeUndefined();
        expect(resolveAbbeNumber(0)).toBeUndefined();
        expect(resolveAbbeNumber(Number.NaN)).toBeUndefined();
        expect(resolveAbbeNumber(4)).toBe(MIN_ABBE_NUMBER);
        expect(resolveAbbeNumber(180)).toBe(MAX_ABBE_NUMBER);

        const clamped = resolveGlassConfig({ chromaticAberration: 2.5, abbeNumber: 4, ior: 1.75 });
        expect(clamped.chromaticAberration).toBe(1);
        expect(clamped.abbeNumber).toBe(MIN_ABBE_NUMBER);

        const sanitized = resolveGlassConfig({ chromaticAberration: Number.NaN, abbeNumber: -10 });
        expect(sanitized.chromaticAberration).toBe(false);
        expect(sanitized.abbeNumber).toBeUndefined();

        const negative = resolveGlassConfig({ chromaticAberration: -0.4 });
        expect(negative.chromaticAberration).toBe(0);

        expect(resolveChromaticMaterialSpread(DEFAULT_GLASS_CONFIG.ior)).toBe(1);
        expect(resolveChromaticMaterialSpread(1.1)).toBe(MIN_CHROMATIC_IOR_SPREAD);
        expect(resolveChromaticMaterialSpread(4.0)).toBe(MAX_CHROMATIC_IOR_SPREAD);
        expect(resolveEffectiveChromaticAberration(true, 58.5, 2.15)).toBeCloseTo(
            resolveChromaticAberration(true),
            10,
        );
        expect(resolveEffectiveChromaticAberration(true, 28, 1.75)).toBeGreaterThan(
            resolveEffectiveChromaticAberration(true, 58.5, 1.75),
        );
        expect(resolveEffectiveChromaticAberration(false, 28, 2.417)).toBe(0);

        // Smoothly monotonic from 0 to 1 without dead saturation zones even at low Abbe numbers.
        const lowAbbeCurve = [0, 0.25, 0.5, 0.75, 1].map((strength) =>
            resolveEffectiveChromaticAberration(strength, 20, 2.15),
        );
        for (let index = 1; index < lowAbbeCurve.length; index++) {
            expect(lowAbbeCurve[index]!).toBeGreaterThan(lowAbbeCurve[index - 1]!);
        }
        expect(resolveEffectiveChromaticAberration(1, 10, 2.5)).toBeLessThan(MAX_CHROMATIC_SPREAD);

        const standardChannels = resolveChromaticChannelScales(50, 0.2);
        expect(standardChannels.redScale).toBeCloseTo(50 * (1 - 0.2 * CHROMATIC_RED_SHIFT_RATIO), 8);
        expect(standardChannels.blueScale).toBeCloseTo(50 * (1 + 0.2 * CHROMATIC_BLUE_SHIFT_RATIO), 8);
        expect(standardChannels.blueMultiplier).toBeCloseTo(1 + 0.2 * CHROMATIC_BLUE_SHIFT_RATIO, 8);

        // Red channel never inverts sign even at maximum material dispersion.
        const extremeChannels = resolveChromaticChannelScales(50, MAX_CHROMATIC_IOR_SPREAD);
        expect(extremeChannels.redScale).toBe(0);
        expect(extremeChannels.blueScale).toBeCloseTo(50 * (1 + MAX_CHROMATIC_IOR_SPREAD * CHROMATIC_BLUE_SHIFT_RATIO), 8);
    });

    it("supports explicit sharpness and automatically increases sharpness when blur is 0", () => {
        expect(resolveGlassSharpness(undefined, 2)).toBe(0);
        expect(resolveGlassSharpness(undefined, 0)).toBe(DEFAULT_CLEAR_SHARPNESS);
        expect(resolveGlassSharpness(0, 0)).toBe(0);
        expect(resolveGlassSharpness(0.8, 6)).toBe(0.8);
        expect(resolveGlassSharpness(2.5, 6)).toBe(1);
        expect(resolveGlassSharpness(-1, 0)).toBe(0);
        expect(resolveGlassSharpness(Number.NaN, 0)).toBe(DEFAULT_CLEAR_SHARPNESS);

        const sharpEl = document.createElement("div");
        sharpEl.setAttribute("data-lg-sharpness", "0.75");
        expect(parseElementGlassAttributes(sharpEl)).toEqual({ sharpness: 0.75 });

        const clearAutoCfg = resolveGlassConfig({ blur: 0 });
        expect(clearAutoCfg.sharpness).toBeUndefined();
        expect(clearAutoCfg.id).toContain(`sh${DEFAULT_CLEAR_SHARPNESS.toFixed(2)}`);

        const clearDisabledCfg = resolveGlassConfig({ blur: 0, sharpness: 0 });
        expect(clearDisabledCfg.sharpness).toBe(0);
        expect(clearDisabledCfg.id).not.toContain("_sh");

        const explicitSharpCfg = resolveGlassConfig({ blur: 6, sharpness: 0.9 });
        expect(explicitSharpCfg.sharpness).toBe(0.9);
        expect(explicitSharpCfg.id).toContain("sh0.90");

        expect(formatCssFallbackFilter(undefined, 0)).toBe("blur(0.0px)");
        expect(resolveSharpnessPixelRatio(0, 1)).toBe(1);
        expect(resolveSharpnessPixelRatio(DEFAULT_CLEAR_SHARPNESS, 1)).toBeCloseTo(3.3, 6);
        expect(resolveSharpnessPixelRatio(1, 1)).toBe(4);
        expect(resolveSharpnessPixelRatio(1, 2)).toBe(4);
    });
});
