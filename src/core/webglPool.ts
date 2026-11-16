export const DEFAULT_MAX_ACTIVE_WEBGL_CONTEXTS = 8;

export interface WebglPoolEntry {
    readonly token: symbol;
    isVisible: boolean;
    lastUsedOrder: number;
    evictToCss: () => void;
    restoreWebgl: () => void;
}

let maxActiveContexts = DEFAULT_MAX_ACTIVE_WEBGL_CONTEXTS;
let sequenceCounter = 0;

const activeEntries = new Map<symbol, WebglPoolEntry>();
const standbyEntries = new Map<symbol, WebglPoolEntry>();

export function setMaxActiveWebglContextsForTesting(limit: number | null): void {
    maxActiveContexts = limit === null ? DEFAULT_MAX_ACTIVE_WEBGL_CONTEXTS : Math.max(1, Math.floor(limit));
}

export function resetWebglPoolForTesting(): void {
    activeEntries.clear();
    standbyEntries.clear();
    maxActiveContexts = DEFAULT_MAX_ACTIVE_WEBGL_CONTEXTS;
    sequenceCounter = 0;
}

export function getWebglPoolStats(): {
    activeCount: number;
    standbyCount: number;
    maxActiveContexts: number;
} {
    return {
        activeCount: activeEntries.size,
        standbyCount: standbyEntries.size,
        maxActiveContexts,
    };
}

function findEvictionCandidate(allowEvictVisible: boolean): WebglPoolEntry | null {
    let offscreenCandidate: WebglPoolEntry | null = null;
    let visibleCandidate: WebglPoolEntry | null = null;

    for (const candidate of activeEntries.values()) {
        if (!candidate.isVisible) {
            if (!offscreenCandidate || candidate.lastUsedOrder < offscreenCandidate.lastUsedOrder) {
                offscreenCandidate = candidate;
            }
        } else if (allowEvictVisible) {
            if (!visibleCandidate || candidate.lastUsedOrder < visibleCandidate.lastUsedOrder) {
                visibleCandidate = candidate;
            }
        }
    }

    return offscreenCandidate ?? visibleCandidate;
}

function findBestStandbyCandidate(): WebglPoolEntry | null {
    let bestVisible: WebglPoolEntry | null = null;
    for (const candidate of standbyEntries.values()) {
        if (candidate.isVisible) {
            if (!bestVisible || candidate.lastUsedOrder > bestVisible.lastUsedOrder) {
                bestVisible = candidate;
            }
        }
    }
    return bestVisible;
}

function promoteStandbyIfPossible(): void {
    while (activeEntries.size < maxActiveContexts) {
        const candidate = findBestStandbyCandidate();
        if (!candidate) break;
        standbyEntries.delete(candidate.token);
        candidate.restoreWebgl();
        if (!activeEntries.has(candidate.token)) {
            break;
        }
    }
}

export function acquireWebglSlot(entry: WebglPoolEntry, allowEvictVisible = true): boolean {
    entry.lastUsedOrder = ++sequenceCounter;
    standbyEntries.delete(entry.token);

    if (activeEntries.has(entry.token)) {
        activeEntries.delete(entry.token);
        activeEntries.set(entry.token, entry);
        return true;
    }

    if (activeEntries.size < maxActiveContexts) {
        activeEntries.set(entry.token, entry);
        return true;
    }

    if (!entry.isVisible) {
        standbyEntries.set(entry.token, entry);
        return false;
    }

    const candidate = findEvictionCandidate(allowEvictVisible);
    if (!candidate) {
        standbyEntries.set(entry.token, entry);
        return false;
    }

    activeEntries.delete(candidate.token);
    standbyEntries.set(candidate.token, candidate);
    candidate.evictToCss();

    if (activeEntries.size < maxActiveContexts) {
        activeEntries.set(entry.token, entry);
        return true;
    }

    standbyEntries.set(entry.token, entry);
    return false;
}

export function updateWebglSlotVisibility(entry: WebglPoolEntry, isVisible: boolean): void {
    entry.isVisible = isVisible;
    entry.lastUsedOrder = ++sequenceCounter;

    if (isVisible) {
        if (standbyEntries.has(entry.token)) {
            if (activeEntries.size < maxActiveContexts || findEvictionCandidate(false) !== null) {
                standbyEntries.delete(entry.token);
                entry.restoreWebgl();
            }
        }
        return;
    }

    if (activeEntries.has(entry.token)) {
        const waitingVisible = findBestStandbyCandidate();
        if (waitingVisible) {
            activeEntries.delete(entry.token);
            standbyEntries.set(entry.token, entry);
            entry.evictToCss();
            standbyEntries.delete(waitingVisible.token);
            waitingVisible.restoreWebgl();
        }
    }
}

export function isWebglSlotOnStandby(entry: WebglPoolEntry): boolean {
    return standbyEntries.has(entry.token);
}

export function releaseWebglSlot(entry: WebglPoolEntry, removeStandby = true): void {
    const wasActive = activeEntries.delete(entry.token);
    if (removeStandby) {
        standbyEntries.delete(entry.token);
    }
    if (wasActive) {
        promoteStandbyIfPossible();
    }
}
