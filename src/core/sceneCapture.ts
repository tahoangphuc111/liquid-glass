import { parseCssCornerRadiusPx, resolveSharpnessPixelRatio } from "./config.js";
import { automaticRoundedPixelRatio, resizeCanvas, SMALL_SCENE_DIMENSION, useSmallMemoryBudget } from "./renderBudget.js";
import { parseCssColorToRgbaReadonly } from "./cssColor.js";
import { observeSharedElementResize } from "./observer.js";
import { subscribeSceneCaptureSignals } from "./sceneCaptureSignals.js";
import {
    prepareSceneTextLayouts,
    resolveWrappedTextLines,
    type SceneTextLayouts,
} from "./sceneTextLayout.js";
import type { SceneCaptureController } from "./types.js";

const MODERN_COLOR_PREFIX_PATTERN = /^(?:oklch|oklab|lch|lab|hwb|color-mix|color)\(/i;

function lruGet<K, V>(cache: Map<K, V>, key: K): V | undefined {
    const value = cache.get(key);
    if (value !== undefined) {
        cache.delete(key);
        cache.set(key, value);
    }
    return value;
}

function lruSet<K, V>(cache: Map<K, V>, key: K, value: V, maxEntries: number): void {
    if (cache.has(key)) {
        cache.delete(key);
    } else if (cache.size >= maxEntries) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) cache.delete(oldestKey);
    }
    cache.set(key, value);
}

type CornerRadii = number | readonly [number, number, number, number];

function toCanvasCssColor(rawColor: string): string {
    const len = rawColor.length;
    if (len === 0) return rawColor;
    const ch0 = rawColor.charCodeAt(0);
    if ((ch0 === 114 || ch0 === 35) && rawColor.charCodeAt(len - 1) > 32) {
        return rawColor;
    }
    const trimmed = rawColor.trim();
    if (!MODERN_COLOR_PREFIX_PATTERN.test(trimmed)) {
        return trimmed;
    }
    const parsed = parseCssColorToRgbaReadonly(trimmed);
    if (!parsed) return trimmed;
    const red = Math.round(parsed[0] * 255);
    const green = Math.round(parsed[1] * 255);
    const blue = Math.round(parsed[2] * 255);
    return parsed[3] >= 0.999
        ? `rgb(${red}, ${green}, ${blue})`
        : `rgba(${red}, ${green}, ${blue}, ${Number(parsed[3].toFixed(4))})`;
}

interface GradientStopSpec {
    color: string;
    posPx: number | null;
    posFrac: number | null;
}

function applyLetterSpacing(ctx: CanvasRenderingContext2D, letterSpacing: string): void {
    const target = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
    if (!("letterSpacing" in target)) return;
    target.letterSpacing = letterSpacing === "normal" ? "0px" : letterSpacing;
}

const MAX_BLUR_CACHE = 200;
const blurCache = new Map<string, number>();
function parseCssBlurPx(filterStr: string): number {
    if (!filterStr || filterStr === "none") return 0;
    const cached = lruGet(blurCache, filterStr);
    if (cached !== undefined) return cached;
    const match = filterStr.match(/blur\(\s*([\d.]+)px\s*\)/i);
    let value = 0;
    if (match) {
        const parsed = Number.parseFloat(match[1]);
        value = Number.isFinite(parsed) && parsed > 0 ? Math.min(80, parsed) : 0;
    }
    lruSet(blurCache, filterStr, value, MAX_BLUR_CACHE);
    return value;
}

function splitTopLevelArgs(inner: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < inner.length; index++) {
        const ch = inner[index];
        if (ch === "(") depth++;
        else if (ch === ")" && depth > 0) depth--;
        else if (ch === "," && depth === 0) {
            parts.push(inner.slice(start, index).trim());
            start = index + 1;
        }
    }
    const tail = inner.slice(start).trim();
    if (tail) parts.push(tail);
    return parts;
}

function extractFunctionInner(source: string, fnName: string): { isRepeating: boolean; inner: string } | null {
    const repeatingName = `repeating-${fnName}(`;
    const normalName = `${fnName}(`;
    let start = source.indexOf(repeatingName);
    let isRepeating = true;
    let openOffset = repeatingName.length;
    if (start < 0) {
        start = source.indexOf(normalName);
        isRepeating = false;
        openOffset = normalName.length;
    }
    if (start < 0) return null;
    let depth = 1;
    let index = start + openOffset;
    while (index < source.length && depth > 0) {
        if (source[index] === "(") depth++;
        else if (source[index] === ")") depth--;
        index++;
    }
    if (depth !== 0) return null;
    return {
        isRepeating,
        inner: source.slice(start + openOffset, index - 1),
    };
}

function parseCssGradientAngle(token: string): { dx: number; dy: number } | null {
    const normalized = token.trim().toLowerCase();
    const degMatch = normalized.match(/^(-?[\d.]+)deg$/);
    if (degMatch) {
        const rad = (Number.parseFloat(degMatch[1]) * Math.PI) / 180;
        return { dx: Math.sin(rad), dy: -Math.cos(rad) };
    }
    const radMatch = normalized.match(/^(-?[\d.]+)rad$/);
    if (radMatch) {
        const rad = Number.parseFloat(radMatch[1]);
        return { dx: Math.sin(rad), dy: -Math.cos(rad) };
    }
    const gradMatch = normalized.match(/^(-?[\d.]+)grad$/);
    if (gradMatch) {
        const rad = (Number.parseFloat(gradMatch[1]) * Math.PI) / 200;
        return { dx: Math.sin(rad), dy: -Math.cos(rad) };
    }
    const turnMatch = normalized.match(/^(-?[\d.]+)turn$/);
    if (turnMatch) {
        const rad = Number.parseFloat(turnMatch[1]) * Math.PI * 2;
        return { dx: Math.sin(rad), dy: -Math.cos(rad) };
    }
    if (!normalized.startsWith("to ")) return null;
    let dx = 0;
    let dy = 0;
    if (normalized.includes("left")) dx = -1;
    else if (normalized.includes("right")) dx = 1;
    if (normalized.includes("top")) dy = -1;
    else if (normalized.includes("bottom")) dy = 1;
    const mag = Math.hypot(dx, dy);
    return mag > 0 ? { dx: dx / mag, dy: dy / mag } : null;
}

function parseCssAngleRadians(token: string): number | null {
    const normalized = token.trim().toLowerCase();
    const degMatch = normalized.match(/^(-?[\d.]+)deg$/);
    if (degMatch) return (Number.parseFloat(degMatch[1]) * Math.PI) / 180;
    const radMatch = normalized.match(/^(-?[\d.]+)rad$/);
    if (radMatch) return Number.parseFloat(radMatch[1]);
    const gradMatch = normalized.match(/^(-?[\d.]+)grad$/);
    if (gradMatch) return (Number.parseFloat(gradMatch[1]) * Math.PI) / 200;
    const turnMatch = normalized.match(/^(-?[\d.]+)turn$/);
    if (turnMatch) return Number.parseFloat(turnMatch[1]) * Math.PI * 2;
    return null;
}

const MAX_SPLIT_BG_LAYERS_CACHE = 128;
const splitBgLayersCache = new Map<string, readonly string[]>();

function getCachedBackgroundLayers(backgroundImage: string): readonly string[] {
    const cached = lruGet(splitBgLayersCache, backgroundImage);
    if (cached !== undefined) return cached;
    const layers = splitTopLevelArgs(backgroundImage);
    lruSet(splitBgLayersCache, backgroundImage, layers, MAX_SPLIT_BG_LAYERS_CACHE);
    return layers;
}

interface ParsedStopToken {
    readonly color: string;
    readonly kind: "none" | "px" | "frac";
    readonly value: number;
}

const MAX_PARSED_STOPS_CACHE = 128;
const parsedGradientStopsCache = new Map<string, readonly ParsedStopToken[]>();

function extractGradientStopColorAndRest(part: string): { colorToken: string; rest: string } | null {
    const trimmed = part.trim();
    if (!trimmed) return null;
    const parenIndex = trimmed.indexOf("(");
    if (
        parenIndex > 0 &&
        /^(?:color-mix|rgba?|hsla?|hwb|oklch|oklab|lch|lab|color)$/i.test(
            trimmed.slice(0, parenIndex),
        )
    ) {
        let depth = 0;
        for (let index = parenIndex; index < trimmed.length; index++) {
            const char = trimmed[index];
            if (char === "(") {
                depth++;
            } else if (char === ")") {
                depth--;
                if (depth === 0) {
                    return {
                        colorToken: trimmed.slice(0, index + 1),
                        rest: trimmed.slice(index + 1).trim(),
                    };
                }
            }
        }
        return null;
    }
    const simpleMatch = trimmed.match(/^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})(.*)$/);
    if (!simpleMatch) return null;
    return {
        colorToken: simpleMatch[1]!,
        rest: simpleMatch[2]!.trim(),
    };
}

function getCachedStopTokens(cacheKey: string, args: readonly string[], angleStops: boolean): readonly ParsedStopToken[] {
    const cached = lruGet(parsedGradientStopsCache, cacheKey);
    if (cached !== undefined) return cached;
    const tokens: ParsedStopToken[] = [];
    for (let idx = 0; idx < args.length; idx++) {
        const part = args[idx]!;
        const parsedStop = extractGradientStopColorAndRest(part);
        if (!parsedStop) continue;
        const color = toCanvasCssColor(parsedStop.colorToken);
        const rest = parsedStop.rest;
        if (!rest) {
            tokens.push({ color, kind: "none", value: 0 });
            continue;
        }
        const positionTokens = rest.match(/-?[\d.]+(?:%|px|deg|rad|grad|turn)/gi) ?? [];
        if (positionTokens.length === 0) {
            tokens.push({ color, kind: "none", value: 0 });
            continue;
        }
        const maxPositions = Math.min(2, positionTokens.length);
        let emitted = false;
        for (let posIdx = 0; posIdx < maxPositions; posIdx++) {
            const trimmed = positionTokens[posIdx]!.trim().toLowerCase();
            if (angleStops) {
                const angleRad = parseCssAngleRadians(trimmed);
                if (angleRad !== null) {
                    tokens.push({ color, kind: "frac", value: angleRad / (Math.PI * 2) });
                    emitted = true;
                    continue;
                }
            }
            if (!angleStops && trimmed.endsWith("px")) {
                const px = Number.parseFloat(trimmed);
                if (Number.isFinite(px)) {
                    tokens.push({ color, kind: "px", value: px });
                    emitted = true;
                    continue;
                }
            }
            if (trimmed.endsWith("%")) {
                const pct = Number.parseFloat(trimmed);
                if (Number.isFinite(pct)) {
                    tokens.push({ color, kind: "frac", value: pct / 100 });
                    emitted = true;
                }
            }
        }
        if (!emitted) {
            tokens.push({ color, kind: "none", value: 0 });
        }
    }
    lruSet(parsedGradientStopsCache, cacheKey, tokens, MAX_PARSED_STOPS_CACHE);
    return tokens;
}

function resolveGradientStopSeries(
    count: number,
    readExplicit: (index: number) => number | null,
    fallbackEnd: number,
    clampUnit: boolean,
): number[] {
    const resolved = new Array<number>(count);
    if (count === 0) return resolved;

    const firstExplicit = readExplicit(0);
    let maxExplicit =
        firstExplicit !== null && Number.isFinite(firstExplicit)
            ? clampUnit
                ? Math.min(1, Math.max(0, firstExplicit))
                : firstExplicit
            : 0;
    resolved[0] = maxExplicit;
    let anchorIndex = 0;

    for (let index = 1; index < count; index++) {
        const raw = readExplicit(index);
        let value: number | null = null;
        if (raw !== null && Number.isFinite(raw)) {
            const clamped = clampUnit ? Math.min(1, Math.max(0, raw)) : raw;
            maxExplicit = Math.max(maxExplicit, clamped);
            value = maxExplicit;
        } else if (index === count - 1) {
            value = Math.max(maxExplicit, fallbackEnd);
        }
        if (value === null) continue;

        resolved[index] = value;
        const gapCount = index - anchorIndex;
        if (gapCount > 1) {
            const startVal = resolved[anchorIndex]!;
            const stepDelta = (value - startVal) / gapCount;
            for (let step = 1; step < gapCount; step++) {
                resolved[anchorIndex + step] = startVal + stepDelta * step;
            }
        }
        anchorIndex = index;
    }
    return resolved;
}

function interpolateCssColorAt(colorA: string, colorB: string, t: number): string {
    const rgbaA = parseCssColorToRgbaReadonly(colorA);
    const rgbaB = parseCssColorToRgbaReadonly(colorB);
    if (!rgbaA || !rgbaB) return t < 0.5 ? colorA : colorB;
    const clampedT = Math.min(1, Math.max(0, t));
    const r = Math.round((rgbaA[0] + (rgbaB[0] - rgbaA[0]) * clampedT) * 255);
    const g = Math.round((rgbaA[1] + (rgbaB[1] - rgbaA[1]) * clampedT) * 255);
    const b = Math.round((rgbaA[2] + (rgbaB[2] - rgbaA[2]) * clampedT) * 255);
    const a = rgbaA[3] + (rgbaB[3] - rgbaA[3]) * clampedT;
    return a >= 0.999
        ? `rgb(${r}, ${g}, ${b})`
        : `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(4))})`;
}

