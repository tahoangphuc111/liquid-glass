import { lensGeometry, smooth } from "./geometry";

interface BubbleSpec {
    spreadX: number;
    rise: number;
    radius: number;
    delay: number;
    driftPhase: number;
    driftAmp: number;
    hue: number;
    accentHue: number;
}

const BUBBLE_PALETTE: ReadonlyArray<readonly [number, number]> = [
    [352, 28],
    [16, 46],
    [42, 18],
    [146, 188],
    [196, 224],
    [222, 265],
    [274, 322],
    [328, 355],
];

const bubbles: readonly BubbleSpec[] = Array.from({ length: 40 }, (_, index) => {
    const hashA = Math.sin((index + 1) * 47.21) * 4375.5453;
    const spread = hashA - Math.floor(hashA);
    const hashB = Math.sin((index + 1) * 91.73) * 1937.13;
    const jitter = hashB - Math.floor(hashB);
    const tier = (index * 17 % 41) / 40;
    const reach = 0.055 + 0.285 * tier;
    const [hue, accentHue] = BUBBLE_PALETTE[index % BUBBLE_PALETTE.length]!;
    return {
        spreadX: (spread - 0.5) * (0.36 + reach * 2.45),
        rise: reach,
        radius: (0.015 + 0.058 * jitter) * (0.48 + reach * 1.45),
        delay: (index % 8) * 0.042,
        driftPhase: spread * Math.PI * 2,
        driftAmp: 0.004 + 0.006 * jitter,
        hue: (hue + Math.round((jitter - 0.5) * 18) + 360) % 360,
        accentHue: (accentHue + Math.round((spread - 0.5) * 18) + 360) % 360,
    };
});

function makeBubbleAtlas(cell: number) {
    const atlas = document.createElement("canvas");
    atlas.width = cell * 8;
    atlas.height = cell * 5;
    const ctx = atlas.getContext("2d")!;
    for (let index = 0; index < bubbles.length; index++) {
        const spec = bubbles[index]!;
        const radius = cell / 2 - 2;
        ctx.save();
        ctx.translate((index % 8 + 0.5) * cell, (Math.floor(index / 8) + 0.5) * cell);
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.clip();

        const baseGrad = ctx.createLinearGradient(-radius * 0.7, -radius * 0.85, radius * 0.8, radius * 0.85);
        baseGrad.addColorStop(0, `hsl(${spec.hue} 94% 68%)`);
        baseGrad.addColorStop(0.55, `hsl(${(spec.hue + 18) % 360} 88% 54%)`);
        baseGrad.addColorStop(1, `hsl(${spec.accentHue} 86% 42%)`);
        ctx.fillStyle = baseGrad;
        ctx.fillRect(-radius, -radius, radius * 2, radius * 2);

        const swirlCount = 2 + (index % 2);
        for (let blobIndex = 0; blobIndex < swirlCount; blobIndex++) {
            const angle = spec.driftPhase + blobIndex * 2.2;
            const blobCenterX = Math.cos(angle) * radius * 0.28;
            const blobCenterY = Math.sin(angle) * radius * 0.28;
            const blobGrad = ctx.createRadialGradient(
                blobCenterX,
                blobCenterY,
                0,
                blobCenterX,
                blobCenterY,
                radius * 0.72,
            );
            const blobHue = (spec.accentHue + blobIndex * 44) % 360;
            blobGrad.addColorStop(0, `hsla(${blobHue} 98% 78% / 0.82)`);
            blobGrad.addColorStop(0.55, `hsla(${blobHue} 92% 62% / 0.35)`);
            blobGrad.addColorStop(1, `hsla(${blobHue} 92% 62% / 0)`);
            ctx.fillStyle = blobGrad;
            ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
        }

        const specGlow = ctx.createRadialGradient(-radius * 0.34, -radius * 0.38, 0, -radius * 0.22, -radius * 0.25, radius * 0.85);
        specGlow.addColorStop(0, "rgba(255, 255, 255, 0.72)");
        specGlow.addColorStop(0.32, "rgba(255, 255, 255, 0.18)");
        specGlow.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.fillStyle = specGlow;
        ctx.fillRect(-radius, -radius, radius * 2, radius * 2);

        ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
        ctx.lineWidth = Math.max(1, radius * 0.06);
        ctx.beginPath();
        ctx.arc(0, 0, radius - ctx.lineWidth * 0.5, 0, Math.PI * 2);
        ctx.stroke();

        ctx.restore();
    }
    return atlas;
}

