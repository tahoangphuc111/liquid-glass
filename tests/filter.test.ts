import { afterEach, describe, expect, it, vi } from "vitest";
import {
    DEFAULT_GLASS_CONFIG,
    MAP_PRELOAD_TIMEOUT_MS,
    SVG_NS,
    resolveChromaticChannelScales,
    resolveEffectiveChromaticAberration,
    resolveGlassConfig,
} from "../src/core/config.js";
import {
    acquireSharedFilter,
    buildFilterElement,
    clearFilterElementPools,
    disposeSharedFilter,
    releaseSharedFilter,
    sharedFilters,
    startMapPreload,
    tryUpdateFilterScalesInPlace,
} from "../src/core/filter.js";

describe("SVG displacement filter builder", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("keeps chromatic aberration disabled by default", () => {
        expect(DEFAULT_GLASS_CONFIG.chromaticAberration).toBe(false);
        expect(resolveGlassConfig().chromaticAberration).toBe(false);
        expect(resolveGlassConfig({ chromaticAberration: true }).chromaticAberration).toBe(true);
    });

    it("smooths displacement map via feGaussianBlur on T0 and skips on T1", () => {
        const { filterNode: smoothFilter } = buildFilterElement(
            "lg-test-t0",
            "0%",
            "0%",
            "100%",
            "100%",
            "blob:http://localhost/map",
            184,
            41,
            "48.33",
            undefined,
            0.6,
            false,
            0.67,
        );
        const blurNode = smoothFilter.querySelector("feGaussianBlur");
        const dispNode = smoothFilter.querySelector("feDisplacementMap");

        expect(blurNode?.getAttribute("in")).toBe("disp_map");
        expect(blurNode?.getAttribute("result")).toBe("disp_map_smooth");
        expect(blurNode?.getAttribute("stdDeviation")).toBe("0.67");
        expect(dispNode?.getAttribute("in2")).toBe("disp_map_smooth");

        const { filterNode: tier1Filter } = buildFilterElement(
            "lg-test-t1",
            "0%",
            "0%",
            "100%",
            "100%",
            "blob:http://localhost/map",
            184,
            41,
            "48.33",
            undefined,
            0.6,
            true,
            0.67,
        );
        expect(tier1Filter.querySelector("feGaussianBlur")).toBeNull();
        expect(tier1Filter.querySelector("feDisplacementMap")?.getAttribute("in2")).toBe("disp_map_t1");
    });

    it("builds a 2-pass prismatic chromatic aberration SVG graph reusing a single feImage", () => {
        const { filterNode: offFilter } = buildFilterElement(
            "lg-ca-off",
            "0%",
            "0%",
            "100%",
            "100%",
            "blob:http://localhost/map",
            200,
            60,
            "50.00",
            undefined,
            8,
            false,
            0,
            false,
        );
        expect(offFilter.querySelectorAll("feDisplacementMap")).toHaveLength(1);
        expect(offFilter.querySelectorAll("feColorMatrix")).toHaveLength(0);
        expect(offFilter.querySelectorAll("feComposite")).toHaveLength(0);

        const { filterNode: onFilter } = buildFilterElement(
            "lg-ca-on",
            "0%",
            "0%",
            "100%",
            "100%",
            "blob:http://localhost/map",
            200,
            60,
            "50.00",
            undefined,
            8,
            false,
            0,
            true,
        );
        expect(onFilter.querySelectorAll("feImage")).toHaveLength(1);
        const dispNodes = onFilter.querySelectorAll("feDisplacementMap");
        expect(dispNodes).toHaveLength(2);
        expect(dispNodes[0].getAttribute("in2")).toBe("disp_map");
        expect(dispNodes[1].getAttribute("in2")).toBe("disp_map");
        expect(Number(dispNodes[0].getAttribute("scale"))).toBeLessThan(50);
        expect(Number(dispNodes[1].getAttribute("scale"))).toBeGreaterThan(50);

        const matrices = onFilter.querySelectorAll("feColorMatrix");
        expect(matrices).toHaveLength(2);
        const composite = onFilter.querySelector("feComposite");
        expect(composite?.getAttribute("operator")).toBe("arithmetic");
        expect(composite?.getAttribute("result")).toBe("displaced");

        const { filterNode: tinyScaleFilter } = buildFilterElement(
            "lg-ca-tiny",
            "0%",
            "0%",
            "100%",
            "100%",
            "blob:http://localhost/map",
            200,
            60,
            "0.50",
            undefined,
            8,
            false,
            0,
            true,
        );
        expect(tinyScaleFilter.querySelectorAll("feDisplacementMap")).toHaveLength(1);
    });

    it("downscales WASM displacement map in lightweight tier and shares BMP/Blob at T0", () => {
        let blobCounter = 0;
        Object.defineProperty(URL, "createObjectURL", {
            value: vi.fn(() => `blob:lg-ca-${++blobCounter}`),
            configurable: true,
            writable: true,
        });
        Object.defineProperty(URL, "revokeObjectURL", {
            value: vi.fn(),
            configurable: true,
            writable: true,
        });

        const svgDefs = document.createElementNS(SVG_NS, "defs") as unknown as SVGDefsElement;
        const offConfig = resolveGlassConfig({ chromaticAberration: false });
        const t0Config = resolveGlassConfig({ chromaticAberration: true });
        const offRecord = acquireSharedFilter(
            {
                sharedKey: "ca_t0_off_test",
                config: offConfig,
                w: 224,
                h: 64,
                radius: 20,
                surface: "convex_squircle",
                rasterScale: 2,
                halfMinDim: 32,
                svgDefs,
            },
            0,
        );
        const t0Record = acquireSharedFilter(
            {
                sharedKey: "ca_t0_test",
                config: t0Config,
                w: 224,
                h: 64,
                radius: 20,
                surface: "convex_squircle",
                rasterScale: 2,
                halfMinDim: 32,
                svgDefs,
            },
            0,
        );
        const t1Record = acquireSharedFilter(
            {
                sharedKey: "ca_t1_test",
                config: t0Config,
                w: 224,
                h: 64,
                radius: 20,
                surface: "convex_squircle",
                rasterScale: 2,
                halfMinDim: 32,
                svgDefs,
            },
            1,
        );

        expect(offRecord?.blobUrl).toBeTruthy();
        expect(t0Record?.blobUrl).toBe(offRecord?.blobUrl);
        expect(t0Record?.archetype?.effectiveScale).toBe(2);
        expect(t1Record?.archetype?.effectiveScale).toBeLessThan(1);
        expect(t1Record?.node?.querySelectorAll("feDisplacementMap")).toHaveLength(2);

        releaseSharedFilter("ca_t0_off_test", offRecord ?? undefined);
        releaseSharedFilter("ca_t0_test", t0Record ?? undefined);
        releaseSharedFilter("ca_t1_test", t1Record ?? undefined);
    });

    it("bounds the strongest chromatic pass and reuses the bitmap across scale settings", () => {
        const svgDefs = document.createElementNS(SVG_NS, "defs") as SVGDefsElement;
        const baseOptions = { bezel: 10, scaleRatio: 100, chromaticAberration: 1 };
        const acquire = (sharedKey: string, maxScaleMultiplier: number, maxRefractionPx?: number) =>
            acquireSharedFilter({
                sharedKey,
                config: resolveGlassConfig({ ...baseOptions, maxScaleMultiplier, maxRefractionPx }),
                w: 200,
                h: 48,
                radius: 18,
                surface: "convex_squircle",
                rasterScale: 1.5,
                halfMinDim: 24,
                svgDefs,
            }, 0)!;
        const records = [acquire("chroma_bezel_cap", 1), acquire("chroma_pixel_cap", 2, 3)];
        try {
            expect(records[0]!.archetype).toBe(records[1]!.archetype);
            for (const [index, cap] of [10, 6].entries()) {
                const passes = records[index]!.node!.querySelectorAll("feDisplacementMap");
                expect(passes).toHaveLength(2);
                const strongestScale = Math.max(...Array.from(passes, (pass) => Number(pass.getAttribute("scale"))));
                expect(strongestScale).toBeLessThanOrEqual(cap);
                expect(strongestScale).toBeGreaterThan(cap - 0.03);
            }
        } finally {
            for (const record of records) disposeSharedFilter(record.key, false);
        }
    });

    it("uses crisp 2x HiDPI displacement maps without blurring T0 rounded SVG surfaces", () => {
        Object.defineProperty(URL, "createObjectURL", {
            value: vi.fn(() => "blob:lg-small-round"),
            configurable: true,
            writable: true,
        });
        Object.defineProperty(URL, "revokeObjectURL", {
            value: vi.fn(),
            configurable: true,
            writable: true,
        });

        const svgDefs = document.createElementNS(SVG_NS, "defs") as unknown as SVGDefsElement;
        const smallCircleConfig = resolveGlassConfig({ pill: true, radius: 28, blur: 2 });
        const record = acquireSharedFilter(
            {
                sharedKey: "small_circle_2x_crisp",
                config: smallCircleConfig,
                w: 56,
                h: 56,
                radius: 28,
                surface: "convex_squircle",
                rasterScale: 2,
                halfMinDim: 28,
                svgDefs,
            },
            0,
        );

        expect(record?.archetype?.effectiveScale).toBe(2);
        expect(record?.archetype?.targetW).toBe(112);
        expect(record?.archetype?.targetH).toBe(112);
        expect(record?.node?.querySelector("feGaussianBlur")).toBeNull();
        expect(record?.node?.querySelector("feDisplacementMap")?.getAttribute("in2")).toBe("disp_map");

        releaseSharedFilter("small_circle_2x_crisp", record ?? undefined);

        const panelConfig = resolveGlassConfig({ radius: 22, blur: 2 });
        const panelRecord = acquireSharedFilter(
            {
                sharedKey: "large_panel_within_wasm_cap",
                config: panelConfig,
                w: 340,
                h: 115,
                radius: 22,
                surface: "convex_squircle",
                rasterScale: 2,
                halfMinDim: 57.5,
                svgDefs,
            },
            0,
        );
        expect(panelRecord?.archetype).not.toBeNull();
        expect(panelRecord!.archetype!.targetW * panelRecord!.archetype!.targetH).toBeLessThanOrEqual(
            136_000,
        );
        expect(panelRecord!.archetype!.effectiveScale).toBeGreaterThan(1.5);
        expect(panelRecord!.archetype!.blob.size).toBeGreaterThan(64);
        releaseSharedFilter("large_panel_within_wasm_cap", panelRecord ?? undefined);
    });

    it("recycles standard SVG filter DOM subtrees across filter evictions", () => {
        Object.defineProperty(URL, "createObjectURL", {
            value: vi.fn(() => "blob:lg-recycle"),
            configurable: true,
            writable: true,
        });
        Object.defineProperty(URL, "revokeObjectURL", {
            value: vi.fn(),
            configurable: true,
            writable: true,
        });

        const svgDefs = document.createElementNS(SVG_NS, "defs") as unknown as SVGDefsElement;
        const cfg = resolveGlassConfig({ radius: 18, blur: 0 });
        const rec1 = acquireSharedFilter(
            {
                sharedKey: "pool_recycle_1",
                config: cfg,
                w: 120,
                h: 48,
                radius: 18,
                surface: "convex_squircle",
                rasterScale: 1,
                halfMinDim: 24,
                svgDefs,
            },
            0,
        );
        const firstFilterNode = rec1?.node;
        expect(firstFilterNode).not.toBeNull();
        releaseSharedFilter("pool_recycle_1", rec1 ?? undefined);
        disposeSharedFilter("pool_recycle_1", false);

        const rec2 = acquireSharedFilter(
            {
                sharedKey: "pool_recycle_2",
                config: cfg,
                w: 140,
                h: 52,
                radius: 18,
                surface: "convex_squircle",
                rasterScale: 1,
                halfMinDim: 26,
                svgDefs,
            },
            0,
        );
        expect(rec2?.node).toBe(firstFilterNode);
        expect(rec2?.feImage?.getAttribute("width")).toBe("140");
        expect(rec2?.feImage?.getAttribute("height")).toBe("52");
        releaseSharedFilter("pool_recycle_2", rec2 ?? undefined);
    });

    it("applies asymmetric Cauchy Red/Blue ordering, 0.5 alpha conservation, abbeNumber activation, and preloadImage cleanup", () => {
        const { filterNode } = buildFilterElement(
            "lg-cauchy-test",
            "-10%",
            "-10%",
            "120%",
            "120%",
            "blob:mock",
            100,
            60,
            "50",
            undefined,
            0,
            false,
            0,
            undefined,
            24,
        );

        const dispNodes = filterNode.querySelectorAll("feDisplacementMap");
        expect(dispNodes.length).toBe(2);
        const warmScale = Number.parseFloat(dispNodes[0]!.getAttribute("scale")!);
        const coolScale = Number.parseFloat(dispNodes[1]!.getAttribute("scale")!);
        expect(warmScale).toBeLessThan(50);
        expect(coolScale).toBeGreaterThan(50);
        expect(50 - warmScale).toBeLessThan(coolScale - 50);

        const matrices = filterNode.querySelectorAll("feColorMatrix");
        expect(matrices.length).toBe(2);
        expect(matrices[0]!.getAttribute("values")).toBe("1 0 0 0 0  0 0.5 0 0 0  0 0 0 0 0  0 0 0 1 0");
        expect(matrices[1]!.getAttribute("values")).toBe("0 0 0 0 0  0 0.5 0 0 0  0 0 1 0 0  0 0 0 1 0");

        sharedFilters.set("mock-preload-key", {
            key: "mock-preload-key",
            filterId: "lg-999",
            filterIdT1: "lg-999",
            node: null,
            nodeT1: null,
            feImage: null,
            feImageT1: null,
            refCount: 0,
            blobUrl: "blob:mock-preload",
            lastUsed: 0,
            ready: false,
            readyPromise: null,
            preloadImage: null,
            preloadTimerId: null,
            actualW: 100,
            actualH: 50,
            lastFeW: 100,
            lastFeH: 50,
            archetype: null,
        });
        const record = sharedFilters.get("mock-preload-key")!;
        void startMapPreload(record);
        const image = record.preloadImage!;
        disposeSharedFilter("mock-preload-key", true);
        expect(record.preloadImage).toBeNull();
        expect(image.onload).toBeNull();
        expect(image.onerror).toBeNull();
    });

    it("caps travel for every SVG color channel at compact horizontal and vertical sizes", () => {
        const svgDefs = document.createElementNS(SVG_NS, "defs");
        const config = resolveGlassConfig({
            bezel: 40, thickness: 160, scaleRatio: 40, maxScaleMultiplier: 40,
            blur: 0, chromaticAberration: 1,
        });
        function getMap(w: number, h: number, adaptiveRefraction: boolean, refractionDirection: "all" | "horizontal" | "vertical" = "all") {
            const key = `adaptive-${w}x${h}-${adaptiveRefraction}-${refractionDirection}`;
            const record = acquireSharedFilter({
                sharedKey: key, config: { ...config, adaptiveRefraction, refractionDirection }, w, h,
                radius: 10, surface: "convex_squircle", rasterScale: 2,
                halfMinDim: Math.min(w, h) / 2, svgDefs,
            })!;
            const scales = Array.from(record.node!.querySelectorAll("feDisplacementMap"),
                (node) => Number(node.getAttribute("scale")));
            const result = { bezel: record.archetype!.clampedBezel, travel: Math.max(...scales) / 2 };
            disposeSharedFilter(key, true);
            return result;
        }

        for (const [width, height] of [[120, 24], [24, 120]]) {
            const adaptive = getMap(width, height, true);
            expect(adaptive.bezel).toBe(8);
            expect(adaptive.travel).toBeGreaterThan(0);
            expect(adaptive.travel).toBeLessThanOrEqual(12 - adaptive.bezel - 0.5);
            expect(getMap(width, height, false).travel).toBeGreaterThan(adaptive.travel);
            const directional = getMap(width, height, true, width > height ? "horizontal" : "vertical");
            expect(directional.bezel).toBe(8);
            expect(directional.travel).toBeGreaterThan(adaptive.travel);
            expect(directional.travel).toBeLessThanOrEqual(60 - directional.bezel - 0.5);
        }
        expect(getMap(120, 96, true).travel).toBeGreaterThan(getMap(120, 24, true).travel);
    });

    it("finishes the shared map decode when its first SVG node is disposed", async () => {
        vi.useFakeTimers();
        const svgDefs = document.createElementNS(SVG_NS, "defs");
        const options = {
            config: resolveGlassConfig({ bezel: 11.25, ior: 1.643, blur: 0 }),
            w: 124, h: 36, radius: 15, surface: "convex_circle" as const,
            rasterScale: 2, halfMinDim: 18, svgDefs,
        };
        const first = acquireSharedFilter({ ...options, sharedKey: "decode-first" })!;
        const second = acquireSharedFilter({ ...options, sharedKey: "decode-second" })!;
        expect(first.archetype).toBe(second.archetype);
        expect(second.ready).toBe(false);
        disposeSharedFilter(first.key, true);
        await vi.advanceTimersByTimeAsync(MAP_PRELOAD_TIMEOUT_MS);
        expect(first.preloadImage).toBeNull();
        expect(second.ready).toBe(true);
        disposeSharedFilter(second.key, true);
    });

    it("cancels shared preload timer when all records referencing the archetype dispose and shares archetypes across colorMatrix", () => {
        vi.useFakeTimers();
        const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
        const svgDefs = document.createElementNS(SVG_NS, "defs");
        const cfgA = resolveGlassConfig({ bezel: 11.5, ior: 1.61, blur: 0, saturation: 120 });
        const cfgB = resolveGlassConfig({ bezel: 11.5, ior: 1.61, blur: 0, saturation: 185 });
        const first = acquireSharedFilter({
            sharedKey: "shared-preload-a",
            config: cfgA,
            w: 120,
            h: 40,
            radius: 14,
            surface: "convex_squircle",
            rasterScale: 2,
            halfMinDim: 20,
            svgDefs,
        })!;
        const second = acquireSharedFilter({
            sharedKey: "shared-preload-b",
            config: cfgB,
            w: 120,
            h: 40,
            radius: 14,
            surface: "convex_squircle",
            rasterScale: 2,
            halfMinDim: 20,
            svgDefs,
        })!;
        expect(first.archetype).toBe(second.archetype);
        expect(first.preloadTimerId).not.toBeNull();
        const timerId = first.preloadTimerId;

        clearTimeoutSpy.mockClear();
        disposeSharedFilter(first.key, true);
        expect(clearTimeoutSpy).not.toHaveBeenCalledWith(timerId);

        disposeSharedFilter(second.key, true);
        expect(clearTimeoutSpy).toHaveBeenCalledWith(timerId);
        expect(first.preloadTimerId).toBeNull();
        expect(first.preloadImage).toBeNull();
    });

    it("resolves sharedKey dimension collisions iteratively without mutating caller options", () => {
        const svgDefs = document.createElementNS(SVG_NS, "defs");
        const cfg = resolveGlassConfig({ radius: 16, blur: 0 });
        const baseOptions = {
            sharedKey: "collision_key",
            config: cfg,
            w: 120,
            h: 48,
            actualW: 120,
            actualH: 48,
            radius: 16,
            surface: "convex_squircle" as const,
            rasterScale: 1,
            halfMinDim: 24,
            svgDefs,
        };
        const recA = acquireSharedFilter(baseOptions)!;
        const recB = acquireSharedFilter({ ...baseOptions, actualW: 124, actualH: 50 })!;
        const recBReuse = acquireSharedFilter({ ...baseOptions, actualW: 124, actualH: 50 })!;

        expect(recA.key).toBe("collision_key");
        expect(recB.key).toBe("collision_key_124x50");
        expect(recBReuse).toBe(recB);
        expect(recB.refCount).toBe(2);

        disposeSharedFilter(recA.key, true);
        disposeSharedFilter(recB.key, true);
    });

    it("matches unified IOR/Abbe dispersion scaling and preserves travel caps at high IOR", () => {
        const { filterNode: lowIorFilter } = buildFilterElement(
            "lg-ca-low-ior",
            "0%",
            "0%",
            "100%",
            "100%",
            "blob:mock",
            160,
            64,
            "40.00",
            undefined,
            0,
            false,
            0,
            true,
            28,
            1.333,
        );
        const { filterNode: highIorFilter } = buildFilterElement(
            "lg-ca-high-ior",
            "0%",
            "0%",
            "100%",
            "100%",
            "blob:mock",
            160,
            64,
            "40.00",
            undefined,
            0,
            false,
            0,
            true,
            28,
            2.417,
        );

        const lowPasses = Array.from(lowIorFilter.querySelectorAll("feDisplacementMap"), (node) =>
            Number(node.getAttribute("scale")),
        );
        const highPasses = Array.from(highIorFilter.querySelectorAll("feDisplacementMap"), (node) =>
            Number(node.getAttribute("scale")),
        );
        const expectedLow = resolveChromaticChannelScales(40, resolveEffectiveChromaticAberration(true, 28, 1.333));
        const expectedHigh = resolveChromaticChannelScales(40, resolveEffectiveChromaticAberration(true, 28, 2.417));

        expect(lowPasses[0]).toBeCloseTo(expectedLow.redScale, 2);
        expect(lowPasses[1]).toBeCloseTo(expectedLow.blueScale, 2);
        expect(highPasses[0]).toBeCloseTo(expectedHigh.redScale, 2);
        expect(highPasses[1]).toBeCloseTo(expectedHigh.blueScale, 2);
        expect(highPasses[1]! - highPasses[0]!).toBeGreaterThan(lowPasses[1]! - lowPasses[0]!);

        // High-IOR effectiveChroma > 1 must not be re-clamped and must remain within travel caps.
        const svgDefs = document.createElementNS(SVG_NS, "defs");
        const diamondCapRecord = acquireSharedFilter({
            sharedKey: "diamond_high_chroma_cap",
            config: resolveGlassConfig({
                ior: 2.417,
                bezel: 10,
                scaleRatio: 100,
                maxRefractionPx: 5,
                chromaticAberration: 1,
                abbeNumber: 55.3,
            }),
            w: 180,
            h: 54,
            radius: 18,
            surface: "convex_squircle",
            rasterScale: 1.5,
            halfMinDim: 27,
            svgDefs,
        })!;
        try {
            const scales = Array.from(diamondCapRecord.node!.querySelectorAll("feDisplacementMap"), (node) =>
                Number(node.getAttribute("scale")),
            );
            expect(scales).toHaveLength(2);
            expect(Math.max(...scales)).toBeLessThanOrEqual(10);
            expect(Math.max(...scales)).toBeGreaterThan(9.9);
        } finally {
            disposeSharedFilter(diamondCapRecord.key, true);
        }
    });

    it("preserves full HiDPI WASM displacement map resolution at T1 when blur is 0 or sharpness is active", () => {
        const svgDefs = document.createElementNS(SVG_NS, "defs");
        const blurredT1 = acquireSharedFilter(
            {
                sharedKey: "sharp_blurred_t1",
                config: resolveGlassConfig({ blur: 4, chromaticAberration: true }),
                w: 160,
                h: 64,
                radius: 20,
                surface: "convex_squircle",
                rasterScale: 2,
                halfMinDim: 32,
                svgDefs,
            },
            1,
        )!;
        expect(blurredT1.archetype?.effectiveScale).toBeLessThan(1);

        const clearAutoT1 = acquireSharedFilter(
            {
                sharedKey: "sharp_clear_auto_t1",
                config: resolveGlassConfig({ blur: 0, chromaticAberration: true }),
                w: 160,
                h: 64,
                radius: 20,
                surface: "convex_squircle",
                rasterScale: 3.3,
                halfMinDim: 32,
                svgDefs,
            },
            1,
        )!;
        expect(clearAutoT1.archetype?.effectiveScale).toBeGreaterThan(2.5);

        const explicitMaxT1 = acquireSharedFilter(
            {
                sharedKey: "sharp_explicit_max_t1",
                config: resolveGlassConfig({ blur: 4, sharpness: 1, chromaticAberration: true }),
                w: 160,
                h: 64,
                radius: 20,
                surface: "convex_squircle",
                rasterScale: 4,
                halfMinDim: 32,
                svgDefs,
            },
            1,
        )!;
        expect(explicitMaxT1.archetype?.effectiveScale).toBeGreaterThan(3.5);

        disposeSharedFilter(blurredT1.key, true);
        disposeSharedFilter(clearAutoT1.key, true);
        disposeSharedFilter(explicitMaxT1.key, true);
    });

    it("pools chromatic SVG filter subtrees, updates exclusive scales in place, and collapses chromatic splitting at T2", () => {
        Object.defineProperty(URL, "createObjectURL", {
            value: vi.fn(() => "blob:lg-chroma-opt"),
            configurable: true,
            writable: true,
        });
        Object.defineProperty(URL, "revokeObjectURL", {
            value: vi.fn(),
            configurable: true,
            writable: true,
        });

        clearFilterElementPools();
        const svgRoot = document.createElementNS(SVG_NS, "svg");
        const svgDefs = document.createElementNS(SVG_NS, "defs") as unknown as SVGDefsElement;
        svgRoot.appendChild(svgDefs);
        document.body.appendChild(svgRoot);

        try {
            const baseKey = "chroma_opt_base";
            const lowChromaCfg = resolveGlassConfig({ radius: 18, blur: 2, chromaticAberration: 0.15 });
            const highChromaCfg = resolveGlassConfig({ radius: 18, blur: 2, chromaticAberration: 0.75 });

            const firstRec = acquireSharedFilter(
                {
                    sharedKey: "chroma_pool_1",
                    baseKey,
                    config: lowChromaCfg,
                    w: 180,
                    h: 64,
                    radius: 18,
                    surface: "convex_squircle",
                    rasterScale: 2,
                    halfMinDim: 32,
                    svgDefs,
                },
                0,
            )!;
            const pooledNode = firstRec.node!;
            expect(pooledNode.querySelectorAll("feDisplacementMap")).toHaveLength(2);
            const initialCoolScale = Number(
                pooledNode.querySelectorAll("feDisplacementMap")[1]!.getAttribute("scale"),
            );

            firstRec.ready = true;
            const updatedRec = tryUpdateFilterScalesInPlace(
                "chroma_pool_1",
                "chroma_pool_1_high",
                baseKey,
                highChromaCfg,
                180,
                64,
                0,
            );
            expect(updatedRec).toBe(firstRec);
            expect(updatedRec?.node).toBe(pooledNode);
            expect(updatedRec?.filterId).toBe(firstRec.filterId);
            expect(sharedFilters.has("chroma_pool_1")).toBe(false);
            expect(sharedFilters.get("chroma_pool_1_high")).toBe(firstRec);
            const updatedCoolScale = Number(
                pooledNode.querySelectorAll("feDisplacementMap")[1]!.getAttribute("scale"),
            );
            expect(updatedCoolScale).toBeGreaterThan(initialCoolScale);

            firstRec.refCount = 2;
            expect(
                tryUpdateFilterScalesInPlace(
                    "chroma_pool_1_high",
                    "chroma_pool_1_shared_blocked",
                    baseKey,
                    lowChromaCfg,
                    180,
                    64,
                    0,
                ),
            ).toBeNull();
            firstRec.refCount = 1;

            releaseSharedFilter("chroma_pool_1_high", firstRec);
            disposeSharedFilter("chroma_pool_1_high", false);

            const recycledRec = acquireSharedFilter(
                {
                    sharedKey: "chroma_pool_2",
                    baseKey,
                    config: highChromaCfg,
                    w: 200,
                    h: 72,
                    radius: 18,
                    surface: "convex_squircle",
                    rasterScale: 2,
                    halfMinDim: 36,
                    svgDefs,
                },
                0,
            )!;
            expect(recycledRec.node).toBe(pooledNode);
            expect(recycledRec.feImage?.getAttribute("width")).toBe("200");
            expect(recycledRec.feImage?.getAttribute("height")).toBe("72");
            disposeSharedFilter(recycledRec.key, true);

            const t2Rec = acquireSharedFilter(
                {
                    sharedKey: "chroma_t2_single_pass",
                    baseKey: "chroma_t2_base",
                    config: highChromaCfg,
                    w: 200,
                    h: 72,
                    radius: 18,
                    surface: "convex_squircle",
                    rasterScale: 2,
                    halfMinDim: 36,
                    svgDefs,
                },
                2,
            )!;
            expect(t2Rec.node?.querySelectorAll("feDisplacementMap")).toHaveLength(1);
            expect(t2Rec.node?.querySelectorAll("feColorMatrix")).toHaveLength(0);
            expect(t2Rec.node?.querySelector("feComposite")).toBeNull();
            disposeSharedFilter(t2Rec.key, true);
        } finally {
            svgRoot.remove();
            clearFilterElementPools();
        }
    });
});