function addResolvedGradientStops(
    gradient: CanvasGradient,
    stops: GradientStopSpec[],
    lineLen: number,
    isRepeating: boolean,
): boolean {
    if (!isRepeating) {
        const fractions = resolveGradientStopFractions(stops);
        for (let index = 0; index < stops.length; index++) {
            const pos = fractions[index]!;
            try {
                gradient.addColorStop(Math.min(1, Math.max(0, pos)), stops[index]!.color);
            } catch {
                return false;
            }
        }
        return true;
    }

    const safeLineLen = Math.max(1e-4, lineLen);
    const resolvedPx = resolveGradientStopSeries(
        stops.length,
        (idx) => stops[idx]!.posPx,
        safeLineLen,
        false,
    );
    const firstPx = resolvedPx[0] ?? 0;
    const lastPx = resolvedPx[stops.length - 1] ?? safeLineLen;
    const minPeriod = safeLineLen <= 2 ? 0.02 : 4;
    const period = Math.max(minPeriod, lastPx - firstPx);
    const firstCycle = Math.floor(-lastPx / period) + 1;
    const lastCycle = Math.min(firstCycle + 95, Math.floor((safeLineLen - firstPx) / period));

    let prevPos: number | null = null;
    let prevColor = "";
    for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
        const basePx = cycle * period;
        for (let index = 0; index < stops.length; index++) {
            const pos = (resolvedPx[index]! + basePx) / safeLineLen;
            const color = stops[index]!.color;
            if (prevPos !== null && prevPos < 0 && pos > 0) {
                const boundaryT = -prevPos / (pos - prevPos);
                try {
                    gradient.addColorStop(0, interpolateCssColorAt(prevColor, color, boundaryT));
                } catch {
                    return false;
                }
            }
            if (prevPos !== null && prevPos < 1 && pos > 1) {
                const boundaryT = (1 - prevPos) / (pos - prevPos);
                try {
                    gradient.addColorStop(1, interpolateCssColorAt(prevColor, color, boundaryT));
                } catch {
                    return false;
                }
            }
            if (pos >= 0 && pos <= 1) {
                try {
                    gradient.addColorStop(pos, color);
                } catch {
                    return false;
                }
            }
            prevPos = pos;
            prevColor = color;
        }
    }
    return true;
}

function resolveGradientStopFractions(stops: GradientStopSpec[]): number[] {
    return resolveGradientStopSeries(stops.length, (idx) => stops[idx]!.posFrac, 1, true);
}

function parseStyleCornerRadiusPx(
    rawRadius: string | undefined,
    widthPx: number,
    heightPx: number,
): number {
    if (!rawRadius || rawRadius === "0px" || rawRadius === "0") return 0;
    const parsed = parseCssCornerRadiusPx(rawRadius, widthPx, heightPx);
    if (parsed === null || !Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.min(Math.min(widthPx, heightPx) * 0.5, parsed);
}

function parseElementCornerRadii(
    style: CSSStyleDeclaration,
    widthPx: number,
    heightPx: number,
): CornerRadii {
    const tl = parseStyleCornerRadiusPx(style.borderTopLeftRadius, widthPx, heightPx);
    if (!style.borderTopRightRadius && !style.borderBottomRightRadius && !style.borderBottomLeftRadius) {
        return tl;
    }
    const tr = parseStyleCornerRadiusPx(style.borderTopRightRadius, widthPx, heightPx);
    const br = parseStyleCornerRadiusPx(style.borderBottomRightRadius, widthPx, heightPx);
    const bl = parseStyleCornerRadiusPx(style.borderBottomLeftRadius, widthPx, heightPx);
    if (tl === tr && tl === br && tl === bl) {
        return tl;
    }
    const topSum = tl + tr;
    const bottomSum = bl + br;
    const leftSum = tl + bl;
    const rightSum = tr + br;
    const scale = Math.min(
        1,
        topSum > 0 ? widthPx / topSum : 1,
        bottomSum > 0 ? widthPx / bottomSum : 1,
        leftSum > 0 ? heightPx / leftSum : 1,
        rightSum > 0 ? heightPx / rightSum : 1,
    );
    return [tl * scale, tr * scale, br * scale, bl * scale];
}

function offsetCornerRadii(radii: CornerRadii, deltaPx: number): CornerRadii {
    if (typeof radii === "number") {
        return Math.max(0, radii + deltaPx);
    }
    return [
        Math.max(0, radii[0] + deltaPx),
        Math.max(0, radii[1] + deltaPx),
        Math.max(0, radii[2] + deltaPx),
        Math.max(0, radii[3] + deltaPx),
    ];
}

interface CompiledLinearGradient {
    readonly isRepeating: boolean;
    readonly dx: number;
    readonly dy: number;
    readonly tokens: readonly ParsedStopToken[];
    readonly preResolvedFractions: readonly number[] | null;
}

interface CompiledRadialGradient {
    readonly isRepeating: boolean;
    readonly atXToken: string | null;
    readonly atYToken: string | null;
    readonly sizeKeyword: "closest-side" | "farthest-side" | "closest-corner" | "farthest-corner";
    readonly tokens: readonly ParsedStopToken[];
    readonly preResolvedFractions: readonly number[] | null;
}

interface CompiledConicGradient {
    readonly isRepeating: boolean;
    readonly startAngleRad: number;
    readonly atXToken: string | null;
    readonly atYToken: string | null;
    readonly tokens: readonly ParsedStopToken[];
    readonly preResolvedFractions: readonly number[] | null;
}

const MAX_COMPILED_GRADIENTS = 128;
const compiledLinearGradientCache = new Map<string, CompiledLinearGradient | null>();
const compiledRadialGradientCache = new Map<string, CompiledRadialGradient | null>();
const compiledConicGradientCache = new Map<string, CompiledConicGradient | null>();

function preResolveUnitFractions(
    tokens: readonly ParsedStopToken[],
    isRepeating: boolean,
): readonly number[] | null {
    if (isRepeating) return null;
    for (let idx = 0; idx < tokens.length; idx++) {
        if (tokens[idx]!.kind === "px") return null;
    }
    return resolveGradientStopSeries(
        tokens.length,
        (idx) => {
            const tok = tokens[idx]!;
            return tok.kind === "frac" ? tok.value : null;
        },
        1,
        true,
    );
}

function buildGradientStopSpecs(
    tokens: readonly ParsedStopToken[],
    lineLen: number,
): GradientStopSpec[] {
    const stops = new Array<GradientStopSpec>(tokens.length);
    for (let idx = 0; idx < tokens.length; idx++) {
        const tok = tokens[idx]!;
        if (tok.kind === "px") {
            stops[idx] = {
                color: tok.color,
                posPx: tok.value,
                posFrac: lineLen > 0 ? tok.value / lineLen : 0,
            };
        } else if (tok.kind === "frac") {
            stops[idx] = {
                color: tok.color,
                posPx: tok.value * lineLen,
                posFrac: tok.value,
            };
        } else {
            stops[idx] = { color: tok.color, posPx: null, posFrac: null };
        }
    }
    return stops;
}

function applyCompiledGradientStops(
    gradient: CanvasGradient,
    tokens: readonly ParsedStopToken[],
    preResolvedFractions: readonly number[] | null,
    lineLen: number,
    isRepeating: boolean,
): boolean {
    if (preResolvedFractions) {
        for (let idx = 0; idx < tokens.length; idx++) {
            const pos = preResolvedFractions[idx]!;
            try {
                gradient.addColorStop(Math.min(1, Math.max(0, pos)), tokens[idx]!.color);
            } catch {
                return false;
            }
        }
        return true;
    }
    const stops = buildGradientStopSpecs(tokens, lineLen);
    return addResolvedGradientStops(gradient, stops, lineLen, isRepeating);
}

function getCompiledLinearGradient(backgroundImage: string): CompiledLinearGradient | null {
    const cached = lruGet(compiledLinearGradientCache, backgroundImage);
    if (cached !== undefined) return cached;
    let compiled: CompiledLinearGradient | null = null;
    const parsed = extractFunctionInner(backgroundImage, "linear-gradient");
    if (parsed) {
        const args = splitTopLevelArgs(parsed.inner);
        if (args.length >= 2) {
            const angleVec = parseCssGradientAngle(args[0]!);
            const dx = angleVec ? angleVec.dx : 0;
            const dy = angleVec ? angleVec.dy : 1;
            const stopArgs = angleVec ? args.slice(1) : args;
            const tokens = getCachedStopTokens(`l:${stopArgs.join("|")}`, stopArgs, false);
            if (tokens.length >= 2) {
                compiled = {
                    isRepeating: parsed.isRepeating,
                    dx,
                    dy,
                    tokens,
                    preResolvedFractions: preResolveUnitFractions(tokens, parsed.isRepeating),
                };
            }
        }
    }
    lruSet(compiledLinearGradientCache, backgroundImage, compiled, MAX_COMPILED_GRADIENTS);
    return compiled;
}

function getCompiledRadialGradient(backgroundImage: string): CompiledRadialGradient | null {
    const cached = lruGet(compiledRadialGradientCache, backgroundImage);
    if (cached !== undefined) return cached;
    let compiled: CompiledRadialGradient | null = null;
    const parsed = extractFunctionInner(backgroundImage, "radial-gradient");
    if (parsed) {
        const args = splitTopLevelArgs(parsed.inner);
        if (args.length >= 2) {
            const firstIsShape = /\b(circle|ellipse|at|closest|farthest)\b/i.test(args[0]!);
            const stopArgs = firstIsShape ? args.slice(1) : args;
            let atXToken: string | null = null;
            let atYToken: string | null = null;
            let sizeKeyword: CompiledRadialGradient["sizeKeyword"] = "farthest-corner";
            if (firstIsShape) {
                const shapeSpec = args[0]!;
                const atMatch = shapeSpec.match(
                    /\bat\s+(-?[\d.]+%|-?[\d.]+px|left|right|center)(?:\s+(-?[\d.]+%|-?[\d.]+px|top|bottom|center))?/i,
                );
                if (atMatch) {
                    atXToken = atMatch[1]!;
                    atYToken = atMatch[2] ?? "center";
                }
                const sizeMatch = shapeSpec.match(
                    /\b(closest-side|farthest-side|closest-corner|farthest-corner)\b/i,
                );
                if (sizeMatch) {
                    sizeKeyword = sizeMatch[1]!.toLowerCase() as CompiledRadialGradient["sizeKeyword"];
                }
            }
            const tokens = getCachedStopTokens(`l:${stopArgs.join("|")}`, stopArgs, false);
            if (tokens.length >= 2) {
                compiled = {
                    isRepeating: parsed.isRepeating,
                    atXToken,
                    atYToken,
                    sizeKeyword,
                    tokens,
                    preResolvedFractions: preResolveUnitFractions(tokens, parsed.isRepeating),
                };
            }
        }
    }
    lruSet(compiledRadialGradientCache, backgroundImage, compiled, MAX_COMPILED_GRADIENTS);
    return compiled;
}

function getCompiledConicGradient(backgroundImage: string): CompiledConicGradient | null {
    const cached = lruGet(compiledConicGradientCache, backgroundImage);
    if (cached !== undefined) return cached;
    let compiled: CompiledConicGradient | null = null;
    const parsed = extractFunctionInner(backgroundImage, "conic-gradient");
    if (parsed) {
        const args = splitTopLevelArgs(parsed.inner);
        if (args.length >= 2) {
            let startAngleRad = -Math.PI * 0.5;
            let atXToken: string | null = null;
            let atYToken: string | null = null;
            let stopArgs = args;
            const firstArg = args[0]!;
            if (/^\s*(from\b|at\b)/i.test(firstArg)) {
                const fromMatch = firstArg.match(/\bfrom\s+(-?[\d.]+(?:deg|rad|grad|turn))/i);
                if (fromMatch) {
                    const parsedAngle = parseCssAngleRadians(fromMatch[1]!);
                    if (parsedAngle !== null) startAngleRad = parsedAngle - Math.PI * 0.5;
                }
                const atMatch = firstArg.match(
                    /\bat\s+(-?[\d.]+%|-?[\d.]+px|left|right|center)(?:\s+(-?[\d.]+%|-?[\d.]+px|top|bottom|center))?/i,
                );
                if (atMatch) {
                    atXToken = atMatch[1]!;
                    atYToken = atMatch[2] ?? "center";
                }
                stopArgs = args.slice(1);
            }
            const tokens = getCachedStopTokens(`a:${stopArgs.join("|")}`, stopArgs, true);
            if (tokens.length >= 2) {
                compiled = {
                    isRepeating: parsed.isRepeating,
                    startAngleRad,
                    atXToken,
                    atYToken,
                    tokens,
                    preResolvedFractions: preResolveUnitFractions(tokens, parsed.isRepeating),
                };
            }
        }
    }
    lruSet(compiledConicGradientCache, backgroundImage, compiled, MAX_COMPILED_GRADIENTS);
    return compiled;
}

function drawLinearGradientBox(
    ctx: CanvasRenderingContext2D,
    backgroundImage: string,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: CornerRadii,
): boolean {
    const compiled = getCompiledLinearGradient(backgroundImage);
    if (!compiled) return false;

    const lineLen = Math.max(1, Math.abs(width * compiled.dx) + Math.abs(height * compiled.dy));
    const halfLen = lineLen * 0.5;
    const cx = x + width * 0.5;
    const cy = y + height * 0.5;
    const x0 = cx - compiled.dx * halfLen;
    const y0 = cy - compiled.dy * halfLen;
    const x1 = cx + compiled.dx * halfLen;
    const y1 = cy + compiled.dy * halfLen;

    const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
    if (
        !applyCompiledGradientStops(
            gradient,
            compiled.tokens,
            compiled.preResolvedFractions,
            lineLen,
            compiled.isRepeating,
        )
    ) {
        return false;
    }

    ctx.fillStyle = gradient;
    fillRoundedOrRect(ctx, x, y, width, height, radius);
    return true;
}

function drawRadialGradientBox(
    ctx: CanvasRenderingContext2D,
    backgroundImage: string,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: CornerRadii,
): boolean {
    const compiled = getCompiledRadialGradient(backgroundImage);
    if (!compiled) return false;

    const cx = compiled.atXToken
        ? x + width * parseObjectPositionFraction(compiled.atXToken, width, 0)
        : x + width * 0.5;
    const cy = compiled.atYToken
        ? y + height * parseObjectPositionFraction(compiled.atYToken, height, 0)
        : y + height * 0.5;

    const dxLeft = Math.abs(cx - x);
    const dxRight = Math.abs(x + width - cx);
    const dyTop = Math.abs(cy - y);
    const dyBottom = Math.abs(y + height - cy);
    let rad: number;
    if (compiled.sizeKeyword === "closest-side") {
        rad = Math.min(dxLeft, dxRight, dyTop, dyBottom);
    } else if (compiled.sizeKeyword === "farthest-side") {
        rad = Math.max(dxLeft, dxRight, dyTop, dyBottom);
    } else if (compiled.sizeKeyword === "closest-corner") {
        const minDx = dxLeft < dxRight ? dxLeft : dxRight;
        const minDy = dyTop < dyBottom ? dyTop : dyBottom;
        rad = Math.sqrt(minDx * minDx + minDy * minDy);
    } else {
        const maxDx = dxLeft > dxRight ? dxLeft : dxRight;
        const maxDy = dyTop > dyBottom ? dyTop : dyBottom;
        rad = Math.sqrt(maxDx * maxDx + maxDy * maxDy);
    }
    rad = Math.max(1, rad);

    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    if (
        !applyCompiledGradientStops(
            gradient,
            compiled.tokens,
            compiled.preResolvedFractions,
            rad,
            compiled.isRepeating,
        )
    ) {
        return false;
    }
    ctx.fillStyle = gradient;
    fillRoundedOrRect(ctx, x, y, width, height, radius);
    return true;
}

function drawConicGradientBox(
    ctx: CanvasRenderingContext2D,
    backgroundImage: string,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: CornerRadii,
): boolean {
    if (
        typeof (ctx as CanvasRenderingContext2D & { createConicGradient?: unknown })
            .createConicGradient !== "function"
    ) {
        return false;
    }
    const compiled = getCompiledConicGradient(backgroundImage);
    if (!compiled) return false;

    const cx = compiled.atXToken
        ? x + width * parseObjectPositionFraction(compiled.atXToken, width, 0)
        : x + width * 0.5;
    const cy = compiled.atYToken
        ? y + height * parseObjectPositionFraction(compiled.atYToken, height, 0)
        : y + height * 0.5;

    const gradient = ctx.createConicGradient(compiled.startAngleRad, cx, cy);
    if (
        !applyCompiledGradientStops(
            gradient,
            compiled.tokens,
            compiled.preResolvedFractions,
            1,
            compiled.isRepeating,
        )
    ) {
        return false;
    }
    ctx.fillStyle = gradient;
    fillRoundedOrRect(ctx, x, y, width, height, radius);
    return true;
}

interface BackgroundUrlCacheEntry {
    image: HTMLImageElement | null;
    status: "loading" | "ready" | "error";
    listeners: Set<() => void>;
}

const MAX_BG_URL_CACHE_ENTRIES = 64;
const backgroundUrlCache = new Map<string, BackgroundUrlCacheEntry>();

function extractCssUrl(layer: string): string | null {
    const match = layer.match(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^)\s]+))\s*\)/i);
    if (!match) return null;
    const raw = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    return raw.length > 0 ? raw : null;
}

