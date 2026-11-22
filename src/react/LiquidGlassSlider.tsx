import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
    type InputHTMLAttributes,
} from "react";
import type { LiquidGlassSliderOptions } from "../core/types.js";
import { useGlassSlider } from "./useGlassSlider.js";

export type LiquidGlassSliderProps = LiquidGlassSliderOptions &
    Omit<InputHTMLAttributes<HTMLInputElement>, keyof LiquidGlassSliderOptions | "type"> & {
        onValueChange?: (value: number, input: HTMLInputElement) => void;
    };

export const LiquidGlassSlider = forwardRef<HTMLInputElement, LiquidGlassSliderProps>(
    function LiquidGlassSlider(
        {
            orientation,
            onChange,
            onValueChange,
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
            value,
            disabled,
            min,
            max,
            step,
            ...restProps
        },
        ref,
    ) {
        const inputRef = useRef<HTMLInputElement | null>(null);
        useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

        const { refresh } = useGlassSlider(inputRef, {
            orientation,
            onChange: (nextVal, inputEl) => {
                onChange?.(nextVal, inputEl);
                onValueChange?.(nextVal, inputEl);
            },
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
        }, [value, min, max, step, disabled, refresh]);

        return (
            <span className="lg-slider-host" style={{ display: "contents" }}>
                <input
                    ref={inputRef}
                    type="range"
                    value={value}
                    onChange={value !== undefined ? () => {} : undefined}
                    disabled={disabled}
                    min={min}
                    max={max}
                    step={step}
                    {...restProps}
                />
            </span>
        );
    },
);
