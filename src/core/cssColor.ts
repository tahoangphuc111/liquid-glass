const NAMED_CSS_RGB: Record<string, readonly [number, number, number]> = {
    black: [0, 0, 0],
    white: [1, 1, 1],
    red: [1, 0, 0],
    lime: [0, 1, 0],
    green: [0, 128 / 255, 0],
    blue: [0, 0, 1],
    yellow: [1, 1, 0],
    cyan: [0, 1, 1],
    aqua: [0, 1, 1],
    magenta: [1, 0, 1],
    fuchsia: [1, 0, 1],
    silver: [192 / 255, 192 / 255, 192 / 255],
    gray: [128 / 255, 128 / 255, 128 / 255],
    grey: [128 / 255, 128 / 255, 128 / 255],
    maroon: [128 / 255, 0, 0],
    olive: [128 / 255, 128 / 255, 0],
    purple: [128 / 255, 0, 128 / 255],
    teal: [0, 128 / 255, 128 / 255],
    navy: [0, 0, 128 / 255],
    orange: [1, 165 / 255, 0],
    pink: [1, 192 / 255, 203 / 255],
    coral: [1, 127 / 255, 80 / 255],
    crimson: [220 / 255, 20 / 255, 60 / 255],
    gold: [1, 215 / 255, 0],
    indigo: [75 / 255, 0, 130 / 255],
    violet: [238 / 255, 130 / 255, 238 / 255],
    rebeccapurple: [102 / 255, 51 / 255, 153 / 255],
    skyblue: [135 / 255, 206 / 255, 235 / 255],
    slategray: [112 / 255, 128 / 255, 144 / 255],
    slategrey: [112 / 255, 128 / 255, 144 / 255],
    aliceblue: [240 / 255, 248 / 255, 1],
    beige: [245 / 255, 245 / 255, 220 / 255],
    brown: [165 / 255, 42 / 255, 42 / 255],
    chocolate: [210 / 255, 105 / 255, 30 / 255],
    cornflowerblue: [100 / 255, 149 / 255, 237 / 255],
    darkblue: [0, 0, 139 / 255],
    darkgray: [169 / 255, 169 / 255, 169 / 255],
    darkgrey: [169 / 255, 169 / 255, 169 / 255],
    darkgreen: [0, 100 / 255, 0],
    darkred: [139 / 255, 0, 0],
    deeppink: [1, 20 / 255, 147 / 255],
    deepskyblue: [0, 191 / 255, 1],
    dodgerblue: [30 / 255, 144 / 255, 1],
    firebrick: [178 / 255, 34 / 255, 34 / 255],
    forestgreen: [34 / 255, 139 / 255, 34 / 255],
    gainsboro: [220 / 255, 220 / 255, 220 / 255],
    ghostwhite: [248 / 255, 248 / 255, 1],
    hotpink: [1, 105 / 255, 180 / 255],
    ivory: [1, 1, 240 / 255],
    khaki: [240 / 255, 230 / 255, 140 / 255],
    lavender: [230 / 255, 230 / 255, 250 / 255],
    lightblue: [173 / 255, 216 / 255, 230 / 255],
    lightgray: [211 / 255, 211 / 255, 211 / 255],
    lightgrey: [211 / 255, 211 / 255, 211 / 255],
    lightgreen: [144 / 255, 238 / 255, 144 / 255],
    midnightblue: [25 / 255, 25 / 255, 112 / 255],
    mintcream: [245 / 255, 1, 250 / 255],
    orangered: [1, 69 / 255, 0],
    orchid: [218 / 255, 112 / 255, 214 / 255],
    plum: [221 / 255, 160 / 255, 221 / 255],
    royalblue: [65 / 255, 105 / 255, 225 / 255],
    salmon: [250 / 255, 128 / 255, 114 / 255],
    seagreen: [46 / 255, 139 / 255, 87 / 255],
    slateblue: [106 / 255, 90 / 255, 205 / 255],
    snow: [1, 250 / 255, 250 / 255],
    springgreen: [0, 1, 127 / 255],
    steelblue: [70 / 255, 130 / 255, 180 / 255],
    tan: [210 / 255, 180 / 255, 140 / 255],
    thistle: [216 / 255, 191 / 255, 216 / 255],
    tomato: [1, 99 / 255, 71 / 255],
    turquoise: [64 / 255, 224 / 255, 208 / 255],
    wheat: [245 / 255, 222 / 255, 179 / 255],
    whitesmoke: [245 / 255, 245 / 255, 245 / 255],
    yellowgreen: [154 / 255, 205 / 255, 50 / 255],
};

