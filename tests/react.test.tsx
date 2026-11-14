import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { LiquidGlass, LiquidGlassProvider } from "../src/react/index.js";
import { destroyLiquidGlass } from "../src/index.js";

function setForcedChromium(value: boolean | undefined): void {
    const win = window as unknown as { __LG_FORCE_CHROMIUM__?: boolean };
    if (value === undefined) {
        delete win.__LG_FORCE_CHROMIUM__;
    } else {
        win.__LG_FORCE_CHROMIUM__ = value;
    }
}

describe("React bindings", () => {
    afterEach(() => {
        cleanup();
        destroyLiquidGlass();
        setForcedChromium(undefined);
        vi.restoreAllMocks();
    });

    it("renders polymorphic LiquidGlass inside LiquidGlassProvider", () => {
        setForcedChromium(false);
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
        const ref = createRef<HTMLElement>();

        render(
            <LiquidGlassProvider className="scene" defaults={{ blur: 2 }}>
                <div>Background</div>
                <LiquidGlass ref={ref} as="section" pill className="floating-box" aria-label="Glass surface">
                    Content
                </LiquidGlass>
            </LiquidGlassProvider>,
        );

        const el = screen.getByRole("region", { name: "Glass surface" });
        expect(el.tagName).toBe("SECTION");
        expect(el.classList.contains("lg-surface")).toBe(true);
        expect(el.classList.contains("floating-box")).toBe(true);
        expect(el.hasAttribute("data-lg-surface")).toBe(true);
        expect(el.getAttribute("data-lg-pill")).toBe("true");
        expect(ref.current).toBe(el);
    });

    it("activates wasm-svg on desktop Chromium", () => {
        setForcedChromium(true);

        render(
            <LiquidGlass radius={20} data-testid="glass">
                Inside
            </LiquidGlass>,
        );

        expect(screen.getByTestId("glass").getAttribute("data-lg-engine")).toBe("wasm-svg");
    });
});
