import type { SceneCaptureController } from "./types.js";

const COLOR_TOKEN_PATTERN =
    /#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|\b[a-zA-Z]{3,20}\b/g;

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

const blurCache = new Map<string, number>();
function parseCssBlurPx(filterStr: string): number {
    if (!filterStr || filterStr === "none") return 0;
    const cached = blurCache.get(filterStr);
    if (cached !== undefined) return cached;
    const match = filterStr.match(/blur\(\s*([\d.]+)px\s*\)/i);
    let value = 0;
    if (match) {
        const parsed = Number.parseFloat(match[1]);
        value = Number.isFinite(parsed) && parsed > 0 ? Math.min(80, parsed) : 0;
    }
    if (blurCache.size > 200) blurCache.clear();
    blurCache.set(filterStr, value);
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

function parseGradientStops(args: string[], lineLen: number): GradientStopSpec[] {
    const stops: GradientStopSpec[] = [];
    for (const part of args) {
        const colorMatch = part.match(
            /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|[a-zA-Z]{3,20})(.*)$/,
        );
        if (!colorMatch) continue;
        const color = colorMatch[1];
        const rest = colorMatch[2].trim();
        let posPx: number | null = null;
        let posFrac: number | null = null;
        if (rest) {
            const pxMatch = rest.match(/(-?[\d.]+)px/);
            const pctMatch = rest.match(/(-?[\d.]+)%/);
            if (pxMatch) {
                posPx = Number.parseFloat(pxMatch[1]);
                posFrac = lineLen > 0 ? posPx / lineLen : 0;
            } else if (pctMatch) {
                posFrac = Number.parseFloat(pctMatch[1]) / 100;
                posPx = posFrac * lineLen;
            }
        }
        stops.push({ color, posPx, posFrac });
    }
    return stops;
}

