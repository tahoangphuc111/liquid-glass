const ADDR_STATE_PREV_W: usize = 0x00000;
const ADDR_STATE_PREV_H: usize = 0x00004;
const ADDR_STATE_PREV_CORNER: usize = 0x00008;
const ADDR_STATE_PREV_HORIZ_BEZEL: usize = 0x0000C;
const ADDR_STATE_LAST_SURFACE: usize = 0x00010;
const ADDR_STATE_LAST_RHO_QUANT: usize = 0x00014;
const ADDR_STATE_LAST_IOR: usize = 0x00018;
const ADDR_STATE_UNIT_MAX: usize = 0x0001C;
const ADDR_STATE_MAX_DISP: usize = 0x00020;
const ADDR_STATE_LAST_SCALE: usize = 0x00024;
const ADDR_STATE_PREV_COL_BEZEL: usize = 0x00030;
const ADDR_STATE_IDX_A: usize = 0x00034;
const ADDR_STATE_IDX_B: usize = 0x00038;
const ADDR_STATE_LAST_FLAGS: usize = 0x0003C;
const ADDR_STATE_LAST_RADIUS: usize = 0x00040;
const ADDR_STATE_LAST_CLAMPED_BEZEL: usize = 0x00044;
const ADDR_STATE_LAST_THICKNESS: usize = 0x00048;
const ADDR_STATE_BASIS_SURF: usize = 0x0004C;
const ADDR_STATE_BASIS_IOR: usize = 0x00050;
const ADDR_STATE_NORM_RING: usize = 0x00054;
const ADDR_STATE_EDGE_RING: usize = 0x00058;
const ADDR_STATE_CORNER_RING: usize = 0x0005C;
const ADDR_STATE_PREV_CORNER_SLOT: usize = 0x00060;
const ADDR_STATE_LAST_TOTAL_BYTES: usize = 0x00064;
const ADDR_STATE_PREV_GEOM_RAD: usize = 0x00068;
const ADDR_STATE_PREV_SCALED_BEZ: usize = 0x0006C;
const ADDR_STATE_DIRTY_MAX_PX: usize = 0x00070;

const ADDR_SURFACE_LUTS: usize = 0x00400;
const SURFACE_STRIDE: usize = 1536;

const ADDR_IGN: usize = 0x01C00;

const ADDR_VEC_A: usize = 0x02000;
const ADDR_VEC_B: usize = 0x02200;
const ADDR_SCRATCH_NORM: usize = 0x02410;

const ADDR_NORM_DIR_HASH: usize = 0x02800;
const ADDR_NORM_DIR_IOR: usize = 0x02820;
const ADDR_NORM_DIR_UMAX: usize = 0x02840;
const ADDR_EDGE_DIR_HASH: usize = 0x02860;
const ADDR_EDGE_DIR_BEZ: usize = 0x02880;
const ADDR_CORNER_DIR_NORM: usize = 0x028A0;
const ADDR_CORNER_DIR_RAD: usize = 0x028B0;
const ADDR_CORNER_DIR_BEZ: usize = 0x028C0;
const ADDR_CORNER_DIR_VALID: usize = 0x028D0;

const ADDR_PREV_XLO: usize = 0x02900;
const ADDR_PREV_XHI: usize = 0x02A00;

const ADDR_K_LUT: usize = 0x03000;
const ADDR_SURFACE_C: usize = 0x03400;

const ADDR_NORM_CACHE: usize = 0x04000;
const ADDR_EDGE_CACHE: usize = 0x05000;
const ADDR_CORNER_META_CACHE: usize = 0x0D000;

const ADDR_BMP_HEADER: usize = 0x14C00;
const ADDR_BMP_PAYLOAD: usize = 0x14C40;
const ADDR_CORNER_STREAM_CACHE: usize = 0x94C40;

const BMP_HEADER_SIZE: i32 = 64;
const MAX_PIXELS: i32 = 131072;
const NEUTRAL_PIXEL: u32 = 0xFF808080;

let tempHeight: f32 = 0.0;
let tempDerivative: f32 = 0.0;

@inline
function evalConvexSquircle(x: f32): void {
    let u: f32 = 1.0 - x;
    let u2: f32 = u * u;
    let u4: f32 = u2 * u2;
    let omU2: f32 = (1.0 - u2 > <f32>1e-10) ? (1.0 - u2) : <f32>1e-10;
    let omU4: f32 = (1.0 - u4 > <f32>1e-10) ? (1.0 - u4) : <f32>1e-10;
    let c: f32 = Mathf.sqrt(omU2);
    let s2: f32 = Mathf.sqrt(omU4);
    let s: f32 = Mathf.sqrt(s2);
    let s3: f32 = s * s2;
    let invCS3: f32 = 1.0 / (c * s3);
    tempHeight = <f32>0.70 * s + <f32>0.30 * c;
    tempDerivative = u * (<f32>0.70 * u2 * c + <f32>0.30 * s3) * invCS3;
}

@inline
function evalConvexCircle(x: f32): void {
    let u: f32 = 1.0 - x;
    let omU2: f32 = (1.0 - u * u > <f32>1e-10) ? (1.0 - u * u) : <f32>1e-10;
    let c: f32 = Mathf.sqrt(omU2);
    tempHeight = c;
    tempDerivative = u / c;
}

@inline
function evalLinear(x: f32): void {
    tempHeight = x < 0.0 ? 0.0 : (x > 1.0 ? 1.0 : x);
    tempDerivative = (x > 0.0 && x < 1.0) ? 1.0 : 0.0;
}

@inline
function evalLip(x: f32): void {
    let u: f32 = 1.0 - x;
    let xu: f32 = x * u;
    let xu2: f32 = xu * xu;
    let x2: f32 = x * x;

    let sinPiX: f32 = (16.0 * xu) / (5.0 - 4.0 * xu);
    let cosAbs: f32 = Mathf.sqrt(1.0 - sinPiX * sinPiX > 0.0 ? 1.0 - sinPiX * sinPiX : 0.0);
    let cosPiX: f32 = x <= 0.5 ? cosAbs : -cosAbs;

    let concave: f32 = x2 * (3.0 - 2.0 * x) - <f32>0.15 * xu2 * sinPiX;
    let dConcave: f32 = 6.0 * xu - <f32>0.15 * (2.0 * xu * (1.0 - 2.0 * x) * sinPiX + <f32>Math.PI * xu2 * cosPiX);

    let convex: f32;
    let dConvex: f32;
    if (x < 0.5) {
        let ucd: f32 = 1.0 - 2.0 * x;
        let comp2: f32 = ucd * ucd;
        let omC4: f32 = (1.0 - comp2 * comp2 > <f32>1e-10) ? (1.0 - comp2 * comp2) : <f32>1e-10;
        let s2: f32 = Mathf.sqrt(omC4);
        let s: f32 = Mathf.sqrt(s2);
        convex = s;
        dConvex = (2.0 * ucd * comp2) / (s * s2);
    } else {
        convex = 1.0;
        dConvex = 0.0;
    }

    let t: f32 = ((6.0 * x - 15.0) * x + 10.0) * x2 * x;
    let dt: f32 = 30.0 * xu2;

    tempHeight = convex * (1.0 - t) + concave * t;
    tempDerivative = dConvex * (1.0 - t) + dConcave * t + (concave - convex) * dt;
}

@inline
function reduceBestIndex(vMax: v128, vIdx: v128): i32 {
    let bestVal: f32 = f32x4.extract_lane(vMax, 0);
    let bestIdx: i32 = i32x4.extract_lane(vIdx, 0);
    let m1: f32 = f32x4.extract_lane(vMax, 1);
    let i1: i32 = i32x4.extract_lane(vIdx, 1);
    if (m1 > bestVal) { bestVal = m1; bestIdx = i1; }
    let m2: f32 = f32x4.extract_lane(vMax, 2);
    let i2: i32 = i32x4.extract_lane(vIdx, 2);
    if (m2 > bestVal) { bestVal = m2; bestIdx = i2; }
    let m3: f32 = f32x4.extract_lane(vMax, 3);
    let i3: i32 = i32x4.extract_lane(vIdx, 3);
    if (m3 > bestVal) { bestIdx = i3; }
    return bestIdx;
}

