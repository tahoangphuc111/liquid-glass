import type { App, Plugin } from "vue";
import { LiquidGlass } from "./LiquidGlass.js";
import { LiquidGlassSwitch } from "./LiquidGlassSwitch.js";
import { LiquidGlassSlider } from "./LiquidGlassSlider.js";
import { LiquidGlassProvider } from "./context.js";

export { LiquidGlass } from "./LiquidGlass.js";
export {
    LiquidGlassSwitch,
    type LiquidGlassSwitchItem,
} from "./LiquidGlassSwitch.js";
export { LiquidGlassSlider } from "./LiquidGlassSlider.js";
export {
    LiquidGlassProvider,
    LIQUID_GLASS_INJECTION_KEY,
    useLiquidGlassContext,
    type VueLiquidGlassContext,
} from "./context.js";
export { useLiquidGlass, type UseVueLiquidGlassResult } from "./useLiquidGlass.js";
export { useGlassSwitch, type UseVueGlassSwitchResult } from "./useGlassSwitch.js";
export { useGlassSlider, type UseVueGlassSliderResult } from "./useGlassSlider.js";
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

export const LiquidGlassPlugin: Plugin = {
    install(app: App) {
        app.component("LiquidGlass", LiquidGlass);
        app.component("LiquidGlassSwitch", LiquidGlassSwitch);
        app.component("LiquidGlassSlider", LiquidGlassSlider);
        app.component("LiquidGlassProvider", LiquidGlassProvider);
    },
};