function clamp01(value: number): number {
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function linearSrgbToSrgbChannel(linear: number): number {
    if (!Number.isFinite(linear)) return 0;
    const sign = linear < 0 ? -1 : 1;
    const abs = Math.abs(linear);
    const encoded = abs <= 0.0031308 ? 12.92 * abs : 1.055 * Math.pow(abs, 1 / 2.4) - 0.055;
    return clamp01(sign * encoded);
}

export function srgbChannelToLinear(srgb: number): number {
    if (!Number.isFinite(srgb)) return 0;
    const abs = Math.abs(srgb);
    const sign = srgb < 0 ? -1 : 1;
    const linear = abs <= 0.04045 ? abs / 12.92 : Math.pow((abs + 0.055) / 1.055, 2.4);
    return sign * linear;
}

function xyzD65ToSrgb(xyzX: number, xyzY: number, xyzZ: number): [number, number, number] {
    const rLin = 3.2409699419045213 * xyzX - 1.5373831775700935 * xyzY - 0.4986107602930033 * xyzZ;
    const gLin = -0.9692436362808798 * xyzX + 1.8759675015077206 * xyzY + 0.0415550574071756 * xyzZ;
    const bLin = 0.0556300796969936 * xyzX - 0.2039769588889765 * xyzY + 1.0569715142428786 * xyzZ;
    return [
        linearSrgbToSrgbChannel(rLin),
        linearSrgbToSrgbChannel(gLin),
        linearSrgbToSrgbChannel(bLin),
    ];
}

function oklabToSrgb(lightness: number, labA: number, labB: number): [number, number, number] {
    const lRoot = lightness + 0.3963377774 * labA + 0.2158037573 * labB;
    const mRoot = lightness - 0.1055613458 * labA - 0.0638541728 * labB;
    const sRoot = lightness - 0.0894841775 * labA - 1.2914855480 * labB;
    const lCube = lRoot * lRoot * lRoot;
    const mCube = mRoot * mRoot * mRoot;
    const sCube = sRoot * sRoot * sRoot;
    const rLin = 4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube;
    const gLin = -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube;
    const bLin = -0.0041960863 * lCube - 0.7034186147 * mCube + 1.7076147010 * sCube;
    return [
        linearSrgbToSrgbChannel(rLin),
        linearSrgbToSrgbChannel(gLin),
        linearSrgbToSrgbChannel(bLin),
    ];
}

function xyzD50ToD65Srgb(xD50: number, yD50: number, zD50: number): [number, number, number] {
    const rLin = 3.1341359569958698 * xD50 - 1.6173863321612534 * yD50 - 0.49066194600835317 * zD50;
    const gLin = -0.9787955029120893 * xD50 + 1.9162545672595241 * yD50 + 0.03344273116131948 * zD50;
    const bLin = 0.07195537988411677 * xD50 - 0.2289768264158322 * yD50 + 1.4053860583241256 * zD50;
    return [
        linearSrgbToSrgbChannel(rLin),
        linearSrgbToSrgbChannel(gLin),
        linearSrgbToSrgbChannel(bLin),
    ];
}

function cieLabD50ToSrgb(lightness: number, labA: number, labB: number): [number, number, number] {
    const kappa = 24389 / 27;
    const epsilon = 216 / 24389;
    const fy = (lightness + 16) / 116;
    const fx = labA / 500 + fy;
    const fz = fy - labB / 200;

    const fx3 = fx * fx * fx;
    const fz3 = fz * fz * fz;
    const xr = fx3 > epsilon ? fx3 : (116 * fx - 16) / kappa;
    const yr = lightness > kappa * epsilon ? fy * fy * fy : lightness / kappa;
    const zr = fz3 > epsilon ? fz3 : (116 * fz - 16) / kappa;

    const xD50 = xr * (0.3457 / 0.3585);
    const zD50 = zr * ((1 - 0.3457 - 0.3585) / 0.3585);
    return xyzD50ToD65Srgb(xD50, yr, zD50);
}

function displayP3ToSrgb(redP3: number, greenP3: number, blueP3: number): [number, number, number] {
    const rLin = srgbChannelToLinear(redP3);
    const gLin = srgbChannelToLinear(greenP3);
    const bLin = srgbChannelToLinear(blueP3);
    return [
        linearSrgbToSrgbChannel(1.2249401762805598 * rLin - 0.22494017628056007 * gLin),
        linearSrgbToSrgbChannel(-0.04205695470968818 * rLin + 1.0420569547096885 * gLin),
        linearSrgbToSrgbChannel(
            -0.019637554590334415 * rLin - 0.07863604555063179 * gLin + 1.0982736001409665 * bLin,
        ),
    ];
}

function a98RgbToLinear(channel: number): number {
    if (!Number.isFinite(channel)) return 0;
    const sign = channel < 0 ? -1 : 1;
    return sign * Math.pow(Math.abs(channel), 563 / 256);
}

function a98RgbToSrgb(red: number, green: number, blue: number): [number, number, number] {
    const rLin = a98RgbToLinear(red);
    const gLin = a98RgbToLinear(green);
    const bLin = a98RgbToLinear(blue);
    return [
        linearSrgbToSrgbChannel(1.3983557439607779 * rLin - 0.39835574396077844 * gLin),
        linearSrgbToSrgbChannel(gLin),
        linearSrgbToSrgbChannel(-0.042928989294473155 * gLin + 1.0429289892944733 * bLin),
    ];
}

function proPhotoToLinear(channel: number): number {
    if (!Number.isFinite(channel)) return 0;
    const sign = channel < 0 ? -1 : 1;
    const abs = Math.abs(channel);
    return sign * (abs <= 16 / 512 ? abs / 16 : Math.pow(abs, 1.8));
}

function proPhotoToSrgb(red: number, green: number, blue: number): [number, number, number] {
    const rLin = proPhotoToLinear(red);
    const gLin = proPhotoToLinear(green);
    const bLin = proPhotoToLinear(blue);
    return [
        linearSrgbToSrgbChannel(
            2.034367530264265 * rLin - 0.7276346979586674 * gLin - 0.3067328417215192 * bLin,
        ),
        linearSrgbToSrgbChannel(
            -0.22882676452720851 * rLin + 1.2317535278163025 * gLin - 0.0029267161946770724 * bLin,
        ),
        linearSrgbToSrgbChannel(
            -0.008558453633062305 * rLin - 0.15326825265085825 * gLin + 1.1618266466134592 * bLin,
        ),
    ];
}

function rec2020ToLinear(channel: number): number {
    if (!Number.isFinite(channel)) return 0;
    const sign = channel < 0 ? -1 : 1;
    const abs = Math.abs(channel);
    const alpha = 1.09929682680944;
    const beta = 0.018053968510807;
    return sign * (abs < beta * 4.5 ? abs / 4.5 : Math.pow((abs + alpha - 1) / alpha, 1 / 0.45));
}

function rec2020ToSrgb(red: number, green: number, blue: number): [number, number, number] {
    const rLin = rec2020ToLinear(red);
    const gLin = rec2020ToLinear(green);
    const bLin = rec2020ToLinear(blue);
    return [
        linearSrgbToSrgbChannel(
            1.6604910021084347 * rLin - 0.5876411387885493 * gLin - 0.07284986331988486 * bLin,
        ),
        linearSrgbToSrgbChannel(
            -0.12455047452159085 * rLin + 1.13289989712596 * gLin - 0.008349422604369508 * bLin,
        ),
        linearSrgbToSrgbChannel(
            -0.018150763354905293 * rLin - 0.10057889800800734 * gLin + 1.118729661362913 * bLin,
        ),
    ];
}

function hwbToSrgb(hueDeg: number, whiteness: number, blackness: number): [number, number, number] {
    const w = clamp01(whiteness);
    const b = clamp01(blackness);
    if (w + b >= 1) {
        const gray = w / (w + b);
        return [gray, gray, gray];
    }
    const [red, green, blue] = hslToSrgb(hueDeg, 1, 0.5);
    const scale = 1 - w - b;
    return [clamp01(red * scale + w), clamp01(green * scale + w), clamp01(blue * scale + w)];
}

function srgbToOklab(red: number, green: number, blue: number): [number, number, number] {
    const rLin = srgbChannelToLinear(red);
    const gLin = srgbChannelToLinear(green);
    const bLin = srgbChannelToLinear(blue);
    const lRoot = Math.cbrt(0.4122214708 * rLin + 0.5363325363 * gLin + 0.0514459929 * bLin);
    const mRoot = Math.cbrt(0.2119034982 * rLin + 0.6806995451 * gLin + 0.1073969566 * bLin);
    const sRoot = Math.cbrt(0.0883024619 * rLin + 0.2817188376 * gLin + 0.6299787005 * bLin);
    return [
        0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
        1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
        0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
    ];
}

function srgbToHsl(red: number, green: number, blue: number): [number, number, number] {
    const maxC = Math.max(red, green, blue);
    const minC = Math.min(red, green, blue);
    const lightness = (maxC + minC) * 0.5;
    const delta = maxC - minC;
    if (delta <= 1e-6) return [0, 0, lightness];
    const saturation = delta / (1 - Math.abs(2 * lightness - 1));
    let hue = 0;
    if (maxC === red) {
        hue = ((green - blue) / delta) % 6;
    } else if (maxC === green) {
        hue = (blue - red) / delta + 2;
    } else {
        hue = (red - green) / delta + 4;
    }
    return [((hue * 60) % 360 + 360) % 360, saturation, lightness];
}

function srgbToXyzD65(red: number, green: number, blue: number): [number, number, number] {
    const rLin = srgbChannelToLinear(red);
    const gLin = srgbChannelToLinear(green);
    const bLin = srgbChannelToLinear(blue);
    return [
        0.4123907992659595 * rLin + 0.357584339383878 * gLin + 0.1804807884018343 * bLin,
        0.21263900587151036 * rLin + 0.715168678767756 * gLin + 0.07219231536073371 * bLin,
        0.01933081871559185 * rLin + 0.11919477979462599 * gLin + 0.9505321522496607 * bLin,
    ];
}

function xyzD65ToD50(xD65: number, yD65: number, zD65: number): [number, number, number] {
    return [
        1.0479298208405488 * xD65 + 0.022946793341019088 * yD65 - 0.05019222954313557 * zD65,
        0.029627815688159344 * xD65 + 0.990434484573249 * yD65 - 0.01707382502938514 * zD65,
        -0.009243058152591178 * xD65 + 0.015055144896577895 * yD65 + 0.7518742899580008 * zD65,
    ];
}

function srgbToCieLabD50(red: number, green: number, blue: number): [number, number, number] {
    const [xD65, yD65, zD65] = srgbToXyzD65(red, green, blue);
    const [xD50, yD50, zD50] = xyzD65ToD50(xD65, yD65, zD65);
    const xr = xD50 / (0.3457 / 0.3585);
    const yr = yD50;
    const zr = zD50 / ((1 - 0.3457 - 0.3585) / 0.3585);
    const epsilon = 216 / 24389;
    const kappa = 24389 / 27;
    const labTransfer = (ratio: number) =>
        ratio > epsilon ? Math.cbrt(ratio) : (kappa * ratio + 16) / 116;
    const fx = labTransfer(xr);
    const fy = labTransfer(yr);
    const fz = labTransfer(zr);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function srgbToHwb(red: number, green: number, blue: number): [number, number, number] {
    const [hue] = srgbToHsl(red, green, blue);
    const whiteness = Math.min(red, green, blue);
    const blackness = 1 - Math.max(red, green, blue);
    return [hue, whiteness, blackness];
}

export function computeRelativeLuminance(color: string | readonly [number, number, number]): number {
    const rgb = typeof color === "string" ? (parseCssColorToRgbaReadonly(color) ?? [1, 1, 1]) : color;
    const rLin = srgbChannelToLinear(rgb[0]);
    const gLin = srgbChannelToLinear(rgb[1]);
    const bLin = srgbChannelToLinear(rgb[2]);
    return Math.max(0, 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin);
}

export function computeWcagContrastRatio(
    foreground: string | readonly [number, number, number],
    background: string | readonly [number, number, number],
): number {
    const lumaFirst = computeRelativeLuminance(foreground);
    const lumaSecond = computeRelativeLuminance(background);
    const lighter = Math.max(lumaFirst, lumaSecond);
    const darker = Math.min(lumaFirst, lumaSecond);
    return (lighter + 0.05) / (darker + 0.05);
}

function interpolateHueDeg(hueA: number, hueB: number, t: number, mode: string): number {
    const a = ((hueA % 360) + 360) % 360;
    const b = ((hueB % 360) + 360) % 360;
    let delta = b - a;
    if (mode === "longer") {
        if (delta >= 0 && delta < 180) delta -= 360;
        else if (delta < 0 && delta > -180) delta += 360;
    } else if (mode === "increasing") {
        if (delta < 0) delta += 360;
    } else if (mode === "decreasing") {
        if (delta > 0) delta -= 360;
    } else {
        if (delta > 180) delta -= 360;
        else if (delta < -180) delta += 360;
    }
    return ((a + delta * t) % 360 + 360) % 360;
}

function hslToSrgb(hueDeg: number, sat: number, light: number): [number, number, number] {
    const wrappedHue = ((hueDeg % 360) + 360) % 360;
    const saturation = clamp01(sat);
    const lightness = clamp01(light);
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const hueSector = wrappedHue / 60;
    const second = chroma * (1 - Math.abs((hueSector % 2) - 1));
    const match = lightness - chroma * 0.5;
    let r = 0;
    let g = 0;
    let b = 0;
    if (hueSector < 1) {
        r = chroma;
        g = second;
    } else if (hueSector < 2) {
        r = second;
        g = chroma;
    } else if (hueSector < 3) {
        g = chroma;
        b = second;
    } else if (hueSector < 4) {
        g = second;
        b = chroma;
    } else if (hueSector < 5) {
        r = second;
        b = chroma;
    } else {
        r = chroma;
        b = second;
    }
    return [clamp01(r + match), clamp01(g + match), clamp01(b + match)];
}

export function parseCssAngleDegrees(token: string): number {
    const trimmed = token.trim().toLowerCase();
    const numeric = parseFloat(trimmed);
    if (!Number.isFinite(numeric)) return 0;
    if (trimmed.endsWith("grad")) return numeric * 0.9;
    if (trimmed.endsWith("rad")) return (numeric * 180) / Math.PI;
    if (trimmed.endsWith("turn")) return numeric * 360;
    return numeric;
}

function parseNumericOrPercent(token: string, percentScale: number, unitScale = 1): number {
    const trimmed = token.trim();
    if (trimmed === "none") return 0;
    const numeric = parseFloat(trimmed);
    if (!Number.isFinite(numeric)) return 0;
    return trimmed.endsWith("%") ? (numeric / 100) * percentScale : numeric * unitScale;
}

function parseAlphaToken(token: string | undefined): number {
    if (!token) return 1;
    const trimmed = token.trim();
    if (trimmed === "none") return 0;
    const numeric = parseFloat(trimmed);
    if (!Number.isFinite(numeric)) return 1;
    return clamp01(trimmed.endsWith("%") ? numeric / 100 : numeric);
}

function splitColorFunctionArgs(inner: string): { args: string[]; alpha: number } {
    const slashIndex = inner.indexOf("/");
    const head = (slashIndex >= 0 ? inner.slice(0, slashIndex) : inner).trim();
    const tail = slashIndex >= 0 ? inner.slice(slashIndex + 1).trim() : undefined;
    if (head.includes(",")) {
        const parts = head.split(",").map((part) => part.trim()).filter(Boolean);
        return {
            args: parts.slice(0, 3),
            alpha: tail !== undefined ? parseAlphaToken(tail) : parseAlphaToken(parts[3]),
        };
    }
    const parts = head.split(/\s+/).filter(Boolean);
    return {
        args: parts,
        alpha: parseAlphaToken(tail),
    };
}

function splitTopLevelByComma(text: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < text.length; index++) {
        const ch = text[index]!;
        if (ch === "(") {
            depth += 1;
        } else if (ch === ")" && depth > 0) {
            depth -= 1;
        } else if (ch === "," && depth === 0) {
            const slice = text.slice(start, index).trim();
            if (slice) parts.push(slice);
            start = index + 1;
        }
    }
    const tail = text.slice(start).trim();
    if (tail) parts.push(tail);
    return parts;
}

const LEADING_PERCENT_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)%)\s+([\s\S]+)$/;
const TRAILING_PERCENT_RE = /^([\s\S]+?)\s+([+-]?(?:\d+\.?\d*|\.\d+)%)$/;
const MAX_COLOR_MIX_DEPTH = 4;

