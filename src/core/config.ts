import { resolveRefractionDirection, resolveRefractionEdgeFade } from "./refractionBounds.js";
import type {
    GlassConfig,
    GlassCornerStyle,
    GlassEngineMode,
    GlassLightTiltMode,
    GlassPreset,
    GlassSurface,
    GlassTheme,
    LiquidGlassOptions,
} from "./types.js";

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
    adaptiveRefraction: false,
    refractionDirection: "all",
    refractionEdgeFade: 0.35,
    scaleRatio: 2.35,
    maxScaleMultiplier: 5.5,
    blur: 2,
    ior: 2.15,
    colorMatrix: GLASS_COLOR_MATRIX,
    coreFilter: "blur(6px) saturate(200%) brightness(1.03)",
    radius: 18,
    cornerStyle: "circular",
    pill: false,
    alwaysOn: true,
    hollow: false,
    chromaticAberration: false,
};

export const MAX_ELEMENT_DEVICE_AREA = 1_500_000;
export const MAX_TOTAL_DEVICE_AREA = 4_000_000;
export const CSS_FALLBACK_BACKDROP = "blur(8px) saturate(210%) brightness(1.04)";

export const MAP_MAX_SCALE = 1.0;
export const MAP_MIN_SCALE = 0.5;
export const UNROUNDED_MAP_SCALE = 0.125;
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

    if (radius <= 0) return UNROUNDED_MAP_SCALE;

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

export function resolveGlassSaturation(value?: number): number | undefined {
    return typeof value === "number" && Number.isFinite(value)
        ? Math.min(4, Math.max(0, value))
        : undefined;
}

function formatExplicitSaturation(saturation: number): string {
    return saturation === 1 ? "" : ` saturate(${saturation})`;
}

export function formatGlassFilterStyle(
    filterId: string,
    blur: number,
    qualityTier: number,
    saturation?: number,
): string {
    const amount = resolveGlassSaturation(saturation);
    const satPart = amount === undefined && USE_CSS_SATURATION && blur >= 1 ? "saturate(200%) " : "";
    const filter = `${satPart}url(#${filterId})${amount === undefined ? "" : formatExplicitSaturation(amount)}`;
    if (PREBLUR_MODE === "css" && blur > 0 && qualityTier < 2) {
        const effectiveBlur = qualityTier === 1 ? (blur * 0.5).toFixed(2) : blur;
        return `blur(${effectiveBlur}px) ${filter}`;
    }
    return filter;
}

export function formatCssFallbackFilter(saturation?: number, blur?: number): string {
    const amount = resolveGlassSaturation(saturation);
    if (blur === undefined) {
        return amount === undefined
            ? CSS_FALLBACK_BACKDROP
            : `blur(8px)${formatExplicitSaturation(amount)} brightness(1.04)`;
    }
    const blurPart = `blur(${(blur * 3.5).toFixed(1)}px)`;
    return blurPart + (amount === undefined ? (blur >= 1 ? " saturate(180%)" : "") : formatExplicitSaturation(amount));
}

export function formatGlassCoreFilter(filter?: string, saturation?: number): string {
    const amount = resolveGlassSaturation(saturation);
    if (filter === undefined) return formatCssFallbackFilter(amount);
    if (amount === undefined || filter !== DEFAULT_GLASS_CONFIG.coreFilter) return filter;
    return `blur(6px)${formatExplicitSaturation(amount)} brightness(1.03)`;
}

export function resolveSurfaceId(surface: GlassSurface): number {
    if (surface === "convex_circle") return 1;
    if (surface === "linear") return 2;
    if (surface === "lip") return 3;
    if (surface === "concave") return 4;
    return 0;
}

export function resolveCornerStyle(cornerStyle?: GlassCornerStyle): GlassCornerStyle {
    return cornerStyle === "squircle" ? "squircle" : "circular";
}