export function createScene(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false })!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    let atlas: HTMLCanvasElement | undefined;

    return function paint(
        geometry: ReturnType<typeof lensGeometry>,
        scale: number,
        progress: number,
        bloom: number,
        charge: number,
        orbOffsetX = 0,
        orbOffsetY = 0,
        driftTimeSeconds = 0,
    ) {
        const { width, height } = canvas;
        const { cx, cy, radius, span } = geometry;
        const titleSize = Math.min(width * 0.102, Math.max(24 * scale, span * 0.098));
        const introBaseline = height * 0.455;
        const revealBaseline = height * 0.485;

        ctx.fillStyle = "#f9f7f5";
        ctx.fillRect(0, 0, width, height);

        const washRadius = Math.max(width, height) * 0.52;
        const washCenterY = height * (0.48 - 0.10 * progress);
        const wash = ctx.createRadialGradient(
            cx,
            washCenterY,
            radius * 0.12,
            cx,
            washCenterY,
            washRadius,
        );
        wash.addColorStop(0, `rgba(147, 197, 253, ${(0.045 + 0.065 * progress).toFixed(3)})`);
        wash.addColorStop(0.45, `rgba(253, 186, 168, ${(0.035 + 0.045 * bloom).toFixed(3)})`);
        wash.addColorStop(1, "rgba(249, 247, 245, 0)");
        ctx.fillStyle = wash;
        ctx.fillRect(0, 0, width, height);

        const bubbleAmount = bloom * (0.28 + 0.72 * smooth(0.45, 0.96, progress));
        if (bubbleAmount > 0.004) {
            const cell = Math.ceil(span * 0.15) + 4;
            if (atlas?.width !== cell * 8) atlas = makeBubbleAtlas(cell);
            for (const [index, bubble] of bubbles.entries()) {
                const easeProgress = smooth(bubble.delay, 0.58 + bubble.delay, bubbleAmount);
                if (!easeProgress) continue;
                const bobX = Math.cos(driftTimeSeconds * 0.9 + bubble.driftPhase) * bubble.driftAmp * span * easeProgress;
                const bobY = Math.sin(driftTimeSeconds * 1.15 + bubble.driftPhase) * bubble.driftAmp * span * easeProgress;
                const bubbleRadius = span * bubble.radius * easeProgress;
                const bubbleX = cx + bubble.spreadX * span * easeProgress + bobX;
                const bubbleY = height * (0.37 - bubble.rise * 0.85 * easeProgress) + bobY;
                ctx.save();
                ctx.globalAlpha = Math.min(1, easeProgress * 1.15) * (0.35 + 0.65 * bubbleAmount);
                ctx.drawImage(
                    atlas,
                    (index % 8) * cell,
                    Math.floor(index / 8) * cell,
                    cell,
                    cell,
                    bubbleX - bubbleRadius,
                    bubbleY - bubbleRadius,
                    2 * bubbleRadius,
                    2 * bubbleRadius,
                );
                ctx.restore();
            }
        }

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `560 ${titleSize}px system-ui, -apple-system, sans-serif`;
        ctx.letterSpacing = `${-titleSize * 0.035}px`;
        ctx.fillStyle = "#1c1c20";
        ctx.globalAlpha = 1 - smooth(0.02, 0.25, progress);
        ctx.fillText("Một tia sáng mới", cx, introBaseline - titleSize * 0.58);
        ctx.fillStyle = "#494952";
        ctx.fillText("đang dần thành hình.", cx, introBaseline + titleSize * 0.58);

        ctx.globalAlpha = smooth(0.14, 0.42, progress);
        ctx.fillStyle = "#18181c";
        ctx.font = `600 ${titleSize * 1.12}px system-ui, -apple-system, sans-serif`;
        ctx.fillText("Xin chào Velun.", cx, revealBaseline);

        ctx.globalAlpha = smooth(0.70, 0.98, progress);
        const bodySize = Math.max(scale * 15, titleSize * 0.44);
        ctx.font = `420 ${bodySize}px system-ui, -apple-system, sans-serif`;
        ctx.letterSpacing = `${-bodySize * 0.014}px`;
        ctx.fillStyle = "#4b4b55";
        ctx.fillText("Studio độc lập", cx, revealBaseline + titleSize * 0.72 + bodySize * 0.72);
        ctx.fillText("kiến tạo cùng ánh sáng.", cx, revealBaseline + titleSize * 0.72 + bodySize * 2.04);
        ctx.globalAlpha = 1;

        if (charge <= 0.002) return;
        const arcCenterX = cx + orbOffsetX;
        const arcCenterY = cy + orbOffsetY;
        const arcLift = smooth(0, 0.42, progress);
        const crescentOriginY = arcCenterY - radius * (0.64 - 0.44 * arcLift);
        const crescentRadius = radius * (0.56 + 0.06 * arcLift);
        const blurPx = Math.max(10, Math.round(radius * 0.11));
        const arcStart = Math.PI * 0.13;
        const arcEnd = Math.PI * 0.87;

        ctx.save();
        ctx.beginPath();
        ctx.arc(arcCenterX, arcCenterY, Math.max(0, radius - 1), 0, Math.PI * 2);
        ctx.clip();
        ctx.globalAlpha = charge;
        ctx.lineCap = "round";
        ctx.filter = `blur(${blurPx}px)`;

        const haloGrad = ctx.createLinearGradient(
            arcCenterX - crescentRadius,
            crescentOriginY,
            arcCenterX + crescentRadius,
            crescentOriginY,
        );
        haloGrad.addColorStop(0, "rgba(56, 189, 248, 0)");
        haloGrad.addColorStop(0.18, "rgba(56, 189, 248, 0.78)");
        haloGrad.addColorStop(0.5, "rgba(29, 78, 255, 0.95)");
        haloGrad.addColorStop(0.82, "rgba(56, 189, 248, 0.78)");
        haloGrad.addColorStop(1, "rgba(56, 189, 248, 0)");

        ctx.strokeStyle = haloGrad;
        ctx.lineWidth = radius * 0.22;
        ctx.beginPath();
        ctx.arc(arcCenterX, crescentOriginY, crescentRadius, arcStart, arcEnd);
        ctx.stroke();

        const coreGrad = ctx.createLinearGradient(
            arcCenterX - crescentRadius * 0.85,
            crescentOriginY,
            arcCenterX + crescentRadius * 0.85,
            crescentOriginY,
        );
        coreGrad.addColorStop(0, "rgba(37, 99, 235, 0)");
        coreGrad.addColorStop(0.24, "rgba(59, 130, 246, 0.88)");
        coreGrad.addColorStop(0.5, "rgba(28, 66, 255, 0.98)");
        coreGrad.addColorStop(0.76, "rgba(59, 130, 246, 0.88)");
        coreGrad.addColorStop(1, "rgba(37, 99, 235, 0)");

        ctx.strokeStyle = coreGrad;
        ctx.lineWidth = radius * 0.11;
        ctx.beginPath();
        ctx.arc(arcCenterX, crescentOriginY, crescentRadius, arcStart + 0.08, arcEnd - 0.08);
        ctx.stroke();

        ctx.restore();
    };
}