interface ColorMixFrame {
    space: string;
    hueMode: string;
    weight2: number;
    alphaMultiplier: number;
    expr1: string;
    expr2: string;
    rgba1: [number, number, number, number] | null;
    rgba2: [number, number, number, number] | null;
}

function parseColorMixStopExpr(component: string): { expr: string; percent: number | null } | null {
    const trimmed = component.trim();
    if (!trimmed) return null;
    const trailingMatch = trimmed.match(TRAILING_PERCENT_RE);
    if (trailingMatch) {
        const pct = parseFloat(trailingMatch[2]!);
        if (Number.isFinite(pct)) {
            return { expr: trailingMatch[1]!.trim(), percent: pct };
        }
    }
    const leadingMatch = trimmed.match(LEADING_PERCENT_RE);
    if (leadingMatch) {
        const pct = parseFloat(leadingMatch[1]!);
        if (Number.isFinite(pct)) {
            return { expr: leadingMatch[2]!.trim(), percent: pct };
        }
    }
    return { expr: trimmed, percent: null };
}

function createColorMixFrame(inner: string): ColorMixFrame | null {
    const commaParts = splitTopLevelByComma(inner);
    if (commaParts.length !== 3) return null;

    const methodTokens = commaParts[0]!.toLowerCase().split(/\s+/).filter(Boolean);
    if (methodTokens[0] !== "in" || methodTokens.length < 2) return null;
    const space = methodTokens[1]!;
    const hueMode = methodTokens[2] ?? "shorter";

    const stop1 = parseColorMixStopExpr(commaParts[1]!);
    const stop2 = parseColorMixStopExpr(commaParts[2]!);
    if (!stop1 || !stop2) return null;

    let p1 = stop1.percent;
    let p2 = stop2.percent;
    if (p1 === null && p2 === null) {
        p1 = 50;
        p2 = 50;
    } else if (p1 !== null && p2 === null) {
        p2 = 100 - p1;
    } else if (p1 === null && p2 !== null) {
        p1 = 100 - p2;
    }
    const total = p1! + p2!;
    if (total <= 0) return null;

    return {
        space,
        hueMode,
        weight2: p2! / total,
        alphaMultiplier: total < 100 ? total / 100 : 1,
        expr1: stop1.expr,
        expr2: stop2.expr,
        rgba1: null,
        rgba2: null,
    };
}

