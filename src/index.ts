export * from "./core/types.js";
export * from "./core/config.js";
export {
    initWasmSimdModule,
    getWasmDisplacementBmp,
    isWasmReady,
    onWasmReady,
    revokeBlobUrlSafely,
} from "./core/wasm.js";
export {
    qualityTier,
    isGlassDowngraded,
    qualityUpgrades,
    qualityDowngrades,
    applyQualityTier,
    recordJankFrame,
    downgradeLiquidGlass,
} from "./core/telemetry.js";
export {
    checkIsChromium,
    canUseSvgGlass,
    canUseWebglRefraction,
    resolveGlassEngine,
} from "./core/observer.js";
export {
    initLiquidGlass,
    destroyLiquidGlass,
    rebuildAllLiquidGlassFilters,
    downgradeLiquidGlassToCss,
    getLiquidGlassStats,
    registerManagedElement,
    unregisterManagedElement,
} from "./core/engine.js";
export {
    acquireSharedSceneCapture,
    createSceneCaptureController,
    captureDomToCanvas,
} from "./core/sceneCapture.js";
export { GlassWebglRenderer, parseCssColorToRgb } from "./core/webglRenderer.js";
export {
    parseCssColorToRgba,
    computeRelativeLuminance,
    computeWcagContrastRatio,
} from "./core/cssColor.js";
export {
    OPTICAL_LUT_SIZE,
    buildOpticalLut,
    evaluateOpticalProfile,
    evaluateChromaticDispersion,
    evaluateCauchyIndex,
    evaluateFresnelReflectance,
    evaluateBrewsterAngle,
    evaluateCriticalAngle,
    evaluateSpectralRefraction,
    solveRefractionRay,
    type FresnelReflectanceSample,
    type SpectralRefractionSample,
    type VectorRefractionResult,
} from "./core/optics.js";
export {
    buildSpringPropagator,
    stepSpring,
    evaluateSpringEnergy,
    predictMomentumOffset,
    type DampedSpringParams,
    type SpringStepResult,
    type SpringPropagator,
} from "./core/spring.js";
export { createLiquidGlass, requestDeviceTiltPermission } from "./core/controller.js";
export { createGlassSlider } from "./core/slider.js";
export { createGlassSwitch } from "./core/switch.js";
export {
    registerLiquidGlassElement,
    type LiquidGlassCustomElement,
} from "./core/customElement.js";
export { glassEffect, type LiquidGlassGroup } from "./core/glassEffect.js";
export type {
    LiquidGlassSwitchOptions,
    LiquidGlassSwitchInstance,
} from "./core/types.js";
