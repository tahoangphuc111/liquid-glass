import {
    forwardRef,
    useImperativeHandle,
    useRef,
    type ComponentPropsWithoutRef,
    type ElementType,
    type ForwardedRef,
    type ReactElement,
    type ReactNode,
} from "react";
import type { LiquidGlassOptions } from "../core/types.js";
import { useLiquidGlass } from "./useLiquidGlass.js";

export type LiquidGlassProps<T extends ElementType = "div"> = LiquidGlassOptions & {
    as?: T;
    children?: ReactNode;
    className?: string;
} & Omit<ComponentPropsWithoutRef<T>, keyof LiquidGlassOptions | "as" | "children">;

type LiquidGlassPolymorphicComponent = <T extends ElementType = "div">(
    props: LiquidGlassProps<T> & { ref?: ForwardedRef<HTMLElement> },
) => ReactElement | null;

const LiquidGlassImpl = forwardRef<HTMLElement, LiquidGlassProps<ElementType>>(
    function LiquidGlass(
        {
            as,
            children,
            className,
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
        const elRef = useRef<HTMLElement | null>(null);
        useImperativeHandle(ref, () => elRef.current as HTMLElement);

        useLiquidGlass(elRef, {
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

        const Component = (as ?? "div") as ElementType;
        const classes = className ? `lg-surface ${className}` : "lg-surface";

        return (
            <Component ref={elRef} className={classes} {...restProps}>
                {children}
            </Component>
        );
    },
);

export const LiquidGlass = LiquidGlassImpl as LiquidGlassPolymorphicComponent;
