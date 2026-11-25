const JANK_WINDOW_MS = 1000;
const QUALITY_RECOVERY_MS = 3000;

let prevJankOlder = -Infinity;
let prevJankNewer = -Infinity;
let jankStreakCount = 0;
let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
let recoveryAt = 0;
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

function recoverQualityAfterQuietPeriod(): void {
    recoveryTimer = null;
    if (isGlassDowngraded || qualityTier <= 0) return;

    const remaining = recoveryAt - Date.now();
    if (remaining > 0) {
        recoveryTimer = setTimeout(recoverQualityAfterQuietPeriod, remaining);
        return;
    }
    jankStreakCount = 0;
    prevJankOlder = -Infinity;
    prevJankNewer = -Infinity;
    applyQualityTier(qualityTier - 1);
    scheduleQualityRecovery();
}

export function scheduleQualityRecovery(): void {
    if (isGlassDowngraded || qualityTier <= 0) return;
    recoveryAt = Date.now() + QUALITY_RECOVERY_MS;
    recoveryTimer ??= setTimeout(recoverQualityAfterQuietPeriod, QUALITY_RECOVERY_MS);
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
    if (isGlassDowngraded) return;
    if (qualityTier > 0) scheduleQualityRecovery();
    if (qualityTier >= 2) return;

    if (
        jankStreakCount >= 2 &&
        Math.max(timestamp, prevJankNewer) - Math.min(timestamp, prevJankOlder) <= JANK_WINDOW_MS
    ) {
        jankStreakCount = 0;
        prevJankOlder = -Infinity;
        prevJankNewer = -Infinity;
        applyQualityTier(qualityTier + 1);
        scheduleQualityRecovery();
        return;
    }

    if (jankStreakCount === 0) {
        prevJankNewer = timestamp;
        jankStreakCount = 1;
    } else {
        if (timestamp >= prevJankNewer) {
            prevJankOlder = prevJankNewer;
            prevJankNewer = timestamp;
        } else if (timestamp > prevJankOlder) {
            prevJankOlder = timestamp;
        }
        jankStreakCount = 2;
    }
}

export function downgradeLiquidGlass(): void {
    isGlassDowngraded = true;
    disconnectLoafTelemetry();
}

export function initLoafTelemetry(): void {
    if (recoveryTimer === null && qualityTier > 0 && !isGlassDowngraded) {
        scheduleQualityRecovery();
    }
    if (loafObserver || typeof PerformanceObserver !== "function") return;
    try {
        if (PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame")) {
            loafObserver = new PerformanceObserver((list) => {
                if (typeof document !== "undefined" && document.hidden) return;
                for (const entry of list.getEntries()) {
                    const loaf = entry as PerformanceEntry & { blockingDuration?: number };
                    if (loaf.duration > 50 && ((loaf.blockingDuration ?? 0) > 0 || loaf.duration > 85)) {
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
    if (recoveryTimer !== null) {
        clearTimeout(recoveryTimer);
        recoveryTimer = null;
    }
}

export function resetTelemetryForTesting(): void {
    prevJankOlder = -Infinity;
    prevJankNewer = -Infinity;
    jankStreakCount = 0;
    recoveryAt = 0;
    qualityTier = 0;
    isGlassDowngraded = false;
    qualityUpgrades = 0;
    qualityDowngrades = 0;
    disconnectLoafTelemetry();
}