function pickCssLayerValue(raw: string | undefined, layerIndex: number, fallback: string): string {
    if (!raw) return fallback;
    const trimmed = raw.trim();
    if (!trimmed) return fallback;
    if (!trimmed.includes(",")) return trimmed;
    const parts = splitTopLevelArgs(trimmed);
    if (parts.length === 0) return fallback;
    return parts[layerIndex % parts.length] || fallback;
}

function drawBackgroundUrlLayer(
    ctx: CanvasRenderingContext2D,
    layer: string,
    style: CSSStyleDeclaration | null,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: CornerRadii,
    onAsyncAssetReady?: () => void,
    layerIndex = 0,
): boolean {
    if (typeof Image === "undefined" || typeof ctx.drawImage !== "function") return false;
    const imageUrl = extractCssUrl(layer);
    if (!imageUrl) return false;
    const baseUrl = (ctx.canvas?.ownerDocument ?? document).baseURI;
    const cacheKey = `${baseUrl}\n${imageUrl}`;

    let entry = lruGet(backgroundUrlCache, cacheKey);
    if (!entry) {
        let url: URL;
        try {
            url = new URL(imageUrl, baseUrl);
        } catch {
            return false;
        }
        const createdEntry: BackgroundUrlCacheEntry = {
            image: null,
            status: "loading",
            listeners: new Set(),
        };
        entry = createdEntry;
        if (onAsyncAssetReady) createdEntry.listeners.add(onAsyncAssetReady);
        lruSet(backgroundUrlCache, cacheKey, createdEntry, MAX_BG_URL_CACHE_ENTRIES);

        const img = new Image();
        if (url.protocol === "http:" || url.protocol === "https:") img.crossOrigin = "anonymous";
        const finalize = (success: boolean) => {
            img.onload = null;
            img.onerror = null;
            if (backgroundUrlCache.get(cacheKey) !== createdEntry) {
                createdEntry.listeners.clear();
                return;
            }
            if (success && img.naturalWidth > 0 && img.naturalHeight > 0) {
                createdEntry.image = img;
                createdEntry.status = "ready";
            } else {
                createdEntry.status = "error";
            }
            const callbacks = Array.from(createdEntry.listeners);
            createdEntry.listeners.clear();
            if (createdEntry.status === "ready") {
                for (let idx = 0; idx < callbacks.length; idx++) {
                    callbacks[idx]!();
                }
            }
        };
        img.onload = () => finalize(true);
        img.onerror = () => finalize(false);
        img.src = url.href;
        if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
            img.onload = null;
            img.onerror = null;
            createdEntry.image = img;
            createdEntry.status = "ready";
            createdEntry.listeners.clear();
        }
    } else if (entry.status === "loading" && onAsyncAssetReady) {
        entry.listeners.add(onAsyncAssetReady);
    }

    if (entry.status !== "ready" || !entry.image) {
        return false;
    }

    const img = entry.image;
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    if (natW <= 0 || natH <= 0 || width <= 0 || height <= 0) return false;

    const bgSizeRaw = pickCssLayerValue(style?.backgroundSize, layerIndex, "auto").toLowerCase();
    const bgPosParts = pickCssLayerValue(style?.backgroundPosition, layerIndex, "0% 0%").split(/\s+/);
    const natAspect = natW / natH;
    const boxAspect = width / height;

    let drawW = width;
    let drawH = height;
    if (bgSizeRaw === "cover") {
        if (natAspect > boxAspect) {
            drawH = height;
            drawW = height * natAspect;
        } else {
            drawW = width;
            drawH = width / natAspect;
        }
    } else if (bgSizeRaw === "contain") {
        if (natAspect > boxAspect) {
            drawW = width;
            drawH = width / natAspect;
        } else {
            drawH = height;
            drawW = height * natAspect;
        }
    } else if (bgSizeRaw && bgSizeRaw !== "auto") {
        const sizeParts = bgSizeRaw.split(/\s+/);
        const parseDim = (tok: string | undefined, ref: number): number | null => {
            if (!tok || tok === "auto") return null;
            const n = Number.parseFloat(tok);
            if (!Number.isFinite(n) || n <= 0) return null;
            return tok.endsWith("%") ? (n / 100) * ref : n;
        };
        const parsedW = parseDim(sizeParts[0], width);
        const parsedH = parseDim(sizeParts[1], height);
        if (parsedW !== null && parsedH !== null) {
            drawW = parsedW;
            drawH = parsedH;
        } else if (parsedW !== null) {
            drawW = parsedW;
            drawH = parsedW / natAspect;
        } else if (parsedH !== null) {
            drawH = parsedH;
            drawW = parsedH * natAspect;
        }
    }

    const posFracX = parseObjectPositionFraction(bgPosParts[0] ?? "50%", width, drawW);
    const posFracY = parseObjectPositionFraction(bgPosParts[1] ?? bgPosParts[0] ?? "50%", height, drawH);
    const drawX = x + (width - drawW) * posFracX;
    const drawY = y + (height - drawH) * posFracY;

    if (typeof ctx.save === "function" && typeof ctx.restore === "function" && typeof ctx.clip === "function") {
        ctx.save();
        if (!traceRoundedOrRectPath(ctx, x, y, width, height, radius)) {
            if (typeof ctx.beginPath === "function" && typeof ctx.rect === "function") {
                ctx.beginPath();
                ctx.rect(x, y, width, height);
            }
        }
        ctx.clip();
        try {
            ctx.drawImage(img, drawX, drawY, drawW, drawH);
        } catch {
        }
        ctx.restore();
    } else {
        try {
            ctx.drawImage(img, drawX, drawY, drawW, drawH);
        } catch {
        }
    }
    return true;
}

function drawBackgroundImageLayers(
    ctx: CanvasRenderingContext2D,
    backgroundImage: string,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: CornerRadii,
    style: CSSStyleDeclaration | null = null,
    onAsyncAssetReady?: () => void,
): void {
    const layers = getCachedBackgroundLayers(backgroundImage);
    for (let index = layers.length - 1; index >= 0; index--) {
        const layer = layers[index]!.trim();
        if (!layer || layer === "none") continue;
        if (layer.includes("linear-gradient(")) {
            drawLinearGradientBox(ctx, layer, x, y, width, height, radius);
        } else if (layer.includes("radial-gradient(")) {
            drawRadialGradientBox(ctx, layer, x, y, width, height, radius);
        } else if (layer.includes("conic-gradient(")) {
            drawConicGradientBox(ctx, layer, x, y, width, height, radius);
        } else if (layer.includes("url(")) {
            drawBackgroundUrlLayer(ctx, layer, style, x, y, width, height, radius, onAsyncAssetReady, index);
        }
    }
}

type TextBounds = Pick<DOMRect, "left" | "top" | "width" | "height">;

function getTextBounds(rects: DOMRectList): TextBounds | undefined {
    if (rects.length <= 1) return rects[0];
    const first = rects[0]!;
    let { left, top, right, bottom } = first;
    for (let index = 1; index < rects.length; index++) {
        const line = rects[index]!;
        left = Math.min(left, line.left);
        top = Math.min(top, line.top);
        right = Math.max(right, line.right);
        bottom = Math.max(bottom, line.bottom);
    }
    return { left, top, width: right - left, height: bottom - top };
}

function resolveTextFill(
    ctx: CanvasRenderingContext2D,
    style: CSSStyleDeclaration,
    rect: TextBounds,
    sourceRect: DOMRect,
): string | CanvasGradient {
    const clip =
        style.backgroundClip ||
        (style as CSSStyleDeclaration & { webkitBackgroundClip?: string }).webkitBackgroundClip;
    if (clip === "text" && style.backgroundImage.includes("linear-gradient(")) {
        const compiled = getCompiledLinearGradient(style.backgroundImage);
        if (compiled) {
            const left = rect.left - sourceRect.left;
            const top = rect.top - sourceRect.top;
            const width = rect.width;
            const height = rect.height;
            const lineLen = Math.max(1, Math.abs(width * compiled.dx) + Math.abs(height * compiled.dy));
            const halfLen = lineLen * 0.5;
            const cx = left + width * 0.5;
            const cy = top + height * 0.5;
            const gradient = ctx.createLinearGradient(
                cx - compiled.dx * halfLen,
                cy - compiled.dy * halfLen,
                cx + compiled.dx * halfLen,
                cy + compiled.dy * halfLen,
            );
            if (
                applyCompiledGradientStops(
                    gradient,
                    compiled.tokens,
                    compiled.preResolvedFractions,
                    lineLen,
                    compiled.isRepeating,
                )
            ) {
                return gradient;
            }
        }
    }
    return toCanvasCssColor(style.color);
}

