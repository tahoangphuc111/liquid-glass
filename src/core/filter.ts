import {
    BLUR_EDGE_MODE,
    GLASS_COLOR_MATRIX,
    MAP_MIN_SCALE,
    MAP_PRELOAD_TIMEOUT_MS,
    PREBLUR_MODE,
    SVG_NS,
    USE_CSS_SATURATION,
    pickMapScale,
} from "./config.js";
import type { GlassConfig, GlassSurface } from "./types.js";
import { getWasmDisplacementBmp, revokeBlobUrlSafely } from "./wasm.js";

export interface FilterArchetype {
    targetW: number;
    targetH: number;
    effectiveScale: number;
    clampedBezel: number;
    blob: Blob;
    blobUrl: string | null;
    scale: string;
    needsSeparateT1Filter: boolean;
    filterX: string;
    filterY: string;
    filterW: string;
    filterH: string;
    debugStr: string;
    decoded: boolean;
    preloadPromise: Promise<void> | null;
}

export interface PooledFilterElement extends SVGFilterElement {
    _isStd?: boolean;
    _hasMatrix?: boolean;
    _lastX?: string;
    _lastY?: string;
    _lastW?: string;
    _lastH?: string;
    _feImage?: PooledFeImageElement;
    _feDisp?: PooledFeDisplacementElement;
}

interface PooledFeImageElement extends SVGFEImageElement {
    _lastHref?: string;
    _lastW?: number;
    _lastH?: number;
}

interface PooledFeDisplacementElement extends SVGFEDisplacementMapElement {
    _lastScale?: string;
}

export interface SharedFilterRecord {
    key: string;
    filterId: string;
    filterIdT1: string;
    node: PooledFilterElement | null;
    nodeT1: PooledFilterElement | null;
    feImage: PooledFeImageElement | null;
    feImageT1: PooledFeImageElement | null;
    refCount: number;
    blobUrl: string | null;
    lastUsed: number;
    ready: boolean;
    readyPromise: Promise<void> | null;
    preloadImage: HTMLImageElement | null;
    preloadTimerId: ReturnType<typeof setTimeout> | null;
    actualW: number;
    actualH: number;
    lastFeW: number;
    lastFeH: number;
    archetype: FilterArchetype | null;
}

export interface AcquireFilterOptions {
    sharedKey: string;
    config: GlassConfig;
    w: number;
    h: number;
    actualW?: number;
    actualH?: number;
    radius: number;
    surface: GlassSurface;
    rasterScale: number;
    halfMinDim: number;
    svgDefs: SVGDefsElement;
}

export const sharedFilters = new Map<string, SharedFilterRecord>();
export const lruUnusedFilterKeys = new Set<string>();
export const filterArchetypeCache = new Map<string, FilterArchetype>();

export let activeBlobUrlCount = 0;

let filterIdCounter = 0;
let lruEvictionTimer: ReturnType<typeof setTimeout> | null = null;

const MAX_LRU_FILTERS = 2;
const LRU_IDLE_EVICT_MS = 5000;
const MAX_FILTER_ARCHETYPES = 16;
const RESOLVED_VOID_PROMISE = Promise.resolve();

let lastArchCfg1: GlassConfig | null = null;
let lastArchW1 = 0;
let lastArchH1 = 0;
let lastArchRad1 = -1;
let lastArchSurf1 = "";
let lastArchScale1 = 0;
let lastArchTier1 = -1;
let lastArchVal1: FilterArchetype | null = null;

let lastArchCfg2: GlassConfig | null = null;
let lastArchW2 = 0;
let lastArchH2 = 0;
let lastArchRad2 = -1;
let lastArchSurf2 = "";
let lastArchScale2 = 0;
let lastArchTier2 = -1;
let lastArchVal2: FilterArchetype | null = null;

export function resetArchetypeHotSlots(): void {
    lastArchCfg1 = null;
    lastArchCfg2 = null;
    lastArchVal1 = null;
    lastArchVal2 = null;
}

