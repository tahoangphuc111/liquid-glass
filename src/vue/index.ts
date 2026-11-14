import type { App, Plugin } from "vue";
import { LiquidGlass } from "./LiquidGlass.js";
import { LiquidGlassProvider } from "./context.js";

export { LiquidGlass } from "./LiquidGlass.js";
export {
    LiquidGlassProvider,
    LIQUID_GLASS_INJECTION_KEY,
    useLiquidGlassContext,
    type VueLiquidGlassContext,
} from "./context.js";
export { useLiquidGlass, type UseVueLiquidGlassResult } from "./useLiquidGlass.js";
export type {
    GlassEngine,
    GlassEngineMode,
    GlassSurface,
    LiquidGlassOptions,
} from "../core/types.js";

export const LiquidGlassPlugin: Plugin = {
    install(app: App) {
        app.component("LiquidGlass", LiquidGlass);
        app.component("LiquidGlassProvider", LiquidGlassProvider);
    },
};
