export function useSmallMemoryBudget(): boolean {
    if (typeof navigator === "undefined") return true;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    return !(typeof memory === "number" && Number.isFinite(memory) && memory > 4);
}

export function automaticRoundedPixelRatio(minRatio: number, maxRatio: number): number {
    const rawDpr = typeof window === "undefined" ? 1 : window.devicePixelRatio;
    const dpr = Number.isFinite(rawDpr) && rawDpr > 0 ? rawDpr : 1;
    if (typeof navigator !== "undefined") {
        const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
        const cores = navigator.hardwareConcurrency;
        if ((memory !== undefined && memory > 0 && memory <= 4) || (cores > 0 && cores <= 2)) {
            return Math.min(1.5, Math.max(1, dpr));
        }
    }
    return Math.min(maxRatio, Math.max(minRatio, dpr));
}

export const SMALL_FRAME_PIXELS = 1_048_576;
export const SMALL_SCENE_DIMENSION = 1024;

export function resizeCanvas(canvas: HTMLCanvasElement, width: number, height: number): void {
    if (height < canvas.height) canvas.height = height;
    if (width !== canvas.width) canvas.width = width;
    if (height > canvas.height) canvas.height = height;
}
