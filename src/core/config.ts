import type { GlassConfig, LiquidGlassOptions } from "./types.js";

export const SVG_NS = "http://www.w3.org/2000/svg";
export const PREBLUR_MODE: "css" | "svg" = "css";
export const BLUR_EDGE_MODE: "none" | "duplicate" | "wrap" = "none";
export const USE_CSS_SATURATION = true;

export const GLASS_COLOR_MATRIX =
    "1.15 0 0 0 0  0 1.15 0 0 0  0 0 1.15 0 0  0 0 0 1 0";

export const DEFAULT_GLASS_CONFIG: GlassConfig = {
    id: "liquid-glass",
    selector: "[data-liquid-glass], .lg-surface",
    surface: "convex_squircle",
    thickness: 48,
    bezel: 14,
    scaleRatio: 2.35,
    maxScaleMultiplier: 5.5,
    blur: 2,
    ior: 2.15,
    colorMatrix: GLASS_COLOR_MATRIX,
    coreFilter: "blur(6px) saturate(280%) brightness(1.03)",
    radius: 18,
    pill: false,
    alwaysOn: true,
    hollow: false,
    chromaticAberration: false,
};

export const MAX_ELEMENT_DEVICE_AREA = 1_500_000;
export const MAX_TOTAL_DEVICE_AREA = 4_000_000;
export const CSS_FALLBACK_BACKDROP = "blur(8px) saturate(285%) brightness(1.04)";

export const MAP_MAX_SCALE = 1.0;
export const MAP_MIN_SCALE = 0.5;
export const UNROUNDED_MAP_SCALE = 0.2;
export const MAP_MAX_PIXELS = 262_144;
export const MAP_PRELOAD_TIMEOUT_MS = 350;

export function pickMapScale(
    width: number,
    height: number,
    bezel: number,
    radius = 0,
    blur = 0,
    isAxisX = false,
): number {
    if (isAxisX) return 1.0;

    if (radius <= 2) return UNROUNDED_MAP_SCALE;

    const area = width * height;
    const scaleBudget =
        area > MAP_MAX_PIXELS ? Math.sqrt(MAP_MAX_PIXELS / Math.max(1, area)) : 1.0;
    const effectiveCurvatureRadius = Math.max(1.0, Math.min(radius, bezel > 0 ? bezel : radius));
    const curvatureRetention = Math.min(1.0, 18.0 / effectiveCurvatureRadius);
    const excessBlur = blur > 8.0 ? blur - 8.0 : 0.0;
    const blurAttenuation =
        excessBlur > 0.0
            ? 1.0 /
              Math.sqrt(
                  1.0 + 0.06 * (1.0 - 0.5 * curvatureRetention) * excessBlur * excessBlur,
              )
            : 1.0;

    const clampedScale = Math.min(
        MAP_MAX_SCALE,
        Math.max(MAP_MIN_SCALE, Math.min(scaleBudget, blurAttenuation)),
    );

    if (clampedScale >= 0.875) return 1.0;
    if (clampedScale >= 0.625) return 0.75;
    return 0.5;
}

export function formatGlassFilterStyle(
    filterId: string,
    blur: number,
    qualityTier: number,
): string {
    if (PREBLUR_MODE === "css" && blur > 0 && qualityTier < 2) {
        const effectiveBlur = qualityTier === 1 ? (blur * 0.5).toFixed(2) : blur;
        return USE_CSS_SATURATION
            ? `blur(${effectiveBlur}px) saturate(280%) url(#${filterId})`
            : `blur(${effectiveBlur}px) url(#${filterId})`;
    }
    return USE_CSS_SATURATION ? `saturate(280%) url(#${filterId})` : `url(#${filterId})`;
}

export function resolveChromaticAberration(value?: boolean | number): number {
    if (typeof value === "number") {
        return Number.isFinite(value) ? Math.min(0.25, Math.max(0, value)) : 0;
    }
    return value === true ? 0.085 : 0;
}

export function resolveGlassConfig(options: LiquidGlassOptions = {}): GlassConfig {
    const surface = options.surface ?? DEFAULT_GLASS_CONFIG.surface;
    const thickness = options.thickness ?? DEFAULT_GLASS_CONFIG.thickness;
    const bezel = options.bezel ?? DEFAULT_GLASS_CONFIG.bezel;
    const scaleRatio = options.scaleRatio ?? DEFAULT_GLASS_CONFIG.scaleRatio;
    const maxScaleMultiplier =
        options.maxScaleMultiplier ?? DEFAULT_GLASS_CONFIG.maxScaleMultiplier;
    const blur = options.blur ?? DEFAULT_GLASS_CONFIG.blur;
    const ior = options.ior ?? DEFAULT_GLASS_CONFIG.ior;
    const radius = options.radius ?? DEFAULT_GLASS_CONFIG.radius;
    const pill = options.pill ?? DEFAULT_GLASS_CONFIG.pill;
    const hollow = options.hollow ?? DEFAULT_GLASS_CONFIG.hollow;
    const alwaysOn = options.alwaysOn ?? DEFAULT_GLASS_CONFIG.alwaysOn;
    const coreFilter = options.coreFilter ?? DEFAULT_GLASS_CONFIG.coreFilter;
    const chromaticAberration =
        options.chromaticAberration ?? DEFAULT_GLASS_CONFIG.chromaticAberration ?? false;
    const chromaAmount = resolveChromaticAberration(chromaticAberration);

    const id = [
        "lg",
        surface,
        thickness,
        bezel,
        scaleRatio,
        blur,
        ior.toFixed(2),
        pill ? 1 : 0,
        chromaAmount > 0 ? `ca${chromaAmount.toFixed(3)}` : "ca0",
    ].join("_");

    return {
        ...DEFAULT_GLASS_CONFIG,
        id,
        surface,
        thickness,
        bezel,
        scaleRatio,
        maxScaleMultiplier,
        blur,
        ior,
        radius,
        pill,
        hollow,
        alwaysOn,
        coreFilter,
        chromaticAberration,
    };
}
