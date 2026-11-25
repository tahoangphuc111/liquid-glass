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
    SCHOTT_BK7_SELLMEIER,
    SCHOTT_SF11_SELLMEIER,
    buildOpticalLut,
    evaluateOpticalProfile,
    evaluateChromaticDispersion,
    evaluateCauchyIndex,
    evaluateSellmeierIndex,
    evaluateBeerLambertTransmittance,
    evaluateFresnelReflectance,
    evaluateBrewsterAngle,
    evaluateCriticalAngle,
    evaluateSpectralRefraction,
    evaluateThinFilmInterference,
    evaluateDerjaguinEffectiveRadius,
    evaluateYoungLaplacePressure,
    solveRefractionRay,
    type FresnelReflectanceSample,
    type SellmeierCoefficients,
    type SpectralRefractionSample,
    type ThinFilmInterferenceSample,
    type VectorRefractionResult,
} from "./core/optics.js";
export {
    buildSpringPropagator,
    stepSpring,
    evaluateSpringEnergy,
    evaluateRayleighDissipationRate,
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