function drawLinearGradientBox(
    ctx: CanvasRenderingContext2D,
    backgroundImage: string,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
): boolean {
    const parsed = extractFunctionInner(backgroundImage, "linear-gradient");
    if (!parsed) return false;
    const args = splitTopLevelArgs(parsed.inner);
    if (args.length < 2) return false;

    const angleVec = parseCssGradientAngle(args[0]);
    const dir = angleVec ?? { dx: 0, dy: 1 };
    const stopArgs = angleVec ? args.slice(1) : args;
    const lineLen = Math.max(1, Math.abs(width * dir.dx) + Math.abs(height * dir.dy));
    const cx = x + width * 0.5;
    const cy = y + height * 0.5;
    const x0 = cx - dir.dx * lineLen * 0.5;
    const y0 = cy - dir.dy * lineLen * 0.5;
    const x1 = cx + dir.dx * lineLen * 0.5;
    const y1 = cy + dir.dy * lineLen * 0.5;

    const stops = parseGradientStops(stopArgs, lineLen);
    if (stops.length < 2) return false;

    const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
    if (parsed.isRepeating) {
        const firstPx = stops[0].posPx ?? 0;
        const lastPx = stops[stops.length - 1].posPx ?? firstPx + 1;
        const period = Math.max(4, lastPx - firstPx);
        const cycles = Math.min(96, Math.ceil((lineLen + period) / period) + 1);
        for (let cycle = -1; cycle < cycles; cycle++) {
            const basePx = cycle * period - firstPx;
            for (const stop of stops) {
                const pos = ((stop.posPx ?? 0) + basePx) / lineLen;
                if (pos < 0 || pos > 1) continue;
                try {
                    gradient.addColorStop(pos, stop.color);
                } catch {
                    return false;
                }
            }
        }
    } else {
        const denominator = Math.max(1, stops.length - 1);
        for (let index = 0; index < stops.length; index++) {
            const pos = stops[index].posFrac ?? index / denominator;
            try {
                gradient.addColorStop(Math.min(1, Math.max(0, pos)), stops[index].color);
            } catch {
                return false;
            }
        }
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
    radius: number,
): boolean {
    const parsed = extractFunctionInner(backgroundImage, "radial-gradient");
    if (!parsed) return false;
    const args = splitTopLevelArgs(parsed.inner);
    if (args.length < 2) return false;
    const firstIsShape = /\b(circle|ellipse|at|closest|farthest)\b/i.test(args[0]);
    const stopArgs = firstIsShape ? args.slice(1) : args;
    const rad = Math.max(width, height) * 0.6;
    const stops = parseGradientStops(stopArgs, rad);
    if (stops.length < 2) return false;

    const cx = x + width * 0.5;
    const cy = y + height * 0.5;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    const denominator = Math.max(1, stops.length - 1);
    for (let index = 0; index < stops.length; index++) {
        const pos = stops[index].posFrac ?? index / denominator;
        try {
            gradient.addColorStop(Math.min(1, Math.max(0, pos)), stops[index].color);
        } catch {
            return false;
        }
    }
    ctx.fillStyle = gradient;
    fillRoundedOrRect(ctx, x, y, width, height, radius);
    return true;
}

const gradientColorsCache = new Map<string, string[]>();
function parseLinearGradientColors(backgroundImage: string): string[] {
    const cached = gradientColorsCache.get(backgroundImage);
    if (cached !== undefined) return cached;
    const startIdx = backgroundImage.indexOf("linear-gradient(");
    if (startIdx < 0) {
        if (gradientColorsCache.size > 200) gradientColorsCache.clear();
        gradientColorsCache.set(backgroundImage, []);
        return [];
    }
    const inner = backgroundImage.slice(startIdx + 16);
    const tokens = inner.match(COLOR_TOKEN_PATTERN) ?? [];
    const result = tokens.filter(
        (token) =>
            !["to", "top", "bottom", "left", "right", "deg", "rad", "turn", "from", "at"].includes(
                token.toLowerCase(),
            ),
    );
    if (gradientColorsCache.size > 200) gradientColorsCache.clear();
    gradientColorsCache.set(backgroundImage, result);
    return result;
}

function resolveTextFill(
    ctx: CanvasRenderingContext2D,
    style: CSSStyleDeclaration,
    rect: DOMRect,
    sourceRect: DOMRect,
): string | CanvasGradient {
    const clip =
        style.backgroundClip ||
        (style as CSSStyleDeclaration & { webkitBackgroundClip?: string }).webkitBackgroundClip;
    if (clip === "text" && style.backgroundImage.includes("gradient")) {
        const colors = parseLinearGradientColors(style.backgroundImage);
        if (colors.length >= 2) {
            const left = rect.left - sourceRect.left;
            const top = rect.top - sourceRect.top;
            const gradient = ctx.createLinearGradient(left, top, left + rect.width, top + rect.height);
            const denominator = Math.max(1, colors.length - 1);
            for (let index = 0; index < colors.length; index++) {
                try {
                    gradient.addColorStop(index / denominator, colors[index]);
                } catch {
                    return style.color;
                }
            }
            return gradient;
        }
    }
    return style.color;
}

function traceRoundedOrRectPath(
    ctx: CanvasRenderingContext2D,
    leftPx: number,
    topPx: number,
    widthPx: number,
    heightPx: number,
    radiusPx: number,
): boolean {
    if (radiusPx > 0.5 && typeof ctx.roundRect === "function") {
        ctx.beginPath();
        ctx.roundRect(
            leftPx,
            topPx,
            widthPx,
            heightPx,
            Math.min(radiusPx, Math.min(widthPx, heightPx) * 0.5),
        );
        return true;
    }
    return false;
}

function fillRoundedOrRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
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

const boxShadowCache = new Map<string, ParsedBoxShadow[]>();

function parseCssBoxShadows(boxShadowStr: string): ParsedBoxShadow[] {
    if (!boxShadowStr || boxShadowStr === "none") return [];
    const cached = boxShadowCache.get(boxShadowStr);
    if (cached) return cached;

    const layers = splitTopLevelArgs(boxShadowStr);
    const parsed: ParsedBoxShadow[] = [];

    for (let index = 0; index < layers.length; index++) {
        const layer = layers[index].trim();
        if (!layer) continue;

        let inset = false;
        const lengths: number[] = [];
        let color = "rgba(0, 0, 0, 0.25)";

        const tokens = layer.match(/(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^)]+\)|#[0-9a-fA-F]+|\S+/g) ?? [];
        for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
            const token = tokens[tokenIndex];
            if (token.toLowerCase() === "inset") {
                inset = true;
            } else if (/^-?(?:\d+\.?\d*|\.\d+)(?:px)?$/i.test(token)) {
                const value = Number.parseFloat(token);
                if (Number.isFinite(value)) lengths.push(value);
            } else {
                color = token;
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

    if (boxShadowCache.size > 200) boxShadowCache.clear();
    boxShadowCache.set(boxShadowStr, parsed);
    return parsed;
}

function drawBoxShadows(
    ctx: CanvasRenderingContext2D,
    shadows: ParsedBoxShadow[],
    leftPx: number,
    topPx: number,
    widthPx: number,
    heightPx: number,
    radiusPx: number,
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
            const spreadRadius = Math.max(0, radiusPx + shadow.spread);
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
            const innerRadius = Math.max(0, radiusPx - shadow.spread);
            ctx.beginPath();
            ctx.rect(leftPx - pad, topPx - pad, widthPx + pad * 2, heightPx + pad * 2);
            if (innerW > 0 && innerH > 0) {
                if (innerRadius > 0.5 && typeof ctx.roundRect === "function") {
                    ctx.roundRect(innerLeft, innerTop, innerW, innerH, Math.min(innerRadius, Math.min(innerW, innerH) * 0.5));
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

function drawElementBorder(
    ctx: CanvasRenderingContext2D,
    style: CSSStyleDeclaration,
    leftPx: number,
    topPx: number,
    widthPx: number,
    heightPx: number,
    radiusPx: number,
): void {
    if (typeof ctx.stroke !== "function") return;
    const hasBorderStyle = (value: string) => Boolean(value && value !== "none" && value !== "hidden");
    const topW = hasBorderStyle(style.borderTopStyle) ? Number.parseFloat(style.borderTopWidth || "0") || 0 : 0;
    const rightW = hasBorderStyle(style.borderRightStyle) ? Number.parseFloat(style.borderRightWidth || "0") || 0 : 0;
    const bottomW = hasBorderStyle(style.borderBottomStyle) ? Number.parseFloat(style.borderBottomWidth || "0") || 0 : 0;
    const leftW = hasBorderStyle(style.borderLeftStyle) ? Number.parseFloat(style.borderLeftWidth || "0") || 0 : 0;
    if (topW <= 0 && rightW <= 0 && bottomW <= 0 && leftW <= 0) return;

    const topColor = style.borderTopColor;
    const rightColor = style.borderRightColor;
    const bottomColor = style.borderBottomColor;
    const leftColor = style.borderLeftColor;

    const isUniform =
        topW === rightW &&
        topW === bottomW &&
        topW === leftW &&
        topColor === rightColor &&
        topColor === bottomColor &&
        topColor === leftColor;

    if (isUniform && topW > 0) {
        if (!topColor || topColor === "transparent" || topColor === "rgba(0, 0, 0, 0)") return;
        const inset = topW * 0.5;
        const strokeW = Math.max(0, widthPx - topW);
        const strokeH = Math.max(0, heightPx - topW);
        if (strokeW <= 0 || strokeH <= 0) return;
        ctx.strokeStyle = topColor;
        ctx.lineWidth = topW;
        if (traceRoundedOrRectPath(ctx, leftPx + inset, topPx + inset, strokeW, strokeH, Math.max(0, radiusPx - inset))) {
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
    const drawSide = (edgeW: number, color: string, x1: number, y1: number, x2: number, y2: number) => {
        if (edgeW <= 0 || !color || color === "transparent" || color === "rgba(0, 0, 0, 0)") return;
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = edgeW;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    };
    drawSide(topW, topColor, leftPx, topPx + topW * 0.5, leftPx + widthPx, topPx + topW * 0.5);
    drawSide(rightW, rightColor, leftPx + widthPx - rightW * 0.5, topPx, leftPx + widthPx - rightW * 0.5, topPx + heightPx);
    drawSide(bottomW, bottomColor, leftPx, topPx + heightPx - bottomW * 0.5, leftPx + widthPx, topPx + heightPx - bottomW * 0.5);
    drawSide(leftW, leftColor, leftPx + leftW * 0.5, topPx, leftPx + leftW * 0.5, topPx + heightPx);
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

function drawImageElementFitted(
    ctx: CanvasRenderingContext2D,
    image: HTMLImageElement,
    style: CSSStyleDeclaration,
    drawW: number,
    drawH: number,
): void {
    const natW = image.naturalWidth;
    const natH = image.naturalHeight;
    const fit = (style.objectFit || "fill").toLowerCase();
    if (fit === "fill" || natW <= 0 || natH <= 0 || drawW <= 0 || drawH <= 0) {
        ctx.drawImage(image, -drawW * 0.5, -drawH * 0.5, drawW, drawH);
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
    ctx.drawImage(image, -drawW * 0.5 + offsetLeft, -drawH * 0.5 + offsetTop, renderedW, renderedH);
}

interface SvgRasterEntry {
    hash: string;
    image: HTMLImageElement | null;
    status: "loading" | "ready" | "error";
}

const svgRasterCache = new WeakMap<SVGSVGElement, SvgRasterEntry>();

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
        serialized = new XMLSerializer().serializeToString(clone);
    } catch {
        return;
    }

    const hash = `${widthPx}x${heightPx}|${serialized}`;
    const existing = svgRasterCache.get(svgEl);
    if (existing && existing.hash === hash) {
        if (existing.status === "ready" && existing.image) {
            ctx.drawImage(existing.image, leftPx, topPx, widthPx, heightPx);
        }
        return;
    }

    const entry: SvgRasterEntry = {
        hash,
        image: null,
        status: "loading",
    };
    svgRasterCache.set(svgEl, entry);

    const blob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    const img = new Image();
    const finalize = (success: boolean) => {
        if (typeof URL.revokeObjectURL === "function") {
            try {
                URL.revokeObjectURL(blobUrl);
            } catch {
            }
        }
        if (svgRasterCache.get(svgEl) !== entry) return;
        if (success) {
            entry.image = img;
            entry.status = "ready";
            onAsyncReady?.();
        } else {
            entry.status = "error";
        }
    };
    img.onload = () => finalize(true);
    img.onerror = () => finalize(false);
    img.src = blobUrl;
}

function intersectsSourceBounds(
    left: number,
    top: number,
    width: number,
    height: number,
    sourceWidth: number,
    sourceHeight: number,
    marginPx = 0,
): boolean {
    return (
        width > 0 &&
        height > 0 &&
        left + width + marginPx > 0 &&
        left - marginPx < sourceWidth &&
        top + height + marginPx > 0 &&
        top - marginPx < sourceHeight
    );
}

function extractWordOffsets(normalizedText: string): { starts: number[]; ends: number[] } {
    const starts: number[] = [];
    const ends: number[] = [];
    const length = normalizedText.length;
    let wordStart = 0;
    for (let index = 0; index <= length; index++) {
        if (index === length || normalizedText.charCodeAt(index) === 32) {
            if (index > wordStart) {
                starts.push(wordStart);
                ends.push(index);
            }
            wordStart = index + 1;
        }
    }
    return { starts, ends };
}

const MAX_CAPTURE_DIM = 3072;
const MAX_CAPTURE_AREA = 8_388_608;
const ROUNDED_MIN_CAPTURE_SCALE = 2;
const ROUNDED_MAX_CAPTURE_SCALE = 2.5;
const UNROUNDED_MAX_CAPTURE_DIM = 448;
const UNROUNDED_CAPTURE_SCALE = 0.2;
const ROUNDED_RADIUS_THRESHOLD = 2;

export interface SceneCaptureQualityOptions {
    pixelRatio?: number;
    radius?: number;
}

export function resolveCaptureDimensions(
    sourceWidth: number,
    sourceHeight: number,
    requestedPixelRatio?: number,
    radius?: number,
): { texWidth: number; texHeight: number } {
    const hasExplicitPixelRatio =
        typeof requestedPixelRatio === "number" &&
        Number.isFinite(requestedPixelRatio) &&
        requestedPixelRatio > 0;
    const isUnrounded =
        !hasExplicitPixelRatio &&
        typeof radius === "number" &&
        Number.isFinite(radius) &&
        radius <= ROUNDED_RADIUS_THRESHOLD;

    if (isUnrounded) {
        const desiredW = Math.max(64, Math.round(sourceWidth * UNROUNDED_CAPTURE_SCALE));
        const desiredH = Math.max(64, Math.round(sourceHeight * UNROUNDED_CAPTURE_SCALE));
        const dimScale = UNROUNDED_MAX_CAPTURE_DIM / Math.max(desiredW, desiredH);
        const fitScale = Math.min(1, dimScale);
        return {
            texWidth: Math.max(2, Math.round(desiredW * fitScale)),
            texHeight: Math.max(2, Math.round(desiredH * fitScale)),
        };
    }

    const deviceDpr =
        typeof window !== "undefined" &&
        typeof window.devicePixelRatio === "number" &&
        Number.isFinite(window.devicePixelRatio) &&
        window.devicePixelRatio > 0
            ? window.devicePixelRatio
            : 1;
    const dprScale = hasExplicitPixelRatio
        ? Math.min(4, Math.max(0.5, requestedPixelRatio!))
        : Math.min(ROUNDED_MAX_CAPTURE_SCALE, Math.max(ROUNDED_MIN_CAPTURE_SCALE, deviceDpr));
    const maxDim = hasExplicitPixelRatio ? 4096 : MAX_CAPTURE_DIM;
    const maxArea = hasExplicitPixelRatio ? 16_000_000 : MAX_CAPTURE_AREA;
    const desiredW = Math.max(256, Math.round(sourceWidth * dprScale));
    const desiredH = Math.max(256, Math.round(sourceHeight * dprScale));
    const dimScale = maxDim / Math.max(desiredW, desiredH);
    const areaScale = Math.sqrt(maxArea / Math.max(1, desiredW * desiredH));
    const fitScale = Math.min(1, dimScale, areaScale);
    return {
        texWidth: Math.max(2, Math.round(desiredW * fitScale)),
        texHeight: Math.max(2, Math.round(desiredH * fitScale)),
    };
}

function isOpaqueBackground(color: string | undefined): boolean {
    if (!color) return false;
    const trimmed = color.trim().toLowerCase();
    if (!trimmed || trimmed === "transparent") return false;
    const rgbaMatch = trimmed.match(
        /^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/,
    );
    if (rgbaMatch && Number.parseFloat(rgbaMatch[1]) <= 0.001) return false;
    return true;
}

function getCssColorLuminance(color: string | undefined): number | null {
    if (!color) return null;
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
    if (source.classList.contains("dark") || source.getAttribute("data-theme") === "dark") {
        return true;
    }
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
): boolean {
    const sourceRect = source.getBoundingClientRect();
    if (sourceRect.width < 2 || sourceRect.height < 2) return false;

    const { texWidth, texHeight } = resolveCaptureDimensions(
        sourceRect.width,
        sourceRect.height,
        pixelRatio,
        radius,
    );
    if (canvas.width !== texWidth) canvas.width = texWidth;
    if (canvas.height !== texHeight) canvas.height = texHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const rootStyle = window.getComputedStyle(source);
    const backdropLayers: Array<{ bgColor: string; bgImage: string }> = [];
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
            });
        }
        if (isOpaqueBackground(bgColor)) {
            foundOpaque = true;
            break;
        }
        cursor = cursor.parentElement;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    if (!foundOpaque) {
        ctx.fillStyle = isDarkColorScheme(source, rootStyle) ? "#0b0f19" : "#f3f2f6";
        ctx.fillRect(0, 0, texWidth, texHeight);
    }
    for (let index = backdropLayers.length - 1; index >= 0; index--) {
        const layer = backdropLayers[index];
        if (layer.bgColor) {
            ctx.fillStyle = layer.bgColor;
            ctx.fillRect(0, 0, texWidth, texHeight);
        }
        if (layer.bgImage) {
            drawRadialGradientBox(ctx, layer.bgImage, 0, 0, texWidth, texHeight, 0);
            drawLinearGradientBox(ctx, layer.bgImage, 0, 0, texWidth, texHeight, 0);
        }
    }

    if (
        backdropOverride?.canvas &&
        backdropOverride.canvas.width > 0 &&
        backdropOverride.canvas.height > 0
    ) {
        const overrideCanvas = backdropOverride.canvas;
        const overrideElement = backdropOverride.element;
        if (overrideElement && overrideElement.isConnected) {
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
        } else {
            ctx.drawImage(overrideCanvas, 0, 0, texWidth, texHeight);
        }
    }

    const scaleX = texWidth / sourceRect.width;
    const scaleY = texHeight / sourceRect.height;
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);

    const stack: Element[] = [source];
    while (stack.length > 0) {
        const element = stack.pop()!;
        if (element !== source && element.hasAttribute("data-lg-surface")) {
            continue;
        }

        const style = window.getComputedStyle(element);
        if (style.display === "none") continue;
        if (element !== source) {
            if (style.visibility === "hidden") continue;
            const elementOpacity = Number.parseFloat(style.opacity || "1");
            if (!(elementOpacity > 0.01)) continue;
        }
        const opacity = element === source ? 1 : Number.parseFloat(style.opacity || "1");
        const blurPx = element === source ? 0 : parseCssBlurPx(style.filter);

        if (element !== source) {
            const clip =
                style.backgroundClip ||
                (style as CSSStyleDeclaration & { webkitBackgroundClip?: string }).webkitBackgroundClip;
            const bgColor = style.backgroundColor;
            const bgImage = style.backgroundImage;
            const hasLinearBg =
                clip !== "text" && Boolean(bgImage && bgImage.includes("linear-gradient("));
            const hasRadialBg =
                clip !== "text" && Boolean(bgImage && bgImage.includes("radial-gradient("));
            const hasSolidBg =
                clip !== "text" && bgColor && bgColor !== "rgba(0, 0, 0, 0)" && bgColor !== "transparent";
            const parsedShadows = parseCssBoxShadows(style.boxShadow || "");
            const hasBorder =
                (style.borderTopStyle !== "none" && (Number.parseFloat(style.borderTopWidth || "0") || 0) > 0) ||
                (style.borderRightStyle !== "none" && (Number.parseFloat(style.borderRightWidth || "0") || 0) > 0) ||
                (style.borderBottomStyle !== "none" && (Number.parseFloat(style.borderBottomWidth || "0") || 0) > 0) ||
                (style.borderLeftStyle !== "none" && (Number.parseFloat(style.borderLeftWidth || "0") || 0) > 0);

            if (hasSolidBg || hasLinearBg || hasRadialBg || parsedShadows.length > 0 || hasBorder) {
                const bgRect = element.getBoundingClientRect();
                const left = bgRect.left - sourceRect.left;
                const top = bgRect.top - sourceRect.top;
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
                    intersectsSourceBounds(
                        left,
                        top,
                        bgRect.width,
                        bgRect.height,
                        sourceRect.width,
                        sourceRect.height,
                        shadowMargin,
                    )
                ) {
                    const cornerRadius = Number.parseFloat(style.borderTopLeftRadius || "0") || 0;
                    ctx.save();
                    ctx.globalAlpha = opacity;
                    if (blurPx > 0 && "filter" in ctx) {
                        ctx.filter = `blur(${blurPx}px)`;
                    }
                    if (parsedShadows.length > 0) {
                        drawBoxShadows(ctx, parsedShadows, left, top, bgRect.width, bgRect.height, cornerRadius, false);
                    }
                    if (hasSolidBg) {
                        ctx.fillStyle = bgColor;
                        fillRoundedOrRect(ctx, left, top, bgRect.width, bgRect.height, cornerRadius);
                    }
                    if (hasRadialBg) {
                        drawRadialGradientBox(ctx, bgImage, left, top, bgRect.width, bgRect.height, cornerRadius);
                    }
                    if (hasLinearBg) {
                        drawLinearGradientBox(ctx, bgImage, left, top, bgRect.width, bgRect.height, cornerRadius);
                    }
                    if (parsedShadows.length > 0) {
                        drawBoxShadows(ctx, parsedShadows, left, top, bgRect.width, bgRect.height, cornerRadius, true);
                    }
                    if (hasBorder) {
                        drawElementBorder(ctx, style, left, top, bgRect.width, bgRect.height, cornerRadius);
                    }
                    ctx.restore();
                }
            }
        }

        if (element instanceof HTMLImageElement) {
            if (element.complete && element.naturalWidth > 0) {
                const imgRect = element.getBoundingClientRect();
                const imgLeft = imgRect.left - sourceRect.left;
                const imgTop = imgRect.top - sourceRect.top;
                if (
                    intersectsSourceBounds(
                        imgLeft,
                        imgTop,
                        imgRect.width,
                        imgRect.height,
                        sourceRect.width,
                        sourceRect.height,
                    )
                ) {
                    const baseW = element.offsetWidth || imgRect.width;
                    const baseH = element.offsetHeight || imgRect.height;
                    const cx = imgLeft + imgRect.width * 0.5;
                    const cy = imgTop + imgRect.height * 0.5;
                    const imgCornerRadius = Number.parseFloat(style.borderTopLeftRadius || "0") || 0;
                    ctx.save();
                    ctx.globalAlpha = opacity;
                    ctx.translate(cx, cy);
                    if (style.transform && style.transform !== "none" && typeof DOMMatrixReadOnly === "function") {
                        const matrix = new DOMMatrixReadOnly(style.transform);
                        ctx.transform(matrix.a, matrix.b, matrix.c, matrix.d, 0, 0);
                    }
                    if (imgCornerRadius > 0.5 && traceRoundedOrRectPath(ctx, -baseW * 0.5, -baseH * 0.5, baseW, baseH, imgCornerRadius)) {
                        ctx.clip();
                    }
                    drawImageElementFitted(ctx, element, style, baseW, baseH);
                    ctx.restore();
                }
            }
        } else if (typeof SVGSVGElement !== "undefined" && element instanceof SVGSVGElement) {
            const svgRect = element.getBoundingClientRect();
            const svgLeft = svgRect.left - sourceRect.left;
            const svgTop = svgRect.top - sourceRect.top;
            if (
                intersectsSourceBounds(
                    svgLeft,
                    svgTop,
                    svgRect.width,
                    svgRect.height,
                    sourceRect.width,
                    sourceRect.height,
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
        } else if (
            typeof HTMLCanvasElement !== "undefined" &&
            element instanceof HTMLCanvasElement &&
            !element.classList.contains("lg-webgl-canvas")
        ) {
            if (element.width > 0 && element.height > 0) {
                const canvasRect = element.getBoundingClientRect();
                const canvasLeft = canvasRect.left - sourceRect.left;
                const canvasTop = canvasRect.top - sourceRect.top;
                if (
                    intersectsSourceBounds(
                        canvasLeft,
                        canvasTop,
                        canvasRect.width,
                        canvasRect.height,
                        sourceRect.width,
                        sourceRect.height,
                    )
                ) {
                    ctx.save();
                    ctx.globalAlpha = opacity;
                    ctx.drawImage(
                        element,
                        canvasLeft,
                        canvasTop,
                        canvasRect.width,
                        canvasRect.height,
                    );
                    ctx.restore();
                }
            }
        } else {
            let node = element.firstChild;
            while (node) {
                if (node.nodeType === Node.TEXT_NODE) {
                    const rawText = node.textContent;
                    const trimmed = rawText ? rawText.trim() : "";
                    if (rawText && trimmed.length > 0) {
                        const startOffset = rawText.indexOf(trimmed);
                        range.setStart(node, startOffset);
                        range.setEnd(node, startOffset + trimmed.length);
                        const rects = range.getClientRects();
                        const textRect = range.getBoundingClientRect();
                        if (
                            intersectsSourceBounds(
                                textRect.left - sourceRect.left,
                                textRect.top - sourceRect.top,
                                textRect.width,
                                textRect.height,
                                sourceRect.width,
                                sourceRect.height,
                            )
                        ) {
                            const content =
                                style.textTransform === "uppercase" ? trimmed.toUpperCase() : trimmed;
                            ctx.save();
                            ctx.globalAlpha = opacity;
                            ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
                            applyLetterSpacing(ctx, style.letterSpacing);
                            ctx.fillStyle = resolveTextFill(ctx, style, textRect, sourceRect);
                            ctx.textBaseline = "middle";
                            ctx.textAlign = "left";
                            if (rects.length <= 1) {
                                const box = rects.length === 1 ? rects[0] : textRect;
                                ctx.fillText(
                                    content,
                                    box.left - sourceRect.left,
                                    box.top - sourceRect.top + box.height * 0.5,
                                );
                            } else {
                                const normalizedText = content.replace(/\s+/g, " ");
                                const { starts: wordStarts, ends: wordEnds } =
                                    extractWordOffsets(normalizedText);
                                const wordCount = wordStarts.length;
                                const totalMeasuredWidth = ctx.measureText(normalizedText).width;
                                let charDensity =
                                    totalMeasuredWidth > 0 && normalizedText.length > 0
                                        ? totalMeasuredWidth / normalizedText.length
                                        : 8;
                                let wordIdx = 0;
                                for (
                                    let lineIdx = 0;
                                    lineIdx < rects.length && wordIdx < wordCount;
                                    lineIdx++
                                ) {
                                    const lineRect = rects[lineIdx];
                                    const maxLineWidth = lineRect.width + 4;
                                    const lineCharStart = wordStarts[wordIdx];
                                    let low = wordIdx;
                                    let high = wordCount - 1;
                                    if (low < high) {
                                        const targetEndChar =
                                            lineCharStart +
                                            Math.max(1, Math.floor(maxLineWidth / charDensity));
                                        let searchLow = low;
                                        let searchHigh = high;
                                        while (searchLow < searchHigh) {
                                            const mid = (searchLow + searchHigh + 1) >> 1;
                                            if (wordEnds[mid] <= targetEndChar) {
                                                searchLow = mid;
                                            } else {
                                                searchHigh = mid - 1;
                                            }
                                        }
                                        const guessIdx = searchLow;
                                        const guessSlice = normalizedText.slice(
                                            lineCharStart,
                                            wordEnds[guessIdx],
                                        );
                                        const guessWidth = ctx.measureText(guessSlice).width;
                                        if (guessWidth > 0 && guessSlice.length > 0) {
                                            charDensity = guessWidth / guessSlice.length;
                                        }
                                        if (guessWidth <= maxLineWidth) {
                                            low = guessIdx;
                                            let step = 1;
                                            while (
                                                low + step <= high &&
                                                ctx.measureText(
                                                    normalizedText.slice(
                                                        lineCharStart,
                                                        wordEnds[low + step],
                                                    ),
                                                ).width <= maxLineWidth
                                            ) {
                                                low += step;
                                                step <<= 1;
                                            }
                                            high = Math.min(high, low + step - 1);
                                        } else {
                                            high = guessIdx - 1;
                                            let step = 1;
                                            while (high - step >= low) {
                                                if (
                                                    ctx.measureText(
                                                        normalizedText.slice(
                                                            lineCharStart,
                                                            wordEnds[high - step],
                                                        ),
                                                    ).width > maxLineWidth
                                                ) {
                                                    high -= step;
                                                    step <<= 1;
                                                } else {
                                                    low = high - step;
                                                    break;
                                                }
                                            }
                                        }
                                        while (low < high) {
                                            const mid = (low + high + 1) >> 1;
                                            if (
                                                ctx.measureText(
                                                    normalizedText.slice(lineCharStart, wordEnds[mid]),
                                                ).width <= maxLineWidth
                                            ) {
                                                low = mid;
                                            } else {
                                                high = mid - 1;
                                            }
                                        }
                                    }
                                    const lineText = normalizedText.slice(lineCharStart, wordEnds[low]);
                                    wordIdx = low + 1;
                                    ctx.fillText(
                                        lineText,
                                        lineRect.left - sourceRect.left,
                                        lineRect.top - sourceRect.top + lineRect.height * 0.5,
                                    );
                                }
                            }
                            ctx.restore();
                        }
                    }
                }
                node = node.nextSibling;
            }
        }

        let child = element.lastElementChild;
        while (child) {
            stack.push(child as HTMLElement);
            child = child.previousElementSibling;
        }
    }

    return true;
}

export function createSceneCaptureController(
    sourceElement: HTMLElement,
    getQualityOptions?: () => number | SceneCaptureQualityOptions | undefined,
): SceneCaptureController {
    const listeners = new Set<(canvas: HTMLCanvasElement, source: HTMLElement) => void>();
    let captureCanvas: HTMLCanvasElement | null =
        typeof document !== "undefined" ? document.createElement("canvas") : null;
    if (captureCanvas) {
        captureCanvas.width = 0;
        captureCanvas.height = 0;
    }
    let hasCaptured = false;
    let captureFrame: number | null = null;
    let isActive = true;
    let pendingWhileInactive = false;
    let disposed = false;

    const range = typeof document !== "undefined" ? document.createRange() : null;

    const performCapture = () => {
        captureFrame = null;
        if (disposed || !captureCanvas || !range || !sourceElement.isConnected) return;
        if (!isActive) {
            pendingWhileInactive = true;
            return;
        }
        const resolved = getQualityOptions?.();
        const pixelRatio = typeof resolved === "number" ? resolved : resolved?.pixelRatio;
        const radius = typeof resolved === "number" ? undefined : resolved?.radius;
        if (
            captureDomToCanvas(
                sourceElement,
                captureCanvas,
                range,
                pixelRatio,
                radius,
                null,
                scheduleCapture,
            )
        ) {
            hasCaptured = true;
            for (const listener of listeners) {
                listener(captureCanvas, sourceElement);
            }
        }
    };

    const scheduleCapture = () => {
        if (disposed) return;
        if (!isActive) {
            pendingWhileInactive = true;
            return;
        }
        if (captureFrame !== null || typeof requestAnimationFrame !== "function") return;
        captureFrame = requestAnimationFrame(performCapture);
    };

    const setActive = (active: boolean) => {
        if (disposed || isActive === active) return;
        isActive = active;
        if (!active) {
            if (captureFrame !== null && typeof cancelAnimationFrame === "function") {
                cancelAnimationFrame(captureFrame);
                captureFrame = null;
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
    let themeObserver: MutationObserver | null = null;
    if (typeof MutationObserver === "function") {
        mutationObserver = new MutationObserver((records) => {
            for (let index = 0; index < records.length; index++) {
                const target = records[index].target as HTMLElement | Node;
                const parentEl =
                    target instanceof HTMLElement ? target : target.parentElement;
                if (parentEl && parentEl !== sourceElement && parentEl.closest("[data-lg-surface]")) {
                    continue;
                }
                scheduleCapture();
                break;
            }
        });
        mutationObserver.observe(sourceElement, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
            attributeFilter: ["class", "style", "data-theme", "data-color-scheme"],
        });

        if (typeof document !== "undefined") {
            themeObserver = new MutationObserver(scheduleCapture);
            if (document.documentElement !== sourceElement) {
                themeObserver.observe(document.documentElement, {
                    attributes: true,
                    attributeFilter: ["class", "style", "data-theme", "data-color-scheme"],
                });
            }
            if (document.body && document.body !== sourceElement) {
                themeObserver.observe(document.body, {
                    attributes: true,
                    attributeFilter: ["class", "style", "data-theme", "data-color-scheme"],
                });
            }
        }
    }

    let colorSchemeQuery: MediaQueryList | null = null;
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
        colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
        colorSchemeQuery?.addEventListener?.("change", scheduleCapture);
    }

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver === "function") {
        resizeObserver = new ResizeObserver(scheduleCapture);
        resizeObserver.observe(sourceElement);
    }

    sourceElement.addEventListener("load", scheduleCapture, true);
    if (typeof window !== "undefined") {
        window.addEventListener("resize", scheduleCapture, { passive: true });
    }
    if (typeof document !== "undefined" && "fonts" in document && document.fonts?.ready) {
        void document.fonts.ready.then(() => {
            if (!disposed) scheduleCapture();
        });
    }

    scheduleCapture();

    return {
        get canvas() {
            return hasCaptured ? captureCanvas : null;
        },
        get source() {
            return sourceElement;
        },
        subscribe(listener) {
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
            themeObserver?.disconnect();
            colorSchemeQuery?.removeEventListener?.("change", scheduleCapture);
            resizeObserver?.disconnect();
            sourceElement.removeEventListener("load", scheduleCapture, true);
            if (typeof window !== "undefined") {
                window.removeEventListener("resize", scheduleCapture);
            }
            if (captureFrame !== null && typeof cancelAnimationFrame === "function") {
                cancelAnimationFrame(captureFrame);
                captureFrame = null;
            }
            captureCanvas = null;
        },
    };
}