export function scheduleLruEviction(delay = LRU_IDLE_EVICT_MS): void {
    if (lruEvictionTimer !== null) return;
    lruEvictionTimer = setTimeout(processLruEviction, delay);
}

export function clearLruEvictionTimer(): void {
    if (lruEvictionTimer !== null) {
        clearTimeout(lruEvictionTimer);
        lruEvictionTimer = null;
    }
}

export function processLruEviction(): void {
    lruEvictionTimer = null;
    const now = performance.now();
    let nextDelay = LRU_IDLE_EVICT_MS;
    for (const key of lruUnusedFilterKeys) {
        const record = sharedFilters.get(key);
        if (!record) {
            lruUnusedFilterKeys.delete(key);
            continue;
        }
        if (record.refCount <= 0) {
            const idleTime = now - record.lastUsed;
            if (idleTime >= LRU_IDLE_EVICT_MS) {
                disposeSharedFilter(key, false);
            } else {
                nextDelay = Math.max(50, LRU_IDLE_EVICT_MS - idleTime);
                break;
            }
        }
    }
    if (lruUnusedFilterKeys.size > 0) {
        scheduleLruEviction(nextDelay);
    }
}

export function buildFilterElement(
    id: string,
    filterX: string,
    filterY: string,
    filterW: string,
    filterH: string,
    combinedUrl: string,
    width: number,
    height: number,
    scale: string,
    colorMatrix: string | undefined,
    blurAmt: number | string,
    isT1 = false,
    dispSmooth = 0,
): { filterNode: PooledFilterElement; feImage: PooledFeImageElement } {
    const numericBlur = typeof blurAmt === "string" ? parseFloat(blurAmt) : blurAmt;
    const isStandard =
        !(PREBLUR_MODE === "svg" && numericBlur > 0) &&
        !isT1 &&
        dispSmooth <= 0 &&
        (colorMatrix === GLASS_COLOR_MATRIX || !colorMatrix || USE_CSS_SATURATION);
    const hasMatrix = !USE_CSS_SATURATION && Boolean(colorMatrix);

    const filterNode = document.createElementNS(SVG_NS, "filter") as PooledFilterElement;
    filterNode.id = id;
    filterNode.setAttribute("x", filterX);
    filterNode.setAttribute("y", filterY);
    filterNode.setAttribute("width", filterW);
    filterNode.setAttribute("height", filterH);
    filterNode.setAttribute("color-interpolation-filters", "sRGB");

    let dispMapIn = "SourceGraphic";
    if (PREBLUR_MODE === "svg" && numericBlur > 0) {
        const blurNode = document.createElementNS(SVG_NS, "feGaussianBlur");
        blurNode.setAttribute("in", "SourceGraphic");
        blurNode.setAttribute("stdDeviation", String(blurAmt));
        if (BLUR_EDGE_MODE !== "none") {
            blurNode.setAttribute("edgeMode", BLUR_EDGE_MODE);
        }
        const blurResult = isT1 ? "blurred_source_t1" : "blurred_source";
        blurNode.setAttribute("result", blurResult);
        filterNode.appendChild(blurNode);
        dispMapIn = blurResult;
    }

    const feImage = document.createElementNS(SVG_NS, "feImage") as PooledFeImageElement;
    feImage.setAttribute("href", combinedUrl);
    feImage.setAttribute("preserveAspectRatio", "none");
    feImage.setAttribute("x", "0");
    feImage.setAttribute("y", "0");
    feImage.setAttribute("width", String(width));
    feImage.setAttribute("height", String(height));
    const dispMapResult = isT1 ? "disp_map_t1" : "disp_map";
    feImage.setAttribute("result", dispMapResult);
    filterNode.appendChild(feImage);

    let dispMapSource = dispMapResult;
    if (!isT1 && dispSmooth > 0) {
        const mapBlurNode = document.createElementNS(SVG_NS, "feGaussianBlur");
        mapBlurNode.setAttribute("in", dispMapResult);
        mapBlurNode.setAttribute("stdDeviation", dispSmooth.toFixed(2));
        mapBlurNode.setAttribute("edgeMode", "duplicate");
        const smoothResult = "disp_map_smooth";
        mapBlurNode.setAttribute("result", smoothResult);
        filterNode.appendChild(mapBlurNode);
        dispMapSource = smoothResult;
    }

    const feDisp = document.createElementNS(
        SVG_NS,
        "feDisplacementMap",
    ) as PooledFeDisplacementElement;
    feDisp.setAttribute("in", dispMapIn);
    feDisp.setAttribute("in2", dispMapSource);
    feDisp.setAttribute("scale", scale);
    feDisp.setAttribute("xChannelSelector", "R");
    feDisp.setAttribute("yChannelSelector", "G");
    const dispResult = isT1 ? "displaced_t1" : "displaced";
    feDisp.setAttribute("result", dispResult);
    filterNode.appendChild(feDisp);

    if (colorMatrix && !isT1 && !USE_CSS_SATURATION) {
        const feColor = document.createElementNS(SVG_NS, "feColorMatrix");
        feColor.setAttribute("in", dispResult);
        feColor.setAttribute("type", "matrix");
        feColor.setAttribute("values", colorMatrix);
        filterNode.appendChild(feColor);
    }

    if (isStandard) {
        filterNode._isStd = true;
        filterNode._hasMatrix = hasMatrix;
        filterNode._lastX = filterX;
        filterNode._lastY = filterY;
        filterNode._lastW = filterW;
        filterNode._lastH = filterH;
        filterNode._feImage = feImage;
        filterNode._feDisp = feDisp;
        feImage._lastHref = combinedUrl;
        feImage._lastW = width;
        feImage._lastH = height;
        feDisp._lastScale = scale;
    }

    return { filterNode, feImage };
}