function mixResolvedRgba(
    space: string,
    hueMode: string,
    weight2: number,
    alphaMultiplier: number,
    c1: [number, number, number, number],
    c2: [number, number, number, number],
): [number, number, number, number] {
    const mixedAlpha = clamp01(((1 - weight2) * c1[3] + weight2 * c2[3]) * alphaMultiplier);
    const w1 = (1 - weight2) * c1[3];
    const w2 = weight2 * c2[3];
    const denom = w1 + w2;
    if (denom <= 1e-6) return [0, 0, 0, 0];

    if (space === "srgb-linear") {
        return [
            linearSrgbToSrgbChannel((srgbChannelToLinear(c1[0]) * w1 + srgbChannelToLinear(c2[0]) * w2) / denom),
            linearSrgbToSrgbChannel((srgbChannelToLinear(c1[1]) * w1 + srgbChannelToLinear(c2[1]) * w2) / denom),
            linearSrgbToSrgbChannel((srgbChannelToLinear(c1[2]) * w1 + srgbChannelToLinear(c2[2]) * w2) / denom),
            mixedAlpha,
        ];
    }

    if (space === "oklab") {
        const lab1 = srgbToOklab(c1[0], c1[1], c1[2]);
        const lab2 = srgbToOklab(c2[0], c2[1], c2[2]);
        const [r, g, b] = oklabToSrgb(
            (lab1[0] * w1 + lab2[0] * w2) / denom,
            (lab1[1] * w1 + lab2[1] * w2) / denom,
            (lab1[2] * w1 + lab2[2] * w2) / denom,
        );
        return [r, g, b, mixedAlpha];
    }

    if (space === "oklch") {
        const lab1 = srgbToOklab(c1[0], c1[1], c1[2]);
        const lab2 = srgbToOklab(c2[0], c2[1], c2[2]);
        const chr1 = Math.hypot(lab1[1], lab1[2]);
        const chr2 = Math.hypot(lab2[1], lab2[2]);
        const hue1 = (Math.atan2(lab1[2], lab1[1]) * 180) / Math.PI;
        const hue2 = (Math.atan2(lab2[2], lab2[1]) * 180) / Math.PI;
        const mixedL = (lab1[0] * w1 + lab2[0] * w2) / denom;
        const mixedC = (chr1 * w1 + chr2 * w2) / denom;
        const powerless1 = w1 <= 1e-6 || chr1 < 1e-4;
        const powerless2 = w2 <= 1e-6 || chr2 < 1e-4;
        const mixedH = powerless1
            ? hue2
            : powerless2
              ? hue1
              : interpolateHueDeg(hue1, hue2, weight2, hueMode);
        const hRad = (mixedH * Math.PI) / 180;
        const [r, g, b] = oklabToSrgb(mixedL, mixedC * Math.cos(hRad), mixedC * Math.sin(hRad));
        return [r, g, b, mixedAlpha];
    }

    if (space === "lab") {
        const lab1 = srgbToCieLabD50(c1[0], c1[1], c1[2]);
        const lab2 = srgbToCieLabD50(c2[0], c2[1], c2[2]);
        const [r, g, b] = cieLabD50ToSrgb(
            (lab1[0] * w1 + lab2[0] * w2) / denom,
            (lab1[1] * w1 + lab2[1] * w2) / denom,
            (lab1[2] * w1 + lab2[2] * w2) / denom,
        );
        return [r, g, b, mixedAlpha];
    }

    if (space === "lch") {
        const lab1 = srgbToCieLabD50(c1[0], c1[1], c1[2]);
        const lab2 = srgbToCieLabD50(c2[0], c2[1], c2[2]);
        const chr1 = Math.hypot(lab1[1], lab1[2]);
        const chr2 = Math.hypot(lab2[1], lab2[2]);
        const hue1 = (Math.atan2(lab1[2], lab1[1]) * 180) / Math.PI;
        const hue2 = (Math.atan2(lab2[2], lab2[1]) * 180) / Math.PI;
        const mixedL = (lab1[0] * w1 + lab2[0] * w2) / denom;
        const mixedC = (chr1 * w1 + chr2 * w2) / denom;
        const powerless1 = w1 <= 1e-6 || chr1 < 1e-4;
        const powerless2 = w2 <= 1e-6 || chr2 < 1e-4;
        const mixedH = powerless1
            ? hue2
            : powerless2
              ? hue1
              : interpolateHueDeg(hue1, hue2, weight2, hueMode);
        const hRad = (mixedH * Math.PI) / 180;
        const [r, g, b] = cieLabD50ToSrgb(mixedL, mixedC * Math.cos(hRad), mixedC * Math.sin(hRad));
        return [r, g, b, mixedAlpha];
    }

    if (space === "hsl") {
        const hsl1 = srgbToHsl(c1[0], c1[1], c1[2]);
        const hsl2 = srgbToHsl(c2[0], c2[1], c2[2]);
        const powerless1 = w1 <= 1e-6 || hsl1[1] < 1e-4;
        const powerless2 = w2 <= 1e-6 || hsl2[1] < 1e-4;
        const mixedH = powerless1
            ? hsl2[0]
            : powerless2
              ? hsl1[0]
              : interpolateHueDeg(hsl1[0], hsl2[0], weight2, hueMode);
        const [r, g, b] = hslToSrgb(
            mixedH,
            (hsl1[1] * w1 + hsl2[1] * w2) / denom,
            (hsl1[2] * w1 + hsl2[2] * w2) / denom,
        );
        return [r, g, b, mixedAlpha];
    }

    if (space === "hwb") {
        const hwb1 = srgbToHwb(c1[0], c1[1], c1[2]);
        const hwb2 = srgbToHwb(c2[0], c2[1], c2[2]);
        const powerless1 = w1 <= 1e-6 || hwb1[1] + hwb1[2] >= 0.9999;
        const powerless2 = w2 <= 1e-6 || hwb2[1] + hwb2[2] >= 0.9999;
        const mixedH = powerless1
            ? hwb2[0]
            : powerless2
              ? hwb1[0]
              : interpolateHueDeg(hwb1[0], hwb2[0], weight2, hueMode);
        const [r, g, b] = hwbToSrgb(
            mixedH,
            (hwb1[1] * w1 + hwb2[1] * w2) / denom,
            (hwb1[2] * w1 + hwb2[2] * w2) / denom,
        );
        return [r, g, b, mixedAlpha];
    }

    if (space === "xyz" || space === "xyz-d65") {
        const xyz1 = srgbToXyzD65(c1[0], c1[1], c1[2]);
        const xyz2 = srgbToXyzD65(c2[0], c2[1], c2[2]);
        const [r, g, b] = xyzD65ToSrgb(
            (xyz1[0] * w1 + xyz2[0] * w2) / denom,
            (xyz1[1] * w1 + xyz2[1] * w2) / denom,
            (xyz1[2] * w1 + xyz2[2] * w2) / denom,
        );
        return [r, g, b, mixedAlpha];
    }

    if (space === "xyz-d50") {
        const xyz1 = xyzD65ToD50(...srgbToXyzD65(c1[0], c1[1], c1[2]));
        const xyz2 = xyzD65ToD50(...srgbToXyzD65(c2[0], c2[1], c2[2]));
        const [r, g, b] = xyzD50ToD65Srgb(
            (xyz1[0] * w1 + xyz2[0] * w2) / denom,
            (xyz1[1] * w1 + xyz2[1] * w2) / denom,
            (xyz1[2] * w1 + xyz2[2] * w2) / denom,
        );
        return [r, g, b, mixedAlpha];
    }

    if (space === "display-p3") {
        const linearToP3 = (xD65: number, yD65: number, zD65: number): [number, number, number] => [
            linearSrgbToSrgbChannel(2.493496911941425 * xD65 - 0.9313836179191237 * yD65 - 0.4027107844507168 * zD65),
            linearSrgbToSrgbChannel(-0.8294889695615747 * xD65 + 1.7626640603183459 * yD65 + 0.023624685841943584 * zD65),
            linearSrgbToSrgbChannel(0.03584583024378436 * xD65 - 0.07617238926804176 * yD65 + 0.9568845240076871 * zD65),
        ];
        const p3First = linearToP3(...srgbToXyzD65(c1[0], c1[1], c1[2]));
        const p3Second = linearToP3(...srgbToXyzD65(c2[0], c2[1], c2[2]));
        const [r, g, b] = displayP3ToSrgb(
            (p3First[0] * w1 + p3Second[0] * w2) / denom,
            (p3First[1] * w1 + p3Second[1] * w2) / denom,
            (p3First[2] * w1 + p3Second[2] * w2) / denom,
        );
        return [r, g, b, mixedAlpha];
    }

    return [
        clamp01((c1[0] * w1 + c2[0] * w2) / denom),
        clamp01((c1[1] * w1 + c2[1] * w2) / denom),
        clamp01((c1[2] * w1 + c2[2] * w2) / denom),
        mixedAlpha,
    ];
}

