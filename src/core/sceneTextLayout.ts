const MAX_CACHED_TEXT_LAYOUTS = 192;
const MAX_CACHED_TEXT_LENGTH = 2048;
const MAX_CACHED_TEXT_LINES = 32;

interface CachedTextLayout {
    text: string;
    whiteSpace: string;
    font: string;
    letterSpacing: string;
    widths: readonly number[];
    lines: readonly (string | undefined)[];
}

interface FontSnapshot {
    face: FontFace;
    descriptors: string;
}

export interface SceneTextLayouts {
    context: CanvasRenderingContext2D;
    measureText: CanvasRenderingContext2D["measureText"];
    shaping: string;
    fonts: readonly FontSnapshot[];
    entries: Map<number, CachedTextLayout>;
}

const canvasLayouts = new WeakMap<HTMLCanvasElement, SceneTextLayouts>();
const textNodeIds = new WeakMap<Node, number>();
let nextTextNodeId = 0;

export function prepareSceneTextLayouts(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
): SceneTextLayouts | null {
    const fontSet = canvas.ownerDocument.fonts;
    if (fontSet?.status === "loading") {
        canvasLayouts.delete(canvas);
        return null;
    }

    // Layout attributes and downloaded fonts can change between two captures
    // even when the text and its line widths are identical.
    const shaping = [
        ctx.direction,
        ctx.fontKerning,
        ctx.fontStretch,
        ctx.fontVariantCaps,
        ctx.textRendering,
        ctx.wordSpacing,
        (ctx as CanvasRenderingContext2D & { lang?: string }).lang,
        canvas.lang,
        canvas.ownerDocument.documentElement.lang,
        ctx.direction === "inherit" && canvas.isConnected
            ? canvas.ownerDocument.defaultView?.getComputedStyle(canvas).direction
            : canvas.dir || canvas.ownerDocument.documentElement.dir,
    ].join("|");
    const fonts = Array.from(fontSet ?? [], (face): FontSnapshot => ({
        face,
        descriptors: [
            face.status, face.family, face.style, face.weight, face.stretch,
            face.unicodeRange, face.featureSettings,
            (face as FontFace & { variationSettings?: string }).variationSettings,
        ].join("|"),
    }));
    const existing = canvasLayouts.get(canvas);
    if (
        existing && existing.context === ctx && existing.measureText === ctx.measureText &&
        existing.shaping === shaping && existing.fonts.length === fonts.length &&
        existing.fonts.every((previous, index) =>
            previous.face === fonts[index]!.face && previous.descriptors === fonts[index]!.descriptors)
    ) {
        return existing;
    }

    const cache: SceneTextLayouts = { context: ctx, measureText: ctx.measureText, shaping, fonts, entries: new Map() };
    canvasLayouts.set(canvas, cache);
    return cache;
}

export function resolveWrappedTextLines(
    layouts: SceneTextLayouts | null,
    ctx: CanvasRenderingContext2D,
    node: Node,
    text: string,
    whiteSpace: string,
    rects: DOMRectList,
): readonly (string | undefined)[] {
    if (!layouts || text.length > MAX_CACHED_TEXT_LENGTH || rects.length > MAX_CACHED_TEXT_LINES) {
        return layoutWrappedText(ctx, text, whiteSpace, rects);
    }

    // The LRU stores numeric keys so a cached layout cannot retain a detached subtree.
    let nodeId = textNodeIds.get(node);
    if (nodeId === undefined) {
        nodeId = ++nextTextNodeId;
        textNodeIds.set(node, nodeId);
    }
    const { entries } = layouts;
    const { font, letterSpacing } = ctx;
    const cached = entries.get(nodeId);
    if (
        cached && cached.text === text && cached.whiteSpace === whiteSpace && cached.font === font &&
        cached.letterSpacing === letterSpacing && cached.widths.length === rects.length &&
        cached.widths.every((width, index) => width === rects[index]!.width)
    ) {
        entries.delete(nodeId);
        entries.set(nodeId, cached);
        return cached.lines;
    }

    const lines = layoutWrappedText(ctx, text, whiteSpace, rects);
    if (cached) {
        entries.delete(nodeId);
    } else if (entries.size >= MAX_CACHED_TEXT_LAYOUTS) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
    }
    entries.set(nodeId, { text, whiteSpace, font, letterSpacing, widths: Array.from(rects, (rect) => rect.width), lines });
    return lines;
}

function findWordEnds(normalizedText: string): number[] {
    const ends: number[] = [];
    const length = normalizedText.length;
    let wordStart = 0;
    for (let index = 0; index <= length; index++) {
        if (index === length || normalizedText.charCodeAt(index) === 32) {
            if (index > wordStart) {
                ends.push(index);
            }
            wordStart = index + 1;
        }
    }
    return ends;
}

