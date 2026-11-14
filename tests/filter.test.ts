import { describe, expect, it } from "vitest";
import { buildFilterElement } from "../src/core/filter.js";

describe("SVG displacement filter builder", () => {
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
});