function traceRoundedOrRectPath(
    ctx: CanvasRenderingContext2D,
    leftPx: number,
    topPx: number,
    widthPx: number,
    heightPx: number,
    radiusPx: CornerRadii,
): boolean {
    if (typeof ctx.roundRect !== "function") {
        return false;
    }
    const maxRadius = Math.min(widthPx, heightPx) * 0.5;
    if (typeof radiusPx === "number") {
        if (radiusPx <= 0.5) return false;
        ctx.beginPath();
        ctx.roundRect(leftPx, topPx, widthPx, heightPx, Math.min(radiusPx, maxRadius));
        return true;
    }
    if (Math.max(radiusPx[0], radiusPx[1], radiusPx[2], radiusPx[3]) <= 0.5) {
        return false;
    }
    ctx.beginPath();
    ctx.roundRect(leftPx, topPx, widthPx, heightPx, [
        Math.min(radiusPx[0], maxRadius),
        Math.min(radiusPx[1], maxRadius),
        Math.min(radiusPx[2], maxRadius),
        Math.min(radiusPx[3], maxRadius),
    ]);
    return true;
}

function fillRoundedOrRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: CornerRadii,
): void {
    if (traceRoundedOrRectPath(ctx, x, y, width, height, radius)) {
        ctx.fill();
    } else {
        ctx.fillRect(x, y, width, height);
    }
}

interface ParsedBoxShadow {
    inset: boolean;
    offsetX: number;
    offsetY: number;
    blur: number;
    spread: number;
    color: string;
}

const MAX_BOX_SHADOW_CACHE = 200;
const boxShadowCache = new Map<string, readonly ParsedBoxShadow[]>();
const EMPTY_BOX_SHADOWS: readonly ParsedBoxShadow[] = Object.freeze([]);

function isOverflowClipped(value: string): boolean {
    return value === "hidden" || value === "clip" || value === "auto" || value === "scroll";
}

function splitTopLevelWhitespace(text: string): string[] {
    const tokens: string[] = [];
    let depth = 0;
    let tokenStart = -1;
    for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        if (code === 40) {
            if (tokenStart < 0) tokenStart = index;
            depth++;
        } else if (code === 41) {
            if (tokenStart < 0) tokenStart = index;
            if (depth > 0) depth--;
        } else if (code <= 32 && depth === 0) {
            if (tokenStart >= 0) {
                tokens.push(text.slice(tokenStart, index));
                tokenStart = -1;
            }
        } else if (tokenStart < 0) {
            tokenStart = index;
        }
    }
    if (tokenStart >= 0) {
        tokens.push(text.slice(tokenStart));
    }
    return tokens;
}

function parseCssBoxShadows(boxShadowStr: string): readonly ParsedBoxShadow[] {
    if (!boxShadowStr || boxShadowStr === "none") return EMPTY_BOX_SHADOWS;
    const cached = lruGet(boxShadowCache, boxShadowStr);
    if (cached) return cached;

    const layers = splitTopLevelArgs(boxShadowStr);
    const parsed: ParsedBoxShadow[] = [];

    for (let index = 0; index < layers.length; index++) {
        const layer = layers[index].trim();
        if (!layer) continue;

        let inset = false;
        const lengths: number[] = [];
        let color = "rgba(0, 0, 0, 0.25)";

        const tokens = splitTopLevelWhitespace(layer);
        for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
            const token = tokens[tokenIndex]!;
            if (token.toLowerCase() === "inset") {
                inset = true;
            } else if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:px)?$/i.test(token)) {
                const value = Number.parseFloat(token);
                if (Number.isFinite(value)) lengths.push(value);
            } else {
                color = toCanvasCssColor(token);
            }
        }

        if (lengths.length >= 2) {
            parsed.push({
                inset,
                offsetX: lengths[0] ?? 0,
                offsetY: lengths[1] ?? 0,
                blur: Math.max(0, lengths[2] ?? 0),
                spread: lengths[3] ?? 0,
                color,
            });
        }
    }

    lruSet(boxShadowCache, boxShadowStr, parsed, MAX_BOX_SHADOW_CACHE);
    return parsed;
}

function drawBoxShadows(
    ctx: CanvasRenderingContext2D,
    shadows: readonly ParsedBoxShadow[],
    leftPx: number,
    topPx: number,
    widthPx: number,
    heightPx: number,
    radiusPx: CornerRadii,
    insetPass: boolean,
): void {
    if (typeof ctx.save !== "function" || typeof ctx.restore !== "function") return;
    for (let index = shadows.length - 1; index >= 0; index--) {
        const shadow = shadows[index];
        if (shadow.inset !== insetPass) continue;

        ctx.save();
        if (!insetPass) {
            const spreadW = widthPx + shadow.spread * 2;
            const spreadH = heightPx + shadow.spread * 2;
            if (spreadW <= 0 || spreadH <= 0) {
                ctx.restore();
                continue;
            }
            const spreadRadius = offsetCornerRadii(radiusPx, shadow.spread);
            const farOffset = Math.max(widthPx, heightPx, 4096) + 1024;
            ctx.shadowColor = shadow.color;
            ctx.shadowBlur = shadow.blur;
            ctx.shadowOffsetX = shadow.offsetX - farOffset;
            ctx.shadowOffsetY = shadow.offsetY;
            ctx.fillStyle = shadow.color;
            fillRoundedOrRect(
                ctx,
                leftPx - shadow.spread + farOffset,
                topPx - shadow.spread,
                spreadW,
                spreadH,
                spreadRadius,
            );
        } else {
            if (traceRoundedOrRectPath(ctx, leftPx, topPx, widthPx, heightPx, radiusPx)) {
                ctx.clip();
            } else {
                ctx.beginPath();
                ctx.rect(leftPx, topPx, widthPx, heightPx);
                ctx.clip();
            }
            const pad = Math.max(shadow.blur, Math.abs(shadow.spread), Math.abs(shadow.offsetX), Math.abs(shadow.offsetY)) + 32;
            const innerLeft = leftPx + shadow.spread;
            const innerTop = topPx + shadow.spread;
            const innerW = Math.max(0, widthPx - shadow.spread * 2);
            const innerH = Math.max(0, heightPx - shadow.spread * 2);
            const innerRadius = offsetCornerRadii(radiusPx, -shadow.spread);
            ctx.beginPath();
            ctx.rect(leftPx - pad, topPx - pad, widthPx + pad * 2, heightPx + pad * 2);
            if (innerW > 0 && innerH > 0) {
                const maxInnerR = Math.min(innerW, innerH) * 0.5;
                if (typeof innerRadius === "number") {
                    if (innerRadius > 0.5 && typeof ctx.roundRect === "function") {
                        ctx.roundRect(innerLeft, innerTop, innerW, innerH, Math.min(innerRadius, maxInnerR));
                    } else {
                        ctx.rect(innerLeft, innerTop, innerW, innerH);
                    }
                } else if (Math.max(...innerRadius) > 0.5 && typeof ctx.roundRect === "function") {
                    ctx.roundRect(innerLeft, innerTop, innerW, innerH, [
                        Math.min(innerRadius[0], maxInnerR),
                        Math.min(innerRadius[1], maxInnerR),
                        Math.min(innerRadius[2], maxInnerR),
                        Math.min(innerRadius[3], maxInnerR),
                    ]);
                } else {
                    ctx.rect(innerLeft, innerTop, innerW, innerH);
                }
            }
            ctx.shadowColor = shadow.color;
            ctx.shadowBlur = shadow.blur;
            ctx.shadowOffsetX = shadow.offsetX;
            ctx.shadowOffsetY = shadow.offsetY;
            ctx.fillStyle = shadow.color;
            ctx.fill("evenodd");
        }
        ctx.restore();
    }
}

function applyBorderLineDash(
    ctx: CanvasRenderingContext2D,
    borderStyle: string,
    lineWidth: number,
): void {
    if (typeof ctx.setLineDash !== "function") return;
    if (borderStyle === "dashed") {
        ctx.setLineDash([Math.max(2, lineWidth * 3), Math.max(2, lineWidth * 2)]);
    } else if (borderStyle === "dotted") {
        ctx.setLineDash([Math.max(1, lineWidth), Math.max(1, lineWidth)]);
    } else {
        ctx.setLineDash([]);
    }
}

function drawElementBorder(
    ctx: CanvasRenderingContext2D,
    style: CSSStyleDeclaration,
    leftPx: number,
    topPx: number,
    widthPx: number,
    heightPx: number,
    radiusPx: CornerRadii,
): void {
    if (typeof ctx.stroke !== "function") return;
    const hasBorderStyle = (value: string) => Boolean(value && value !== "none" && value !== "hidden");
    const topStyle = style.borderTopStyle;
    const rightStyle = style.borderRightStyle;
    const bottomStyle = style.borderBottomStyle;
    const leftStyle = style.borderLeftStyle;
    const topW = hasBorderStyle(topStyle) ? Number.parseFloat(style.borderTopWidth || "0") || 0 : 0;
    const rightW = hasBorderStyle(rightStyle) ? Number.parseFloat(style.borderRightWidth || "0") || 0 : 0;
    const bottomW = hasBorderStyle(bottomStyle) ? Number.parseFloat(style.borderBottomWidth || "0") || 0 : 0;
    const leftW = hasBorderStyle(leftStyle) ? Number.parseFloat(style.borderLeftWidth || "0") || 0 : 0;
    if (topW <= 0 && rightW <= 0 && bottomW <= 0 && leftW <= 0) return;

    const topColor = style.borderTopColor;
    const rightColor = style.borderRightColor;
    const bottomColor = style.borderBottomColor;
    const leftColor = style.borderLeftColor;

    const isUniform =
        topW === rightW &&
        topW === bottomW &&
        topW === leftW &&
        topStyle === rightStyle &&
        topStyle === bottomStyle &&
        topStyle === leftStyle &&
        topColor === rightColor &&
        topColor === bottomColor &&
        topColor === leftColor;

    if (isUniform && topW > 0) {
        if (!topColor || topColor === "transparent" || topColor === "rgba(0, 0, 0, 0)") return;
        const inset = topW * 0.5;
        const strokeW = Math.max(0, widthPx - topW);
        const strokeH = Math.max(0, heightPx - topW);
        if (strokeW <= 0 || strokeH <= 0) return;
        ctx.strokeStyle = toCanvasCssColor(topColor);
        ctx.lineWidth = topW;
        applyBorderLineDash(ctx, topStyle, topW);
        if (traceRoundedOrRectPath(ctx, leftPx + inset, topPx + inset, strokeW, strokeH, offsetCornerRadii(radiusPx, -inset))) {
            ctx.stroke();
        } else if (typeof ctx.strokeRect === "function") {
            ctx.strokeRect(leftPx + inset, topPx + inset, strokeW, strokeH);
        } else if (typeof ctx.beginPath === "function" && typeof ctx.rect === "function") {
            ctx.beginPath();
            ctx.rect(leftPx + inset, topPx + inset, strokeW, strokeH);
            ctx.stroke();
        }
        return;
    }

    if (typeof ctx.beginPath !== "function" || typeof ctx.moveTo !== "function" || typeof ctx.lineTo !== "function") {
        return;
    }
    const drawSide = (
        edgeW: number,
        edgeStyle: string,
        color: string,
        x1: number,
        y1: number,
        x2: number,
        y2: number,
    ) => {
        if (edgeW <= 0 || !color || color === "transparent" || color === "rgba(0, 0, 0, 0)") return;
        ctx.beginPath();
        ctx.strokeStyle = toCanvasCssColor(color);
        ctx.lineWidth = edgeW;
        applyBorderLineDash(ctx, edgeStyle, edgeW);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    };
    drawSide(topW, topStyle, topColor, leftPx, topPx + topW * 0.5, leftPx + widthPx, topPx + topW * 0.5);
    drawSide(rightW, rightStyle, rightColor, leftPx + widthPx - rightW * 0.5, topPx, leftPx + widthPx - rightW * 0.5, topPx + heightPx);
    drawSide(bottomW, bottomStyle, bottomColor, leftPx, topPx + heightPx - bottomW * 0.5, leftPx + widthPx, topPx + heightPx - bottomW * 0.5);
    drawSide(leftW, leftStyle, leftColor, leftPx + leftW * 0.5, topPx, leftPx + leftW * 0.5, topPx + heightPx);
}

function parseObjectPositionFraction(token: string, axisSize: number, contentSize: number): number {
    const trimmed = token.trim().toLowerCase();
    if (trimmed === "left" || trimmed === "top") return 0;
    if (trimmed === "right" || trimmed === "bottom") return 1;
    if (trimmed === "center" || !trimmed) return 0.5;
    if (trimmed.endsWith("%")) {
        const pct = Number.parseFloat(trimmed);
        return Number.isFinite(pct) ? pct / 100 : 0.5;
    }
    if (trimmed.endsWith("px") && axisSize !== contentSize) {
        const px = Number.parseFloat(trimmed);
        return Number.isFinite(px) ? px / (axisSize - contentSize) : 0.5;
    }
    return 0.5;
}