export function resolveGlassTheme(
    theme?: GlassTheme,
    element?: Element | null,
): "light" | "dark" {
    if (theme === "dark" || theme === "light") return theme;
    const ancestorTheme = element?.closest?.("[data-theme]")?.getAttribute("data-theme")?.trim().toLowerCase();
    if (ancestorTheme === "dark") return "dark";
    if (ancestorTheme === "light") return "light";
    if (typeof document !== "undefined") {
        const docEl = document.documentElement;
        const body = document.body;
        if (
            docEl.classList.contains("dark") ||
            docEl.getAttribute("data-theme") === "dark" ||
            body?.classList.contains("dark") ||
            body?.getAttribute("data-theme") === "dark"
        ) {
            return "dark";
        }
        if (
            docEl.classList.contains("light") ||
            docEl.getAttribute("data-theme") === "light" ||
            body?.classList.contains("light") ||
            body?.getAttribute("data-theme") === "light"
        ) {
            return "light";
        }
        if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
            const docScheme = (window.getComputedStyle(docEl).colorScheme || "").toLowerCase();
            if (docScheme.includes("dark") && !docScheme.startsWith("light")) return "dark";
            if (docScheme.startsWith("light") && !docScheme.includes("dark")) return "light";
        }
    }
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
        if (window.matchMedia("(prefers-color-scheme: dark)")?.matches) return "dark";
    }
    return "light";
}

export const DEFAULT_ABBE_NUMBER = 58.5;

export const GLASS_PRESETS: Record<GlassPreset, Partial<LiquidGlassOptions>> = {
    apple_liquid: {
        surface: "convex_squircle",
        thickness: 48,
        bezel: 14,
        scaleRatio: 2.35,
        blur: 2,
        ior: 2.15,
        highlight: 0.9,
        chromaticAberration: false,
        abbeNumber: 58.5,
    },
    frosted: {
        surface: "convex_squircle",
        thickness: 34,
        bezel: 12,
        scaleRatio: 1.65,
        blur: 14,
        ior: 1.52,
        tintOpacity: 0.22,
        highlight: 0.55,
        chromaticAberration: false,
    },
    crystal: {
        surface: "convex_circle",
        thickness: 64,
        bezel: 18,
        scaleRatio: 2.8,
        blur: 0.5,
        ior: 1.75,
        highlight: 1.0,
        chromaticAberration: true,
        abbeNumber: 28,
    },
    water: {
        surface: "convex_squircle",
        thickness: 52,
        bezel: 20,
        scaleRatio: 2.6,
        blur: 1,
        ior: 1.333,
        highlight: 0.85,
        chromaticAberration: 0.04,
        abbeNumber: 55.7,
    },
    obsidian: {
        surface: "lip",
        thickness: 40,
        bezel: 14,
        scaleRatio: 1.9,
        blur: 10,
        ior: 1.62,
        tintColor: "rgba(14, 18, 28, 1)",
        tintOpacity: 0.42,
        highlight: 0.72,
        chromaticAberration: false,
    },
    subtle: {
        surface: "linear",
        thickness: 24,
        bezel: 10,
        scaleRatio: 1.25,
        blur: 6,
        ior: 1.48,
        highlight: 0.4,
        chromaticAberration: false,
    },
    prism: {
        surface: "convex_squircle",
        thickness: 68,
        bezel: 20,
        scaleRatio: 2.95,
        blur: 0.4,
        ior: 1.785,
        highlight: 1.0,
        chromaticAberration: true,
        abbeNumber: 25.8,
    },
    diamond: {
        surface: "convex_circle",
        thickness: 58,
        bezel: 16,
        scaleRatio: 2.75,
        blur: 0,
        ior: 2.417,
        highlight: 1.0,
        chromaticAberration: true,
        abbeNumber: 55.3,
    },
    smoke: {
        surface: "convex_squircle",
        thickness: 42,
        bezel: 14,
        scaleRatio: 1.85,
        blur: 12,
        ior: 1.52,
        tintColor: "rgba(18, 22, 32, 1)",
        tintOpacity: 0.32,
        highlight: 0.58,
        chromaticAberration: false,
    },
    ice: {
        surface: "concave",
        thickness: 46,
        bezel: 16,
        scaleRatio: 2.2,
        blur: 9,
        ior: 1.309,
        tintColor: "rgba(218, 240, 255, 1)",
        tintOpacity: 0.24,
        highlight: 0.88,
        chromaticAberration: true,
        abbeNumber: 95,
    },
};

export function resolvePresetOptions<T extends LiquidGlassOptions>(options: T): T {
    if (!options.preset) return options;
    const presetDefaults = GLASS_PRESETS[options.preset];
    if (!presetDefaults) return options;
    return mergeGlassOptions(presetDefaults, options);
}

const VALID_GLASS_SURFACES = new Set<GlassSurface>([
    "convex_squircle",
    "convex_circle",
    "linear",
    "lip",
    "concave",
]);

const VALID_ENGINE_MODES = new Set<GlassEngineMode>(["auto", "wasm-svg", "webgl", "css"]);

