import { describe, expect, it } from "vitest";
import {
    DEFAULT_GLASS_CONFIG,
    formatCssFallbackFilter,
    resolveChromaticAberration,
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
        expect(pickMapScale(340, 145, 16, 0, 0.6, false)).toBe(0.125);
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

        expect(resolveChromaticAberration()).toBe(0);
        expect(resolveChromaticAberration(true)).toBe(0.085);
        expect(resolveChromaticAberration(true, 10)).toBe(0.25);
        expect(resolveChromaticAberration(false, 10)).toBe(0);
        expect(resolveChromaticAberration(0.5)).toBe(0.5);
        expect(resolveChromaticAberration(htmlOptions.chromaticAberration)).toBe(1);
    });

    it("parses hex and rgb() strings to normalized RGB", () => {
        expect(parseCssColorToRgb("rgb(255, 0, 128)")).toEqual([1, 0, 128 / 255]);
        expect(parseCssColorToRgb("rgba(10, 20, 30, 0.4)")).toEqual([10 / 255, 20 / 255, 30 / 255]);
        expect(parseCssColorToRgb("#336699")).toEqual([0x33 / 255, 0x66 / 255, 0x99 / 255]);
        expect(parseCssColorToRgb("#fff")).toEqual([1, 1, 1]);
        expect(parseCssColorToRgb("transparent")).toEqual([1, 1, 1]);
    });
});
