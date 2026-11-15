import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GLASS_CONFIG, SVG_NS, resolveGlassConfig } from "../src/core/config.js";
import {
    acquireSharedFilter,
    buildFilterElement,
    releaseSharedFilter,
} from "../src/core/filter.js";

describe("SVG displacement filter builder", () => {
    afterEach(() => {
        vi.restoreAllMocks();
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
        expect(t0Record?.archetype?.effectiveScale).toBe(1);
        expect(t1Record?.archetype?.effectiveScale).toBeLessThan(1);
        expect(t1Record?.node?.querySelectorAll("feDisplacementMap")).toHaveLength(2);

        releaseSharedFilter("ca_t0_off_test", offRecord ?? undefined);
        releaseSharedFilter("ca_t0_test", t0Record ?? undefined);
        releaseSharedFilter("ca_t1_test", t1Record ?? undefined);
    });
});
