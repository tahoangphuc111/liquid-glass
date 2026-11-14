export type GlassSurface = "convex_squircle" | "convex_circle" | "linear" | "lip";

export type GlassEngineMode = "auto" | "wasm-svg" | "webgl" | "css";

export type GlassEngine = "wasm-svg" | "webgl" | "css";

export interface GlassConfig {
    id: string;
    selector?: string;
    surface: GlassSurface;
    thickness: number;
    bezel: number;
    scaleRatio: number;
    maxScaleMultiplier: number;
    blur: number;
    ior: number;
    colorMatrix?: string;
    coreFilter?: string;
    radius: number;
    pill: boolean;
    alwaysOn: boolean;
    hollow: boolean;
    axis?: "x" | null;
}

export interface LiquidGlassOptions {
    surface?: GlassSurface;
    engine?: GlassEngineMode;
    thickness?: number;
    bezel?: number;
    scaleRatio?: number;
    maxScaleMultiplier?: number;
    blur?: number;
    ior?: number;
    radius?: number;
    pill?: boolean;
    hollow?: boolean;
    alwaysOn?: boolean;
    coreFilter?: string;
    tintColor?: string;
    tintOpacity?: number;
    highlight?: number;
    pixelRatio?: number;
    chromaticAberration?: boolean | number;
    interactive?: boolean;
    sceneElement?: HTMLElement | null;
    sceneCanvas?: HTMLCanvasElement | null;
    onEngineChange?: (engine: GlassEngine) => void;
}

export interface LiquidGlassInstance {
    readonly element: HTMLElement;
    readonly engine: GlassEngine;
    update(options: Partial<LiquidGlassOptions>): void;
    refresh(): void;
    setSceneCanvas(canvas: HTMLCanvasElement | null, sceneElement?: HTMLElement | null): void;
    destroy(): void;
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
    destroy(): void;
}