const MAX_CSS_COLOR_CACHE_ENTRIES = 256;
const cssColorCache = new Map<string, readonly [number, number, number, number] | null>();

function hexNibble(code: number): number {
    if (code >= 48 && code <= 57) return code - 48;
    if (code >= 65 && code <= 70) return code - 55;
    if (code >= 97 && code <= 102) return code - 87;
    return -1;
}

function parseHexColor(trimmed: string): [number, number, number, number] | null {
    const hexLen = trimmed.length - 1;
    if (hexLen === 3 || hexLen === 4) {
        const r = hexNibble(trimmed.charCodeAt(1));
        const g = hexNibble(trimmed.charCodeAt(2));
        const b = hexNibble(trimmed.charCodeAt(3));
        const a = hexLen === 4 ? hexNibble(trimmed.charCodeAt(4)) : 15;
        if ((r | g | b | a) < 0) return null;
        return [r / 15, g / 15, b / 15, a / 15];
    }
    if (hexLen === 6 || hexLen === 8) {
        const r0 = hexNibble(trimmed.charCodeAt(1));
        const r1 = hexNibble(trimmed.charCodeAt(2));
        const g0 = hexNibble(trimmed.charCodeAt(3));
        const g1 = hexNibble(trimmed.charCodeAt(4));
        const b0 = hexNibble(trimmed.charCodeAt(5));
        const b1 = hexNibble(trimmed.charCodeAt(6));
        const a0 = hexLen === 8 ? hexNibble(trimmed.charCodeAt(7)) : 15;
        const a1 = hexLen === 8 ? hexNibble(trimmed.charCodeAt(8)) : 15;
        if ((r0 | r1 | g0 | g1 | b0 | b1 | a0 | a1) < 0) return null;
        return [
            ((r0 << 4) | r1) / 255,
            ((g0 << 4) | g1) / 255,
            ((b0 << 4) | b1) / 255,
            ((a0 << 4) | a1) / 255,
        ];
    }
    return null;
}