@inline
function rebuildOpticalBasisSimd(surfaceId: i32, ior: f32): void {
    let tensorBase: usize = ADDR_SURFACE_LUTS + <usize>surfaceId * SURFACE_STRIDE;
    let cBase: usize = ADDR_SURFACE_C + (<usize>surfaceId << 9);
    let eta: f32 = 1.0 / ior;
    let eta2: f32 = eta * eta;

    let vEta = f32x4.splat(eta);
    let vEta2 = f32x4.splat(eta2);
    let vOneMinusEta2 = f32x4.splat(1.0 - eta2);
    let vOne = f32x4.splat(1.0);
    let vPadeN0 = f32x4.splat(<f32>0.99994401);
    let vPadeN1 = f32x4.splat(<f32>0.79481480);
    let vPadeD1 = f32x4.splat(<f32>0.29877658);

    let vMaxA = f32x4.splat(-1.0);
    let vMaxB = f32x4.splat(-1.0);
    let vIdxA = i32x4.splat(1);
    let vIdxB = i32x4.splat(1);
    let vCurIdx = i32x4(0, 1, 2, 3);
    let vStepIdx = i32x4.splat(4);

    for (let offset: usize = 0; offset < 512; offset += 16) {
        let vWk = v128.load(tensorBase + offset);
        let vCk = v128.load(cBase + offset);
        let vWA = v128.load(tensorBase + 512 + offset);
        let vWB = v128.load(tensorBase + 1024 + offset);

        let vQ = f32x4.mul(vEta2, vWk);
        let vNum = f32x4.sub(vPadeN0, f32x4.mul(vPadeN1, vQ));
        let vDen = f32x4.sub(vOne, f32x4.mul(vPadeD1, vQ));
        let vFactor = f32x4.div(
            f32x4.mul(vOneMinusEta2, vDen),
            f32x4.add(vDen, f32x4.mul(vEta, f32x4.mul(vCk, vNum)))
        );

        let vVA = f32x4.mul(vFactor, vWA);
        let vVB = f32x4.mul(vFactor, vWB);

        v128.store(ADDR_VEC_A + offset, vVA);
        v128.store(ADDR_VEC_B + offset, vVB);

        let vAbsA = f32x4.abs(vVA);
        let vAbsB = f32x4.abs(vVB);

        let vCmpA = f32x4.gt(vAbsA, vMaxA);
        vMaxA = v128.bitselect(vAbsA, vMaxA, vCmpA);
        vIdxA = v128.bitselect(vCurIdx, vIdxA, vCmpA);

        let vCmpB = f32x4.gt(vAbsB, vMaxB);
        vMaxB = v128.bitselect(vAbsB, vMaxB, vCmpB);
        vIdxB = v128.bitselect(vCurIdx, vIdxB, vCmpB);

        vCurIdx = i32x4.add(vCurIdx, vStepIdx);
    }

    store<f32>(ADDR_VEC_A, 0.0);
    store<f32>(ADDR_VEC_B, 0.0);
    store<f32>(ADDR_VEC_A + (127 << 2), 0.0);
    store<f32>(ADDR_VEC_B + (127 << 2), 0.0);

    store<i32>(ADDR_STATE_IDX_A, reduceBestIndex(vMaxA, vIdxA));
    store<i32>(ADDR_STATE_IDX_B, reduceBestIndex(vMaxB, vIdxB));
    store<i32>(ADDR_STATE_BASIS_SURF, surfaceId);
    store<f32>(ADDR_STATE_BASIS_IOR, ior);
}

export function initTables(): void {
    for (let sIdx: usize = 0; sIdx < 4; sIdx++) {
        let base: usize = ADDR_SURFACE_LUTS + sIdx * SURFACE_STRIDE;
        let cBase: usize = ADDR_SURFACE_C + (sIdx << 9);
        for (let k = 1; k < 127; k++) {
            let x: f32 = <f32>k / 127.0;
            if (sIdx == 0) evalConvexSquircle(x);
            else if (sIdx == 1) evalConvexCircle(x);
            else if (sIdx == 2) evalLinear(x);
            else evalLip(x);

            let h: f32 = tempHeight > 0.0 ? tempHeight : 0.0;
            let p: f32 = tempDerivative;
            let p2: f32 = p * p;
            let pf: f32 = p / Mathf.sqrt(Mathf.sqrt(1.0 + <f32>0.12 * p2));
            let wA: f32 = pf * h;
            let wB: f32 = pf * Mathf.sqrt(h * Mathf.sqrt(h));

            let Ck: f32 = Mathf.sqrt(1.0 + p2);
            let wk: f32 = p2 / (1.0 + p2);

            store<f32>(base + (k << 2), wk);
            store<f32>(cBase + (k << 2), Ck);
            store<f32>(base + 512 + (k << 2), wA);
            store<f32>(base + 1024 + (k << 2), wB);
        }
        store<f32>(base, 0.0);
        store<f32>(cBase, 1.0);
        store<f32>(base + 512, 0.0);
        store<f32>(base + 1024, 0.0);
        store<f32>(base + (127 << 2), 0.0);
        store<f32>(cBase + (127 << 2), 1.0);
        store<f32>(base + 512 + (127 << 2), 0.0);
        store<f32>(base + 1024 + (127 << 2), 0.0);
    }

    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            let inner: f32 = <f32>0.06711056 * <f32>x + <f32>0.00583715 * <f32>y;
            inner = inner - Mathf.floor(inner);
            let ign: f32 = <f32>52.9829189 * inner;
            ign = ign - Mathf.floor(ign);
            let bias: f32 = 127.5 + ign;
            store<f32>(ADDR_IGN + (((y << 4) | x) << 2), bias);
        }
    }

    store<u16>(ADDR_BMP_HEADER + 0, 0x4D42);
    store<u32>(ADDR_BMP_HEADER + 2, 64);
    store<u32>(ADDR_BMP_HEADER + 6, 0);
    store<u32>(ADDR_BMP_HEADER + 10, 64);
    store<u32>(ADDR_BMP_HEADER + 14, 40);
    store<i32>(ADDR_BMP_HEADER + 18, 0);
    store<i32>(ADDR_BMP_HEADER + 22, 0);
    store<u16>(ADDR_BMP_HEADER + 26, 1);
    store<u16>(ADDR_BMP_HEADER + 28, 32);
    store<u32>(ADDR_BMP_HEADER + 30, 0);
    store<u32>(ADDR_BMP_HEADER + 34, 0);
    store<i32>(ADDR_BMP_HEADER + 38, 2835);
    store<i32>(ADDR_BMP_HEADER + 42, 2835);
    store<u32>(ADDR_BMP_HEADER + 46, 0);
    store<u32>(ADDR_BMP_HEADER + 50, 0);
    for (let i: usize = 54; i < 64; i++) {
        store<u8>(ADDR_BMP_HEADER + i, 0);
    }

    let vNeutral = i32x4.splat(NEUTRAL_PIXEL);
    let ptr: usize = ADDR_BMP_PAYLOAD;
    let endPtr: usize = ADDR_CORNER_STREAM_CACHE + 32768;
    while (ptr < endPtr) {
        v128.store(ptr, vNeutral, 0);
        v128.store(ptr, vNeutral, 16);
        v128.store(ptr, vNeutral, 32);
        v128.store(ptr, vNeutral, 48);
        ptr += 64;
    }

    for (let i: usize = 0; i < 8; i++) {
        store<u32>(ADDR_NORM_DIR_HASH + (i << 2), 0xFFFFFFFF);
        store<u32>(ADDR_EDGE_DIR_HASH + (i << 2), 0xFFFFFFFF);
    }
    for (let i: usize = 0; i < 4; i++) {
        store<i32>(ADDR_CORNER_DIR_NORM + (i << 2), -1);
        store<f32>(ADDR_CORNER_DIR_RAD + (i << 2), -1.0);
        store<f32>(ADDR_CORNER_DIR_BEZ + (i << 2), -1.0);
        store<i32>(ADDR_CORNER_DIR_VALID + (i << 2), 0);
    }

    rebuildOpticalBasisSimd(0, <f32>2.05);

    store<i32>(ADDR_STATE_PREV_W, 0);
    store<i32>(ADDR_STATE_PREV_H, 0);
    store<i32>(ADDR_STATE_PREV_CORNER, 0);
    store<i32>(ADDR_STATE_PREV_HORIZ_BEZEL, 0);
    store<i32>(ADDR_STATE_PREV_COL_BEZEL, 0);
    store<i32>(ADDR_STATE_LAST_SURFACE, -1);
    store<i32>(ADDR_STATE_LAST_RHO_QUANT, -2);
    store<f32>(ADDR_STATE_LAST_IOR, 0.0);
    store<f32>(ADDR_STATE_LAST_SCALE, 0.0);
    store<f32>(ADDR_STATE_UNIT_MAX, 1.0);
    store<f32>(ADDR_STATE_MAX_DISP, 1.0);
    store<i32>(ADDR_STATE_LAST_FLAGS, -1);
    store<f32>(ADDR_STATE_LAST_RADIUS, -1.0);
    store<f32>(ADDR_STATE_LAST_CLAMPED_BEZEL, -1.0);
    store<f32>(ADDR_STATE_LAST_THICKNESS, -1.0);
    store<i32>(ADDR_STATE_NORM_RING, 0);
    store<i32>(ADDR_STATE_EDGE_RING, 0);
    store<i32>(ADDR_STATE_CORNER_RING, 0);
    store<i32>(ADDR_STATE_PREV_CORNER_SLOT, -1);
    store<i32>(ADDR_STATE_LAST_TOTAL_BYTES, 64);
    store<f32>(ADDR_STATE_PREV_GEOM_RAD, -1.0);
    store<f32>(ADDR_STATE_PREV_SCALED_BEZ, -1.0);
    store<i32>(ADDR_STATE_DIRTY_MAX_PX, 0);
}

