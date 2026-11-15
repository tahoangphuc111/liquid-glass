"use client";

export { LiquidGlass, type LiquidGlassProps } from "../react/LiquidGlass.js";
export {
    LiquidGlassSwitch,
    resolveSwitchValueForPathname,
    type NextLiquidGlassSwitchProps,
    type NextLiquidGlassSwitchItem,
} from "./LiquidGlassSwitch.js";
export {
    LiquidGlassProvider,
    useLiquidGlassContext,
    type LiquidGlassProviderProps,
    type LiquidGlassContextValue,
} from "../react/context.js";
export { useLiquidGlass, type UseLiquidGlassResult } from "../react/useLiquidGlass.js";
export { useGlassSwitch, type UseGlassSwitchResult } from "../react/useGlassSwitch.js";
export type {
    GlassEngine,
    GlassEngineMode,
    GlassSurface,
    LiquidGlassOptions,
    LiquidGlassSwitchOptions,
    LiquidGlassSwitchInstance,
} from "../core/types.js";
