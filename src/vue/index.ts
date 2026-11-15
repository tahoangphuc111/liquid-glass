import type { App, Plugin } from "vue";
import { LiquidGlass } from "./LiquidGlass.js";
import { LiquidGlassSwitch } from "./LiquidGlassSwitch.js";
import { LiquidGlassProvider } from "./context.js";

export { LiquidGlass } from "./LiquidGlass.js";
export {
    LiquidGlassSwitch,
    type LiquidGlassSwitchItem,
} from "./LiquidGlassSwitch.js";
export {
    LiquidGlassProvider,
    LIQUID_GLASS_INJECTION_KEY,
    useLiquidGlassContext,
    type VueLiquidGlassContext,
} from "./context.js";
export { useLiquidGlass, type UseVueLiquidGlassResult } from "./useLiquidGlass.js";
export { useGlassSwitch, type UseVueGlassSwitchResult } from "./useGlassSwitch.js";
export type {
    GlassEngine,
    GlassEngineMode,
    GlassSurface,
    LiquidGlassOptions,
    LiquidGlassSwitchOptions,
    LiquidGlassSwitchInstance,
} from "../core/types.js";

export const LiquidGlassPlugin: Plugin = {
    install(app: App) {
        app.component("LiquidGlass", LiquidGlass);
        app.component("LiquidGlassSwitch", LiquidGlassSwitch);
        app.component("LiquidGlassProvider", LiquidGlassProvider);
    },
};