function parseFastCommaRgb(trimmed: string): [number, number, number, number] | null {
    const len = trimmed.length;
    if (len < 10 || trimmed.charCodeAt(len - 1) !== 41) return null;
    const c0 = trimmed.charCodeAt(0) | 32;
    const c1 = trimmed.charCodeAt(1) | 32;
    const c2 = trimmed.charCodeAt(2) | 32;
    if (c0 !== 114 || c1 !== 103 || c2 !== 98) return null;
    let cursor = 3;
    const c3 = trimmed.charCodeAt(3);
    if ((c3 | 32) === 97) {
        if (trimmed.charCodeAt(4) !== 40) return null;
        cursor = 5;
    } else if (c3 === 40) {
        cursor = 4;
    } else {
        return null;
    }
    const end = len - 1;
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 1;
    for (let comp = 0; comp < 4; comp++) {
        while (cursor < end && trimmed.charCodeAt(cursor) <= 32) cursor++;
        let intPart = 0;
        let fracPart = 0;
        let fracDiv = 1;
        let hasDigits = false;
        while (cursor < end) {
            const ch = trimmed.charCodeAt(cursor);
            if (ch >= 48 && ch <= 57) {
                intPart = intPart * 10 + (ch - 48);
                hasDigits = true;
                cursor++;
            } else {
                break;
            }
        }
        if (cursor < end && trimmed.charCodeAt(cursor) === 46) {
            cursor++;
            while (cursor < end) {
                const ch = trimmed.charCodeAt(cursor);
                if (ch >= 48 && ch <= 57) {
                    fracPart = fracPart * 10 + (ch - 48);
                    fracDiv *= 10;
                    hasDigits = true;
                    cursor++;
                } else {
                    break;
                }
            }
        }
        if (!hasDigits) return null;
        const val = intPart + fracPart / fracDiv;
        while (cursor < end && trimmed.charCodeAt(cursor) <= 32) cursor++;
        if (comp === 0) r = val;
        else if (comp === 1) g = val;
        else if (comp === 2) b = val;
        else a = val;
        if (comp < 2) {
            if (cursor >= end || trimmed.charCodeAt(cursor) !== 44) return null;
            cursor++;
        } else if (comp === 2) {
            if (cursor === end) break;
            if (trimmed.charCodeAt(cursor) !== 44) return null;
            cursor++;
        } else if (cursor !== end) {
            return null;
        }
    }
    return [clamp01(r / 255), clamp01(g / 255), clamp01(b / 255), clamp01(a)];
}

