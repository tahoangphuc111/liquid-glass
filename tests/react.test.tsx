import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import {
    LiquidGlass,
    LiquidGlassProvider,
    LiquidGlassSwitch,
    useLiquidGlass,
} from "../src/react/index.js";
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

    it("renders LiquidGlassSwitch with items and triggers onChange on selection", () => {
        const handleChange = vi.fn();
        const ref = createRef<HTMLElement>();

        render(
            <LiquidGlassSwitch
                ref={ref}
                engine="css"
                defaultValue="home"
                onChange={handleChange}
                items={[
                    { value: "home", label: "Home" },
                    { value: "search", label: "Search" },
                    { value: "profile", label: "Profile" },
                ]}
            />,
        );

        const nav = ref.current;
        expect(nav).not.toBeNull();
        expect(nav?.classList.contains("lg-switch")).toBe(true);
        expect(nav?.querySelector(".lg-switch-glider")).not.toBeNull();

        const searchTab = screen.getByRole("tab", { name: "Search" });
        fireEvent.click(searchTab);
        expect(handleChange).toHaveBeenCalledTimes(1);
        expect(handleChange.mock.calls[0]?.[0]).toBe("search");
        expect(handleChange.mock.calls[0]?.[1]).toBe(1);
    });

    it("destroys controller instance cleanly when target element conditionally unmounts", () => {
        function ConditionalGlass({ show }: { show: boolean }) {
            const elRef = createRef<HTMLDivElement>();
            useLiquidGlass(elRef, { engine: "css" });

            return show ? <div ref={elRef} data-testid="surface">Surface</div> : null;
        }

        const { rerender } = render(<ConditionalGlass show={true} />);
        const surface = screen.getByTestId("surface");
        expect(surface.getAttribute("data-lg-surface")).toBe("");

        // Unmount element conditionally while component remains mounted
        rerender(<ConditionalGlass show={false} />);
        expect(screen.queryByTestId("surface")).toBeNull();
    });
});
