import { useSmallMemoryBudget } from "./renderBudget.js";

export const DEFAULT_MAX_ACTIVE_WEBGL_CONTEXTS = 8;

export interface WebglPoolEntry {
    readonly token: symbol;
    isVisible: boolean;
    lastUsedOrder: number;
    evictToCss: () => void;
    restoreWebgl: () => void;
}

function deviceContextLimit(): number {
    return useSmallMemoryBudget() ? 2 : DEFAULT_MAX_ACTIVE_WEBGL_CONTEXTS;
}

let maxActiveContextsOverride: number | null = null;
let sequenceCounter = 0;
let promotingStandby = false;

function resolveMaxActiveContexts(): number {
    return maxActiveContextsOverride ?? deviceContextLimit();
}

const activeEntries = new Map<symbol, WebglPoolEntry>();
const standbyEntries = new Map<symbol, WebglPoolEntry>();

export function setMaxActiveWebglContextsForTesting(limit: number | null): void {
    maxActiveContextsOverride = limit === null ? null : Math.max(1, Math.floor(limit));
}

export function resetWebglPoolForTesting(): void {
    activeEntries.clear();
    standbyEntries.clear();
    maxActiveContextsOverride = null;
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
        maxActiveContexts: resolveMaxActiveContexts(),
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

function findBestStandbyCandidate(excluded?: Set<symbol>): WebglPoolEntry | null {
    let bestVisible: WebglPoolEntry | null = null;
    for (const candidate of standbyEntries.values()) {
        if (candidate.isVisible && (!excluded || !excluded.has(candidate.token))) {
            if (!bestVisible || candidate.lastUsedOrder > bestVisible.lastUsedOrder) {
                bestVisible = candidate;
            }
        }
    }
    return bestVisible;
}

function promoteStandbyIfPossible(): void {
    if (promotingStandby) return;
    promotingStandby = true;
    let failedTokens: Set<symbol> | undefined;
    try {
        while (activeEntries.size < resolveMaxActiveContexts()) {
            const candidate = findBestStandbyCandidate(failedTokens);
            if (!candidate) break;
            standbyEntries.delete(candidate.token);
            candidate.restoreWebgl();
            if (standbyEntries.has(candidate.token) || !activeEntries.has(candidate.token)) {
                failedTokens ??= new Set();
                failedTokens.add(candidate.token);
            }
        }
    } finally {
        promotingStandby = false;
    }
}

export function acquireWebglSlot(entry: WebglPoolEntry, allowEvictVisible = !useSmallMemoryBudget()): boolean {
    const maxContexts = resolveMaxActiveContexts();
    entry.lastUsedOrder = ++sequenceCounter;
    standbyEntries.delete(entry.token);

    if (activeEntries.has(entry.token)) {
        activeEntries.delete(entry.token);
        activeEntries.set(entry.token, entry);
        return true;
    }

    if (activeEntries.size < maxContexts) {
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

    if (activeEntries.size < maxContexts) {
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
            if (activeEntries.size < resolveMaxActiveContexts() || findEvictionCandidate(false) !== null) {
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
            promoteStandbyIfPossible();
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
