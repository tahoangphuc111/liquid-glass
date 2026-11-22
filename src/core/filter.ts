import {
    BLUR_EDGE_MODE,
    GLASS_COLOR_MATRIX,
    MAP_MIN_SCALE,
    MAP_PRELOAD_TIMEOUT_MS,
    PREBLUR_MODE,
    SVG_NS,
    USE_CSS_SATURATION,
    pickMapScale,
    resolveChromaticAberration,
} from "./config.js";
import { getRefractionSpan, resolveRefractionBezel, resolveRefractionTravel } from "./refractionBounds.js";
import type { GlassConfig, GlassSurface } from "./types.js";
import {
    acquireCachedDisplacementBlobUrl,
    getWasmDisplacementBmp,
    MAX_DISPLACEMENT_TEXELS,
    releaseCachedDisplacementBlobUrl,
    setOnBlobUrlEvicted,
} from "./wasm.js";

export interface FilterArchetype {
    targetW: number;
    targetH: number;
    effectiveScale: number;
    clampedBezel: number;
    blob: Blob;
    blobUrl: string | null;
    scale: number;
    needsSeparateT1Filter: boolean;
    filterX: string;
    filterY: string;
    filterW: string;
    filterH: string;
    debugStr: string;
    decoded: boolean;
    preloadPromise: Promise<void> | null;
    finishPreload?: (reuseImage: boolean) => void;
    refCount: number;
    evicted: boolean;
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
    finishPreload?: (reuseImage: boolean) => void;
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
const MAX_POOLED_STD_FILTERS = 16;
const MAX_POOLED_PRELOAD_IMAGES = 8;
const RESOLVED_VOID_PROMISE = Promise.resolve();
const SVG_BLUE_SHIFT = 1.35 * 1.28;

const freeStdFilterPool: PooledFilterElement[] = [];
const freePreloadImages: HTMLImageElement[] = [];

export function clearFilterElementPools(): void {
    freeStdFilterPool.length = 0;
    freePreloadImages.length = 0;
}

let lastArchCfg1: GlassConfig | null = null;
let lastArchW1 = 0;
let lastArchH1 = 0;
let lastArchRad1 = -1;
let lastArchSurf1 = "";
let lastArchCornerStyle1 = "";
let lastArchScale1 = 0;
let lastArchTier1 = -1;
let lastArchVal1: FilterArchetype | null = null;

let lastArchCfg2: GlassConfig | null = null;
let lastArchW2 = 0;
let lastArchH2 = 0;
let lastArchRad2 = -1;
let lastArchSurf2 = "";
let lastArchCornerStyle2 = "";
let lastArchScale2 = 0;
let lastArchTier2 = -1;
let lastArchVal2: FilterArchetype | null = null;

export function resetArchetypeHotSlots(): void {
    lastArchCfg1 = null;
    lastArchCfg2 = null;
    lastArchVal1 = null;
    lastArchVal2 = null;
    lastArchCornerStyle1 = "";
    lastArchCornerStyle2 = "";
}

const getNowMs = (): number =>
    typeof performance !== "undefined" ? performance.now() : Date.now();

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
    const now = getNowMs();
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

function createDisplacementNode(
    dispMapIn: string,
    dispMapSource: string,
    scaleValue: string,
    resultId: string,
): PooledFeDisplacementElement {
    const feDisp = document.createElementNS(
        SVG_NS,
        "feDisplacementMap",
    ) as PooledFeDisplacementElement;
    feDisp.setAttribute("in", dispMapIn);
    feDisp.setAttribute("in2", dispMapSource);
    feDisp.setAttribute("scale", scaleValue);
    feDisp.setAttribute("xChannelSelector", "R");
    feDisp.setAttribute("yChannelSelector", "G");
    feDisp.setAttribute("result", resultId);
    return feDisp;
}

function createChannelMatrixNode(
    sourceId: string,
    matrixValues: string,
    resultId: string,
): SVGFEColorMatrixElement {
    const feMatrix = document.createElementNS(SVG_NS, "feColorMatrix");
    feMatrix.setAttribute("in", sourceId);
    feMatrix.setAttribute("type", "matrix");
    feMatrix.setAttribute("values", matrixValues);
    feMatrix.setAttribute("result", resultId);
    return feMatrix;
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
    chromaticAberration?: boolean | number,
    abbeNumber?: number,
): { filterNode: PooledFilterElement; feImage: PooledFeImageElement } {
    const numericBlur = typeof blurAmt === "string" ? parseFloat(blurAmt) : blurAmt;
    const chromaAmount = resolveChromaticAberration(chromaticAberration, abbeNumber);
    const numericScale = parseFloat(scale) || 0;
    const chromaShift = chromaAmount * 1.35;
    const scaleMinus = Math.max(0, numericScale * (1 - chromaShift * 0.72));
    const scalePlus = numericScale * (1 + chromaAmount * SVG_BLUE_SHIFT);
    const useChromatic = chromaAmount > 0 && scalePlus - scaleMinus >= 0.25;

    const isStandard =
        !useChromatic &&
        !(PREBLUR_MODE === "svg" && numericBlur > 0) &&
        !isT1 &&
        dispSmooth <= 0 &&
        (colorMatrix === GLASS_COLOR_MATRIX || !colorMatrix || USE_CSS_SATURATION);
    const hasMatrix = !USE_CSS_SATURATION && Boolean(colorMatrix);

    if (isStandard && !hasMatrix && freeStdFilterPool.length > 0) {
        const pooledFilter = freeStdFilterPool.pop()!;
        const pooledFeImage = pooledFilter._feImage;
        const pooledFeDisp = pooledFilter._feDisp;
        if (pooledFeImage && pooledFeDisp) {
            pooledFilter.id = id;
            if (pooledFilter._lastX !== filterX) {
                pooledFilter.setAttribute("x", filterX);
                pooledFilter._lastX = filterX;
            }
            if (pooledFilter._lastY !== filterY) {
                pooledFilter.setAttribute("y", filterY);
                pooledFilter._lastY = filterY;
            }
            if (pooledFilter._lastW !== filterW) {
                pooledFilter.setAttribute("width", filterW);
                pooledFilter._lastW = filterW;
            }
            if (pooledFilter._lastH !== filterH) {
                pooledFilter.setAttribute("height", filterH);
                pooledFilter._lastH = filterH;
            }
            if (pooledFeImage._lastHref !== combinedUrl) {
                pooledFeImage.setAttribute("href", combinedUrl);
                pooledFeImage._lastHref = combinedUrl;
            }
            if (pooledFeImage._lastW !== width) {
                pooledFeImage.setAttribute("width", String(width));
                pooledFeImage._lastW = width;
            }
            if (pooledFeImage._lastH !== height) {
                pooledFeImage.setAttribute("height", String(height));
                pooledFeImage._lastH = height;
            }
            if (pooledFeDisp._lastScale !== scale) {
                pooledFeDisp.setAttribute("scale", scale);
                pooledFeDisp._lastScale = scale;
            }
            return { filterNode: pooledFilter, feImage: pooledFeImage };
        }
    }

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

    const dispResult = isT1 ? "displaced_t1" : "displaced";
    let feDisp: PooledFeDisplacementElement | undefined;

    if (useChromatic) {
        const suffix = isT1 ? "_t1" : "";
        const warmDispId = `disp_warm${suffix}`;
        const coolDispId = `disp_cool${suffix}`;
        const warmMixId = `warm_mix${suffix}`;
        const coolMixId = `cool_mix${suffix}`;

        filterNode.appendChild(
            createDisplacementNode(dispMapIn, dispMapSource, scaleMinus.toFixed(2), warmDispId),
        );
        filterNode.appendChild(
            createDisplacementNode(dispMapIn, dispMapSource, scalePlus.toFixed(2), coolDispId),
        );
        filterNode.appendChild(
            createChannelMatrixNode(
                warmDispId,
                "1 0 0 0 0  0 0.5 0 0 0  0 0 0 0 0  0 0 0 1 0",
                warmMixId,
            ),
        );
        filterNode.appendChild(
            createChannelMatrixNode(
                coolDispId,
                "0 0 0 0 0  0 0.5 0 0 0  0 0 1 0 0  0 0 0 1 0",
                coolMixId,
            ),
        );

        const feCombine = document.createElementNS(SVG_NS, "feComposite");
        feCombine.setAttribute("in", warmMixId);
        feCombine.setAttribute("in2", coolMixId);
        feCombine.setAttribute("operator", "arithmetic");
        feCombine.setAttribute("k1", "0");
        feCombine.setAttribute("k2", "1");
        feCombine.setAttribute("k3", "1");
        feCombine.setAttribute("k4", "0");
        feCombine.setAttribute("result", dispResult);
        filterNode.appendChild(feCombine);
    } else {
        feDisp = createDisplacementNode(dispMapIn, dispMapSource, scale, dispResult);
        filterNode.appendChild(feDisp);
    }

    if (colorMatrix && !isT1 && !USE_CSS_SATURATION) {
        const feColor = document.createElementNS(SVG_NS, "feColorMatrix");
        feColor.setAttribute("in", dispResult);
        feColor.setAttribute("type", "matrix");
        feColor.setAttribute("values", colorMatrix);
        filterNode.appendChild(feColor);
    }

    if (isStandard && feDisp) {
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
        record.readyPromise = archetype.preloadPromise.then(() => {
            record.ready = true;
        });
        return record.readyPromise;
    }

    const blobUrl = record.blobUrl;
    if (typeof Image === "undefined" || !blobUrl) {
        record.ready = true;
        if (archetype) {
            archetype.decoded = true;
            archetype.preloadPromise = RESOLVED_VOID_PROMISE;
        }
        record.readyPromise = RESOLVED_VOID_PROMISE;
        return RESOLVED_VOID_PROMISE;
    }

    const img = freePreloadImages.pop() ?? new Image();
    img.decoding = "async";
    record.preloadImage = img;
    const preloadPromise = new Promise<void>((resolve) => {
        const finish = (reuseImage: boolean) => {
            if (record.finishPreload !== finish && (!archetype || archetype.finishPreload !== finish)) return;
            if (record.finishPreload === finish) record.finishPreload = undefined;
            if (archetype && archetype.finishPreload === finish) archetype.finishPreload = undefined;
            if (record.preloadTimerId !== null) clearTimeout(record.preloadTimerId);
            img.onload = null;
            img.onerror = null;
            img.removeAttribute("src");
            if (reuseImage && freePreloadImages.length < MAX_POOLED_PRELOAD_IMAGES) {
                freePreloadImages.push(img);
            }
            record.preloadTimerId = null;
            record.ready = true;
            if (archetype) archetype.decoded = true;
            record.preloadImage = null;
            resolve();
        };

        const settle = () => finish(true);
        record.finishPreload = finish;
        if (archetype) archetype.finishPreload = finish;
        record.preloadTimerId = setTimeout(settle, MAP_PRELOAD_TIMEOUT_MS);
        if (typeof img.decode === "function") {
            img.src = blobUrl;
            img.decode().then(settle, settle);
        } else {
            img.onload = settle;
            img.onerror = settle;
            img.src = blobUrl;
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
        svgDefs,
    } = options;

    const now = getNowMs();

    const existingRecord = sharedFilters.get(sharedKey);
    if (existingRecord !== undefined) {
        if (
            existingRecord.actualW !== actualW || existingRecord.actualH !== actualH
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
    const cornerStyle = config.cornerStyle === "squircle" ? "squircle" : "circular";
    const chromaAmount = resolveChromaticAberration(config.chromaticAberration, config.abbeNumber);
    const effectiveArchTier = tier === 1 && chromaAmount > 0 ? 3 : tier;
    let archetype: FilterArchetype | null = null;
    if (
        lastArchVal1 &&
        !lastArchVal1.evicted &&
        config === lastArchCfg1 &&
        w === lastArchW1 &&
        h === lastArchH1 &&
        radius === lastArchRad1 &&
        surface === lastArchSurf1 &&
        cornerStyle === lastArchCornerStyle1 &&
        rasterScale === lastArchScale1 &&
        effectiveArchTier === lastArchTier1
    ) {
        archetype = lastArchVal1;
    } else if (
        lastArchVal2 &&
        !lastArchVal2.evicted &&
        config === lastArchCfg2 &&
        w === lastArchW2 &&
        h === lastArchH2 &&
        radius === lastArchRad2 &&
        surface === lastArchSurf2 &&
        cornerStyle === lastArchCornerStyle2 &&
        rasterScale === lastArchScale2 &&
        effectiveArchTier === lastArchTier2
    ) {
        archetype = lastArchVal2;
    } else {
        const isAxisX = config.axis === "x";
        const bezelSpan = isAxisX ? w : Math.min(w, h);
        const clampedBezel = resolveRefractionBezel(bezelSpan, config.bezel, config.adaptiveRefraction === true);
        const glassThickness = config.thickness;
        const scaleRatio = config.scaleRatio;

        const archetypeKey = `${w}|${h}|${radius}|${clampedBezel}|${glassThickness}|${scaleRatio}|${config.maxScaleMultiplier}|${Math.fround(ior)}|${surface}|${cornerStyle}|${config.pill ? 1 : 0}|${isAxisX ? 1 : 0}|${config.refractionDirection}|${config.refractionEdgeFade}|${blurAmt}|${rasterScale}|${effectiveArchTier}`;
        archetype = filterArchetypeCache.get(archetypeKey) ?? null;
        if (archetype) {
            filterArchetypeCache.delete(archetypeKey);
            filterArchetypeCache.set(archetypeKey, archetype);
        }

        if (!archetype) {
            const baseScale = pickMapScale(w, h, clampedBezel, radius, blurAmt, isAxisX);
            const hidpiFitScale =
                !isAxisX && radius > 0 && tier === 0
                    ? Math.min(
                          rasterScale,
                          Math.sqrt(MAX_DISPLACEMENT_TEXELS / Math.max(1, w * h)),
                      )
                    : baseScale;
            const activeScale =
                radius <= 0
                    ? baseScale
                    : tier === 2 || (tier === 1 && chromaAmount > 0)
                      ? baseScale * 0.5 > MAP_MIN_SCALE
                          ? baseScale * 0.5
                          : MAP_MIN_SCALE
                      : Math.max(baseScale, hidpiFitScale);
            let targetW: number;
            let targetH: number;
            let effectiveScale: number;
            if (isAxisX) {
                targetH = 1;
                targetW = Math.min(MAX_DISPLACEMENT_TEXELS, Math.max(4, Math.round(w * activeScale)));
                effectiveScale = targetW / w;
            } else if (w >= h) {
                targetH = Math.max(2, Math.round(h * activeScale));
                effectiveScale = targetH / h;
                targetW = Math.max(4, Math.round(w * effectiveScale));
            } else {
                targetW = Math.max(4, Math.round(w * activeScale));
                effectiveScale = targetW / w;
                targetH = Math.max(2, Math.round(h * effectiveScale));
            }
            if (targetW * targetH > MAX_DISPLACEMENT_TEXELS) {
                const shrink = Math.sqrt(MAX_DISPLACEMENT_TEXELS / (targetW * targetH));
                targetW = Math.max(4, Math.floor(targetW * shrink));
                targetH = Math.max(2, Math.floor(targetH * shrink));
                targetW = Math.min(targetW, Math.floor(MAX_DISPLACEMENT_TEXELS / 2));
                targetH = Math.min(targetH, Math.floor(MAX_DISPLACEMENT_TEXELS / targetW));
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
                cornerStyle,
                config,
            );

            if (!wasmRes) {
                return null;
            }

            const { blobUrl, createdNew } = acquireCachedDisplacementBlobUrl(wasmRes.blob);
            if (createdNew) {
                activeBlobUrlCount++;
            }

            const scale = Math.max(0, Math.min(
                wasmRes.maxDisplacement * scaleRatio,
                config.maxScaleMultiplier * clampedBezel,
            ));

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
                refCount: 0,
                evicted: false,
            };

            if (filterArchetypeCache.size >= MAX_FILTER_ARCHETYPES) {
                let oldestKey: string | undefined;
                for (const [candidateKey, candidateArch] of filterArchetypeCache) {
                    if (candidateArch.refCount <= 0) {
                        oldestKey = candidateKey;
                        break;
                    }
                }
                if (oldestKey === undefined) {
                    oldestKey = filterArchetypeCache.keys().next().value;
                }
                if (oldestKey !== undefined) {
                    const evictedArch = filterArchetypeCache.get(oldestKey);
                    filterArchetypeCache.delete(oldestKey);
                    if (evictedArch) {
                        evictedArch.evicted = true;
                        if (evictedArch.refCount <= 0 && evictedArch.blobUrl) {
                            if (releaseCachedDisplacementBlobUrl(evictedArch.blobUrl)) {
                                if (activeBlobUrlCount > 0) activeBlobUrlCount--;
                            }
                            evictedArch.blobUrl = null;
                        }
                    }
                }
            }
            filterArchetypeCache.set(archetypeKey, archetype);
        }

        lastArchCfg2 = lastArchCfg1;
        lastArchW2 = lastArchW1;
        lastArchH2 = lastArchH1;
        lastArchRad2 = lastArchRad1;
        lastArchSurf2 = lastArchSurf1;
        lastArchCornerStyle2 = lastArchCornerStyle1;
        lastArchScale2 = lastArchScale1;
        lastArchTier2 = lastArchTier1;
        lastArchVal2 = lastArchVal1;

        lastArchCfg1 = config;
        lastArchW1 = w;
        lastArchH1 = h;
        lastArchRad1 = radius;
        lastArchSurf1 = surface;
        lastArchCornerStyle1 = cornerStyle;
        lastArchScale1 = rasterScale;
        lastArchTier1 = effectiveArchTier;
        lastArchVal1 = archetype;
    }

    if (!archetype) {
        return null;
    }

    archetype.refCount++;
    const combinedUrl = archetype.blobUrl ?? "";
    let scale = archetype.scale;
    const span = getRefractionSpan(actualW, actualH, config.axis === "x" ? "horizontal" : config.refractionDirection);
    const adaptiveTravel = config.adaptiveRefraction === true ? resolveRefractionTravel(span, archetype.clampedBezel) : Infinity;
    const travel = Math.min(adaptiveTravel, config.maxRefractionPx ?? Infinity);
    scale = Math.min(scale, 2 * travel / (1 + chromaAmount * SVG_BLUE_SHIFT));
    const scaleValue = (Math.floor(scale * 100) / 100).toFixed(2);
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
        scaleValue,
        config.colorMatrix,
        blurAmt,
        false,
        0,
        chromaAmount,
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
            scaleValue,
            config.colorMatrix,
            blurAmtT1,
            true,
            0,
            chromaAmount,
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

export function disposeSharedFilter(key: string, immediate = false): void {
    if (!key) return;
    const record = sharedFilters.get(key);
    if (!record) return;

    if (!record.archetype) {
        record.finishPreload?.(!immediate);
    } else if (record.archetype.refCount <= 1) {
        (record.archetype.finishPreload ?? record.finishPreload)?.(!immediate);
    }

    const node = record.node;
    if (node) {
        if (node.parentNode) {
            node.remove();
        }
        if (
            !immediate &&
            node._isStd &&
            !node._hasMatrix &&
            node._feImage &&
            node._feDisp &&
            freeStdFilterPool.length < MAX_POOLED_STD_FILTERS
        ) {
            freeStdFilterPool.push(node);
        }
    }
    if (record.nodeT1 && record.nodeT1.parentNode) {
        record.nodeT1.remove();
    }
    record.node = null;
    record.nodeT1 = null;
    record.feImage = null;
    record.feImageT1 = null;
    const archetype = record.archetype;
    record.archetype = null;
    if (archetype) {
        if (archetype.refCount > 0) archetype.refCount--;
        if (archetype.evicted && archetype.refCount <= 0 && archetype.blobUrl) {
            if (releaseCachedDisplacementBlobUrl(archetype.blobUrl)) {
                decrementActiveBlobUrlCount();
            }
            archetype.blobUrl = null;
        }
    }

    sharedFilters.delete(key);
    lruUnusedFilterKeys.delete(key);
}

export function resetActiveBlobUrlCount(): void {
    activeBlobUrlCount = 0;
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
        record.lastUsed = getNowMs();
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

setOnBlobUrlEvicted(decrementActiveBlobUrlCount);