export function startMapPreload(
    record: SharedFilterRecord,
    archetype: FilterArchetype | null = null,
): Promise<void> {
    if (record.ready) return RESOLVED_VOID_PROMISE;
    if (record.readyPromise) return record.readyPromise;
    if (archetype && archetype.preloadPromise) {
        record.readyPromise = archetype.preloadPromise;
        return archetype.preloadPromise;
    }

    if (typeof Image === "undefined" || !record.blobUrl) {
        record.ready = true;
        if (archetype) {
            archetype.decoded = true;
            archetype.preloadPromise = RESOLVED_VOID_PROMISE;
        }
        record.readyPromise = RESOLVED_VOID_PROMISE;
        return RESOLVED_VOID_PROMISE;
    }

    const img = new Image();
    img.decoding = "async";
    record.preloadImage = img;
    img.src = record.blobUrl;

    const preloadPromise = new Promise<void>((resolve) => {
        let timerId: ReturnType<typeof setTimeout> | null = null;
        const settle = () => {
            if (timerId !== null) {
                clearTimeout(timerId);
                timerId = null;
            }
            record.preloadTimerId = null;
            record.ready = true;
            if (archetype) archetype.decoded = true;
            record.preloadImage = null;
            resolve();
        };

        timerId = setTimeout(settle, MAP_PRELOAD_TIMEOUT_MS);
        record.preloadTimerId = timerId;

        if (typeof img.decode === "function") {
            img.decode().then(settle, settle);
        } else {
            img.onload = settle;
            img.onerror = settle;
        }
    });

    record.readyPromise = preloadPromise;
    if (archetype) archetype.preloadPromise = preloadPromise;
    return preloadPromise;
}

