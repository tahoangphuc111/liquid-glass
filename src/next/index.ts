"use client";

export { LiquidGlass, type LiquidGlassProps } from "../react/LiquidGlass.js";
export {
    LiquidGlassSwitch,
    resolveSwitchValueForPathname,
    type NextLiquidGlassSwitchProps,
    type NextLiquidGlassSwitchItem,
} from "./LiquidGlassSwitch.js";
export { LiquidGlassSlider, type LiquidGlassSliderProps } from "../react/LiquidGlassSlider.js";
export {
    LiquidGlassProvider,
    useLiquidGlassContext,
    type LiquidGlassProviderProps,
    type LiquidGlassContextValue,
} from "../react/context.js";
export { useLiquidGlass, type UseLiquidGlassResult } from "../react/useLiquidGlass.js";
export { useGlassSwitch, type UseGlassSwitchResult } from "../react/useGlassSwitch.js";
export { useGlassSlider, type UseGlassSliderResult } from "../react/useGlassSlider.js";
export type {
    GlassCornerStyle,
    GlassDragBounds,
    GlassDragMode,
    GlassEngine,
    GlassEngineMode,
    GlassLightTilt,
    GlassLightTiltMode,
    GlassOrientation,
    GlassPreset,
    GlassSurface,
    GlassTheme,
    LiquidGlassOptions,
    LiquidGlassSwitchOptions,
    LiquidGlassSwitchInstance,
    LiquidGlassSliderOptions,
    LiquidGlassSliderInstance,
} from "../core/types.js";