function fillRowPixel(rowStartPtr: usize, pixelCount: i32, vPixel: v128, scalarPixel: u32): void {
    if (pixelCount <= 0) return;
    if (pixelCount < 4) {
        for (let i = 0; i < pixelCount; i++) {
            store<u32>(rowStartPtr + (<usize>i << 2), scalarPixel);
        }
        return;
    }
    let p = rowStartPtr;
    let count16 = pixelCount & ~15;
    let end16 = rowStartPtr + (<usize>count16 << 2);
    while (p < end16) {
        v128.store(p, vPixel, 0);
        v128.store(p, vPixel, 16);
        v128.store(p, vPixel, 32);
        v128.store(p, vPixel, 48);
        p += 64;
    }
    let count4 = pixelCount & ~3;
    let end4 = rowStartPtr + (<usize>count4 << 2);
    while (p < end4) {
        v128.store(p, vPixel);
        p += 16;
    }
    if (pixelCount > count4) {
        v128.store(rowStartPtr + (<usize>(pixelCount - 4) << 2), vPixel);
    }
}

@inline
function fillDualRowPixel(
    tStartPtr: usize,
    bStartPtr: usize,
    pixelCount: i32,
    vTop: v128,
    vBot: v128,
    sTop: u32,
    sBot: u32
): void {
    if (pixelCount < 4) {
        for (let i = 0; i < pixelCount; i++) {
            let off: usize = <usize>i << 2;
            store<u32>(tStartPtr + off, sTop);
            store<u32>(bStartPtr + off, sBot);
        }
        return;
    }
    let off: usize = 0;
    let end32: usize = <usize>(pixelCount & ~31) << 2;
    while (off < end32) {
        let tp = tStartPtr + off;
        let bp = bStartPtr + off;
        v128.store(tp, vTop, 0);
        v128.store(tp, vTop, 16);
        v128.store(tp, vTop, 32);
        v128.store(tp, vTop, 48);
        v128.store(tp, vTop, 64);
        v128.store(tp, vTop, 80);
        v128.store(tp, vTop, 96);
        v128.store(tp, vTop, 112);
        v128.store(bp, vBot, 0);
        v128.store(bp, vBot, 16);
        v128.store(bp, vBot, 32);
        v128.store(bp, vBot, 48);
        v128.store(bp, vBot, 64);
        v128.store(bp, vBot, 80);
        v128.store(bp, vBot, 96);
        v128.store(bp, vBot, 112);
        off += 128;
    }
    let end4: usize = <usize>(pixelCount & ~3) << 2;
    while (off < end4) {
        v128.store(tStartPtr + off, vTop);
        v128.store(bStartPtr + off, vBot);
        off += 16;
    }
    if ((pixelCount & 3) != 0) {
        let tailOff: usize = <usize>(pixelCount - 4) << 2;
        v128.store(tStartPtr + tailOff, vTop);
        v128.store(bStartPtr + tailOff, vBot);
    }
}

@inline
function clearRowNeutral(rowStartPtr: usize, pixelCount: i32, vNeutral: v128): void {
    fillRowPixel(rowStartPtr, pixelCount, vNeutral, NEUTRAL_PIXEL);
}

function clearSpanClipped(
    startPx: i32,
    spanLen: i32,
    overTopEnd: i32,
    overBotStart: i32,
    vNeutral: v128
): void {
    let endPx: i32 = startPx + spanLen;
    if (startPx < overTopEnd) startPx = overTopEnd;
    if (endPx > overBotStart) endPx = overBotStart;
    if (startPx < endPx) {
        clearRowNeutral(ADDR_BMP_PAYLOAD + (<usize>startPx << 2), endPx - startPx, vNeutral);
    }
}