function parseOptionalFiniteNumber(raw: string | null): number | undefined {
    if (raw === null || raw.trim() === "") return undefined;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalBoolean(raw: string | null): boolean | undefined {
    if (raw === null) return undefined;
    const normalized = raw.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
    return undefined;
}

export function parseElementGlassAttributes(
    element: Pick<Element, "getAttribute">,
): Partial<LiquidGlassOptions> | null {
    let overrides: Record<string, unknown> | null = null;
    const assign = (key: string, value: unknown) => {
        if (value === undefined) return;
        overrides ??= {};
        overrides[key] = value;
    };

    const presetRaw = element.getAttribute("data-lg-preset")?.trim() as GlassPreset | undefined;
    if (presetRaw && Object.prototype.hasOwnProperty.call(GLASS_PRESETS, presetRaw)) {
        assign("preset", presetRaw);
    }

    const surfaceRaw = element.getAttribute("data-lg-surface")?.trim() as GlassSurface | undefined;
    if (surfaceRaw && VALID_GLASS_SURFACES.has(surfaceRaw)) {
        assign("surface", surfaceRaw);
    }

    const engineRaw = element.getAttribute("data-lg-engine")?.trim() as GlassEngineMode | undefined;
    if (engineRaw && VALID_ENGINE_MODES.has(engineRaw)) {
        assign("engine", engineRaw);
    }

    assign("blur", parseOptionalFiniteNumber(element.getAttribute("data-lg-blur")));
    assign("saturation", parseOptionalFiniteNumber(element.getAttribute("data-lg-saturation")));
    assign("thickness", parseOptionalFiniteNumber(element.getAttribute("data-lg-thickness")));
    assign("bezel", parseOptionalFiniteNumber(element.getAttribute("data-lg-bezel")));
    assign("adaptiveRefraction", parseOptionalBoolean(element.getAttribute("data-lg-adaptive-refraction")));
    const direction = element.getAttribute("data-lg-refraction-direction")?.trim();
    if (direction === "all" || direction === "horizontal" || direction === "vertical") {
        assign("refractionDirection", direction);
    }
    assign("refractionEdgeFade", parseOptionalFiniteNumber(element.getAttribute("data-lg-refraction-edge-fade")));
    assign("maxRefractionPx", parseOptionalFiniteNumber(element.getAttribute("data-lg-max-refraction-px")));
    assign("ior", parseOptionalFiniteNumber(element.getAttribute("data-lg-ior")));
    assign("radius", parseOptionalFiniteNumber(element.getAttribute("data-lg-radius")));
    assign("scaleRatio", parseOptionalFiniteNumber(element.getAttribute("data-lg-scale-ratio")));
    assign("tintOpacity", parseOptionalFiniteNumber(element.getAttribute("data-lg-tint-opacity")));
    assign("highlight", parseOptionalFiniteNumber(element.getAttribute("data-lg-highlight")));
    assign("abbeNumber", parseOptionalFiniteNumber(element.getAttribute("data-lg-abbe-number")));

    const themeRaw = element.getAttribute("data-lg-theme")?.trim().toLowerCase();
    if (themeRaw === "auto" || themeRaw === "light" || themeRaw === "dark") {
        assign("theme", themeRaw);
    }

    const cornerRaw = element.getAttribute("data-lg-corner-style")?.trim();
    if (cornerRaw === "squircle" || cornerRaw === "circular") {
        assign("cornerStyle", cornerRaw);
    }

    assign("pill", parseOptionalBoolean(element.getAttribute("data-lg-pill")));
    assign("hollow", parseOptionalBoolean(element.getAttribute("data-lg-hollow")));
    assign("interactive", parseOptionalBoolean(element.getAttribute("data-lg-interactive")));
    assign("coalesce", parseOptionalBoolean(element.getAttribute("data-lg-coalesce")));
    assign("alwaysOn", parseOptionalBoolean(element.getAttribute("data-lg-always-on")));
    assign("pixelRatio", parseOptionalFiniteNumber(element.getAttribute("data-lg-pixel-ratio")));
    assign(
        "maxScaleMultiplier",
        parseOptionalFiniteNumber(element.getAttribute("data-lg-max-scale-multiplier")),
    );

    const draggableRaw = element.getAttribute("data-lg-draggable")?.trim().toLowerCase();
    if (draggableRaw === "elastic" || draggableRaw === "free") {
        assign("draggable", draggableRaw);
    } else if (draggableRaw !== undefined && draggableRaw !== "") {
        assign("draggable", parseOptionalBoolean(draggableRaw));
    }

    const dragBoundsRaw = element.getAttribute("data-lg-drag-bounds")?.trim().toLowerCase();
    if (dragBoundsRaw === "viewport" || dragBoundsRaw === "parent") {
        assign("dragBounds", dragBoundsRaw);
    }

    const chromaRaw = element.getAttribute("data-lg-chromatic-aberration")?.trim().toLowerCase();
    if (chromaRaw === "true" || chromaRaw === "false") {
        assign("chromaticAberration", chromaRaw === "true");
    } else if (chromaRaw) {
        assign("chromaticAberration", parseOptionalFiniteNumber(chromaRaw));
    }

    const tintColorRaw = element.getAttribute("data-lg-tint-color")?.trim();
    if (tintColorRaw) {
        assign("tintColor", tintColorRaw);
    }

    const lightTiltRaw = element.getAttribute("data-lg-light-tilt")?.trim();
    if (lightTiltRaw === "pointer" || lightTiltRaw === "gyro") {
        assign("lightTilt", lightTiltRaw);
    } else if (lightTiltRaw && lightTiltRaw.includes(",")) {
        const [rawHorizontal, rawVertical] = lightTiltRaw.split(",", 2);
        const horizontal = parseOptionalFiniteNumber(rawHorizontal ?? null);
        const vertical = parseOptionalFiniteNumber(rawVertical ?? null);
        if (horizontal !== undefined && vertical !== undefined) {
            assign("lightTilt", { horizontal, vertical });
        }
    }

    return overrides as Partial<LiquidGlassOptions> | null;
}

export function parseCssCornerRadiusPx(
    rawRadius: string | undefined,
    widthPx: number,
    heightPx: number,
): number | null {
    if (!rawRadius) return null;
    const tokens = rawRadius.trim().split(/\s+/, 2);
    const firstToken = tokens[0] ?? "";
    if (!firstToken) return null;
    const firstNumeric = Number.parseFloat(firstToken);
    if (!Number.isFinite(firstNumeric)) return null;
    const minDimension = Math.min(widthPx, heightPx);
    const secondToken = tokens[1];
    if (secondToken) {
        const secondNumeric = Number.parseFloat(secondToken);
        if (Number.isFinite(secondNumeric)) {
            const rx = firstToken.endsWith("%") ? (firstNumeric / 100) * widthPx : firstNumeric;
            const ry = secondToken.endsWith("%") ? (secondNumeric / 100) * heightPx : secondNumeric;
            const effective = Math.min(rx, ry);
            return Math.min(Math.max(effective, 0), minDimension * 0.5);
        }
    }
    const resolved = firstToken.endsWith("%") ? (firstNumeric / 100) * minDimension : firstNumeric;
    return Math.min(Math.max(resolved, 0), minDimension * 0.5);
}

export function mergeGlassOptions<T extends LiquidGlassOptions>(
    defaults: Partial<LiquidGlassOptions> | undefined,
    options: T,
): T {
    const merged: Record<string, unknown> = defaults ? { ...defaults } : {};
    for (const [key, value] of Object.entries(options)) {
        if (value !== undefined) {
            merged[key] = value;
        }
    }
    return merged as T;
}

export function computeMergedOptionPatch<T extends object>(
    prevOptions: T | null,
    nextOptions: T,
): T {
    if (!prevOptions) return nextOptions;
    const patch = { ...nextOptions } as Record<string, unknown>;
    for (const key of Object.keys(prevOptions)) {
        if (!(key in patch)) {
            patch[key] = undefined;
        }
    }
    return patch as T;
}

export function serializeLightTiltKey(lightTilt: GlassLightTiltMode | undefined): string {
    if (typeof lightTilt === "string") return lightTilt;
    if (lightTilt && typeof lightTilt === "object") {
        return `${lightTilt.horizontal}:${lightTilt.vertical}`;
    }
    return "";
}

export function resolveChromaticAberration(
    value?: boolean | number,
    abbeNumber?: number,
): number {
    if (value === false) return 0;
    const hasCustomAbbe = typeof abbeNumber === "number" && Number.isFinite(abbeNumber) && abbeNumber > 0;
    const materialGain = hasCustomAbbe
        ? DEFAULT_ABBE_NUMBER / Math.min(120, Math.max(10, abbeNumber))
        : 1;
    if (typeof value === "number") {
        return Number.isFinite(value) ? Math.min(1, Math.max(0, Math.min(1, value) * materialGain)) : 0;
    }
    return value === true || hasCustomAbbe ? Math.min(0.25, 0.085 * materialGain) : 0;
}

export function resolveGlassConfig(options: LiquidGlassOptions = {}): GlassConfig {
    const effectiveOptions = resolvePresetOptions(options);
    const surface = effectiveOptions.surface ?? DEFAULT_GLASS_CONFIG.surface;
    const thickness =
        Number.isFinite(effectiveOptions.thickness)
            ? Math.max(0, effectiveOptions.thickness!)
            : DEFAULT_GLASS_CONFIG.thickness;
    const bezel =
        Number.isFinite(effectiveOptions.bezel)
            ? Math.max(0, effectiveOptions.bezel!)
            : DEFAULT_GLASS_CONFIG.bezel;
    const adaptiveRefraction = effectiveOptions.adaptiveRefraction === true;
    const refractionDirection = resolveRefractionDirection(effectiveOptions.refractionDirection);
    const refractionEdgeFade = resolveRefractionEdgeFade(effectiveOptions.refractionEdgeFade);
    const maxRefractionPx = Number.isFinite(effectiveOptions.maxRefractionPx)
        ? Math.max(0, effectiveOptions.maxRefractionPx!)
        : undefined;
    const scaleRatio =
        Number.isFinite(effectiveOptions.scaleRatio)
            ? Math.max(0, effectiveOptions.scaleRatio!)
            : DEFAULT_GLASS_CONFIG.scaleRatio;
    const maxScaleMultiplier =
        Number.isFinite(effectiveOptions.maxScaleMultiplier)
            ? Math.max(0, effectiveOptions.maxScaleMultiplier!)
            : DEFAULT_GLASS_CONFIG.maxScaleMultiplier;
    const blur =
        Number.isFinite(effectiveOptions.blur)
            ? Math.max(0, effectiveOptions.blur!)
            : DEFAULT_GLASS_CONFIG.blur;
    const saturation = resolveGlassSaturation(effectiveOptions.saturation);
    const ior =
        Number.isFinite(effectiveOptions.ior)
            ? Math.max(1, effectiveOptions.ior!)
            : DEFAULT_GLASS_CONFIG.ior;
    const radius =
        Number.isFinite(effectiveOptions.radius)
            ? effectiveOptions.radius!
            : DEFAULT_GLASS_CONFIG.radius;
    const cornerStyle = resolveCornerStyle(
        effectiveOptions.cornerStyle ?? DEFAULT_GLASS_CONFIG.cornerStyle,
    );
    const pill = effectiveOptions.pill ?? DEFAULT_GLASS_CONFIG.pill;
    const hollow = effectiveOptions.hollow ?? DEFAULT_GLASS_CONFIG.hollow;
    const alwaysOn = effectiveOptions.alwaysOn ?? DEFAULT_GLASS_CONFIG.alwaysOn;
    const coreFilter = effectiveOptions.coreFilter ?? DEFAULT_GLASS_CONFIG.coreFilter;
    const abbeNumber =
        typeof effectiveOptions.abbeNumber === "number" && Number.isFinite(effectiveOptions.abbeNumber)
            ? effectiveOptions.abbeNumber
            : undefined;
    const chromaticAberration =
        effectiveOptions.chromaticAberration ?? (abbeNumber !== undefined && abbeNumber > 0);
    const chromaAmount = resolveChromaticAberration(chromaticAberration, abbeNumber);

    const idParts = [
        "lg",
        surface,
        thickness,
        bezel,
        adaptiveRefraction,
        refractionDirection,
        refractionEdgeFade,
        maxRefractionPx,
        scaleRatio,
        blur,
        ior.toFixed(2),
        pill ? 1 : 0,
        chromaAmount > 0 ? `ca${chromaAmount.toFixed(3)}` : "ca0",
    ];
    if (saturation !== undefined) idParts.push(`sat${saturation}`);
    if (cornerStyle === "squircle") {
        idParts.push("sq");
    }
    const id = idParts.join("_");

    return {
        ...DEFAULT_GLASS_CONFIG,
        id,
        surface,
        thickness,
        bezel,
        adaptiveRefraction,
        refractionDirection,
        refractionEdgeFade,
        maxRefractionPx,
        scaleRatio,
        maxScaleMultiplier,
        blur,
        saturation,
        ior,
        radius,
        cornerStyle,
        pill,
        hollow,
        alwaysOn,
        coreFilter,
        chromaticAberration,
        ...(abbeNumber !== undefined ? { abbeNumber } : {}),
    };
}
