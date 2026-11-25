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
    const trimmed = rawPath.trim();
    if (trimmed.startsWith("?") || trimmed.startsWith("#")) {
        return "";
    }
    let cleanPath = trimmed.split(/[?#]/, 1)[0] ?? "/";
    try {
        if (cleanPath.includes("://")) {
            cleanPath = new URL(cleanPath).pathname;
        }
    } catch {
    }
    const collapsed = cleanPath.replace(/\/{2,}/g, "/");
    const withLeadingSlash = collapsed.startsWith("/") ? collapsed : `/${collapsed}`;
    if (withLeadingSlash.length > 1 && withLeadingSlash.endsWith("/")) {
        return withLeadingSlash.replace(/\/+$/, "");
    }
    return withLeadingSlash || "/";
}

const historyListeners = new Set<() => void>();
let historyPatched = false;
let originalPushState: History["pushState"] | null = null;
let originalReplaceState: History["replaceState"] | null = null;
let patchedPushState: History["pushState"] | null = null;
let patchedReplaceState: History["replaceState"] | null = null;
let historyNotificationQueued = false;

function notifyHistoryListenersDeferred(): void {
    if (historyNotificationQueued || historyListeners.size === 0) return;
    historyNotificationQueued = true;
    const flush = () => {
        historyNotificationQueued = false;
        historyListeners.forEach((listener) => {
            try {
                listener();
            } catch {
            }
        });
    };
    if (typeof queueMicrotask === "function") {
        queueMicrotask(flush);
    } else {
        void Promise.resolve().then(flush);
    }
}

function ensureHistoryPatched(): void {
    if (historyPatched || typeof window === "undefined" || !window.history) return;
    historyPatched = true;
    originalPushState = window.history.pushState;
    originalReplaceState = window.history.replaceState;
    const nativePushState = originalPushState;
    const nativeReplaceState = originalReplaceState;
    patchedPushState = function (this: History, ...args) {
        const result = nativePushState.apply(this, args);
        notifyHistoryListenersDeferred();
        return result;
    };
    patchedReplaceState = function (this: History, ...args) {
        const result = nativeReplaceState.apply(this, args);
        notifyHistoryListenersDeferred();
        return result;
    };
    window.history.pushState = patchedPushState;
    window.history.replaceState = patchedReplaceState;
}

function restoreHistoryIfUnused(): void {
    if (!historyPatched || historyListeners.size > 0 || typeof window === "undefined" || !window.history) {
        return;
    }
    if (originalPushState && window.history.pushState === patchedPushState) {
        window.history.pushState = originalPushState;
    }
    if (originalReplaceState && window.history.replaceState === patchedReplaceState) {
        window.history.replaceState = originalReplaceState;
    }
    originalPushState = null;
    originalReplaceState = null;
    patchedPushState = null;
    patchedReplaceState = null;
    historyPatched = false;
}

export function resolveSwitchValueForPathname(
    items: readonly NextLiquidGlassSwitchItem[],
    pathname: string,
): string | undefined {
    if (items.length === 0 || !pathname) {
        return undefined;
    }

    const normalizedCurrent = normalizePathname(pathname);
    if (!normalizedCurrent) {
        return undefined;
    }

    let bestPrefixValue: string | undefined;
    let bestPrefixLength = -1;

    for (const item of items) {
        if (!item.href) {
            continue;
        }
        const normalizedHref = normalizePathname(item.href);
        if (!normalizedHref) {
            if (item.href === pathname) {
                return item.value;
            }
            continue;
        }
        if (normalizedHref === normalizedCurrent) {
            return item.value;
        }
        if (
            !item.exact &&
            normalizedHref !== "/" &&
            normalizedCurrent.startsWith(`${normalizedHref}/`) &&
            normalizedHref.length > bestPrefixLength
        ) {
            bestPrefixLength = normalizedHref.length;
            bestPrefixValue = item.value;
        }
    }

    return bestPrefixValue;
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
        orientation,
        itemSelector,
        gliderElement,
        trackOptions,
        gliderOptions,
        onChange,
        preset,
        theme,
        surface,
        engine,
        thickness,
        bezel,
        adaptiveRefraction,
        refractionDirection,
        refractionEdgeFade,
        maxRefractionPx,
        scaleRatio,
        maxScaleMultiplier,
        blur,
        ior,
        radius,
        cornerStyle,
        pill,
        hollow,
        alwaysOn,
        coreFilter,
        tintColor,
        tintOpacity,
        highlight,
        lightTilt,
        pixelRatio,
        sharpness,
        saturation,
        chromaticAberration,
        abbeNumber,
        interactive,
        draggable,
        dragBounds,
        onDragChange,
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
            restoreHistoryIfUnused();
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
        orientation,
        itemSelector,
        gliderElement,
        trackOptions,
        gliderOptions,
        onChange,
        preset,
        theme,
        surface,
        engine,
        thickness,
        bezel,
        adaptiveRefraction,
        refractionDirection,
        refractionEdgeFade,
        maxRefractionPx,
        scaleRatio,
        maxScaleMultiplier,
        blur,
        ior,
        radius,
        cornerStyle,
        pill,
        hollow,
        alwaysOn,
        coreFilter,
        tintColor,
        tintOpacity,
        highlight,
        lightTilt,
        pixelRatio,
        sharpness,
        saturation,
        chromaticAberration,
        abbeNumber,
        interactive,
        draggable,
        dragBounds,
        onDragChange,
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