export function acquireSharedFilter(
    options: AcquireFilterOptions,
    tier = 0,
): SharedFilterRecord | null {
    const {
        sharedKey,
        config,
        w,
        h,
        actualW = w,
        actualH = h,
        radius,
        surface,
        rasterScale,
        halfMinDim,
        svgDefs,
    } = options;

    const now = performance.now();

    const existingRecord = sharedFilters.get(sharedKey);
    if (existingRecord !== undefined) {
        if (
            existingRecord.refCount >= 1 &&
            (existingRecord.actualW !== actualW || existingRecord.actualH !== actualH)
        ) {
            const exactKey = `${sharedKey}_${actualW}x${actualH}`;
            return acquireSharedFilter(
                {
                    ...options,
                    sharedKey: exactKey,
                },
                tier,
            );
        }
        lruUnusedFilterKeys.delete(sharedKey);
        existingRecord.refCount++;
        existingRecord.lastUsed = now;
        if (existingRecord.node && !existingRecord.node.parentNode && svgDefs) {
            svgDefs.appendChild(existingRecord.node);
        }
        if (existingRecord.nodeT1 && !existingRecord.nodeT1.parentNode && svgDefs) {
            svgDefs.appendChild(existingRecord.nodeT1);
        }
        return existingRecord;
    }

    const blurAmt = config.blur;
    const ior = config.ior;
    let archetype: FilterArchetype | null = null;
    if (
        config === lastArchCfg1 &&
        w === lastArchW1 &&
        h === lastArchH1 &&
        radius === lastArchRad1 &&
        surface === lastArchSurf1 &&
        rasterScale === lastArchScale1 &&
        tier === lastArchTier1
    ) {
        archetype = lastArchVal1;
    } else if (
        config === lastArchCfg2 &&
        w === lastArchW2 &&
        h === lastArchH2 &&
        radius === lastArchRad2 &&
        surface === lastArchSurf2 &&
        rasterScale === lastArchScale2 &&
        tier === lastArchTier2
    ) {
        archetype = lastArchVal2;
    } else {
        const archetypeKey = `${config.id}|${w}_${h}_${radius}_${surface}_${ior.toFixed(2)}_${rasterScale}_${tier}`;
        archetype = filterArchetypeCache.get(archetypeKey) ?? null;

        if (!archetype) {
            const glassThickness = config.thickness;
            const maxBezel = config.bezel;
            const limitBezel = halfMinDim - 1;
            const minBezel = maxBezel < limitBezel ? maxBezel : limitBezel;
            const clampedBezel = minBezel > 1 ? minBezel : 1;
            const scaleRatio = config.scaleRatio;

            const isAxisX = config.axis === "x";
            const baseScale = pickMapScale(w, h, clampedBezel, radius, blurAmt, isAxisX);
            const activeScale =
                tier === 2
                    ? baseScale * 0.5 > MAP_MIN_SCALE
                        ? baseScale * 0.5
                        : MAP_MIN_SCALE
                    : baseScale;
            let targetW: number;
            let targetH: number;
            let effectiveScale: number;
            if (isAxisX) {
                targetH = 1;
                const rawEvenW = 2 * ((w * activeScale * 0.5 + 0.5) | 0);
                targetW = rawEvenW > 4 ? rawEvenW : 4;
                effectiveScale = targetW / w;
            } else if (w >= h) {
                const rawEvenH = 2 * ((h * activeScale * 0.5 + 0.5) | 0);
                targetH = rawEvenH > 2 ? rawEvenH : 2;
                effectiveScale = targetH / h;
                const rawEvenW = 2 * ((w * effectiveScale * 0.5 + 0.5) | 0);
                targetW = rawEvenW > 4 ? rawEvenW : 4;
            } else {
                const rawEvenW = 2 * ((w * activeScale * 0.5 + 0.5) | 0);
                targetW = rawEvenW > 4 ? rawEvenW : 4;
                effectiveScale = targetW / w;
                const rawEvenH = 2 * ((h * effectiveScale * 0.5 + 0.5) | 0);
                targetH = rawEvenH > 2 ? rawEvenH : 2;
            }
            const maxSafeTexels = 136_000;
            if (targetW * targetH > maxSafeTexels) {
                const shrink = Math.sqrt(maxSafeTexels / Math.max(1, targetW * targetH));
                targetW = Math.max(4, 2 * ((targetW * shrink * 0.5) | 0));
                targetH = Math.max(2, 2 * ((targetH * shrink * 0.5) | 0));
                effectiveScale = Math.min(targetW / w, targetH / h);
            }

            const wasmRes = getWasmDisplacementBmp(
                targetW,
                targetH,
                radius,
                clampedBezel,
                glassThickness,
                effectiveScale,
                ior,
                surface,
                config.pill,
                isAxisX,
            );

            if (!wasmRes) {
                return null;
            }

            const blobUrl = URL.createObjectURL(wasmRes.blob);
            activeBlobUrlCount++;

            const finalMaxDisplacement = wasmRes.maxDisplacement || 1.0;
            const rawScale = finalMaxDisplacement * scaleRatio;
            const maxScale = config.maxScaleMultiplier * clampedBezel;
            const clampedScale = rawScale < maxScale ? rawScale : maxScale;
            const scale = (((clampedScale * 100 + 0.5) | 0) * 0.01).toFixed(2);

            const needsSeparateT1Filter = PREBLUR_MODE === "svg" && blurAmt > 0;
            const padPx = needsSeparateT1Filter ? Math.ceil(3 * blurAmt) : 0;
            const filterX = padPx === 0 ? "0%" : `-${((padPx / w) * 100).toFixed(2)}%`;
            const filterY = padPx === 0 ? "0%" : `-${((padPx / h) * 100).toFixed(2)}%`;
            const filterW = padPx === 0 ? "100%" : `${(100 + ((2 * padPx) / w) * 100).toFixed(2)}%`;
            const filterH = padPx === 0 ? "100%" : `${(100 + ((2 * padPx) / h) * 100).toFixed(2)}%`;

            archetype = {
                targetW,
                targetH,
                effectiveScale,
                clampedBezel,
                blob: wasmRes.blob,
                blobUrl,
                scale,
                needsSeparateT1Filter,
                filterX,
                filterY,
                filterW,
                filterH,
                debugStr: `${targetW}x${targetH} @${effectiveScale.toFixed(2)}x (element ${w}x${h})`,
                decoded: false,
                preloadPromise: null,
            };

            if (filterArchetypeCache.size >= MAX_FILTER_ARCHETYPES) {
                const oldestKey = filterArchetypeCache.keys().next().value;
                if (oldestKey !== undefined) {
                    const evictedArch = filterArchetypeCache.get(oldestKey);
                    if (evictedArch && evictedArch.blobUrl) {
                        revokeBlobUrlSafely(evictedArch.blobUrl);
                        evictedArch.blobUrl = null;
                        if (activeBlobUrlCount > 0) activeBlobUrlCount--;
                    }
                    filterArchetypeCache.delete(oldestKey);
                }
            }
            filterArchetypeCache.set(archetypeKey, archetype);
        }

        lastArchCfg2 = lastArchCfg1;
        lastArchW2 = lastArchW1;
        lastArchH2 = lastArchH1;
        lastArchRad2 = lastArchRad1;
        lastArchSurf2 = lastArchSurf1;
        lastArchScale2 = lastArchScale1;
        lastArchTier2 = lastArchTier1;
        lastArchVal2 = lastArchVal1;

        lastArchCfg1 = config;
        lastArchW1 = w;
        lastArchH1 = h;
        lastArchRad1 = radius;
        lastArchSurf1 = surface;
        lastArchScale1 = rasterScale;
        lastArchTier1 = tier;
        lastArchVal1 = archetype;
    }

    if (!archetype) {
        return null;
    }

    const combinedUrl = archetype.blobUrl ?? "";
    filterIdCounter++;
    const filterId = `lg-${filterIdCounter}`;
    const needsSeparateT1Filter = archetype.needsSeparateT1Filter;
    const filterIdT1 = needsSeparateT1Filter ? `lg-${filterIdCounter}-t1` : filterId;

    const { filterNode, feImage } = buildFilterElement(
        filterId,
        archetype.filterX,
        archetype.filterY,
        archetype.filterW,
        archetype.filterH,
        combinedUrl,
        actualW,
        actualH,
        archetype.scale,
        config.colorMatrix,
        blurAmt,
        false,
        0,
    );
    svgDefs.appendChild(filterNode);

    let filterNodeT1: PooledFilterElement | null = null;
    let feImageT1: PooledFeImageElement | null = null;
    if (needsSeparateT1Filter) {
        const blurAmtT1 = (blurAmt * 0.5).toFixed(2);
        const padPxT1 = Math.ceil(1.5 * blurAmt);
        const filterXT1 = padPxT1 === 0 ? "0%" : `-${((padPxT1 / w) * 100).toFixed(2)}%`;
        const filterYT1 = padPxT1 === 0 ? "0%" : `-${((padPxT1 / h) * 100).toFixed(2)}%`;
        const filterWT1 = padPxT1 === 0 ? "100%" : `${(100 + ((2 * padPxT1) / w) * 100).toFixed(2)}%`;
        const filterHT1 = padPxT1 === 0 ? "100%" : `${(100 + ((2 * padPxT1) / h) * 100).toFixed(2)}%`;
        const t1Result = buildFilterElement(
            filterIdT1,
            filterXT1,
            filterYT1,
            filterWT1,
            filterHT1,
            combinedUrl,
            actualW,
            actualH,
            archetype.scale,
            config.colorMatrix,
            blurAmtT1,
            true,
        );
        filterNodeT1 = t1Result.filterNode;
        feImageT1 = t1Result.feImage;
        svgDefs.appendChild(filterNodeT1);
    }

    const isReady = archetype.decoded;
    const newRecord: SharedFilterRecord = {
        key: sharedKey,
        filterId,
        filterIdT1,
        node: filterNode,
        nodeT1: filterNodeT1,
        feImage,
        feImageT1,
        refCount: 1,
        blobUrl: combinedUrl,
        lastUsed: now,
        ready: isReady,
        readyPromise: isReady ? RESOLVED_VOID_PROMISE : null,
        preloadImage: null,
        preloadTimerId: null,
        actualW,
        actualH,
        lastFeW: actualW,
        lastFeH: actualH,
        archetype,
    };
    if (!isReady) {
        startMapPreload(newRecord, archetype);
    }
    sharedFilters.set(sharedKey, newRecord);
    return newRecord;
}

