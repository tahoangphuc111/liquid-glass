"use client";

import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
    type ComponentPropsWithoutRef,
    type ElementType,
    type ForwardedRef,
    type ReactElement,
    type ReactNode,
} from "react";
import type { LiquidGlassSwitchOptions } from "../core/types.js";
import type { LiquidGlassSwitchItem } from "../react/LiquidGlassSwitch.js";
import { useGlassSwitch } from "../react/useGlassSwitch.js";

export interface NextLiquidGlassSwitchItem extends LiquidGlassSwitchItem {
    exact?: boolean;
    prefetch?: boolean;
}

export type NextLiquidGlassSwitchProps<ElementTag extends ElementType = "nav"> =
    LiquidGlassSwitchOptions & {
        as?: ElementTag;
        items?: readonly NextLiquidGlassSwitchItem[];
        pathname?: string;
        linkComponent?: ElementType;
        prefetch?: boolean;
        children?: ReactNode;
        className?: string;
    } & Omit<
            ComponentPropsWithoutRef<ElementTag>,
            keyof LiquidGlassSwitchOptions | "as" | "children" | "onChange"
        >;

function normalizePathname(rawPath: string): string {
    let cleanPath = rawPath.split(/[?#]/, 1)[0] ?? "/";
    try {
        if (cleanPath.includes("://")) {
            cleanPath = new URL(cleanPath).pathname;
        }
    } catch {
        // fallback
    }
    const withLeadingSlash = cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`;
    if (withLeadingSlash.length > 1 && withLeadingSlash.endsWith("/")) {
        return withLeadingSlash.replace(/\/+$/, "");
    }
    return withLeadingSlash || "/";
}

const historyListeners = new Set<() => void>();
let historyPatched = false;

function ensureHistoryPatched(): void {
    if (historyPatched || typeof window === "undefined" || !window.history) return;
    historyPatched = true;
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    window.history.pushState = function (...args) {
        const result = originalPushState.apply(this, args);
        historyListeners.forEach((listener) => {
            try {
                listener();
            } catch {
                // ignore
            }
        });
        return result;
    };
    window.history.replaceState = function (...args) {
        const result = originalReplaceState.apply(this, args);
        historyListeners.forEach((listener) => {
            try {
                listener();
            } catch {
                // ignore
            }
        });
        return result;
    };
}

export function resolveSwitchValueForPathname(
    items: readonly NextLiquidGlassSwitchItem[],
    pathname: string,
): string | undefined {
    if (items.length === 0 || !pathname) {
        return undefined;
    }

    const normalizedCurrent = normalizePathname(pathname);

    for (const item of items) {
        if (!item.href) {
            continue;
        }
        const normalizedHref = normalizePathname(item.href);
        if (normalizedHref === normalizedCurrent) {
            return item.value;
        }
    }

    let bestValue: string | undefined;
    let bestLength = -1;

    for (const item of items) {
        if (!item.href || item.exact) {
            continue;
        }
        const normalizedHref = normalizePathname(item.href);
        if (normalizedHref === "/") {
            continue;
        }
        if (
            normalizedCurrent.startsWith(`${normalizedHref}/`) &&
            normalizedHref.length > bestLength
        ) {
            bestLength = normalizedHref.length;
            bestValue = item.value;
        }
    }

    return bestValue;
}

type NextLiquidGlassSwitchPolymorphicComponent = <ElementTag extends ElementType = "nav">(
    props: NextLiquidGlassSwitchProps<ElementTag> & { ref?: ForwardedRef<HTMLElement> },
) => ReactElement | null;

const NextLiquidGlassSwitchImpl = forwardRef<
    HTMLElement,
    NextLiquidGlassSwitchProps<"nav">
>(function LiquidGlassSwitch(
    {
        as,
        items,
        pathname,
        linkComponent,
        prefetch,
        children,
        className,
        value,
        defaultValue,
        itemSelector,
        gliderElement,
        onChange,
        surface,
        engine,
        thickness,
        bezel,
        scaleRatio,
        maxScaleMultiplier,
        blur,
        ior,
        radius,
        pill,
        hollow,
        alwaysOn,
        coreFilter,
        tintColor,
        tintOpacity,
        highlight,
        pixelRatio,
        chromaticAberration,
        interactive,
        draggable,
        coalesce,
        sceneElement,
        sceneCanvas,
        onEngineChange,
        ...restProps
    },
    ref,
) {
    const containerRef = useRef<HTMLElement | null>(null);
    useImperativeHandle(ref, () => containerRef.current as HTMLElement);

    const [clientPathname, setClientPathname] = useState<string>("");

    useEffect(() => {
        if (pathname !== undefined || typeof window === "undefined") {
            return;
        }
        const syncLocation = () => {
            setClientPathname(window.location.pathname);
        };
        syncLocation();
        ensureHistoryPatched();
        historyListeners.add(syncLocation);
        window.addEventListener("popstate", syncLocation);
        return () => {
            historyListeners.delete(syncLocation);
            window.removeEventListener("popstate", syncLocation);
        };
    }, [pathname]);

    const activePathname = pathname ?? clientPathname;
    const matchedRouteValue =
        value === undefined && items && activePathname
            ? resolveSwitchValueForPathname(items, activePathname)
            : undefined;
    const resolvedValue = value ?? matchedRouteValue;

    const { refresh } = useGlassSwitch(containerRef, {
        value: resolvedValue,
        defaultValue: defaultValue ?? items?.[0]?.value,
        itemSelector,
        gliderElement,
        onChange,
        surface,
        engine,
        thickness,
        bezel,
        scaleRatio,
        maxScaleMultiplier,
        blur,
        ior,
        radius,
        pill,
        hollow,
        alwaysOn,
        coreFilter,
        tintColor,
        tintOpacity,
        highlight,
        pixelRatio,
        chromaticAberration,
        interactive,
        draggable,
        coalesce,
        sceneElement,
        sceneCanvas,
        onEngineChange,
    });

    const didMountRef = useRef(false);
    useEffect(() => {
        if (!didMountRef.current) {
            didMountRef.current = true;
            return;
        }
        refresh();
    }, [items, children, refresh]);

    const Component = (as ?? "nav") as ElementType;
    const LinkTag = (linkComponent ?? "a") as ElementType;
    const classes = className ? `lg-switch ${className}` : "lg-switch";

    return (
        <Component ref={containerRef} className={classes} {...restProps}>
            {items
                ? items.map((item: NextLiquidGlassSwitchItem) =>
                      item.href ? (
                          <LinkTag
                              key={item.value}
                              href={item.href}
                              className="lg-switch-item"
                              data-switch-value={item.value}
                              role="tab"
                              aria-disabled={item.disabled ? "true" : undefined}
                              tabIndex={item.disabled ? -1 : undefined}
                              aria-label={item.ariaLabel}
                              {...(linkComponent && (item.prefetch ?? prefetch) !== undefined
                                  ? { prefetch: item.prefetch ?? prefetch }
                                  : {})}
                          >
                              {item.icon}
                              <span>{item.label}</span>
                          </LinkTag>
                      ) : (
                          <button
                              key={item.value}
                              type="button"
                              className="lg-switch-item"
                              data-switch-value={item.value}
                              role="tab"
                              disabled={item.disabled}
                              aria-disabled={item.disabled ? "true" : undefined}
                              tabIndex={item.disabled ? -1 : undefined}
                              aria-label={item.ariaLabel}
                          >
                              {item.icon}
                              <span>{item.label}</span>
                          </button>
                      ),
                  )
                : children}
        </Component>
    );
});

export const LiquidGlassSwitch =
    NextLiquidGlassSwitchImpl as NextLiquidGlassSwitchPolymorphicComponent;
