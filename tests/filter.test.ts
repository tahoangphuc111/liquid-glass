import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GLASS_CONFIG, MAP_PRELOAD_TIMEOUT_MS, SVG_NS, resolveGlassConfig } from "../src/core/config.js";
import {
    acquireSharedFilter,
    buildFilterElement,
    disposeSharedFilter,
    releaseSharedFilter,
    sharedFilters,
    startMapPreload,
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

});
