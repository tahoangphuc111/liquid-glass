export function smooth(from: number, to: number, value: number) {
    const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
    return t * t * (3 - 2 * t);
}

export function lensGeometry(width: number, height: number, progress: number) {
    const span = Math.min(width, height * 0.56);
    const cx = width / 2;
    const cy = height * (1.03 - 0.685 * progress);
    const radius = span * (0.58 - 0.455 * smooth(0.20, 0.98, progress));
    return { cx, cy, radius, span };
}
