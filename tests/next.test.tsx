import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import {
    LiquidGlass,
    LiquidGlassProvider,
    LiquidGlassSlider,
    LiquidGlassSwitch,
    resolveSwitchValueForPathname,
} from "../src/next/index.js";
import { destroyLiquidGlass } from "../src/index.js";

describe("Next.js bindings (@tahoangphuc111/liquid-glass/next)", () => {
    afterEach(() => {
        cleanup();
        destroyLiquidGlass();
        vi.restoreAllMocks();
    });

    it("resolves active tab values cleanly from Next.js pathnames", () => {
        const items = [
            { value: "home", href: "/", label: "Home", exact: true },
            { value: "search", href: "/search", label: "Search" },
            { value: "library", href: "/library", label: "Library" },
            { value: "playlists", href: "/library/playlists", label: "Playlists" },
        ];

        expect(resolveSwitchValueForPathname(items, "/")).toBe("home");
        expect(resolveSwitchValueForPathname(items, "/search?q=glass")).toBe("search");
        expect(resolveSwitchValueForPathname(items, "/library/albums/1")).toBe("library");
        expect(resolveSwitchValueForPathname(items, "/library/playlists/top")).toBe(
            "playlists",
        );
        expect(resolveSwitchValueForPathname(items, "/unknown")).toBeUndefined();

        expect(resolveSwitchValueForPathname(items, "https://example.com/search/?ref=header#top")).toBe("search");
        expect(resolveSwitchValueForPathname(items, "http://localhost:3000/library/playlists/")).toBe("playlists");
    });

    it("renders SSR HTML cleanly without browser globals mismatch", () => {
        const html = renderToString(
            <LiquidGlassProvider captureScene="never">
                <LiquidGlass pill>SSR Surface</LiquidGlass>
                <LiquidGlassSwitch
                    pathname="/search"
                    items={[
                        { value: "home", href: "/", label: "Home" },
                        { value: "search", href: "/search", label: "Search" },
                    ]}
                />
            </LiquidGlassProvider>,
        );

        expect(html).toContain("lg-surface");
        expect(html).toContain("lg-switch");
        expect(html).toContain("SSR Surface");
    });

    it("integrates custom Link components and updates active route when pathname changes", () => {
        let nowMs = 100;
        let nextRafId = 1;
        const queuedCallbacks = new Map<number, FrameRequestCallback>();

        vi.spyOn(performance, "now").mockImplementation(() => nowMs);
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
            const id = nextRafId;
            nextRafId += 1;
            queuedCallbacks.set(id, callback);
            return id;
        });
        vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
            queuedCallbacks.delete(id);
        });

        function MockNextLink({
            href,
            prefetch,
            children,
            ...rest
        }: {
            href: string;
            prefetch?: boolean;
            children?: ReactNode;
            [key: string]: unknown;
        }) {
            return (
                <a
                    href={href}
                    data-mock-link="true"
                    data-prefetch={prefetch === undefined ? undefined : String(prefetch)}
                    {...rest}
                >
                    {children}
                </a>
            );
        }

        const ref = createRef<HTMLElement>();
        const handleChange = vi.fn();
        const items = [
            { value: "home", href: "/", label: "Home", exact: true },
            { value: "library", href: "/library", label: "Library", prefetch: false },
        ];

        const { rerender } = render(
            <LiquidGlassSwitch
                ref={ref}
                engine="css"
                pathname="/"
                linkComponent={MockNextLink}
                onChange={handleChange}
                items={items}
            />,
        );

        const homeTab = screen.getByRole("tab", { name: "Home" });
        const libraryTab = screen.getByRole("tab", { name: "Library" });
        expect(homeTab.getAttribute("data-mock-link")).toBe("true");
        expect(libraryTab.getAttribute("data-prefetch")).toBe("false");
        expect(homeTab.classList.contains("active")).toBe(true);

        rerender(
            <LiquidGlassSwitch
                ref={ref}
                engine="css"
                pathname="/library/favorites"
                linkComponent={MockNextLink}
                onChange={handleChange}
                items={items}
            />,
        );

        for (let frame = 0; frame < 90; frame += 1) {
            const pending = Array.from(queuedCallbacks.entries());
            if (pending.length === 0) {
                break;
            }
            queuedCallbacks.clear();
            nowMs += 16;
            for (const [, callback] of pending) {
                callback(nowMs);
            }
        }

        expect(libraryTab.classList.contains("active")).toBe(true);

        homeTab.addEventListener("click", (event) => event.preventDefault());
        fireEvent.click(homeTab);
        expect(handleChange).toHaveBeenCalledTimes(1);
        expect(handleChange.mock.calls[0]?.[0]).toBe("home");
    });

    it("syncs route on client-side history.pushState when pathname prop is omitted", async () => {
        window.history.replaceState(null, "", "/home");

        const items = [
            { value: "home", href: "/home", label: "Home" },
            { value: "about", href: "/about", label: "About" },
        ];

        render(
            <LiquidGlassSwitch
                engine="css"
                items={items}
            />,
        );

        const homeTab = screen.getByRole("tab", { name: "Home" });
        expect(homeTab.classList.contains("active")).toBe(true);

        window.history.pushState(null, "", "/about");
        const aboutTab = screen.getByRole("tab", { name: "About" });
        await waitFor(() => {
            expect(aboutTab.classList.contains("active")).toBe(true);
        });
    });

    it("guards query/hash root matching, restores or preserves third-party history hooks on unmount, and renders Next LiquidGlassSlider", () => {
        const items = [
            { value: "home", label: "Home", href: "/" },
            { value: "section", label: "Section", href: "#pricing" },
            { value: "filter", label: "Filtered", href: "?tab=pro" },
        ];
        expect(resolveSwitchValueForPathname(items, "#pricing")).toBeUndefined();
        expect(resolveSwitchValueForPathname(items, "?tab=pro")).toBeUndefined();
        expect(resolveSwitchValueForPathname(items, "/")).toBe("home");

        const originalPush = window.history.pushState;
        const originalReplace = window.history.replaceState;

        const cleanView = render(
            <LiquidGlassSwitch
                engine="css"
                items={[
                    { value: "home", label: "Home", href: "/" },
                    { value: "docs", label: "Docs", href: "/docs" },
                ]}
            />,
        );
        expect(window.history.pushState).not.toBe(originalPush);
        act(() => cleanView.unmount());
        expect(window.history.pushState).toBe(originalPush);
        expect(window.history.replaceState).toBe(originalReplace);

        const wrappedView = render(
            <LiquidGlassSwitch
                engine="css"
                items={[
                    { value: "home", label: "Home", href: "/" },
                    { value: "about", label: "About", href: "/about" },
                ]}
            />,
        );
        const thirdPartyPush: History["pushState"] = function (this: History, ...args) {
            return originalPush.apply(this, args);
        };
        window.history.pushState = thirdPartyPush;
        act(() => wrappedView.unmount());
        expect(window.history.pushState).toBe(thirdPartyPush);
        window.history.pushState = originalPush;

        render(<LiquidGlassSlider data-testid="next-slider" engine="css" min={0} max={100} defaultValue={55} />);
        expect(screen.getByTestId("next-slider").closest(".lg-slider")).not.toBeNull();
    });
});