function drawMediaElementFitted(
    ctx: CanvasRenderingContext2D,
    media: HTMLImageElement | HTMLVideoElement,
    natW: number,
    natH: number,
    style: CSSStyleDeclaration,
    drawW: number,
    drawH: number,
): void {
    const fit = (style.objectFit || "fill").toLowerCase();
    if (fit === "fill" || natW <= 0 || natH <= 0 || drawW <= 0 || drawH <= 0) {
        ctx.drawImage(media, -drawW * 0.5, -drawH * 0.5, drawW, drawH);
        return;
    }

    const posParts = (style.objectPosition || "50% 50%").trim().split(/\s+/);
    const natAspect = natW / natH;
    const boxAspect = drawW / drawH;

    let renderedW = drawW;
    let renderedH = drawH;
    if (fit === "contain" || (fit === "scale-down" && (natW > drawW || natH > drawH))) {
        if (natAspect > boxAspect) {
            renderedW = drawW;
            renderedH = drawW / natAspect;
        } else {
            renderedH = drawH;
            renderedW = drawH * natAspect;
        }
    } else if (fit === "scale-down") {
        renderedW = natW;
        renderedH = natH;
    } else if (fit === "none") {
        renderedW = natW;
        renderedH = natH;
    } else if (fit === "cover") {
        if (natAspect > boxAspect) {
            renderedH = drawH;
            renderedW = drawH * natAspect;
        } else {
            renderedW = drawW;
            renderedH = drawW / natAspect;
        }
    }

    const fracX = parseObjectPositionFraction(posParts[0] ?? "50%", drawW, renderedW);
    const fracY = parseObjectPositionFraction(posParts[1] ?? posParts[0] ?? "50%", drawH, renderedH);
    const offsetLeft = (drawW - renderedW) * fracX;
    const offsetTop = (drawH - renderedH) * fracY;

    if (typeof ctx.beginPath === "function" && typeof ctx.rect === "function" && typeof ctx.clip === "function") {
        ctx.beginPath();
        ctx.rect(-drawW * 0.5, -drawH * 0.5, drawW, drawH);
        ctx.clip();
    }
    ctx.drawImage(media, -drawW * 0.5 + offsetLeft, -drawH * 0.5 + offsetTop, renderedW, renderedH);
}

interface SvgRasterEntry {
    hash: string;
    rawKey: string | null;
    image: HTMLImageElement | null;
    status: "loading" | "ready" | "error";
    listeners: Set<() => void>;
}

const svgRasterCache = new WeakMap<SVGSVGElement, SvgRasterEntry>();
let sharedXmlSerializer: XMLSerializer | null = null;

function drawInlineSvgElement(
    ctx: CanvasRenderingContext2D,
    svgEl: SVGSVGElement,
    style: CSSStyleDeclaration,
    leftPx: number,
    topPx: number,
    widthPx: number,
    heightPx: number,
    onAsyncReady?: () => void,
): void {
    if (
        typeof XMLSerializer === "undefined" ||
        typeof Image === "undefined" ||
        typeof URL === "undefined" ||
        typeof URL.createObjectURL !== "function"
    ) {
        return;
    }

    const existing = svgRasterCache.get(svgEl);
    const rawHtml = typeof svgEl.outerHTML === "string" ? svgEl.outerHTML : null;
    const rawKey = rawHtml !== null ? `${widthPx}x${heightPx}|${style.color || ""}|${rawHtml}` : null;
    if (existing && rawKey !== null && existing.rawKey === rawKey) {
        if (existing.status === "ready" && existing.image) {
            ctx.drawImage(existing.image, leftPx, topPx, widthPx, heightPx);
        } else if (existing.status === "loading" && onAsyncReady) {
            existing.listeners.add(onAsyncReady);
        }
        return;
    }

    let serialized: string;
    try {
        const clone = svgEl.cloneNode(true) as SVGSVGElement;
        if (!clone.getAttribute("xmlns")) {
            clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        }
        clone.setAttribute("width", String(widthPx));
        clone.setAttribute("height", String(heightPx));
        if (style.color && !clone.style.color) {
            clone.style.color = style.color;
        }
        sharedXmlSerializer ??= new XMLSerializer();
        serialized = sharedXmlSerializer.serializeToString(clone);
    } catch {
        return;
    }

    const hash = `${widthPx}x${heightPx}|${serialized}`;
    if (existing && existing.hash === hash) {
        existing.rawKey = rawKey;
        if (existing.status === "ready" && existing.image) {
            ctx.drawImage(existing.image, leftPx, topPx, widthPx, heightPx);
        } else if (existing.status === "loading" && onAsyncReady) {
            existing.listeners.add(onAsyncReady);
        }
        return;
    }

    const listeners = new Set<() => void>();
    if (onAsyncReady) listeners.add(onAsyncReady);
    const entry: SvgRasterEntry = {
        hash,
        rawKey,
        image: null,
        status: "loading",
        listeners,
    };
    svgRasterCache.set(svgEl, entry);

    const blob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    const img = new Image();
    const finalize = (success: boolean) => {
        img.onload = null;
        img.onerror = null;
        if (typeof URL.revokeObjectURL === "function") {
            try {
                URL.revokeObjectURL(blobUrl);
            } catch {
            }
        }
        if (svgRasterCache.get(svgEl) !== entry) {
            entry.listeners.clear();
            return;
        }
        const pendingListeners = Array.from(entry.listeners);
        entry.listeners.clear();
        if (success) {
            entry.image = img;
            entry.status = "ready";
            for (let idx = 0; idx < pendingListeners.length; idx++) {
                pendingListeners[idx]!();
            }
        } else {
            entry.status = "error";
        }
    };
    img.onload = () => finalize(true);
    img.onerror = () => finalize(false);
    img.src = blobUrl;
}

function intersectsClipBounds(
    left: number,
    top: number,
    width: number,
    height: number,
    clipMinX: number,
    clipMinY: number,
    clipMaxX: number,
    clipMaxY: number,
    marginPx = 0,
): boolean {
    return (
        width > 0 &&
        height > 0 &&
        left + width + marginPx > clipMinX &&
        left - marginPx < clipMaxX &&
        top + height + marginPx > clipMinY &&
        top - marginPx < clipMaxY
    );
}

const MAX_CAPTURE_DIM = 3072;
const MAX_CAPTURE_AREA = 8_388_608;
const ROUNDED_MIN_CAPTURE_SCALE = 2.5;
const ROUNDED_MAX_CAPTURE_SCALE = 3.5;
const UNROUNDED_MAX_CAPTURE_DIM = 256;
const UNROUNDED_CAPTURE_SCALE = 0.0625;

export interface SceneCaptureQualityOptions {
    pixelRatio?: number;
    radius?: number;
    sharpness?: number;
}

export function resolveCaptureDimensions(
    sourceWidth: number,
    sourceHeight: number,
    requestedPixelRatio?: number,
    radius?: number,
    sharpness?: number,
): { texWidth: number; texHeight: number } {
    const hasExplicitPixelRatio =
        typeof requestedPixelRatio === "number" &&
        Number.isFinite(requestedPixelRatio) &&
        requestedPixelRatio > 0;
    const safeSharpness =
        typeof sharpness === "number" && Number.isFinite(sharpness) && sharpness > 0
            ? Math.min(1, sharpness)
            : 0;
    const isUnrounded =
        !hasExplicitPixelRatio &&
        safeSharpness <= 0 &&
        typeof radius === "number" &&
        Number.isFinite(radius) &&
        radius <= 0;

    if (isUnrounded) {
        const desiredW = Math.max(32, Math.round(sourceWidth * UNROUNDED_CAPTURE_SCALE));
        const desiredH = Math.max(32, Math.round(sourceHeight * UNROUNDED_CAPTURE_SCALE));
        const dimScale = UNROUNDED_MAX_CAPTURE_DIM / Math.max(desiredW, desiredH);
        const fitScale = Math.min(1, dimScale);
        return {
            texWidth: Math.max(2, Math.round(desiredW * fitScale)),
            texHeight: Math.max(2, Math.round(desiredH * fitScale)),
        };
    }

    const autoDpr = automaticRoundedPixelRatio(ROUNDED_MIN_CAPTURE_SCALE, ROUNDED_MAX_CAPTURE_SCALE);
    const dprScale = hasExplicitPixelRatio
        ? Math.min(4, Math.max(0.5, requestedPixelRatio!))
        : safeSharpness > 0
          ? resolveSharpnessPixelRatio(safeSharpness, autoDpr)
          : autoDpr;
    const smallMemory = useSmallMemoryBudget();
    const maxDim =
        safeSharpness > 0
            ? smallMemory
                ? Math.round(SMALL_SCENE_DIMENSION + (4096 - SMALL_SCENE_DIMENSION) * safeSharpness)
                : 4096
            : smallMemory
              ? SMALL_SCENE_DIMENSION
              : hasExplicitPixelRatio
                ? 4096
                : MAX_CAPTURE_DIM;
    const maxArea =
        safeSharpness > 0
            ? Math.round(MAX_CAPTURE_AREA + (16_000_000 - MAX_CAPTURE_AREA) * safeSharpness)
            : hasExplicitPixelRatio
              ? 16_000_000
              : MAX_CAPTURE_AREA;
    const desiredW = Math.max(2, Math.round(sourceWidth * dprScale));
    const desiredH = Math.max(2, Math.round(sourceHeight * dprScale));
    const dimScale = maxDim / Math.max(desiredW, desiredH);
    const areaScale = Math.sqrt(maxArea / Math.max(1, desiredW * desiredH));
    const fitScale = Math.min(1, dimScale, areaScale);
    return {
        texWidth: Math.max(2, Math.round(desiredW * fitScale)),
        texHeight: Math.max(2, Math.round(desiredH * fitScale)),
    };
}

function isOpaqueBackground(color: string | undefined): boolean {
    if (!color || color === "rgba(0, 0, 0, 0)" || color === "transparent") return false;
    return parseCssColorToRgbaReadonly(color)?.[3] === 1;
}

function getCssColorLuminance(color: string | undefined): number | null {
    if (!color) return null;
    const parsed = parseCssColorToRgbaReadonly(color);
    if (parsed) {
        return 0.299 * parsed[0] + 0.587 * parsed[1] + 0.114 * parsed[2];
    }
    const match = color.trim().match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (!match) return null;
    const red = Number.parseFloat(match[1]) / 255;
    const green = Number.parseFloat(match[2]) / 255;
    const blue = Number.parseFloat(match[3]) / 255;
    if (!Number.isFinite(red) || !Number.isFinite(green) || !Number.isFinite(blue)) return null;
    return 0.299 * red + 0.587 * green + 0.114 * blue;
}

function isDarkColorScheme(source: HTMLElement, rootStyle: CSSStyleDeclaration): boolean {
    const scheme = (rootStyle.colorScheme || "").toLowerCase();
    if (scheme.includes("dark") && !scheme.startsWith("light")) return true;
    if (scheme.startsWith("light") && !scheme.includes("dark")) return false;
    const ancestorTheme = source.closest?.("[data-theme]")?.getAttribute("data-theme")?.trim().toLowerCase();
    if (ancestorTheme === "dark") return true;
    if (ancestorTheme === "light") return false;
    if (source.classList.contains("dark")) return true;
    if (source.classList.contains("light")) return false;
    if (typeof document !== "undefined") {
        const docEl = document.documentElement;
        const docScheme = (window.getComputedStyle(docEl).colorScheme || "").toLowerCase();
        if (docScheme.includes("dark") && !docScheme.startsWith("light")) return true;
        if (docScheme.startsWith("light") && !docScheme.includes("dark")) return false;
        if (
            docEl.classList.contains("dark") ||
            docEl.getAttribute("data-theme") === "dark" ||
            document.body?.classList.contains("dark") ||
            document.body?.getAttribute("data-theme") === "dark"
        ) {
            return true;
        }
        if (
            docEl.classList.contains("light") ||
            docEl.getAttribute("data-theme") === "light" ||
            document.body?.classList.contains("light") ||
            document.body?.getAttribute("data-theme") === "light"
        ) {
            return false;
        }
    }
    const inkLuma = getCssColorLuminance(rootStyle.color);
    if (inkLuma !== null) {
        if (inkLuma < 0.35) return false;
        if (inkLuma > 0.65) return true;
    }
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
        return Boolean(window.matchMedia("(prefers-color-scheme: dark)")?.matches);
    }
    return false;
}

export interface CaptureBackdropSource {
    canvas: HTMLCanvasElement;
    element?: HTMLElement | null;
}

