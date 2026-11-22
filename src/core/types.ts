export type GlassSurface = "convex_squircle" | "convex_circle" | "linear" | "lip" | "concave";

export type GlassPreset =
    | "apple_liquid"
    | "frosted"
    | "crystal"
    | "water"
    | "obsidian"
    | "subtle"
    | "prism"
    | "diamond"
    | "smoke"
    | "ice";

export type GlassCornerStyle = "circular" | "squircle";

export type GlassTheme = "auto" | "light" | "dark";

export type GlassOrientation = "horizontal" | "vertical";

export type GlassRefractionDirection = "all" | GlassOrientation;

export type GlassSwitchOrientation = GlassOrientation;

export type GlassDragMode = boolean | "elastic" | "free";

export type GlassDragBounds =
    | "viewport"
    | "parent"
    | HTMLElement
    | {
          readonly minX?: number;
          readonly maxX?: number;
          readonly minY?: number;
          readonly maxY?: number;
      };

export interface GlassLightTilt {
    horizontal: number;
    vertical: number;
}

export type GlassLightTiltMode = GlassLightTilt | "pointer" | "gyro";

export type GlassEngineMode = "auto" | "wasm-svg" | "webgl" | "css";

export type GlassEngine = "wasm-svg" | "webgl" | "css";

export interface GlassConfig {
    id: string;
    selector?: string;
    surface: GlassSurface;
    thickness: number;
    bezel: number;
    adaptiveRefraction?: boolean;
    refractionDirection?: GlassRefractionDirection;
    refractionEdgeFade?: number;
    maxRefractionPx?: number;
    scaleRatio: number;
    maxScaleMultiplier: number;
    blur: number;
    saturation?: number;
    ior: number;
    colorMatrix?: string;
    coreFilter?: string;
    radius: number;
    cornerStyle?: GlassCornerStyle;
    pill: boolean;
    alwaysOn: boolean;
    hollow: boolean;
    axis?: "x" | null;
    chromaticAberration?: boolean | number;
    abbeNumber?: number;
}

export interface LiquidGlassOptions {
    preset?: GlassPreset;
    theme?: GlassTheme;
    surface?: GlassSurface;
    engine?: GlassEngineMode;
    thickness?: number;
    bezel?: number;
    /** Fit the bezel and displacement to the measured surface. Defaults to true. */
    adaptiveRefraction?: boolean;
    refractionDirection?: GlassRefractionDirection;
    refractionEdgeFade?: number;
    maxRefractionPx?: number;
    scaleRatio?: number;
    maxScaleMultiplier?: number;
    blur?: number;
    /** Backdrop saturation from 0 (grayscale) to 4. Omit for the renderer default. */
    saturation?: number;
    ior?: number;
    radius?: number;
    cornerStyle?: GlassCornerStyle;
    pill?: boolean;
    hollow?: boolean;
    alwaysOn?: boolean;
    coreFilter?: string;
    tintColor?: string;
    tintOpacity?: number;
    highlight?: number;
    lightTilt?: GlassLightTiltMode;
    pixelRatio?: number;
    /** RGB dispersion from 0 to 1, or true for the default material strength. */
    chromaticAberration?: boolean | number;
    abbeNumber?: number;
    interactive?: boolean;
    draggable?: GlassDragMode;
    dragBounds?: GlassDragBounds;
    onDragChange?: (offsetX: number, offsetY: number, isDragging: boolean) => void;
    coalesce?: boolean;
    sceneElement?: HTMLElement | null;
    sceneCanvas?: HTMLCanvasElement | null;
    onEngineChange?: (engine: GlassEngine) => void;
}

export interface LiquidGlassInstance {
    readonly element: HTMLElement;
    readonly engine: GlassEngine;
    update(options: Partial<LiquidGlassOptions>): void;
    refresh(): void;
    setLightTilt?(horizontal: number, vertical: number): void;
    setDragOffset?(offsetX: number, offsetY: number, animate?: boolean): void;
    setSceneCanvas(canvas: HTMLCanvasElement | null, sceneElement?: HTMLElement | null): void;
    destroy(): void;
}

export type LiquidGlassSwitchLayerOptions = Omit<
    LiquidGlassOptions,
    "interactive" | "draggable" | "dragBounds" | "onDragChange" | "coalesce" | "onEngineChange"
>;

export interface LiquidGlassSwitchOptions extends LiquidGlassOptions {
    value?: string;
    defaultValue?: string;
    orientation?: GlassSwitchOrientation;
    itemSelector?: string;
    gliderElement?: HTMLElement | null;
    trackOptions?: LiquidGlassSwitchLayerOptions;
    gliderOptions?: LiquidGlassSwitchLayerOptions;
    onChange?: (value: string, index: number, itemElement: HTMLElement) => void;
}

export interface LiquidGlassSwitchInstance extends LiquidGlassInstance {
    readonly value: string;
    readonly activeIndex: number;
    setValue(value: string, animate?: boolean): void;
    setActiveIndex(index: number, animate?: boolean): void;
    update(options: Partial<LiquidGlassSwitchOptions>): void;
}

export interface LiquidGlassSliderOptions extends LiquidGlassOptions {
    orientation?: GlassOrientation;
    onChange?: (value: number, input: HTMLInputElement) => void;
}

export interface LiquidGlassSliderInstance extends LiquidGlassInstance {
    readonly value: number;
    setValue(value: number, animate?: boolean): void;
    update(options: Partial<LiquidGlassSliderOptions>): void;
}

export interface LiquidGlassStats {
    liveFilters: number;
    filterNodeCount: number;
    activeBlobUrls: number;
    poolConsistent: boolean;
    qualityTier: "T0" | "T1" | "T2" | "CSS fallback";
    downgrades: number;
    upgrades: number;
    activeElements: number;
    wasmReady: boolean;
}

export interface SceneCaptureController {
    readonly canvas: HTMLCanvasElement | null;
    readonly source: HTMLElement | null;
    subscribe(listener: (canvas: HTMLCanvasElement, source: HTMLElement) => void): () => void;
    scheduleCapture(): void;
    setActive?(active: boolean): void;
    destroy(): void;
}
