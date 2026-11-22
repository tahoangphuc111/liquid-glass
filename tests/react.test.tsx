import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, useRef, useState } from "react";
import {
    LiquidGlass,
    LiquidGlassProvider,
    LiquidGlassSlider,
    LiquidGlassSwitch,
    useGlassSlider,
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

        rerender(<ConditionalGlass show={false} />);
        expect(screen.queryByTestId("surface")).toBeNull();
    });

    it("preserves LiquidGlassProvider defaults when component props are omitted", () => {
        setForcedChromium(false);
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

        render(
            <LiquidGlassProvider
                captureScene="never"
                defaults={{ engine: "css", blur: 6, tintColor: "rgb(10, 20, 30)" }}
            >
                <LiquidGlass data-testid="inherited-glass">Inherited</LiquidGlass>
            </LiquidGlassProvider>,
        );

        const el = screen.getByTestId("inherited-glass");
        expect(el.getAttribute("data-lg-engine")).toBe("css");
        expect(el.style.getPropertyValue("--lg-filter")).toBe("blur(21.0px) saturate(180%)");
        expect(el.style.getPropertyValue("--lg-tint")).toBe("rgb(10, 20, 30)");
    });

    it("clears removed props, forwards cornerStyle across conditional remounts, and supports LiquidGlassSlider + useGlassSlider with safe unmount", () => {
        setForcedChromium(true);

        const cardView = render(
            <LiquidGlassProvider defaults={{ engine: "css", blur: 3 }}>
                <LiquidGlass data-testid="react-card" blur={9} tintColor="rgb(200, 10, 20)" highlight={0.75} cornerStyle="squircle">
                    Hello
                </LiquidGlass>
            </LiquidGlassProvider>,
        );
        const card = screen.getByTestId("react-card");
        expect(card.getAttribute("data-lg-corner-style")).toBe("squircle");
        expect(card.style.getPropertyValue("--lg-tint")).toBe("rgb(200, 10, 20)");
        expect(card.style.getPropertyValue("--lg-rim-opacity")).toBe("0.75");

        cardView.rerender(
            <LiquidGlassProvider defaults={{ engine: "css", blur: 3 }}>
                <LiquidGlass data-testid="react-card">Hello</LiquidGlass>
            </LiquidGlassProvider>,
        );
        expect(card.style.getPropertyValue("--lg-tint")).toBe("");
        expect(card.style.getPropertyValue("--lg-rim-opacity")).toBe("");
        expect(card.style.getPropertyValue("--lg-filter")).toContain("10.5px");
        cardView.unmount();

        const values: number[] = [];
        function Harness({ showSlider }: { showSlider: boolean }) {
            const [mounted, setMounted] = useState(true);
            const targetRef = useRef<HTMLDivElement | null>(null);
            const inputRef = useRef<HTMLInputElement | null>(null);
            useLiquidGlass(targetRef, { cornerStyle: "squircle" });
            const { value, setValue, setLightTilt } = useGlassSlider(inputRef, {
                engine: "css",
                orientation: "vertical",
                onChange: (nextVal) => values.push(nextVal),
            });
            return (
                <div>
                    <button type="button" onClick={() => setMounted((p) => !p)}>toggle</button>
                    <button type="button" onClick={() => { setValue(70, false); setLightTilt(0.4, -0.2); }}>jump</button>
                    <div>{mounted ? <div ref={targetRef} data-testid="cond-target">glass</div> : null}</div>
                    <div>
                        <input ref={inputRef} data-testid="hook-slider" type="range" min={0} max={100} defaultValue={25} />
                    </div>
                    <span data-testid="hook-val">{value}</span>
                    {showSlider ? <LiquidGlassSlider engine="css" preset="frosted" min={0} max={100} defaultValue={40} /> : null}
                    <span>sibling</span>
                </div>
            );
        }

        const view = render(<Harness showSlider={true} />);
        expect(screen.getByTestId("cond-target").getAttribute("data-lg-corner-style")).toBe("squircle");
        act(() => screen.getByRole("button", { name: "toggle" }).click());
        expect(screen.queryByTestId("cond-target")).toBeNull();
        act(() => screen.getByRole("button", { name: "toggle" }).click());
        expect(screen.getByTestId("cond-target").getAttribute("data-lg-corner-style")).toBe("squircle");

        expect(screen.getByTestId("hook-slider").closest(".lg-slider")?.getAttribute("data-lg-slider-orientation")).toBe("vertical");
        act(() => screen.getByRole("button", { name: "jump" }).click());
        expect(screen.getByTestId("hook-val").textContent).toBe("70");
        expect(values).toContain(70);

        expect(() => view.rerender(<Harness showSlider={false} />)).not.toThrow();
    });
});