function parseLeafCssColorToRgba(colorStr: string): [number, number, number, number] | null {
    const trimmed = colorStr.trim();
    if (!trimmed) return null;
    const firstCode = trimmed.charCodeAt(0);
    if (firstCode === 35) {
        return parseHexColor(trimmed);
    }
    if (firstCode === 114 || firstCode === 82) {
        const fastRgb = parseFastCommaRgb(trimmed);
        if (fastRgb) return fastRgb;
    }
    const lower = trimmed.toLowerCase();
    if (lower === "transparent") {
        return [0, 0, 0, 0];
    }
    const named = NAMED_CSS_RGB[lower];
    if (named) {
        return [named[0], named[1], named[2], 1];
    }

    const fnMatch = trimmed.match(/^([a-zA-Z-]+)\(([\s\S]+)\)$/);
    if (!fnMatch) return null;
    const fnName = fnMatch[1]!.toLowerCase();
    const { args, alpha } = splitColorFunctionArgs(fnMatch[2]!);

    if (fnName === "rgb" || fnName === "rgba") {
        if (args.length < 3) return null;
        return [
            clamp01(parseNumericOrPercent(args[0]!, 1, 1 / 255)),
            clamp01(parseNumericOrPercent(args[1]!, 1, 1 / 255)),
            clamp01(parseNumericOrPercent(args[2]!, 1, 1 / 255)),
            alpha,
        ];
    }

    if (fnName === "hsl" || fnName === "hsla") {
        if (args.length < 3) return null;
        const [red, green, blue] = hslToSrgb(
            parseCssAngleDegrees(args[0]!),
            parseNumericOrPercent(args[1]!, 1, 0.01),
            parseNumericOrPercent(args[2]!, 1, 0.01),
        );
        return [red, green, blue, alpha];
    }

    if (fnName === "hwb") {
        if (args.length < 3) return null;
        const [red, green, blue] = hwbToSrgb(
            parseCssAngleDegrees(args[0]!),
            parseNumericOrPercent(args[1]!, 1, 0.01),
            parseNumericOrPercent(args[2]!, 1, 0.01),
        );
        return [red, green, blue, alpha];
    }

    if (fnName === "oklab" || fnName === "oklch") {
        if (args.length < 3) return null;
        const lightness = clamp01(parseNumericOrPercent(args[0]!, 1, 1));
        if (fnName === "oklab") {
            const labA = parseNumericOrPercent(args[1]!, 0.4, 1);
            const labB = parseNumericOrPercent(args[2]!, 0.4, 1);
            const [red, green, blue] = oklabToSrgb(lightness, labA, labB);
            return [red, green, blue, alpha];
        }
        const chroma = Math.max(0, parseNumericOrPercent(args[1]!, 0.4, 1));
        const hueRad = (parseCssAngleDegrees(args[2]!) * Math.PI) / 180;
        const [red, green, blue] = oklabToSrgb(
            lightness,
            chroma * Math.cos(hueRad),
            chroma * Math.sin(hueRad),
        );
        return [red, green, blue, alpha];
    }

    if (fnName === "lab" || fnName === "lch") {
        if (args.length < 3) return null;
        const lightness = Math.max(0, parseNumericOrPercent(args[0]!, 100, 1));
        if (fnName === "lab") {
            const labA = parseNumericOrPercent(args[1]!, 125, 1);
            const labB = parseNumericOrPercent(args[2]!, 125, 1);
            const [red, green, blue] = cieLabD50ToSrgb(lightness, labA, labB);
            return [red, green, blue, alpha];
        }
        const chroma = Math.max(0, parseNumericOrPercent(args[1]!, 150, 1));
        const hueRad = (parseCssAngleDegrees(args[2]!) * Math.PI) / 180;
        const [red, green, blue] = cieLabD50ToSrgb(
            lightness,
            chroma * Math.cos(hueRad),
            chroma * Math.sin(hueRad),
        );
        return [red, green, blue, alpha];
    }

    if (fnName === "color") {
        if (args.length < 4) return null;
        const space = args[0]!.toLowerCase();
        const c1 = parseNumericOrPercent(args[1]!, 1, 1);
        const c2 = parseNumericOrPercent(args[2]!, 1, 1);
        const c3 = parseNumericOrPercent(args[3]!, 1, 1);
        if (space === "srgb") {
            return [clamp01(c1), clamp01(c2), clamp01(c3), alpha];
        }
        if (space === "srgb-linear") {
            return [
                linearSrgbToSrgbChannel(c1),
                linearSrgbToSrgbChannel(c2),
                linearSrgbToSrgbChannel(c3),
                alpha,
            ];
        }
        if (space === "display-p3") {
            const [red, green, blue] = displayP3ToSrgb(c1, c2, c3);
            return [red, green, blue, alpha];
        }
        if (space === "a98-rgb") {
            const [red, green, blue] = a98RgbToSrgb(c1, c2, c3);
            return [red, green, blue, alpha];
        }
        if (space === "prophoto-rgb") {
            const [red, green, blue] = proPhotoToSrgb(c1, c2, c3);
            return [red, green, blue, alpha];
        }
        if (space === "rec2020") {
            const [red, green, blue] = rec2020ToSrgb(c1, c2, c3);
            return [red, green, blue, alpha];
        }
        if (space === "xyz" || space === "xyz-d65") {
            const [red, green, blue] = xyzD65ToSrgb(c1, c2, c3);
            return [red, green, blue, alpha];
        }
        if (space === "xyz-d50") {
            const [red, green, blue] = xyzD50ToD65Srgb(c1, c2, c3);
            return [red, green, blue, alpha];
        }
    }

    return null;
}

