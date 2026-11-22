import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
    type ComponentPropsWithoutRef,
    type ElementType,
    type ForwardedRef,
    type ReactElement,
    type ReactNode,
} from "react";
import type { LiquidGlassSwitchOptions } from "../core/types.js";
import { useGlassSwitch } from "./useGlassSwitch.js";

export interface LiquidGlassSwitchItem {
    value: string;
    label: ReactNode;
    icon?: ReactNode;
    href?: string;
    disabled?: boolean;
    ariaLabel?: string;
}

export type LiquidGlassSwitchProps<ElementTag extends ElementType = "nav"> =
    LiquidGlassSwitchOptions & {
        as?: ElementTag;
        items?: readonly LiquidGlassSwitchItem[];
        children?: ReactNode;
        className?: string;
    } & Omit<
            ComponentPropsWithoutRef<ElementTag>,
            keyof LiquidGlassSwitchOptions | "as" | "children" | "onChange"
        >;

type LiquidGlassSwitchPolymorphicComponent = <ElementTag extends ElementType = "nav">(
    props: LiquidGlassSwitchProps<ElementTag> & { ref?: ForwardedRef<HTMLElement> },
) => ReactElement | null;

const LiquidGlassSwitchImpl = forwardRef<
    HTMLElement,
    LiquidGlassSwitchProps<"nav">
>(function LiquidGlassSwitch(
    {
        as,
        items,
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

    const { refresh } = useGlassSwitch(containerRef, {
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
    const classes = className ? `lg-switch ${className}` : "lg-switch";

    return (
        <Component ref={containerRef} className={classes} {...restProps}>
            {items
                ? items.map((item: LiquidGlassSwitchItem) =>
                      item.href ? (
                          <a
                              key={item.value}
                              href={item.href}
                              className="lg-switch-item"
                              data-switch-value={item.value}
                              role="tab"
                              aria-disabled={item.disabled ? "true" : undefined}
                              tabIndex={item.disabled ? -1 : undefined}
                              aria-label={item.ariaLabel}
                          >
                              {item.icon}
                              <span>{item.label}</span>
                          </a>
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
    LiquidGlassSwitchImpl as LiquidGlassSwitchPolymorphicComponent;