export function disposeSharedFilter(key: string, _immediate = false): void {
    if (!key) return;
    const record = sharedFilters.get(key);
    if (!record) return;

    if (record.preloadTimerId !== null) {
        clearTimeout(record.preloadTimerId);
        record.preloadTimerId = null;
    }

    const node = record.node;
    if (node && node.parentNode) {
        node.remove();
    }
    if (record.nodeT1 && record.nodeT1.parentNode) {
        record.nodeT1.remove();
    }
    record.node = null;
    record.nodeT1 = null;
    record.feImage = null;
    record.feImageT1 = null;
    record.preloadImage = null;
    record.archetype = null;

    sharedFilters.delete(key);
    lruUnusedFilterKeys.delete(key);
}

export function releaseSharedFilter(
    key: string | null,
    expectedRecord: SharedFilterRecord | null = null,
): void {
    if (!key) return;
    const record = sharedFilters.get(key);
    if (!record) return;
    if (expectedRecord && record !== expectedRecord) return;
    record.refCount--;
    if (record.refCount <= 0) {
        record.refCount = 0;
        record.lastUsed = performance.now();
        lruUnusedFilterKeys.delete(key);
        lruUnusedFilterKeys.add(key);
        while (lruUnusedFilterKeys.size > MAX_LRU_FILTERS) {
            const evictKey = lruUnusedFilterKeys.keys().next().value;
            if (evictKey !== undefined) {
                disposeSharedFilter(evictKey, false);
            } else {
                break;
            }
        }
        scheduleLruEviction();
    }
}

export function decrementActiveBlobUrlCount(): void {
    if (activeBlobUrlCount > 0) activeBlobUrlCount--;
}