export function captureDomToCanvas(
    source: HTMLElement,
    canvas: HTMLCanvasElement,
    range: Range,
    pixelRatio?: number,
    radius?: number,
    backdropOverride?: CaptureBackdropSource | null,
    onAsyncAssetReady?: () => void,
    sharpness?: number,
): boolean {
    const sourceRect = source.getBoundingClientRect();
    if (sourceRect.width < 2 || sourceRect.height < 2) return false;

    const { texWidth, texHeight } = resolveCaptureDimensions(
        sourceRect.width,
        sourceRect.height,
        pixelRatio,
        radius,
        sharpness,
    );
    resizeCanvas(canvas, texWidth, texHeight);

    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const rootStyle = window.getComputedStyle(source);
    const backdropLayers: Array<{ bgColor: string; bgImage: string; style: CSSStyleDeclaration }> = [];
    let cursor: HTMLElement | null = source;
    let foundOpaque = false;
    while (cursor) {
        const style = cursor === source ? rootStyle : window.getComputedStyle(cursor);
        const bgColor = style.backgroundColor;
        const bgImage = style.backgroundImage;
        const hasBgColor = Boolean(
            bgColor && bgColor !== "rgba(0, 0, 0, 0)" && bgColor !== "transparent",
        );
        const hasBgImage = Boolean(bgImage && bgImage !== "none");
        if (hasBgColor || hasBgImage) {
            backdropLayers.push({
                bgColor: hasBgColor ? bgColor : "",
                bgImage: hasBgImage ? bgImage : "",
                style,
            });
        }
        if (isOpaqueBackground(bgColor)) {
            foundOpaque = true;
            break;
        }
        cursor = cursor.parentElement;
    }

    const scaleX = texWidth / sourceRect.width;
    const scaleY = texHeight / sourceRect.height;

    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    ctx.globalAlpha = 1;
    if (!foundOpaque) {
        ctx.fillStyle = isDarkColorScheme(source, rootStyle) ? "#0b0f19" : "#f3f2f6";
        ctx.fillRect(0, 0, sourceRect.width, sourceRect.height);
    }
    for (let index = backdropLayers.length - 1; index >= 0; index--) {
        const layer = backdropLayers[index];
        if (layer.bgColor) {
            ctx.fillStyle = toCanvasCssColor(layer.bgColor);
            ctx.fillRect(0, 0, sourceRect.width, sourceRect.height);
        }
        if (layer.bgImage) {
            drawBackgroundImageLayers(
                ctx,
                layer.bgImage,
                0,
                0,
                sourceRect.width,
                sourceRect.height,
                0,
                layer.style,
                onAsyncAssetReady,
            );
        }
    }

    if (
        backdropOverride?.canvas &&
        backdropOverride.canvas.width > 0 &&
        backdropOverride.canvas.height > 0
    ) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const overrideCanvas = backdropOverride.canvas;
        const overrideElement = backdropOverride.element;
        if (overrideElement?.isConnected) {
            const overrideRect = overrideElement.getBoundingClientRect();
            if (overrideRect.width >= 2 && overrideRect.height >= 2) {
                const overlapLeft = Math.max(sourceRect.left, overrideRect.left);
                const overlapTop = Math.max(sourceRect.top, overrideRect.top);
                const overlapRight = Math.min(sourceRect.right, overrideRect.right);
                const overlapBottom = Math.min(sourceRect.bottom, overrideRect.bottom);
                if (overlapRight > overlapLeft && overlapBottom > overlapTop) {
                    const srcX =
                        ((overlapLeft - overrideRect.left) / overrideRect.width) * overrideCanvas.width;
                    const srcY =
                        ((overlapTop - overrideRect.top) / overrideRect.height) * overrideCanvas.height;
                    const srcW =
                        ((overlapRight - overlapLeft) / overrideRect.width) * overrideCanvas.width;
                    const srcH =
                        ((overlapBottom - overlapTop) / overrideRect.height) * overrideCanvas.height;
                    const dstX = ((overlapLeft - sourceRect.left) / sourceRect.width) * texWidth;
                    const dstY = ((overlapTop - sourceRect.top) / sourceRect.height) * texHeight;
                    const dstW = ((overlapRight - overlapLeft) / sourceRect.width) * texWidth;
                    const dstH = ((overlapBottom - overlapTop) / sourceRect.height) * texHeight;
                    ctx.drawImage(overrideCanvas, srcX, srcY, srcW, srcH, dstX, dstY, dstW, dstH);
                }
            }
        } else if (!overrideElement) {
            ctx.drawImage(overrideCanvas, 0, 0, texWidth, texHeight);
        }
        ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    }

    let clipMinX = 0;
    let clipMinY = 0;
    let clipMaxX = sourceRect.width;
    let clipMaxY = sourceRect.height;
    let currentOpacity = 1;
    let textLayouts: SceneTextLayouts | null | undefined;

    const POP_CLIP_SENTINEL = 0 as const;
    const POP_OPACITY_SENTINEL = 1 as const;
    const stack: Array<Element | typeof POP_CLIP_SENTINEL | typeof POP_OPACITY_SENTINEL> = [source];
    const clipRestoreBounds: number[] = [];
    const opacityRestoreStack: number[] = [];
    while (stack.length > 0) {
        const entry = stack.pop()!;
        if (entry === POP_CLIP_SENTINEL) {
            ctx.restore();
            clipMaxY = clipRestoreBounds.pop()!;
            clipMaxX = clipRestoreBounds.pop()!;
            clipMinY = clipRestoreBounds.pop()!;
            clipMinX = clipRestoreBounds.pop()!;
            continue;
        }
        if (entry === POP_OPACITY_SENTINEL) {
            currentOpacity = opacityRestoreStack.pop()!;
            continue;
        }
        const element = entry;
        if (element !== source) {
            const tagName = element.tagName;
            if (
                tagName === "SCRIPT" ||
                tagName === "STYLE" ||
                tagName === "NOSCRIPT" ||
                tagName === "TEMPLATE" ||
                tagName === "LINK" ||
                tagName === "META" ||
                tagName === "HEAD" ||
                element.hasAttribute("data-lg-surface") ||
                element.hasAttribute("hidden")
            ) {
                continue;
            }
        }

        const style = element === source ? rootStyle : window.getComputedStyle(element);
        if (style.display === "none") continue;
        const rawOwnOpacity = element === source ? 1 : Number.parseFloat(style.opacity || "1");
        const ownOpacity = Number.isFinite(rawOwnOpacity) ? Math.min(1, Math.max(0, rawOwnOpacity)) : 1;
        const opacity = currentOpacity * ownOpacity;
        if (element !== source && (style.visibility === "hidden" || !(opacity > 0.01))) continue;

        let elementRect = element === source ? sourceRect : undefined;

        if (element !== source) {
            const bgColor = style.backgroundColor;
            const bgImage = style.backgroundImage;
            const boxShadowRaw = style.boxShadow;
            const hasSolidColor = Boolean(
                bgColor && bgColor !== "rgba(0, 0, 0, 0)" && bgColor !== "transparent",
            );
            const hasBgImage = Boolean(bgImage && bgImage !== "none");
            const hasGradientCandidate =
                hasBgImage && (bgImage.includes("gradient(") || bgImage.includes("url("));

            let hasSolidBg = hasSolidColor;
            let hasGradientBg = hasGradientCandidate;
            if (hasSolidColor || hasGradientCandidate) {
                const clip =
                    style.backgroundClip ||
                    (style as CSSStyleDeclaration & { webkitBackgroundClip?: string }).webkitBackgroundClip;
                if (clip === "text") {
                    hasSolidBg = false;
                    hasGradientBg = false;
                }
            }

            const parsedShadows =
                boxShadowRaw && boxShadowRaw !== "none" ? parseCssBoxShadows(boxShadowRaw) : EMPTY_BOX_SHADOWS;
            const btW = style.borderTopWidth;
            const brW = style.borderRightWidth;
            const bbW = style.borderBottomWidth;
            const blW = style.borderLeftWidth;
            const hasBorder =
                (btW !== "0px" && btW !== "" && btW !== "0" && style.borderTopStyle !== "none" && style.borderTopStyle !== "hidden" && (Number.parseFloat(btW) || 0) > 0) ||
                (brW !== "0px" && brW !== "" && brW !== "0" && style.borderRightStyle !== "none" && style.borderRightStyle !== "hidden" && (Number.parseFloat(brW) || 0) > 0) ||
                (bbW !== "0px" && bbW !== "" && bbW !== "0" && style.borderBottomStyle !== "none" && style.borderBottomStyle !== "hidden" && (Number.parseFloat(bbW) || 0) > 0) ||
                (blW !== "0px" && blW !== "" && blW !== "0" && style.borderLeftStyle !== "none" && style.borderLeftStyle !== "hidden" && (Number.parseFloat(blW) || 0) > 0);

            if (hasSolidBg || hasGradientBg || parsedShadows.length > 0 || hasBorder) {
                const bgRect = elementRect ??= element.getBoundingClientRect();
                const left = bgRect.left - sourceRect.left;
                const top = bgRect.top - sourceRect.top;
                const blurPx = parseCssBlurPx(style.filter);
                let shadowMargin = blurPx * 2;
                for (let index = 0; index < parsedShadows.length; index++) {
                    const shadowItem = parsedShadows[index];
                    if (!shadowItem.inset) {
                        shadowMargin = Math.max(
                            shadowMargin,
                            shadowItem.blur * 2 + shadowItem.spread + Math.max(Math.abs(shadowItem.offsetX), Math.abs(shadowItem.offsetY)),
                        );
                    }
                }
                if (
                    intersectsClipBounds(
                        left,
                        top,
                        bgRect.width,
                        bgRect.height,
                        clipMinX,
                        clipMinY,
                        clipMaxX,
                        clipMaxY,
                        shadowMargin,
                    )
                ) {
                    const cornerRadii = parseElementCornerRadii(
                        style,
                        bgRect.width,
                        bgRect.height,
                    );
                    ctx.save();
                    ctx.globalAlpha = opacity;
                    if (blurPx > 0 && "filter" in ctx) {
                        ctx.filter = `blur(${blurPx}px)`;
                    }
                    if (parsedShadows.length > 0) {
                        drawBoxShadows(ctx, parsedShadows, left, top, bgRect.width, bgRect.height, cornerRadii, false);
                    }
                    if (hasSolidBg) {
                        ctx.fillStyle = toCanvasCssColor(bgColor);
                        fillRoundedOrRect(ctx, left, top, bgRect.width, bgRect.height, cornerRadii);
                    }
                    if (hasGradientBg) {
                        drawBackgroundImageLayers(
                            ctx,
                            bgImage,
                            left,
                            top,
                            bgRect.width,
                            bgRect.height,
                            cornerRadii,
                            style,
                            onAsyncAssetReady,
                        );
                    }
                    if (parsedShadows.length > 0) {
                        drawBoxShadows(ctx, parsedShadows, left, top, bgRect.width, bgRect.height, cornerRadii, true);
                    }
                    if (hasBorder) {
                        drawElementBorder(ctx, style, left, top, bgRect.width, bgRect.height, cornerRadii);
                    }
                    ctx.restore();
                }
            }
        }

        const overflow = style.overflow || "";
        const overflowSeparator = overflow.indexOf(" ");
        const clipsX = element !== source && isOverflowClipped(style.overflowX ||
            (overflowSeparator < 0 ? overflow : overflow.slice(0, overflowSeparator)));
        const clipsY = element !== source && isOverflowClipped(style.overflowY ||
            (overflowSeparator < 0 ? overflow : overflow.slice(overflowSeparator + 1)));
        const clipsOverflow = clipsX || clipsY;
        let clippedNextMinX = clipMinX;
        let clippedNextMinY = clipMinY;
        let clippedNextMaxX = clipMaxX;
        let clippedNextMaxY = clipMaxY;
        if (clipsOverflow) {
            const clipRect = elementRect ??= element.getBoundingClientRect();
            const clipLeft = clipRect.left - sourceRect.left;
            const clipTop = clipRect.top - sourceRect.top;
            if (clipsX) {
                clippedNextMinX = Math.max(clipMinX, clipLeft);
                clippedNextMaxX = Math.min(clipMaxX, clipLeft + clipRect.width);
            }
            if (clipsY) {
                clippedNextMinY = Math.max(clipMinY, clipTop);
                clippedNextMaxY = Math.min(clipMaxY, clipTop + clipRect.height);
            }
            if (clippedNextMaxX <= clippedNextMinX || clippedNextMaxY <= clippedNextMinY) {
                continue;
            }
        }

        const isInlineSvg = typeof SVGSVGElement !== "undefined" && element instanceof SVGSVGElement;
        const isCanvasEl = typeof HTMLCanvasElement !== "undefined" && element instanceof HTMLCanvasElement;
        const isVideoEl = typeof HTMLVideoElement !== "undefined" && element instanceof HTMLVideoElement;
        const readyImg =
            element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0
                ? element
                : null;
        const readyVideo =
            !readyImg &&
            isVideoEl &&
            element.readyState >= 2 &&
            element.videoWidth > 0 &&
            element.videoHeight > 0
                ? element
                : null;
        const readyMedia = readyImg ?? readyVideo;

        if (readyMedia) {
            const natW = readyImg ? readyImg.naturalWidth : readyVideo!.videoWidth;
            const natH = readyImg ? readyImg.naturalHeight : readyVideo!.videoHeight;
            const mediaRect = elementRect ??= element.getBoundingClientRect();
            const mediaLeft = mediaRect.left - sourceRect.left;
            const mediaTop = mediaRect.top - sourceRect.top;
            if (
                intersectsClipBounds(
                    mediaLeft,
                    mediaTop,
                    mediaRect.width,
                    mediaRect.height,
                    clipMinX,
                    clipMinY,
                    clipMaxX,
                    clipMaxY,
                )
            ) {
                const baseW = (element as HTMLElement).offsetWidth || mediaRect.width;
                const baseH = (element as HTMLElement).offsetHeight || mediaRect.height;
                const cx = mediaLeft + mediaRect.width * 0.5;
                const cy = mediaTop + mediaRect.height * 0.5;
                const mediaCornerRadii = parseElementCornerRadii(style, baseW, baseH);
                const hasMediaCornerRadius =
                    typeof mediaCornerRadii === "number"
                        ? mediaCornerRadii > 0.5
                        : Math.max(
                              mediaCornerRadii[0],
                              mediaCornerRadii[1],
                              mediaCornerRadii[2],
                              mediaCornerRadii[3],
                          ) > 0.5;
                ctx.save();
                ctx.globalAlpha = opacity;
                ctx.translate(cx, cy);
                const transformStr = style.transform;
                if (transformStr && transformStr !== "none") {
                    if (transformStr.startsWith("matrix(") && transformStr.endsWith(")")) {
                        const comma1 = transformStr.indexOf(",", 7);
                        const comma2 = comma1 >= 0 ? transformStr.indexOf(",", comma1 + 1) : -1;
                        const comma3 = comma2 >= 0 ? transformStr.indexOf(",", comma2 + 1) : -1;
                        const comma4 = comma3 >= 0 ? transformStr.indexOf(",", comma3 + 1) : -1;
                        if (comma4 >= 0) {
                            const ma = Number.parseFloat(transformStr.slice(7, comma1));
                            const mb = Number.parseFloat(transformStr.slice(comma1 + 1, comma2));
                            const mc = Number.parseFloat(transformStr.slice(comma2 + 1, comma3));
                            const md = Number.parseFloat(transformStr.slice(comma3 + 1, comma4));
                            if (Number.isFinite(ma) && Number.isFinite(mb) && Number.isFinite(mc) && Number.isFinite(md)) {
                                ctx.transform(ma, mb, mc, md, 0, 0);
                            }
                        }
                    } else if (typeof DOMMatrixReadOnly === "function") {
                        try {
                            const matrix = new DOMMatrixReadOnly(transformStr);
                            ctx.transform(matrix.a, matrix.b, matrix.c, matrix.d, 0, 0);
                        } catch {
                        }
                    }
                }
                if (
                    hasMediaCornerRadius &&
                    traceRoundedOrRectPath(ctx, -baseW * 0.5, -baseH * 0.5, baseW, baseH, mediaCornerRadii)
                ) {
                    ctx.clip();
                }
                try {
                    drawMediaElementFitted(ctx, element as HTMLImageElement | HTMLVideoElement, natW, natH, style, baseW, baseH);
                } catch {
                }
                ctx.restore();
            }
        } else if (isInlineSvg) {
            const svgRect = elementRect ??= element.getBoundingClientRect();
            const svgLeft = svgRect.left - sourceRect.left;
            const svgTop = svgRect.top - sourceRect.top;
            if (
                intersectsClipBounds(
                    svgLeft,
                    svgTop,
                    svgRect.width,
                    svgRect.height,
                    clipMinX,
                    clipMinY,
                    clipMaxX,
                    clipMaxY,
                )
            ) {
                ctx.save();
                ctx.globalAlpha = opacity;
                drawInlineSvgElement(
                    ctx,
                    element,
                    style,
                    svgLeft,
                    svgTop,
                    svgRect.width,
                    svgRect.height,
                    onAsyncAssetReady,
                );
                ctx.restore();
            }
        } else if (isCanvasEl) {
            if (
                element !== canvas &&
                !element.classList.contains("lg-webgl-canvas") &&
                element.width > 0 &&
                element.height > 0
            ) {
                const canvasRect = elementRect ??= element.getBoundingClientRect();
                const canvasLeft = canvasRect.left - sourceRect.left;
                const canvasTop = canvasRect.top - sourceRect.top;
                if (
                    intersectsClipBounds(
                        canvasLeft,
                        canvasTop,
                        canvasRect.width,
                        canvasRect.height,
                        clipMinX,
                        clipMinY,
                        clipMaxX,
                        clipMaxY,
                    )
                ) {
                    ctx.save();
                    ctx.globalAlpha = opacity;
                    const canvasCornerRadii = parseElementCornerRadii(
                        style,
                        canvasRect.width,
                        canvasRect.height,
                    );
                    if (
                        typeof ctx.clip === "function" &&
                        traceRoundedOrRectPath(
                            ctx,
                            canvasLeft,
                            canvasTop,
                            canvasRect.width,
                            canvasRect.height,
                            canvasCornerRadii,
                        )
                    ) {
                        ctx.clip();
                    }
                    try {
                        ctx.drawImage(
                            element,
                            canvasLeft,
                            canvasTop,
                            canvasRect.width,
                            canvasRect.height,
                        );
                    } catch {
                    }
                    ctx.restore();
                }
            }
        } else if (!isVideoEl) {
            if (clipsOverflow && element.firstChild !== null) {
                const clipRect = elementRect!;
                if (
                    typeof ctx.save === "function" &&
                    typeof ctx.restore === "function" &&
                    typeof ctx.clip === "function"
                ) {
                    ctx.save();
                    const traced = clipsX && clipsY && traceRoundedOrRectPath(
                        ctx,
                        clipRect.left - sourceRect.left,
                        clipRect.top - sourceRect.top,
                        clipRect.width,
                        clipRect.height,
                        parseElementCornerRadii(style, clipRect.width, clipRect.height),
                    );
                    if (!traced && typeof ctx.beginPath === "function" && typeof ctx.rect === "function") {
                        ctx.beginPath();
                        ctx.rect(
                            clippedNextMinX, clippedNextMinY,
                            clippedNextMaxX - clippedNextMinX, clippedNextMaxY - clippedNextMinY,
                        );
                    }
                    ctx.clip();
                    clipRestoreBounds.push(clipMinX, clipMinY, clipMaxX, clipMaxY);
                    stack.push(POP_CLIP_SENTINEL);
                    clipMinX = clippedNextMinX;
                    clipMinY = clippedNextMinY;
                    clipMaxX = clippedNextMaxX;
                    clipMaxY = clippedNextMaxY;
                }
            }
            for (let node = element.firstChild; node; node = node.nextSibling) {
                if (node.nodeType !== Node.TEXT_NODE || !node.textContent) continue;
                const rawText = node.textContent;
                let start = 0;
                let end = rawText.length;
                while (start < end && rawText.charCodeAt(start) <= 32) start++;
                if (start === end) continue;
                while (end > start && rawText.charCodeAt(end - 1) <= 32) end--;

                range.setStart(node, start);
                range.setEnd(node, end);
                const rects = range.getClientRects?.();
                const textRect = rects ? getTextBounds(rects) : range.getBoundingClientRect?.();
                if (!textRect) continue;
                const textLeft = textRect.left - sourceRect.left;
                const textTop = textRect.top - sourceRect.top;
                if (!intersectsClipBounds(
                    textLeft, textTop, textRect.width, textRect.height,
                    clipMinX, clipMinY, clipMaxX, clipMaxY,
                )) continue;

                let content = start === 0 && end === rawText.length ? rawText : rawText.slice(start, end);
                if (style.textTransform === "uppercase") {
                    content = content.toUpperCase();
                } else if (style.textTransform === "lowercase") {
                    content = content.toLowerCase();
                } else if (style.textTransform === "capitalize") {
                    content = content.replace(/\b\w/g, (ch) => ch.toUpperCase());
                }

                ctx.save();
                ctx.globalAlpha = opacity;
                ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
                applyLetterSpacing(ctx, style.letterSpacing);
                ctx.fillStyle = resolveTextFill(ctx, style, textRect, sourceRect);
                ctx.textBaseline = "middle";
                ctx.textAlign = "left";
                if (!rects || rects.length === 1) {
                    ctx.fillText(content, textLeft, textTop + textRect.height * 0.5);
                } else {
                    if (textLayouts === undefined) textLayouts = prepareSceneTextLayouts(canvas, ctx);
                    const lines = resolveWrappedTextLines(textLayouts, ctx, node, content, style.whiteSpace, rects);
                    const allLinesVisible = textLeft >= clipMinX && textTop >= clipMinY &&
                        textLeft + textRect.width <= clipMaxX && textTop + textRect.height <= clipMaxY;
                    for (let index = 0; index < lines.length; index++) {
                        const text = lines[index];
                        if (text === undefined) continue;
                        const line = rects[index]!;
                        const left = line.left - sourceRect.left;
                        const top = line.top - sourceRect.top;
                        // Allow for glyphs that overhang the measured line box.
                        if (allLinesVisible || intersectsClipBounds(
                            left, top, line.width, line.height,
                            clipMinX, clipMinY, clipMaxX, clipMaxY, line.height,
                        )) {
                            ctx.fillText(text, left, top + line.height * 0.5);
                        }
                    }
                }
                ctx.restore();
            }
        }

        if (isInlineSvg || isCanvasEl || isVideoEl) {
            continue;
        }

        let child = element.lastElementChild;
        if (child) {
            if (opacity !== currentOpacity) {
                opacityRestoreStack.push(currentOpacity);
                stack.push(POP_OPACITY_SENTINEL);
                currentOpacity = opacity;
            }
            while (child) {
                stack.push(child as HTMLElement);
                child = child.previousElementSibling;
            }
        }
    }

    return true;
}