export function generateDisplacementBmp(
    targetW: i32,
    targetH: i32,
    radius: f32,
    clampedBezel: f32,
    glassThickness: f32,
    scaleFactor: f32,
    ior: f32,
    surfaceId: i32,
    flags: i32
): i32 {
    let prevW = load<i32>(ADDR_STATE_PREV_W);
    let prevH = load<i32>(ADDR_STATE_PREV_H);

    if (
        ((flags & 4) |
            (targetW ^ prevW) |
            (targetH ^ prevH) |
            (flags ^ load<i32>(ADDR_STATE_LAST_FLAGS)) |
            (surfaceId ^ load<i32>(ADDR_STATE_LAST_SURFACE))) == 0 &&
        radius == load<f32>(ADDR_STATE_LAST_RADIUS) &&
        clampedBezel == load<f32>(ADDR_STATE_LAST_CLAMPED_BEZEL) &&
        glassThickness == load<f32>(ADDR_STATE_LAST_THICKNESS) &&
        scaleFactor == load<f32>(ADDR_STATE_LAST_SCALE) &&
        ior == load<f32>(ADDR_STATE_LAST_IOR)
    ) {
        return load<i32>(ADDR_STATE_LAST_TOTAL_BYTES);
    }

    let forceRebuild = (flags & 4) != 0;
    let isPill = (flags & 1) != 0;
    let isAxisX = (flags & 2) != 0;

    let halfW: f32 = <f32>(targetW >> 1);
    let halfH: f32 = <f32>(targetH >> 1);
    let maxRadius: f32 = halfW < halfH ? halfW : halfH;

    let rawBezel: f32 = clampedBezel * scaleFactor;
    let scaledBezel: f32 = rawBezel > 1.0 ? rawBezel : 1.0;
    let scaledRad: f32 = radius * scaleFactor;
    let pillMode: bool = isPill || (scaledRad >= maxRadius - 0.5);
    let geomRadius: f32 = pillMode ? maxRadius : (scaledRad > 0.0 ? scaledRad : 0.0);
    if (geomRadius > maxRadius) geomRadius = maxRadius;

    let cornerSize: i32 = <i32>Mathf.ceil(geomRadius - <f32>0.5);
    if (cornerSize < 0) cornerSize = 0;
    if (cornerSize > <i32>maxRadius) cornerSize = <i32>maxRadius;
    if (cornerSize > 64) cornerSize = 64;
    if (isAxisX) cornerSize = 0;

    let topBezelLimit: i32 = <i32>Mathf.ceil(scaledBezel) + 1;
    if (topBezelLimit < 1) topBezelLimit = 1;
    if (topBezelLimit > 256) topBezelLimit = 256;

    let posEffLimit: i32 = <i32>Mathf.ceil(scaledBezel - 0.5);
    if (posEffLimit < 0) posEffLimit = 0;
    let effectiveBezelLimit: i32 = topBezelLimit < posEffLimit ? topBezelLimit : posEffLimit;

    let ceilHH = <i32>Mathf.ceil(<f32>targetH * 0.5);
    let ceilHW = <i32>Mathf.ceil(<f32>targetW * 0.5);
    let actualRowBezelLimit = effectiveBezelLimit < ceilHH ? effectiveBezelLimit : ceilHH;
    let actualColBezelLimit = effectiveBezelLimit < ceilHW ? effectiveBezelLimit : ceilHW;
    let horizontalBezelLimit = isAxisX ? 0 : actualRowBezelLimit;

    let isZeroBezel = scaledBezel <= <f32>1e-6;
    let rhoQuant: i32 = isZeroBezel ? 0 : <i32>((glassThickness / scaledBezel) * 1000.0 + 0.5);
    let scaleQuant: i32 = <i32>(scaleFactor * 1000.0 + 0.5);
    let normHash: u32 = (<u32>(surfaceId & 7) << 29) | (<u32>(rhoQuant & 0x1FFFF) << 12) | <u32>(scaleQuant & 0xFFF);

    let normSlot: i32 = -1;
    if (!forceRebuild) {
        for (let s: i32 = 0; s < 8; s++) {
            if (load<u32>(ADDR_NORM_DIR_HASH + (<usize>s << 2)) == normHash) {
                if (load<f32>(ADDR_NORM_DIR_IOR + (<usize>s << 2)) == ior) {
                    normSlot = s;
                    break;
                }
            }
        }
    }

    let unitMax: f32;
    let normProfileBase: usize;

    if (normSlot >= 0) {
        normProfileBase = ADDR_NORM_CACHE + (<usize>normSlot << 9);
        unitMax = load<f32>(ADDR_NORM_DIR_UMAX + (<usize>normSlot << 2));
    } else {
        normSlot = load<i32>(ADDR_STATE_NORM_RING);
        store<i32>(ADDR_STATE_NORM_RING, (normSlot + 1) & 7);
        normProfileBase = ADDR_NORM_CACHE + (<usize>normSlot << 9);

        for (let c: i32 = 0; c < 4; c++) {
            if (load<i32>(ADDR_CORNER_DIR_NORM + (<usize>c << 2)) == normSlot) {
                store<i32>(ADDR_CORNER_DIR_NORM + (<usize>c << 2), -1);
                store<i32>(ADDR_CORNER_DIR_VALID + (<usize>c << 2), 0);
            }
        }
        for (let e: i32 = 0; e < 8; e++) {
            let eHash = load<u32>(ADDR_EDGE_DIR_HASH + (<usize>e << 2));
            if (eHash != 0xFFFFFFFF && <i32>(eHash >> 20) == normSlot) {
                store<u32>(ADDR_EDGE_DIR_HASH + (<usize>e << 2), 0xFFFFFFFF);
            }
        }

        if (
            surfaceId != load<i32>(ADDR_STATE_BASIS_SURF) ||
            ior != load<f32>(ADDR_STATE_BASIS_IOR)
        ) {
            rebuildOpticalBasisSimd(surfaceId, ior);
        }

        let idxA = load<i32>(ADDR_STATE_IDX_A);
        let idxB = load<i32>(ADDR_STATE_IDX_B);
        let peakStart = idxA < idxB ? idxA : idxB;
        let peakEnd = idxA > idxB ? idxA : idxB;

        let rho: f32 = isZeroBezel ? 0.0 : glassThickness / scaledBezel;
        let vRho = f32x4.splat(rho);
        let vMax = f32x4.splat(0.0);

        let pStart4 = peakStart & ~3;
        let pEnd4 = (peakEnd + 4) & ~3;
        if (pEnd4 > 128) pEnd4 = 128;

        for (let offset: usize = <usize>(pStart4 << 2); offset < <usize>(pEnd4 << 2); offset += 16) {
            let vA = v128.load(ADDR_VEC_A + offset);
            let vB = v128.load(ADDR_VEC_B + offset);
            let vU = f32x4.add(vA, f32x4.mul(vRho, vB));
            vMax = f32x4.max(vMax, f32x4.abs(vU));
        }

        let vMax2 = i32x4.shuffle(vMax, vMax, 2, 3, 0, 1);
        vMax = f32x4.max(vMax, vMax2);
        let vMax4 = i32x4.shuffle(vMax, vMax, 1, 0, 3, 2);
        vMax = f32x4.max(vMax, vMax4);
        unitMax = f32x4.extract_lane(vMax, 0);
        if (unitMax <= 0.0) unitMax = 1.0;

        let vScaleA = f32x4.splat(127.0 / unitMax);
        let vScaleB = f32x4.mul(vRho, vScaleA);

        let needsSharpen: bool = scaleFactor < <f32>0.99 && scaleFactor > <f32>0.05;
        if (!needsSharpen) {
            for (let offset: usize = 0; offset < 512; offset += 16) {
                let vA = v128.load(ADDR_VEC_A + offset);
                let vB = v128.load(ADDR_VEC_B + offset);
                let vNorm = f32x4.add(f32x4.mul(vA, vScaleA), f32x4.mul(vB, vScaleB));
                v128.store(normProfileBase + offset, vNorm);
            }
        } else {
            let s2: f32 = scaleFactor * scaleFactor;
            let inv8s2: f32 = (1.0 - s2) / (<f32>8.0 * s2);
            if (inv8s2 > <f32>1.2) inv8s2 = <f32>1.2;

            let vLambda = f32x4.splat(inv8s2);
            let vCenterW = f32x4.splat(1.0 + <f32>2.0 * inv8s2);
            let vZeroF = f32x4.splat(0.0);
            let v127F = f32x4.splat(127.0);

            let vPrevVec = vZeroF;
            let vCurrVec = f32x4.add(
                f32x4.mul(v128.load(ADDR_VEC_A), vScaleA),
                f32x4.mul(v128.load(ADDR_VEC_B), vScaleB)
            );

            for (let offset: usize = 0; offset < 496; offset += 16) {
                let nextOff: usize = offset + 16;
                let vNextVec = f32x4.add(
                    f32x4.mul(v128.load(ADDR_VEC_A + nextOff), vScaleA),
                    f32x4.mul(v128.load(ADDR_VEC_B + nextOff), vScaleB)
                );
                let vLeft = i32x4.shuffle(vPrevVec, vCurrVec, 3, 4, 5, 6);
                let vRight = i32x4.shuffle(vCurrVec, vNextVec, 1, 2, 3, 4);
                let vSharp = f32x4.sub(
                    f32x4.mul(vCurrVec, vCenterW),
                    f32x4.mul(vLambda, f32x4.add(vLeft, vRight))
                );
                v128.store(normProfileBase + offset, f32x4.min(v127F, f32x4.max(vZeroF, vSharp)));
                vPrevVec = vCurrVec;
                vCurrVec = vNextVec;
            }

            let vLeftLast = i32x4.shuffle(vPrevVec, vCurrVec, 3, 4, 5, 6);
            let vRightLast = i32x4.shuffle(vCurrVec, vZeroF, 1, 2, 3, 4);
            let vSharpLast = f32x4.sub(
                f32x4.mul(vCurrVec, vCenterW),
                f32x4.mul(vLambda, f32x4.add(vLeftLast, vRightLast))
            );
            v128.store(normProfileBase + 496, f32x4.min(v127F, f32x4.max(vZeroF, vSharpLast)));
        }
        store<f32>(normProfileBase, 0.0);
        store<f32>(normProfileBase + (127 << 2), 0.0);

        store<u32>(ADDR_NORM_DIR_HASH + (<usize>normSlot << 2), normHash);
        store<f32>(ADDR_NORM_DIR_IOR + (<usize>normSlot << 2), ior);
        store<f32>(ADDR_NORM_DIR_UMAX + (<usize>normSlot << 2), unitMax);
    }

    let maxDispCalc: f32 = isZeroBezel ? (glassThickness * unitMax) : (clampedBezel * unitMax);
    let maxDisplacement: f32 = maxDispCalc <= 0.0 ? 1.0 : maxDispCalc;
    store<f32>(ADDR_STATE_MAX_DISP, maxDisplacement);
    store<f32>(ADDR_STATE_UNIT_MAX, unitMax);

    let cornerSlot: i32 = -1;
    let cornerCacheHit: bool = false;
    if (!isAxisX && cornerSize > 0 && !forceRebuild) {
        for (let c: i32 = 0; c < 4; c++) {
            if (load<i32>(ADDR_CORNER_DIR_NORM + (<usize>c << 2)) == normSlot) {
                let radDiff = geomRadius - load<f32>(ADDR_CORNER_DIR_RAD + (<usize>c << 2));
                let bezDiff = scaledBezel - load<f32>(ADDR_CORNER_DIR_BEZ + (<usize>c << 2));
                if (
                    (radDiff < 0.0 ? -radDiff : radDiff) <= <f32>1e-4 &&
                    (bezDiff < 0.0 ? -bezDiff : bezDiff) <= <f32>1e-4
                ) {
                    cornerSlot = c;
                    cornerCacheHit = load<i32>(ADDR_CORNER_DIR_VALID + (<usize>c << 2)) != 0;
                    break;
                }
            }
        }
    }

    let prevCorner = load<i32>(ADDR_STATE_PREV_CORNER);
    let prevHorizBezel = load<i32>(ADDR_STATE_PREV_HORIZ_BEZEL);
    let prevColBezel = load<i32>(ADDR_STATE_PREV_COL_BEZEL);
    let prevCornerSlot = load<i32>(ADDR_STATE_PREV_CORNER_SLOT);
    let prevGeomRad = load<f32>(ADDR_STATE_PREV_GEOM_RAD);
    let prevScaledBez = load<f32>(ADDR_STATE_PREV_SCALED_BEZ);
    let dirtyMaxPx = load<i32>(ADDR_STATE_DIRTY_MAX_PX);
    let curTotalPx: i32 = targetW * targetH;
    let prevTotalPx: i32 = prevW * prevH;

    let sameGeometryFootprint: bool = (
        prevW == targetW &&
        prevH == targetH &&
        prevCorner == cornerSize &&
        prevHorizBezel == horizontalBezelLimit &&
        prevColBezel == actualColBezelLimit &&
        geomRadius == prevGeomRad &&
        scaledBezel == prevScaledBez
    );

    let vNeutral = i32x4.splat(NEUTRAL_PIXEL);
    let hasStraightSpan: bool = (targetW - (cornerSize << 1)) > 0 && !isAxisX && horizontalBezelLimit > 0;
    let overTopEnd: i32 = hasStraightSpan ? (horizontalBezelLimit * targetW) : 0;
    let overBotStart: i32 = hasStraightSpan ? ((targetH - horizontalBezelLimit) * targetW) : curTotalPx;

    if (prevTotalPx > 0 && !sameGeometryFootprint && overTopEnd < overBotStart) {
        if (prevTotalPx > MAX_PIXELS) {
            let pClear: usize = ADDR_BMP_PAYLOAD;
            let endClear: usize = ADDR_BMP_PAYLOAD + (<usize>MAX_PIXELS << 2);
            while (pClear < endClear) {
                v128.store(pClear, vNeutral);
                pClear += 16;
            }
            dirtyMaxPx = 0;
        } else {
            if (prevTotalPx > overTopEnd) {
                let prevMetaBase: usize = prevCornerSlot >= 0
                    ? (ADDR_CORNER_META_CACHE + (<usize>prevCornerSlot << 9))
                    : ADDR_PREV_XLO;
                let prevXHiBase: usize = prevCornerSlot >= 0
                    ? (prevMetaBase + 256)
                    : ADDR_PREV_XHI;

                let rowMin: i32 = overTopEnd / prevW;
                let rowMax: i32 = (overBotStart - 1) / prevW;
                if (rowMax >= prevH) rowMax = prevH - 1;
                let prevStraightSpan: i32 = prevW - (prevCorner << 1);
                let prevRightColOff: i32 = prevW - prevColBezel;

                for (let row = rowMin; row <= rowMax; row++) {
                    let oppRow: i32 = prevH - 1 - row;
                    let symRow: i32 = row < oppRow ? row : oppRow;
                    let rowPx: i32 = row * prevW;

                    if (symRow < prevCorner) {
                        let pLo = load<i32>(prevMetaBase + (symRow << 2));
                        let pHi = load<i32>(prevXHiBase + (symRow << 2));
                        if (pLo < pHi) {
                            let span = pHi - pLo;
                            clearSpanClipped(rowPx + pLo, span, overTopEnd, overBotStart, vNeutral);
                            clearSpanClipped(rowPx + prevW - pHi, span, overTopEnd, overBotStart, vNeutral);
                        }
                    }

                    if (symRow < prevHorizBezel && prevStraightSpan > 0) {
                        clearSpanClipped(rowPx + prevCorner, prevStraightSpan, overTopEnd, overBotStart, vNeutral);
                    }
                    if (symRow >= prevCorner && prevColBezel > 0) {
                        clearSpanClipped(rowPx, prevColBezel, overTopEnd, overBotStart, vNeutral);
                        clearSpanClipped(rowPx + prevRightColOff, prevColBezel, overTopEnd, overBotStart, vNeutral);
                    }
                }
            }
            if (dirtyMaxPx > prevTotalPx && dirtyMaxPx > overTopEnd) {
                let tailStart: i32 = prevTotalPx > overTopEnd ? prevTotalPx : overTopEnd;
                let tailEnd: i32 = dirtyMaxPx < overBotStart ? dirtyMaxPx : overBotStart;
                if (tailStart < tailEnd) {
                    clearRowNeutral(ADDR_BMP_PAYLOAD + (<usize>tailStart << 2), tailEnd - tailStart, vNeutral);
                }
            }
        }
    }

    if (curTotalPx > dirtyMaxPx) {
        dirtyMaxPx = curTotalPx;
    }

    let profileScale: f32 = 127.0 / scaledBezel;
    let v126I = i32x4.splat(126);
    let v127I = i32x4.splat(127);
    let v255 = i32x4.splat(255);
    let vXorBL = i32x4.splat(0x0000FF00);
    let vXorTR = i32x4.splat(0x00FF0000);
    let vXorBR = i32x4.splat(0x00FFFF00);

    let edgeHash: u32 = (<u32>normSlot << 20) | (<u32>(actualColBezelLimit & 0x1FF) << 10) | (<u32>(topBezelLimit & 0x1FF) << 1) | (isAxisX ? 1 : 0);
    let edgeSlot: i32 = -1;
    if (!forceRebuild) {
        for (let e: i32 = 0; e < 8; e++) {
            if (load<u32>(ADDR_EDGE_DIR_HASH + (<usize>e << 2)) == edgeHash) {
                let bDiff = scaledBezel - load<f32>(ADDR_EDGE_DIR_BEZ + (<usize>e << 2));
                if ((bDiff < 0.0 ? -bDiff : bDiff) <= <f32>1e-4) {
                    edgeSlot = e;
                    break;
                }
            }
        }
    }

    let topRowBase: usize;
    let botRowBase: usize;
    let leftColBase: usize;
    let rightColBase: usize;

    if (edgeSlot >= 0) {
        let edgeBase: usize = ADDR_EDGE_CACHE + (<usize>edgeSlot << 12);
        topRowBase = edgeBase;
        botRowBase = edgeBase + 1024;
        leftColBase = edgeBase + 2048;
        rightColBase = edgeBase + 3072;
    } else {
        edgeSlot = load<i32>(ADDR_STATE_EDGE_RING);
        store<i32>(ADDR_STATE_EDGE_RING, (edgeSlot + 1) & 7);
        let edgeBase: usize = ADDR_EDGE_CACHE + (<usize>edgeSlot << 12);
        topRowBase = edgeBase;
        botRowBase = edgeBase + 1024;
        leftColBase = edgeBase + 2048;
        rightColBase = edgeBase + 3072;

        let simdBezelLimit: i32 = effectiveBezelLimit & ~3;
        let vProfStep4 = f32x4.splat(<f32>4.0 * profileScale);
        let vFloatIdx = f32x4(
            <f32>0.5 * profileScale,
            <f32>1.5 * profileScale,
            <f32>2.5 * profileScale,
            <f32>3.5 * profileScale
        );
        let vTopMask = i32x4.splat(0xFF800080);
        let vLeftMask = i32x4.splat(0xFF008080);

        let edgeIdx: i32 = 0;
        for (; edgeIdx < simdBezelLimit; edgeIdx += 4) {
            let vBaseIdx = i32x4.min_s(i32x4.trunc_sat_f32x4_s(vFloatIdx), v126I);
            let vFrac = f32x4.sub(vFloatIdx, f32x4.convert_i32x4_s(vBaseIdx));
            let vByteOff = i32x4.shl(vBaseIdx, 2);

            let b0 = <usize>i32x4.extract_lane(vByteOff, 0);
            let b1 = <usize>i32x4.extract_lane(vByteOff, 1);
            let b2 = <usize>i32x4.extract_lane(vByteOff, 2);
            let b3 = <usize>i32x4.extract_lane(vByteOff, 3);

            let vP0 = f32x4(
                load<f32>(normProfileBase + b0),
                load<f32>(normProfileBase + b1),
                load<f32>(normProfileBase + b2),
                load<f32>(normProfileBase + b3)
            );
            let vP1 = f32x4(
                load<f32>(normProfileBase + b0 + 4),
                load<f32>(normProfileBase + b1 + 4),
                load<f32>(normProfileBase + b2 + 4),
                load<f32>(normProfileBase + b3 + 4)
            );

            let vDisp = f32x4.add(vP0, f32x4.mul(vFrac, f32x4.sub(vP1, vP0)));
            let vIgn = v128.load(ADDR_IGN + ((edgeIdx & 12) << 2));
            let vRPos = i32x4.min_u(i32x4.trunc_sat_f32x4_u(f32x4.add(vDisp, vIgn)), v255);

            let byteOff: usize = <usize>(edgeIdx << 2);
            if (!isAxisX) {
                let vTopPx = v128.or(vTopMask, i32x4.shl(vRPos, 8));
                let vBotPx = v128.xor(vTopPx, vXorBL);
                v128.store(topRowBase + byteOff, vTopPx);
                v128.store(botRowBase + byteOff, vBotPx);
            }

            let vLeftPx = v128.or(vLeftMask, i32x4.shl(vRPos, 16));
            let vRightPx = v128.xor(vLeftPx, vXorTR);
            v128.store(leftColBase + byteOff, vLeftPx);
            v128.store(rightColBase + byteOff, vRightPx);

            vFloatIdx = f32x4.add(vFloatIdx, vProfStep4);
        }

        for (; edgeIdx < effectiveBezelLimit; edgeIdx++) {
            let floatIdx: f32 = (<f32>edgeIdx + 0.5) * profileScale;
            let baseIndex = <i32>floatIdx;
            let nextIndex = baseIndex + 1 < 127 ? baseIndex + 1 : 127;
            let p0 = load<f32>(normProfileBase + (baseIndex << 2));
            let p1 = load<f32>(normProfileBase + (nextIndex << 2));
            let normalDisplacement: f32 = p0 + (floatIdx - <f32>baseIndex) * (p1 - p0);

            let ignBias = load<f32>(ADDR_IGN + ((edgeIdx & 15) << 2));
            let rPosRaw = <i32>(normalDisplacement + ignBias);
            let rPos: u32 = rPosRaw < 0 ? 0 : (rPosRaw > 255 ? 255 : <u32>rPosRaw);
            let rNeg: u32 = 255 - rPos;

            let byteOff: usize = <usize>(edgeIdx << 2);
            if (!isAxisX) {
                store<u32>(topRowBase + byteOff, 0xFF800080 | (rPos << 8));
                store<u32>(botRowBase + byteOff, 0xFF800080 | (rNeg << 8));
            }
            store<u32>(leftColBase + byteOff, 0xFF008080 | (rPos << 16));
            store<u32>(rightColBase + byteOff, 0xFF008080 | (rNeg << 16));
        }

        for (let i = effectiveBezelLimit; i < topBezelLimit; i++) {
            let byteOff: usize = <usize>(i << 2);
            if (!isAxisX) {
                store<u32>(topRowBase + byteOff, NEUTRAL_PIXEL);
                store<u32>(botRowBase + byteOff, NEUTRAL_PIXEL);
            }
            store<u32>(leftColBase + byteOff, NEUTRAL_PIXEL);
            store<u32>(rightColBase + byteOff, NEUTRAL_PIXEL);
        }

        for (let i = 0; i < (actualColBezelLimit >> 1); i++) {
            let opp = actualColBezelLimit - 1 - i;
            let a = load<u32>(rightColBase + (i << 2));
            let b = load<u32>(rightColBase + (opp << 2));
            store<u32>(rightColBase + (i << 2), b);
            store<u32>(rightColBase + (opp << 2), a);
        }

        store<u32>(ADDR_EDGE_DIR_HASH + (<usize>edgeSlot << 2), edgeHash);
        store<f32>(ADDR_EDGE_DIR_BEZ + (<usize>edgeSlot << 2), scaledBezel);
    }

    let needMarginClear: bool = prevTotalPx > 0 && !sameGeometryFootprint && hasStraightSpan;

    if (!isAxisX && cornerSize > 0) {
        if (cornerCacheHit && cornerSlot >= 0) {
            let metaBase: usize = ADDR_CORNER_META_CACHE + (<usize>cornerSlot << 9);
            let xHiBase: usize = metaBase + 256;
            let streamTL: usize = ADDR_CORNER_STREAM_CACHE + (<usize>cornerSlot << 13);
            let streamTR: usize = streamTL + 4096;

            for (let y = 0; y < cornerSize; y++) {
                let xLo = load<i32>(metaBase + (y << 2));
                let xHi = load<i32>(xHiBase + (y << 2));
                let tlRowPtr: usize = ADDR_BMP_PAYLOAD + (<usize>(y * targetW) << 2);
                let blRowPtr: usize = ADDR_BMP_PAYLOAD + (<usize>((targetH - 1 - y) * targetW) << 2);

                if (needMarginClear && y < horizontalBezelLimit) {
                    if (xLo > 0) {
                        let rMarginOff: usize = <usize>((targetW - xLo) << 2);
                        clearRowNeutral(tlRowPtr, xLo, vNeutral);
                        clearRowNeutral(tlRowPtr + rMarginOff, xLo, vNeutral);
                        clearRowNeutral(blRowPtr, xLo, vNeutral);
                        clearRowNeutral(blRowPtr + rMarginOff, xLo, vNeutral);
                    }
                    if (xHi < cornerSize) {
                        let inSpan: i32 = cornerSize - xHi;
                        let lInOff: usize = <usize>(xHi << 2);
                        let rInOff: usize = <usize>((targetW - cornerSize) << 2);
                        clearRowNeutral(tlRowPtr + lInOff, inSpan, vNeutral);
                        clearRowNeutral(tlRowPtr + rInOff, inSpan, vNeutral);
                        clearRowNeutral(blRowPtr + lInOff, inSpan, vNeutral);
                        clearRowNeutral(blRowPtr + rInOff, inSpan, vNeutral);
                    }
                }

                if (xLo < xHi) {
                    let span: i32 = xHi - xLo;
                    let leftBase: usize = <usize>(xLo << 2);
                    let rightBase: usize = <usize>((targetW - xHi) << 2);
                    let srcTL: usize = streamTL;
                    let srcTR: usize = streamTR;

                    let k: i32 = 0;
                    let span8: i32 = span & ~7;
                    for (; k < span8; k += 8) {
                        let off0: usize = <usize>(k << 2);
                        let vTL0 = v128.load(srcTL + off0, 0);
                        let vTL1 = v128.load(srcTL + off0, 16);
                        let vTR0 = v128.load(srcTR + off0, 0);
                        let vTR1 = v128.load(srcTR + off0, 16);
                        v128.store(tlRowPtr + leftBase + off0, vTL0, 0);
                        v128.store(tlRowPtr + leftBase + off0, vTL1, 16);
                        v128.store(blRowPtr + leftBase + off0, v128.xor(vTL0, vXorBL), 0);
                        v128.store(blRowPtr + leftBase + off0, v128.xor(vTL1, vXorBL), 16);
                        v128.store(tlRowPtr + rightBase + off0, vTR0, 0);
                        v128.store(tlRowPtr + rightBase + off0, vTR1, 16);
                        v128.store(blRowPtr + rightBase + off0, v128.xor(vTR0, vXorBL), 0);
                        v128.store(blRowPtr + rightBase + off0, v128.xor(vTR1, vXorBL), 16);
                    }
                    let span4: i32 = span & ~3;
                    for (; k < span4; k += 4) {
                        let off: usize = <usize>(k << 2);
                        let vTL = v128.load(srcTL + off);
                        let vTR = v128.load(srcTR + off);
                        v128.store(tlRowPtr + leftBase + off, vTL);
                        v128.store(blRowPtr + leftBase + off, v128.xor(vTL, vXorBL));
                        v128.store(tlRowPtr + rightBase + off, vTR);
                        v128.store(blRowPtr + rightBase + off, v128.xor(vTR, vXorBL));
                    }
                    if (span > span4) {
                        if (span >= 4) {
                            let off: usize = <usize>((span - 4) << 2);
                            let vTL = v128.load(srcTL + off);
                            let vTR = v128.load(srcTR + off);
                            v128.store(tlRowPtr + leftBase + off, vTL);
                            v128.store(blRowPtr + leftBase + off, v128.xor(vTL, vXorBL));
                            v128.store(tlRowPtr + rightBase + off, vTR);
                            v128.store(blRowPtr + rightBase + off, v128.xor(vTR, vXorBL));
                        } else {
                            for (; k < span; k++) {
                                let off: usize = <usize>(k << 2);
                                let pTL = load<u32>(srcTL + off);
                                let pTR = load<u32>(srcTR + off);
                                store<u32>(tlRowPtr + leftBase + off, pTL);
                                store<u32>(blRowPtr + leftBase + off, pTL ^ 0x0000FF00);
                                store<u32>(tlRowPtr + rightBase + off, pTR);
                                store<u32>(blRowPtr + rightBase + off, pTR ^ 0x0000FF00);
                            }
                        }
                    }
                    let spanBytes: usize = <usize>(span << 2);
                    streamTL += spanBytes;
                    streamTR += spanBytes;
                }
            }
        } else {
            if (prevCornerSlot >= 0 && geomRadius == prevGeomRad && scaledBezel == prevScaledBez) {
                cornerSlot = prevCornerSlot;
            } else {
                cornerSlot = load<i32>(ADDR_STATE_CORNER_RING);
                store<i32>(ADDR_STATE_CORNER_RING, (cornerSlot + 1) & 3);
            }

            let metaBase: usize = ADDR_CORNER_META_CACHE + (<usize>cornerSlot << 9);
            let xHiBase: usize = metaBase + 256;
            let streamTLStart: usize = ADDR_CORNER_STREAM_CACHE + (<usize>cornerSlot << 13);
            let streamTRStart: usize = streamTLStart + 4096;
            let streamTL: usize = streamTLStart;
            let streamTR: usize = streamTRStart;
            let totalStreamPixels: i32 = 0;
            let canCacheStream: bool = true;

            let rMax: f32 = geomRadius + 0.5;
            let sMax: f32 = rMax * rMax;
            let minCornerRho: f32 = geomRadius > scaledBezel ? (geomRadius - scaledBezel) : 0.0;
            let sMin: f32 = minCornerRho * minCornerRho;
            let deltaS: f32 = (sMax - sMin) / 127.0;
            let invDeltaS: f32 = deltaS > <f32>1e-8 ? (127.0 / (sMax - sMin)) : 0.0;

            let vS = f32x4(
                sMin,
                sMin + deltaS,
                sMin + <f32>2.0 * deltaS,
                sMin + <f32>3.0 * deltaS
            );
            let vStep4S = f32x4.splat(<f32>4.0 * deltaS);
            let vGeomRad = f32x4.splat(geomRadius);
            let vScaledBezel = f32x4.splat(scaledBezel);
            let vProfScale = f32x4.splat(profileScale);
            let vZeroF = f32x4.splat(0.0);
            let vHalfF = f32x4.splat(0.5);
            let vNegHalfF = f32x4.splat(-0.5);
            let vOneF = f32x4.splat(1.0);
            let vTwoF = f32x4.splat(2.0);
            let v127F = f32x4.splat(127.0);
            let vEpsF = f32x4.splat(<f32>1e-6);
            let vEpsS = f32x4.splat(<f32>1e-12);
            let vMagic = i32x4.splat(0x5F375A86);
            let vNr1 = f32x4.splat(<f32>1.5008909);
            let v1p5 = f32x4.splat(1.5);
            let vRimBoost = f32x4.splat(<f32>0.08);

            for (let m: usize = 0; m < 128; m += 4) {
                let vHalfS = f32x4.mul(vS, vHalfF);
                let vR = i32x4.sub(vMagic, i32x4.shr_u(vS, 1));
                vR = f32x4.mul(vR, f32x4.sub(vNr1, f32x4.mul(vHalfS, f32x4.mul(vR, vR))));
                vR = f32x4.mul(vR, f32x4.sub(v1p5, f32x4.mul(vHalfS, f32x4.mul(vR, vR))));
                vR = v128.and(vR, f32x4.gt(vS, vEpsS));
                let vRho = f32x4.mul(vS, vR);

                let vD = f32x4.sub(vGeomRad, vRho);
                let vValid = v128.and(
                    v128.and(f32x4.ge(vD, vNegHalfF), f32x4.lt(vD, vScaledBezel)),
                    f32x4.gt(vRho, vEpsF)
                );

                let vCov = f32x4.min(vOneF, f32x4.max(vZeroF, f32x4.mul(f32x4.add(vD, vHalfF), vTwoF)));
                let vEffD = f32x4.max(vHalfF, vD);
                let vPIdx = f32x4.mul(vEffD, vProfScale);
                let vBIdx = i32x4.min_s(i32x4.trunc_sat_f32x4_s(vPIdx), v126I);
                let vFrac = f32x4.sub(vPIdx, f32x4.convert_i32x4_s(vBIdx));
                let vBOff = i32x4.shl(vBIdx, 2);

                let o0 = <usize>i32x4.extract_lane(vBOff, 0);
                let o1 = <usize>i32x4.extract_lane(vBOff, 1);
                let o2 = <usize>i32x4.extract_lane(vBOff, 2);
                let o3 = <usize>i32x4.extract_lane(vBOff, 3);

                let vP0 = f32x4(
                    load<f32>(normProfileBase + o0),
                    load<f32>(normProfileBase + o1),
                    load<f32>(normProfileBase + o2),
                    load<f32>(normProfileBase + o3)
                );
                let vP1 = f32x4(
                    load<f32>(normProfileBase + o0 + 4),
                    load<f32>(normProfileBase + o1 + 4),
                    load<f32>(normProfileBase + o2 + 4),
                    load<f32>(normProfileBase + o3 + 4)
                );

                let vInterp = f32x4.add(vP0, f32x4.mul(vFrac, f32x4.sub(vP1, vP0)));
                let vRimRatio = f32x4.max(vZeroF, f32x4.sub(vOneF, vD));
                let vHelmholtzGain = f32x4.add(vOneF, f32x4.mul(vRimBoost, f32x4.mul(vRimRatio, vRimRatio)));
                let vSharpenedMag = f32x4.min(v127F, f32x4.mul(vInterp, vHelmholtzGain));
                let vMag = f32x4.mul(vSharpenedMag, vCov);
                let vK = v128.and(f32x4.mul(vMag, vR), vValid);
                v128.store(ADDR_K_LUT + (m << 2), vK);

                vS = f32x4.add(vS, vStep4S);
            }

            let vInvDelta = f32x4.splat(invDeltaS);
            let vMaskAlphaBlue = i32x4.splat(0xFF000080);
            let vFourF = f32x4.splat(4.0);
            let vLaneOffsets = f32x4(0.0, 1.0, 2.0, 3.0);

            let pStart: i32 = cornerSize;
            let pEnd: i32 = cornerSize;

            for (let y = 0; y < cornerSize; y++) {
                let py: f32 = <f32>y + 0.5;
                let v: f32 = geomRadius - py;
                let v2: f32 = v * v;
                let vV = f32x4.splat(v);

                while (pStart > 0) {
                    let uPrev: f32 = geomRadius - (<f32>(pStart - 1) + 0.5);
                    if (uPrev * uPrev + v2 < sMax) {
                        pStart--;
                    } else {
                        break;
                    }
                }

                while (pEnd > 0) {
                    let uPrev: f32 = geomRadius - (<f32>(pEnd - 1) + 0.5);
                    if (uPrev * uPrev + v2 < sMin) {
                        pEnd--;
                    } else {
                        break;
                    }
                }

                let xLo: i32 = pStart;
                let xHi: i32 = pEnd;
                store<i32>(metaBase + (y << 2), xLo);
                store<i32>(xHiBase + (y << 2), xHi);

                let tlRowPtr: usize = ADDR_BMP_PAYLOAD + (<usize>(y * targetW) << 2);
                let blRowPtr: usize = ADDR_BMP_PAYLOAD + (<usize>((targetH - 1 - y) * targetW) << 2);

                if (needMarginClear && y < horizontalBezelLimit) {
                    if (xLo > 0) {
                        let rMarginOff: usize = <usize>((targetW - xLo) << 2);
                        clearRowNeutral(tlRowPtr, xLo, vNeutral);
                        clearRowNeutral(tlRowPtr + rMarginOff, xLo, vNeutral);
                        clearRowNeutral(blRowPtr, xLo, vNeutral);
                        clearRowNeutral(blRowPtr + rMarginOff, xLo, vNeutral);
                    }
                    if (xHi < cornerSize) {
                        let inSpan: i32 = cornerSize - xHi;
                        let lInOff: usize = <usize>(xHi << 2);
                        let rInOff: usize = <usize>((targetW - cornerSize) << 2);
                        clearRowNeutral(tlRowPtr + lInOff, inSpan, vNeutral);
                        clearRowNeutral(tlRowPtr + rInOff, inSpan, vNeutral);
                        clearRowNeutral(blRowPtr + lInOff, inSpan, vNeutral);
                        clearRowNeutral(blRowPtr + rInOff, inSpan, vNeutral);
                    }
                }

                if (xLo >= xHi) continue;

                let span: i32 = xHi - xLo;
                if (totalStreamPixels + span > 1024) {
                    canCacheStream = false;
                }

                let x: i32 = xLo;
                let simdLimit: i32 = xLo + (span & ~3);
                let rowIdxBaseScalar: f32 = (v2 - sMin) * invDeltaS + 0.5;
                let vRowIdxBase = f32x4.splat(rowIdxBaseScalar);
                let rowIgnBase: usize = ADDR_IGN + (<usize>(y & 15) << 6);

                if (x < simdLimit) {
                    let uStart: f32 = geomRadius - (<f32>x + 0.5);
                    let vU = f32x4.sub(f32x4.splat(uStart), vLaneOffsets);

                    for (; x < simdLimit; x += 4) {
                        let vIdxF = f32x4.add(f32x4.mul(f32x4.mul(vU, vU), vInvDelta), vRowIdxBase);
                        let vIdx = i32x4.min_u(i32x4.trunc_sat_f32x4_u(vIdxF), v127I);
                        let vByteIdx = i32x4.shl(vIdx, 2);

                        let k0 = load<f32>(ADDR_K_LUT + <usize>i32x4.extract_lane(vByteIdx, 0));
                        let k1 = load<f32>(ADDR_K_LUT + <usize>i32x4.extract_lane(vByteIdx, 1));
                        let k2 = load<f32>(ADDR_K_LUT + <usize>i32x4.extract_lane(vByteIdx, 2));
                        let k3 = load<f32>(ADDR_K_LUT + <usize>i32x4.extract_lane(vByteIdx, 3));

                        let vK = f32x4(k0, k1, k2, k3);
                        let vVx = f32x4.mul(vK, vU);
                        let vVy = f32x4.mul(vK, vV);

                        let vBias = v128.load(rowIgnBase + (<usize>(x & 12) << 2));

                        let vRPos = i32x4.min_u(i32x4.trunc_sat_f32x4_u(f32x4.add(vVx, vBias)), v255);
                        let vGPos = i32x4.min_u(i32x4.trunc_sat_f32x4_u(f32x4.add(vVy, vBias)), v255);

                        let vPixelTL = v128.or(vMaskAlphaBlue, v128.or(i32x4.shl(vRPos, 16), i32x4.shl(vGPos, 8)));
                        let vRevTL = i8x16.shuffle(vPixelTL, vPixelTL, 12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3);

                        let vPixelTR = v128.xor(vRevTL, vXorTR);
                        let vPixelBL = v128.xor(vPixelTL, vXorBL);
                        let vPixelBR = v128.xor(vRevTL, vXorBR);

                        let leftOff: usize = <usize>(x << 2);
                        let rightOff: usize = <usize>((targetW - 4 - x) << 2);

                        v128.store(tlRowPtr + leftOff, vPixelTL);
                        v128.store(blRowPtr + leftOff, vPixelBL);
                        v128.store(tlRowPtr + rightOff, vPixelTR);
                        v128.store(blRowPtr + rightOff, vPixelBR);

                        if (canCacheStream) {
                            let kOff: i32 = x - xLo;
                            v128.store(streamTL + (<usize>kOff << 2), vPixelTL);
                            v128.store(streamTR + (<usize>(span - 4 - kOff) << 2), vPixelTR);
                        }

                        vU = f32x4.sub(vU, vFourF);
                    }
                }

                if (x < xHi) {
                    if (span >= 4) {
                        let tailX: i32 = xHi - 4;
                        let uTail: f32 = geomRadius - (<f32>tailX + 0.5);
                        let vUTail = f32x4.sub(f32x4.splat(uTail), vLaneOffsets);
                        let vIdxF = f32x4.add(f32x4.mul(f32x4.mul(vUTail, vUTail), vInvDelta), vRowIdxBase);
                        let vIdx = i32x4.min_u(i32x4.trunc_sat_f32x4_u(vIdxF), v127I);
                        let vByteIdx = i32x4.shl(vIdx, 2);

                        let k0 = load<f32>(ADDR_K_LUT + <usize>i32x4.extract_lane(vByteIdx, 0));
                        let k1 = load<f32>(ADDR_K_LUT + <usize>i32x4.extract_lane(vByteIdx, 1));
                        let k2 = load<f32>(ADDR_K_LUT + <usize>i32x4.extract_lane(vByteIdx, 2));
                        let k3 = load<f32>(ADDR_K_LUT + <usize>i32x4.extract_lane(vByteIdx, 3));

                        let vK = f32x4(k0, k1, k2, k3);
                        let vVx = f32x4.mul(vK, vUTail);
                        let vVy = f32x4.mul(vK, vV);

                        let vBias = v128.load(rowIgnBase + (<usize>(tailX & 12) << 2));

                        let vRPos = i32x4.min_u(i32x4.trunc_sat_f32x4_u(f32x4.add(vVx, vBias)), v255);
                        let vGPos = i32x4.min_u(i32x4.trunc_sat_f32x4_u(f32x4.add(vVy, vBias)), v255);

                        let vPixelTL = v128.or(vMaskAlphaBlue, v128.or(i32x4.shl(vRPos, 16), i32x4.shl(vGPos, 8)));
                        let vRevTL = i8x16.shuffle(vPixelTL, vPixelTL, 12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3);

                        let vPixelTR = v128.xor(vRevTL, vXorTR);
                        let vPixelBL = v128.xor(vPixelTL, vXorBL);
                        let vPixelBR = v128.xor(vRevTL, vXorBR);

                        let leftOff: usize = <usize>(tailX << 2);
                        let rightOff: usize = <usize>((targetW - 4 - tailX) << 2);

                        v128.store(tlRowPtr + leftOff, vPixelTL);
                        v128.store(blRowPtr + leftOff, vPixelBL);
                        v128.store(tlRowPtr + rightOff, vPixelTR);
                        v128.store(blRowPtr + rightOff, vPixelBR);

                        if (canCacheStream) {
                            let kOff: i32 = tailX - xLo;
                            v128.store(streamTL + (<usize>kOff << 2), vPixelTL);
                            v128.store(streamTR + (<usize>(span - 4 - kOff) << 2), vPixelTR);
                        }
                    } else {
                        for (; x < xHi; x++) {
                            let u: f32 = geomRadius - (<f32>x + 0.5);
                            let idx = <i32>(u * u * invDeltaS + rowIdxBaseScalar);
                            if (idx > 127) idx = 127;
                            if (idx < 0) idx = 0;
                            let k = load<f32>(ADDR_K_LUT + (idx << 2));
                            let vx: f32 = k * u;
                            let vy: f32 = k * v;
                            let ignBias = load<f32>(rowIgnBase + (<usize>(x & 15) << 2));
                            let rPosRaw = <i32>(vx + ignBias);
                            let gPosRaw = <i32>(vy + ignBias);
                            let rPos: u32 = rPosRaw < 0 ? 0 : (rPosRaw > 255 ? 255 : <u32>rPosRaw);
                            let gPos: u32 = gPosRaw < 0 ? 0 : (gPosRaw > 255 ? 255 : <u32>gPosRaw);
                            let rNeg: u32 = 255 - rPos;
                            let gNeg: u32 = 255 - gPos;

                            let pTL: u32 = 0xFF000080 | (rPos << 16) | (gPos << 8);
                            let pTR: u32 = 0xFF000080 | (rNeg << 16) | (gPos << 8);
                            let leftOff: usize = <usize>(x << 2);
                            let rightOff: usize = <usize>((targetW - 1 - x) << 2);
                            store<u32>(tlRowPtr + leftOff, pTL);
                            store<u32>(tlRowPtr + rightOff, pTR);
                            store<u32>(blRowPtr + leftOff, 0xFF000080 | (rPos << 16) | (gNeg << 8));
                            store<u32>(blRowPtr + rightOff, 0xFF000080 | (rNeg << 16) | (gNeg << 8));

                            if (canCacheStream) {
                                let kOff: i32 = x - xLo;
                                store<u32>(streamTL + (<usize>kOff << 2), pTL);
                                store<u32>(streamTR + (<usize>(span - 1 - kOff) << 2), pTR);
                            }
                        }
                    }
                }

                if (canCacheStream) {
                    let spanBytes: usize = <usize>(span << 2);
                    streamTL += spanBytes;
                    streamTR += spanBytes;
                    totalStreamPixels += span;
                }
            }

            store<i32>(ADDR_CORNER_DIR_NORM + (<usize>cornerSlot << 2), normSlot);
            store<f32>(ADDR_CORNER_DIR_RAD + (<usize>cornerSlot << 2), geomRadius);
            store<f32>(ADDR_CORNER_DIR_BEZ + (<usize>cornerSlot << 2), scaledBezel);
            store<i32>(ADDR_CORNER_DIR_VALID + (<usize>cornerSlot << 2), canCacheStream ? 1 : 0);

            if (!canCacheStream) {
                memory.copy(ADDR_PREV_XLO, metaBase, <usize>(cornerSize << 2));
                memory.copy(ADDR_PREV_XHI, xHiBase, <usize>(cornerSize << 2));
                cornerSlot = -1;
            }
        }
    }

    if (needMarginClear && cornerSize < horizontalBezelLimit && cornerSize > 0) {
        let rMarginOff: usize = <usize>((targetW - cornerSize) << 2);
        for (let r = cornerSize; r < horizontalBezelLimit; r++) {
            let tlRowPtr: usize = ADDR_BMP_PAYLOAD + (<usize>(r * targetW) << 2);
            let blRowPtr: usize = ADDR_BMP_PAYLOAD + (<usize>((targetH - 1 - r) * targetW) << 2);
            clearRowNeutral(tlRowPtr, cornerSize, vNeutral);
            clearRowNeutral(tlRowPtr + rMarginOff, cornerSize, vNeutral);
            clearRowNeutral(blRowPtr, cornerSize, vNeutral);
            clearRowNeutral(blRowPtr + rMarginOff, cornerSize, vNeutral);
        }
    }

    let straightXStart = cornerSize;
    let straightXEnd = targetW - cornerSize;
    let straightSpan = straightXEnd - straightXStart;

    if (straightSpan > 0 && !isAxisX) {
        for (let r = 0; r < horizontalBezelLimit; r++) {
            let topPixel = load<u32>(topRowBase + (r << 2));
            let tOffset: usize = ADDR_BMP_PAYLOAD + <usize>((r * targetW + straightXStart) << 2);
            if (sameGeometryFootprint && load<u32>(tOffset) == topPixel) continue;
            let botPixel = load<u32>(botRowBase + (r << 2));
            let bOffset: usize = ADDR_BMP_PAYLOAD + <usize>(((targetH - 1 - r) * targetW + straightXStart) << 2);

            fillDualRowPixel(
                tOffset,
                bOffset,
                straightSpan,
                i32x4.splat(topPixel),
                i32x4.splat(botPixel),
                topPixel,
                botPixel
            );
        }
    }

    let interiorStartRow = cornerSize;
    let interiorEndRow = targetH - cornerSize;
    if (actualColBezelLimit > 0 && interiorEndRow > interiorStartRow) {
        let rightEdgeOffset = targetW - actualColBezelLimit;
        let col4 = actualColBezelLimit & ~3;

        for (let r = interiorStartRow; r < interiorEndRow; r++) {
            let rowBase: usize = ADDR_BMP_PAYLOAD + <usize>((r * targetW) << 2);
            let rightBase: usize = rowBase + <usize>(rightEdgeOffset << 2);

            let i = 0;
            for (; i < col4; i += 4) {
                let off: usize = <usize>(i << 2);
                v128.store(rowBase + off, v128.load(leftColBase + off));
                v128.store(rightBase + off, v128.load(rightColBase + off));
            }
            if (actualColBezelLimit > col4) {
                if (actualColBezelLimit >= 4) {
                    let off: usize = <usize>((actualColBezelLimit - 4) << 2);
                    v128.store(rowBase + off, v128.load(leftColBase + off));
                    v128.store(rightBase + off, v128.load(rightColBase + off));
                } else {
                    for (; i < actualColBezelLimit; i++) {
                        let off: usize = <usize>(i << 2);
                        store<u32>(rowBase + off, load<u32>(leftColBase + off));
                        store<u32>(rightBase + off, load<u32>(rightColBase + off));
                    }
                }
            }
        }
    }

    let pixelBytes: u32 = <u32>(curTotalPx << 2);
    let totalFileSize: u32 = <u32>BMP_HEADER_SIZE + pixelBytes;
    store<u32>(ADDR_BMP_HEADER + 2, totalFileSize);
    store<i32>(ADDR_BMP_HEADER + 18, targetW);
    store<i32>(ADDR_BMP_HEADER + 22, -targetH);
    store<u32>(ADDR_BMP_HEADER + 34, pixelBytes);

    store<i32>(ADDR_STATE_PREV_W, targetW);
    store<i32>(ADDR_STATE_PREV_H, targetH);
    store<i32>(ADDR_STATE_PREV_CORNER, cornerSize);
    store<i32>(ADDR_STATE_PREV_HORIZ_BEZEL, horizontalBezelLimit);
    store<i32>(ADDR_STATE_PREV_COL_BEZEL, actualColBezelLimit);
    store<i32>(ADDR_STATE_PREV_CORNER_SLOT, cornerSlot);
    store<i32>(ADDR_STATE_LAST_SURFACE, surfaceId);
    store<i32>(ADDR_STATE_LAST_RHO_QUANT, rhoQuant);
    store<f32>(ADDR_STATE_LAST_IOR, ior);
    store<f32>(ADDR_STATE_LAST_SCALE, scaleFactor);
    store<i32>(ADDR_STATE_LAST_FLAGS, flags);
    store<f32>(ADDR_STATE_LAST_RADIUS, radius);
    store<f32>(ADDR_STATE_LAST_CLAMPED_BEZEL, clampedBezel);
    store<f32>(ADDR_STATE_LAST_THICKNESS, glassThickness);
    store<i32>(ADDR_STATE_LAST_TOTAL_BYTES, <i32>totalFileSize);
    store<f32>(ADDR_STATE_PREV_GEOM_RAD, geomRadius);
    store<f32>(ADDR_STATE_PREV_SCALED_BEZ, scaledBezel);
    store<i32>(ADDR_STATE_DIRTY_MAX_PX, dirtyMaxPx);

    return <i32>totalFileSize;
}