const COLOR_MIX_WRAPPER_RE = /^color-mix\(([\s\S]+)\)$/i;

function parseCssColorToRgbaUncached(trimmed: string): [number, number, number, number] | null {
    if (!trimmed) return null;
    const rootMixMatch =
        trimmed.length > 10 &&
        (trimmed.charCodeAt(0) === 99 || trimmed.charCodeAt(0) === 67 )
            ? trimmed.match(COLOR_MIX_WRAPPER_RE)
            : null;
    if (!rootMixMatch) {
        return parseLeafCssColorToRgba(trimmed);
    }

    const rootFrame = createColorMixFrame(rootMixMatch[1]!);
    if (!rootFrame) return null;
    const stack: ColorMixFrame[] = [rootFrame];

    while (stack.length > 0) {
        const frame = stack[stack.length - 1]!;
        if (frame.rgba1 === null) {
            const mixMatch = frame.expr1.match(COLOR_MIX_WRAPPER_RE);
            if (mixMatch) {
                if (stack.length >= MAX_COLOR_MIX_DEPTH) return null;
                const child = createColorMixFrame(mixMatch[1]!);
                if (!child) return null;
                stack.push(child);
                continue;
            }
            const parsed = parseLeafCssColorToRgba(frame.expr1);
            if (!parsed) return null;
            frame.rgba1 = parsed;
        }
        if (frame.rgba2 === null) {
            const mixMatch = frame.expr2.match(COLOR_MIX_WRAPPER_RE);
            if (mixMatch) {
                if (stack.length >= MAX_COLOR_MIX_DEPTH) return null;
                const child = createColorMixFrame(mixMatch[1]!);
                if (!child) return null;
                stack.push(child);
                continue;
            }
            const parsed = parseLeafCssColorToRgba(frame.expr2);
            if (!parsed) return null;
            frame.rgba2 = parsed;
        }

        const completed = stack.pop()!;
        const mixed = mixResolvedRgba(
            completed.space,
            completed.hueMode,
            completed.weight2,
            completed.alphaMultiplier,
            completed.rgba1!,
            completed.rgba2!,
        );
        if (stack.length === 0) {
            return mixed;
        }
        const parent = stack[stack.length - 1]!;
        if (parent.rgba1 === null) {
            parent.rgba1 = mixed;
        } else {
            parent.rgba2 = mixed;
        }
    }

    return null;
}

export function parseCssColorToRgbaReadonly(
    colorStr = "#ffffff",
): readonly [number, number, number, number] | null {
    const cached = cssColorCache.get(colorStr);
    if (cached !== undefined) {
        if (cssColorCache.size >= MAX_CSS_COLOR_CACHE_ENTRIES) {
            cssColorCache.delete(colorStr);
            cssColorCache.set(colorStr, cached);
        }
        return cached;
    }
    const len = colorStr.length;
    const needsTrim = len > 0 && (colorStr.charCodeAt(0) <= 32 || colorStr.charCodeAt(len - 1) <= 32);
    const parsed = parseCssColorToRgbaUncached(needsTrim ? colorStr.trim() : colorStr);
    if (cssColorCache.size >= MAX_CSS_COLOR_CACHE_ENTRIES) {
        const oldestKey = cssColorCache.keys().next().value;
        if (oldestKey !== undefined) {
            cssColorCache.delete(oldestKey);
        }
    }
    cssColorCache.set(colorStr, parsed);
    return parsed;
}

export function parseCssColorToRgba(colorStr = "#ffffff"): [number, number, number, number] | null {
    const parsed = parseCssColorToRgbaReadonly(colorStr);
    return parsed ? [parsed[0], parsed[1], parsed[2], parsed[3]] : null;
}

export function parseCssColorToRgb(colorStr = "#ffffff"): [number, number, number] {
    if (colorStr === "transparent" || colorStr.trim().toLowerCase() === "transparent") {
        return [1, 1, 1];
    }
    const parsed = parseCssColorToRgbaReadonly(colorStr);
    return parsed ? [parsed[0], parsed[1], parsed[2]] : [1, 1, 1];
}