function isSvgFilterContainer(node: Node): boolean {
    if (node.nodeType !== 1) return false;
    const element = node as Element;
    return element.id === "svg-defs" ||
        (element.localName === "svg" && element.childElementCount === 1 && element.firstElementChild?.id === "svg-defs");
}

type SceneCaptureListener = (canvas: HTMLCanvasElement, source: HTMLElement) => void;
const sceneCanvasListeners = new WeakMap<HTMLCanvasElement, Set<SceneCaptureListener>>();

// A capture reuses its canvas. Consumers of those pixels can listen without replacing the canvas.
export function subscribeSceneCanvas(
    canvas: HTMLCanvasElement,
    listener: SceneCaptureListener,
): (() => void) | null {
    const listeners = sceneCanvasListeners.get(canvas);
    if (!listeners) return null;
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function createSceneCaptureController(
    sourceElement: HTMLElement,
    getQualityOptions?: () => number | SceneCaptureQualityOptions | undefined,
): SceneCaptureController {
    const listeners = new Set<SceneCaptureListener>();
    const doc = sourceElement.ownerDocument;
    let captureCanvas: HTMLCanvasElement | null = doc.createElement("canvas");
    resizeCanvas(captureCanvas, 0, 0);
    sceneCanvasListeners.set(captureCanvas, listeners);
    const minObserverDelayMs = 100;
    const maxObserverDelayMs = 500;
    let observerDelayMs = minObserverDelayMs;
    const now = () => typeof performance !== "undefined" ? performance.now() : Date.now();
    let hasCaptured = false;
    let captureFrame: number | null = null;
    let recaptureTimer: ReturnType<typeof setTimeout> | null = null;
    let lastCaptureAt = -Infinity;
    let isActive = true;
    let pendingWhileInactive = false;
    let disposed = false;

    const range = doc.createRange();

    const clearPendingSchedule = () => {
        if (captureFrame !== null && typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(captureFrame);
            captureFrame = null;
        }
        if (recaptureTimer !== null) {
            clearTimeout(recaptureTimer);
            recaptureTimer = null;
        }
    };

    const performCapture = () => {
        captureFrame = null;
        const canvas = captureCanvas;
        if (disposed || !canvas) return;
        if (!isActive || doc.hidden) {
            pendingWhileInactive = true;
            return;
        }
        const startedAt = now();
        const resolved = getQualityOptions?.();
        const pixelRatio = typeof resolved === "number" ? resolved : resolved?.pixelRatio;
        const radius = typeof resolved === "number" ? undefined : resolved?.radius;
        const sharpness = typeof resolved === "number" ? undefined : resolved?.sharpness;
        const captured =
            sourceElement.isConnected && captureDomToCanvas(
                sourceElement,
                canvas,
                range,
                pixelRatio,
                radius,
                null,
                scheduleObserverCapture,
                sharpness,
            );
        if (captured) {
            lastCaptureAt = now();
            observerDelayMs = Math.min(maxObserverDelayMs, Math.max(
                minObserverDelayMs, (lastCaptureAt - startedAt) * 9, observerDelayMs * 0.5,
            ));
        } else {
            resizeCanvas(canvas, 0, 0);
            if (!hasCaptured) return;
        }
        hasCaptured = captured;
        for (const listener of listeners) {
            listener(canvas, sourceElement);
        }
    };

    const scheduleCapture = () => {
        if (disposed) return;
        if (!isActive || doc.hidden) {
            pendingWhileInactive = true;
            return;
        }
        if (recaptureTimer !== null) {
            clearTimeout(recaptureTimer);
            recaptureTimer = null;
        }
        if (captureFrame !== null || typeof requestAnimationFrame !== "function") return;
        captureFrame = requestAnimationFrame(performCapture);
    };

    const scheduleObserverCapture = () => {
        if (disposed) return;
        if (!isActive || doc.hidden) {
            pendingWhileInactive = true;
            return;
        }
        if (!hasCaptured) {
            scheduleCapture();
            return;
        }
        if (captureFrame !== null || recaptureTimer !== null) return;
        const elapsed = now() - lastCaptureAt;
        if (elapsed >= observerDelayMs) {
            scheduleCapture();
            return;
        }
        recaptureTimer = setTimeout(() => {
            recaptureTimer = null;
            scheduleCapture();
        }, observerDelayMs - elapsed);
    };

    const handleVisibilityChange = () => {
        if (disposed) return;
        if (doc.hidden) {
            if (captureFrame !== null || recaptureTimer !== null) {
                clearPendingSchedule();
                pendingWhileInactive = true;
            }
            return;
        }
        if (isActive && (pendingWhileInactive || !hasCaptured)) {
            pendingWhileInactive = false;
            scheduleCapture();
        }
    };

    const setActive = (active: boolean) => {
        if (disposed || isActive === active) return;
        isActive = active;
        if (!active) {
            if (captureFrame !== null || recaptureTimer !== null) {
                clearPendingSchedule();
                pendingWhileInactive = true;
            }
            return;
        }
        if (pendingWhileInactive || !hasCaptured) {
            pendingWhileInactive = false;
            scheduleCapture();
        }
    };

    let mutationObserver: MutationObserver | null = null;
    if (typeof MutationObserver === "function") {
        mutationObserver = new MutationObserver((records) => {
            const isSliderRoot = sourceElement.classList.contains("lg-slider");
            const excludedSelector = isSliderRoot ? "[data-lg-surface]" : "[data-lg-surface], .lg-slider";
            let hasSceneMutation = false;
            let hasImmediateThemeMutation = false;
            for (let index = 0; index < records.length; index++) {
                const record = records[index]!;
                const target = record.target;
                // A newly marked glass surface needs to be removed from the existing snapshot.
                const element = target.nodeType === 1 && record.attributeName !== "data-lg-surface"
                    ? target as Element
                    : target.parentElement;
                const excluded = element?.closest(excludedSelector);
                if (element?.closest("#svg-defs") ||
                    (excluded && excluded !== sourceElement && sourceElement.contains(excluded))) {
                    continue;
                }
                if (
                    record.type === "childList" &&
                    record.removedNodes.length === 0 &&
                    record.addedNodes.length > 0 &&
                    Array.prototype.every.call(record.addedNodes, isSvgFilterContainer)
                ) {
                    continue;
                }
                if (
                    target === sourceElement &&
                    (record.attributeName === "style" || record.attributeName === "class") &&
                    sourceElement.classList.contains("lg-switch") &&
                    (sourceElement.classList.contains("is-dragging") ||
                        sourceElement.classList.contains("is-animating") ||
                        sourceElement.classList.contains("is-pressed"))
                ) {
                    continue;
                }
                hasSceneMutation = true;
                if (
                    record.type === "attributes" &&
                    (record.attributeName === "data-theme" ||
                        record.attributeName === "data-color-scheme")
                ) {
                    hasImmediateThemeMutation = true;
                    break;
                }
            }
            if (hasImmediateThemeMutation) {
                scheduleCapture();
            } else if (hasSceneMutation) {
                scheduleObserverCapture();
            }
        });
        mutationObserver.observe(sourceElement, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
        });
    }

    const unobserveResize = observeSharedElementResize(sourceElement, scheduleObserverCapture);

    const handleSceneContentEvent = (event: Event) => {
        const target = event.target as Element | null;
        if (target?.nodeType === 1 && target !== sourceElement) {
            const glassSurface = target.closest("[data-lg-surface]");
            if (glassSurface && glassSurface !== sourceElement && sourceElement.contains(glassSurface)) return;
        }
        scheduleObserverCapture();
    };
    sourceElement.addEventListener("load", handleSceneContentEvent, true);
    sourceElement.addEventListener("loadeddata", handleSceneContentEvent, true);
    sourceElement.addEventListener("seeked", handleSceneContentEvent, true);
    sourceElement.addEventListener("scroll", handleSceneContentEvent, { capture: true, passive: true });
    const unsubscribeDocumentSignals = subscribeSceneCaptureSignals({
        source: sourceElement,
        scheduleCapture,
        scheduleObserverCapture,
        handleVisibilityChange,
    });

    scheduleCapture();

    return {
        get canvas() {
            return hasCaptured ? captureCanvas : null;
        },
        get source() {
            return sourceElement;
        },
        subscribe(listener) {
            if (disposed) return () => {};
            listeners.add(listener);
            if (hasCaptured && captureCanvas && captureCanvas.width > 0 && sourceElement.isConnected) {
                listener(captureCanvas, sourceElement);
            }
            return () => {
                listeners.delete(listener);
            };
        },
        scheduleCapture,
        setActive,
        destroy() {
            if (disposed) return;
            disposed = true;
            listeners.clear();
            mutationObserver?.disconnect();
            unobserveResize();
            unsubscribeDocumentSignals();
            sourceElement.removeEventListener("load", handleSceneContentEvent, true);
            sourceElement.removeEventListener("loadeddata", handleSceneContentEvent, true);
            sourceElement.removeEventListener("seeked", handleSceneContentEvent, true);
            sourceElement.removeEventListener("scroll", handleSceneContentEvent, true);
            clearPendingSchedule();
            range.collapse(true);
            if (captureCanvas) {
                sceneCanvasListeners.delete(captureCanvas);
                captureCanvas.width = 0;
                captureCanvas.height = 0;
                captureCanvas = null;
            }
        },
    };
}