function layoutWrappedText(
    ctx: CanvasRenderingContext2D,
    content: string,
    whiteSpace: string,
    rects: DOMRectList,
): (string | undefined)[] {
    const lines: (string | undefined)[] = [];
    const preservesNewlines =
        whiteSpace === "pre" ||
        whiteSpace === "pre-wrap" ||
        whiteSpace === "pre-line" ||
        whiteSpace === "break-spaces";
    const preservesSpaces =
        whiteSpace === "pre" ||
        whiteSpace === "pre-wrap" ||
        whiteSpace === "break-spaces";
    const segments =
        preservesNewlines && content.includes("\n")
            ? content.split(/\r?\n/)
            : [content];
    let lineIdx = 0;
    for (let segIdx = 0; segIdx < segments.length && lineIdx < rects.length; segIdx++) {
        const rawSegment = segments[segIdx]!;
        const normalizedText = preservesSpaces
            ? rawSegment
            : rawSegment.replace(/\s+/g, " ").trim();
        const isLastSegment = segIdx === segments.length - 1;
        if (normalizedText.length === 0) {
            if (rects[lineIdx] && rects[lineIdx]!.width <= 1) {
                lineIdx++;
            }
            continue;
        }
        if (whiteSpace === "pre") {
            lines[lineIdx] = normalizedText;
            lineIdx++;
            continue;
        }
        const wordEnds = findWordEnds(normalizedText);
        const wordCount = wordEnds.length;
        const totalMeasuredWidth = ctx.measureText(normalizedText).width;
        let charDensity =
            totalMeasuredWidth > 0 && normalizedText.length > 0
                ? totalMeasuredWidth / normalizedText.length
                : 8;
        let charCursor = 0;
        let wordIdx = 0;
        while (lineIdx < rects.length && charCursor < normalizedText.length) {
            if (!preservesSpaces || charCursor > 0) {
                while (
                    charCursor < normalizedText.length &&
                    normalizedText.charCodeAt(charCursor) === 32
                ) {
                    charCursor++;
                }
            }
            if (charCursor >= normalizedText.length) break;
            const lineRect = rects[lineIdx]!;
            if (isLastSegment && lineIdx === rects.length - 1) {
                lines[lineIdx] = normalizedText.slice(charCursor);
                lineIdx++;
                break;
            }
            while (wordIdx < wordCount && wordEnds[wordIdx]! <= charCursor) {
                wordIdx++;
            }
            const maxLineWidth = lineRect.width + 4;
            const lineCharStart = charCursor;
            if (wordIdx >= wordCount) {
                lines[lineIdx] = normalizedText.slice(lineCharStart);
                lineIdx++;
                break;
            }
            const nextWordEnd = wordEnds[wordIdx]!;
            const firstTokenWidth = ctx.measureText(
                normalizedText.slice(lineCharStart, nextWordEnd),
            ).width;
            if (firstTokenWidth > maxLineWidth && nextWordEnd - lineCharStart > 1) {
                let charLow = lineCharStart + 1;
                let charHigh = nextWordEnd;
                const guessEnd = Math.min(
                    charHigh,
                    Math.max(
                        charLow,
                        lineCharStart + Math.max(1, Math.floor(maxLineWidth / charDensity)),
                    ),
                );
                const guessWidth = ctx.measureText(
                    normalizedText.slice(lineCharStart, guessEnd),
                ).width;
                const guessLen = guessEnd - lineCharStart;
                if (guessWidth > 0 && guessLen > 0) {
                    charDensity = guessWidth / guessLen;
                }
                if (guessWidth <= maxLineWidth) {
                    charLow = guessEnd;
                    let step = 1;
                    while (
                        charLow + step <= charHigh &&
                        ctx.measureText(
                            normalizedText.slice(lineCharStart, charLow + step),
                        ).width <= maxLineWidth
                    ) {
                        charLow += step;
                        step <<= 1;
                    }
                    charHigh = Math.min(charHigh, charLow + step - 1);
                } else {
                    charHigh = Math.max(charLow, guessEnd - 1);
                    let step = 1;
                    while (charHigh - step >= charLow) {
                        if (
                            ctx.measureText(
                                normalizedText.slice(lineCharStart, charHigh - step),
                            ).width > maxLineWidth
                        ) {
                            charHigh -= step;
                            step <<= 1;
                        } else {
                            charLow = charHigh - step;
                            break;
                        }
                    }
                }
                while (charLow < charHigh) {
                    const mid = (charLow + charHigh + 1) >> 1;
                    if (ctx.measureText(normalizedText.slice(lineCharStart, mid)).width <= maxLineWidth) {
                        charLow = mid;
                    } else {
                        charHigh = mid - 1;
                    }
                }
                if (charLow > lineCharStart && charLow < nextWordEnd) {
                    const prevCode = normalizedText.charCodeAt(charLow - 1);
                    const nextCode = normalizedText.charCodeAt(charLow);
                    if (
                        prevCode >= 0xd800 &&
                        prevCode <= 0xdbff &&
                        nextCode >= 0xdc00 &&
                        nextCode <= 0xdfff
                    ) {
                        charLow =
                            charLow > lineCharStart + 1
                                ? charLow - 1
                                : Math.min(nextWordEnd, charLow + 1);
                    }
                }
                const lineText = normalizedText.slice(lineCharStart, charLow);
                charCursor = charLow;
                lines[lineIdx] = lineText;
                lineIdx++;
                continue;
            }
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
            charCursor = wordEnds[low]!;
            wordIdx = low + 1;
            lines[lineIdx] = lineText;
            lineIdx++;
        }
    }
    return lines;
}
