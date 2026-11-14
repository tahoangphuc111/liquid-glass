import { describe, expect, it } from "vitest";
import {
    DEFAULT_GLASS_CONFIG,
    formatGlassFilterStyle,
    pickMapScale,
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
    });

    it("scales displacement maps higher for tight radii and lower for large soft shapes", () => {
        expect(pickMapScale(160, 40, 8, 12, 0, false)).toBe(1.0);
        expect(pickMapScale(340, 145, 16, 22, 0.75, false)).toBe(1.0);
        expect(pickMapScale(96, 48, 16, 24, 2.5, true)).toBe(1.0);
        expect(pickMapScale(800, 600, 20, 40, 1.0, false)).toBeLessThanOrEqual(0.75);
        expect(pickMapScale(1600, 1200, 24, 60, 0, false)).toBe(0.5);
        expect(pickMapScale(340, 145, 16, 0, 0.6, false)).toBe(0.5);
    });

    it("formats backdrop-filter CSS strings per quality tier", () => {
        expect(formatGlassFilterStyle("lg-1", 2.5, 0)).toBe("blur(2.5px) saturate(235%) url(#lg-1)");
        expect(formatGlassFilterStyle("lg-1", 4, 1)).toBe("blur(2.00px) saturate(235%) url(#lg-1)");
        expect(formatGlassFilterStyle("lg-1", 0, 2)).toBe("saturate(235%) url(#lg-1)");
    });

    it("parses hex and rgb() strings to normalized RGB", () => {
        expect(parseCssColorToRgb("rgb(255, 0, 128)")).toEqual([1, 0, 128 / 255]);
        expect(parseCssColorToRgb("rgba(10, 20, 30, 0.4)")).toEqual([10 / 255, 20 / 255, 30 / 255]);
        expect(parseCssColorToRgb("#336699")).toEqual([0x33 / 255, 0x66 / 255, 0x99 / 255]);
        expect(parseCssColorToRgb("#fff")).toEqual([1, 1, 1]);
        expect(parseCssColorToRgb("transparent")).toEqual([1, 1, 1]);
    });
});