interface SharedCaptureSubscription {
    listener: SceneCaptureListener;
    deliveredRevision: number;
}

interface SharedCaptureLease {
    getQuality?: () => number | undefined | SceneCaptureQualityOptions;
    active: boolean;
}

interface SharedSceneCaptureEntry {
    controller: SceneCaptureController;
    leases: Set<SharedCaptureLease>;
    activeSubscriptions: Set<SharedCaptureSubscription>;
    revision: number;
    latestCanvas: HTMLCanvasElement | null;
    lastMaxPixelRatio: number;
    lastHasRounded: boolean;
    lastMaxSharpness: number;
}

const sharedSceneCaptures = new WeakMap<HTMLElement, SharedSceneCaptureEntry>();

function evaluateLeaseQuality(lease: SharedCaptureLease): { pixelRatio?: number; radius: number; sharpness: number } {
    const raw = lease.getQuality?.();
    const pixelRatio = typeof raw === "number" ? raw : raw?.pixelRatio;
    const radius = typeof raw === "number" ? undefined : raw?.radius;
    const sharpness = typeof raw === "number" ? undefined : raw?.sharpness;
    return {
        pixelRatio: pixelRatio !== undefined && Number.isFinite(pixelRatio) && pixelRatio > 0
            ? Math.min(4, Math.max(0.5, pixelRatio))
            : undefined,
        radius: radius !== undefined && Number.isFinite(radius) ? Math.max(0, radius) : 9999,
        sharpness: sharpness !== undefined && Number.isFinite(sharpness) && sharpness > 0
            ? Math.min(1, sharpness)
            : 0,
    };
}

function activeCaptureQuality(leases: Set<SharedCaptureLease>): SceneCaptureQualityOptions | undefined {
    let radius = 0;
    let pixelRatio: number | undefined;
    let sharpness = 0;
    let active = false;
    let automaticRounded = false;
    for (const lease of leases) {
        if (!lease.active) continue;
        active = true;
        const quality = evaluateLeaseQuality(lease);
        radius = Math.max(radius, quality.radius);
        sharpness = Math.max(sharpness, quality.sharpness);
        if (quality.pixelRatio !== undefined) pixelRatio = Math.max(pixelRatio ?? 0, quality.pixelRatio);
        else automaticRounded ||= quality.radius > 0;
    }
    if (automaticRounded && pixelRatio !== undefined &&
        automaticRoundedPixelRatio(ROUNDED_MIN_CAPTURE_SCALE, ROUNDED_MAX_CAPTURE_SCALE) > pixelRatio) {
        pixelRatio = undefined;
    }
    return active ? { radius, pixelRatio, sharpness } : undefined;
}

function deliverSharedCapture(
    subscription: SharedCaptureSubscription,
    revision: number,
    canvas: HTMLCanvasElement,
    source: HTMLElement,
): void {
    if (subscription.deliveredRevision >= revision) return;
    subscription.deliveredRevision = revision;
    subscription.listener(canvas, source);
}

export function acquireSharedSceneCapture(
    sourceElement: HTMLElement,
    getQualityOptions?: () => number | undefined | SceneCaptureQualityOptions,
): SceneCaptureController {
    let entry = sharedSceneCaptures.get(sourceElement);
    const lease: SharedCaptureLease = {
        getQuality: getQualityOptions,
        active: true,
    };

    if (!entry) {
        const leases = new Set([lease]);
        const newEntry: SharedSceneCaptureEntry = {
            controller: null as unknown as SceneCaptureController,
            leases,
            activeSubscriptions: new Set(),
            revision: 0,
            latestCanvas: null,
            lastMaxPixelRatio: 0,
            lastHasRounded: false,
            lastMaxSharpness: 0,
        };
        newEntry.controller = createSceneCaptureController(sourceElement, () => {
            const quality = activeCaptureQuality(leases);
            newEntry.lastMaxPixelRatio = quality?.pixelRatio ?? 0;
            newEntry.lastHasRounded = (quality?.radius ?? 0) > 0;
            newEntry.lastMaxSharpness = quality?.sharpness ?? 0;
            return quality;
        });
        newEntry.controller.subscribe((canvas, source) => {
            newEntry.latestCanvas = canvas;
            const revision = ++newEntry.revision;
            for (const subscription of newEntry.activeSubscriptions) {
                deliverSharedCapture(subscription, revision, canvas, source);
            }
        });
        sharedSceneCaptures.set(sourceElement, newEntry);
        entry = newEntry;
    } else {
        entry.leases.add(lease);
        entry.controller.setActive?.(true);
        const newQuality = evaluateLeaseQuality(lease);
        const autoRoundedScale = automaticRoundedPixelRatio(ROUNDED_MIN_CAPTURE_SCALE, ROUNDED_MAX_CAPTURE_SCALE);
        const effectivePrevScale =
            entry.lastMaxPixelRatio > 0
                ? entry.lastMaxPixelRatio
                : entry.lastHasRounded
                  ? autoRoundedScale
                  : 0;
        const needsUpgrade =
            (newQuality.radius > 0 && !entry.lastHasRounded) ||
            newQuality.sharpness > entry.lastMaxSharpness ||
            (newQuality.pixelRatio !== undefined && newQuality.pixelRatio > effectivePrevScale) ||
            (newQuality.pixelRatio === undefined && newQuality.radius > 0 && entry.lastMaxPixelRatio > 0 &&
                autoRoundedScale > entry.lastMaxPixelRatio);
        if (needsUpgrade) {
            entry.controller.scheduleCapture();
        }
    }

    const currentEntry = entry;
    let leaseDestroyed = false;
    const subscriptions = new Set<SharedCaptureSubscription>();

    const syncSharedActiveState = () => {
        const quality = activeCaptureQuality(currentEntry.leases);
        currentEntry.controller.setActive?.(quality !== undefined);
        if (quality && ((quality.pixelRatio ?? 0) !== currentEntry.lastMaxPixelRatio ||
            ((quality.radius ?? 0) > 0) !== currentEntry.lastHasRounded ||
            (quality.sharpness ?? 0) !== currentEntry.lastMaxSharpness)) {
            currentEntry.controller.scheduleCapture();
        }
    };

    return {
        get canvas() {
            return currentEntry.controller.canvas;
        },
        get source() {
            return currentEntry.controller.source;
        },
        subscribe(listener) {
            if (leaseDestroyed) return () => {};
            const subscription: SharedCaptureSubscription = { listener, deliveredRevision: 0 };
            subscriptions.add(subscription);
            if (lease.active) {
                currentEntry.activeSubscriptions.add(subscription);
                const canvas = currentEntry.controller.canvas;
                if (canvas && canvas.width > 0 && sourceElement.isConnected) {
                    deliverSharedCapture(subscription, currentEntry.revision, canvas, sourceElement);
                }
            }
            return () => {
                subscriptions.delete(subscription);
                currentEntry.activeSubscriptions.delete(subscription);
            };
        },
        scheduleCapture() {
            if (leaseDestroyed) return;
            currentEntry.controller.scheduleCapture();
        },
        setActive(active: boolean) {
            if (leaseDestroyed || lease.active === active) return;
            lease.active = active;
            for (const subscription of subscriptions) {
                if (active) {
                    currentEntry.activeSubscriptions.add(subscription);
                } else {
                    currentEntry.activeSubscriptions.delete(subscription);
                }
            }
            syncSharedActiveState();
            const canvas = currentEntry.latestCanvas;
            if (active && canvas) {
                for (const subscription of subscriptions) {
                    if (!lease.active) break;
                    if (subscription.deliveredRevision > 0 || (canvas.width > 0 && sourceElement.isConnected)) {
                        deliverSharedCapture(subscription, currentEntry.revision, canvas, sourceElement);
                    }
                }
            }
        },
        destroy() {
            if (leaseDestroyed) return;
            leaseDestroyed = true;
            for (const subscription of subscriptions) {
                currentEntry.activeSubscriptions.delete(subscription);
            }
            subscriptions.clear();
            currentEntry.leases.delete(lease);
            if (currentEntry.leases.size === 0) {
                sharedSceneCaptures.delete(sourceElement);
                currentEntry.controller.destroy();
            } else {
                syncSharedActiveState();
            }
        },
    };
}
