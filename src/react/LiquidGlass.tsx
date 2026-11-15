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
        const elRef = useRef<HTMLElement | null>(null);
        useImperativeHandle(ref, () => elRef.current as HTMLElement);

        useLiquidGlass(elRef, {
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
