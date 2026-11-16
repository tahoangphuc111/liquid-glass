const JANK_WINDOW_MS = 1000;
const JANK_THRESHOLD = 3;
const jankTimestamps = new Float64Array(8);

let jankHead = 0;
let jankCount = 0;
let idleTimer: number | null = null;
let loafObserver: PerformanceObserver | null = null;
let onTierChange: ((tier: number, prevTier: number) => void) | null = null;

export let qualityTier = 0;
export let isGlassDowngraded = false;
export let qualityUpgrades = 0;
export let qualityDowngrades = 0;

export function setTierChangeCallback(
    callback: ((tier: number, prevTier: number) => void) | null,
): void {
    onTierChange = callback;
}

export function scheduleQualityRecovery(): void {
    if (isGlassDowngraded) return;
    if (typeof requestIdleCallback !== "function") return;
    if (idleTimer !== null) {
        if (typeof cancelIdleCallback === "function") {
            cancelIdleCallback(idleTimer);
        }
        idleTimer = null;
    }
    idleTimer = requestIdleCallback(
        (deadline) => {
            idleTimer = null;
            if (isGlassDowngraded) return;
            if (deadline.timeRemaining() > 40 && !deadline.didTimeout) {
                if (qualityTier > 0) {
                    applyQualityTier(0);
                }
            } else {
                scheduleQualityRecovery();
            }
        },
        { timeout: 3000 },
    );
}

export function applyQualityTier(tier: number): void {
    if (qualityTier === tier) return;
    const prevTier = qualityTier;
    if (tier < qualityTier) {
        qualityUpgrades++;
    } else {
        qualityDowngrades++;
    }
    qualityTier = tier;
    onTierChange?.(tier, prevTier);
}

export function recordJankFrame(timestamp: number): void {
    jankTimestamps[jankHead] = timestamp;
    jankHead = (jankHead + 1) & 7;
    if (jankCount < 8) jankCount++;

    let recent = 0;
    for (let i = 0; i < jankCount; i++) {
        const diff = timestamp - jankTimestamps[i];
        if (diff >= 0 && diff <= JANK_WINDOW_MS) {
            recent++;
        }
    }

    if (recent >= JANK_THRESHOLD && qualityTier < 2) {
        applyQualityTier(qualityTier + 1);
        scheduleQualityRecovery();
    }
}

export function downgradeLiquidGlass(): void {
    isGlassDowngraded = true;
    disconnectLoafTelemetry();
}

export function initLoafTelemetry(): void {
    if (loafObserver || typeof PerformanceObserver !== "function") return;
    try {
        if (PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame")) {
            loafObserver = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    const loaf = entry as PerformanceEntry & { blockingDuration?: number };
                    if (loaf.duration > 50 && (loaf.blockingDuration ?? 0) > 0) {
                        recordJankFrame(loaf.startTime + loaf.duration);
                    }
                }
            });
            loafObserver.observe({ type: "long-animation-frame", buffered: false });
        }
    } catch {
    }
}

export function disconnectLoafTelemetry(): void {
    if (loafObserver) {
        loafObserver.disconnect();
        loafObserver = null;
    }
    if (idleTimer !== null && typeof cancelIdleCallback === "function") {
        cancelIdleCallback(idleTimer);
        idleTimer = null;
    }
}

export function resetTelemetryForTesting(): void {
    jankTimestamps.fill(0);
    jankHead = 0;
    jankCount = 0;
    qualityTier = 0;
    isGlassDowngraded = false;
    qualityUpgrades = 0;
    qualityDowngrades = 0;
    disconnectLoafTelemetry();
}
