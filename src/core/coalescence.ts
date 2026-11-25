import { evaluateDerjaguinEffectiveRadius } from "./optics.js";

export interface CoalescencePeer {
    readonly relCenterX: number;
    readonly relCenterY: number;
    readonly halfWidth: number;
    readonly halfHeight: number;
    readonly radius: number;
    readonly mergeRadius: number;
    readonly wavePhase: number;
    readonly priorityWinsTie: boolean;
}

export interface CoalescenceSnapshot {
    readonly peers: readonly CoalescencePeer[];
    readonly interferenceIntensity: number;
    readonly requiredBleedPx: number;
}

export interface CoalescenceParticipant {
    readonly element: HTMLElement;
    readonly notifyPeerUpdate: () => void;
    readonly readBounds: () => {
        left: number;
        top: number;
        width: number;
        height: number;
        radius: number;
        bezel: number;
    } | null;
}

const MAX_PEERS_PER_ELEMENT = 4;
const DEFAULT_INTERACTION_RANGE_PX = 42;
const MAX_CANVAS_BLEED_PX = 24;
const GRID_MIN_PARTICIPANTS = 16;
const GRID_CELL_SIZE = 128;
const COARSE_GRID_CELL_SIZE = 1024;
const MAX_GRID_CELLS = 16;
const MAX_QUERY_CELLS = 64;
const EMPTY_PEERS: readonly CoalescencePeer[] = Object.freeze([]);
export const EMPTY_COALESCENCE_SNAPSHOT: CoalescenceSnapshot = Object.freeze({
    peers: EMPTY_PEERS,
    interferenceIntensity: 0,
    requiredBleedPx: 0,
});

function exceedsAxialRange(
    leftA: number,
    topA: number,
    widthA: number,
    heightA: number,
    leftB: number,
    topB: number,
    widthB: number,
    heightB: number,
    maxRange: number,
): boolean {
    return (
        leftB > leftA + widthA + maxRange ||
        leftA > leftB + widthB + maxRange ||
        topB > topA + heightA + maxRange ||
        topA > topB + heightB + maxRange
    );
}

function ensureNodeBounds(node: InternalNodeState): boolean {
    if (node.width >= 2 && node.height >= 2) return true;
    if (node.boundsProbed) return false;
    node.boundsProbed = true;
    const bounds = node.participant.readBounds();
    if (!bounds) return false;
    node.left = bounds.left;
    node.top = bounds.top;
    node.width = bounds.width;
    node.height = bounds.height;
    node.radius = bounds.radius;
    node.bezel = bounds.bezel;
    if (node.width < 2 || node.height < 2) return false;
    spatialGrid?.update(node);
    return true;
}

let nextParticipantOrder = 1;
let currentNotifyEpoch = 0;
let currentQueryEpoch = 0;

interface InternalNodeState {
    readonly order: number;
    readonly participant: CoalescenceParticipant;
    left: number;
    top: number;
    width: number;
    height: number;
    radius: number;
    bezel: number;
    boundsProbed: boolean;
    gridLevel: 0 | 1 | 2;
    gridFirstX: number;
    gridFirstY: number;
    gridLastX: number;
    gridLastY: number;
    selectedPeers: InternalNodeState[] | null;
    dependents: Set<InternalNodeState> | null;
    lastNotifyEpoch: number;
    lastQueryEpoch: number;
}

const participantNodes = new Map<HTMLElement, InternalNodeState>();

function fitsGridCoords(
    firstX: number,
    firstY: number,
    lastX: number,
    lastY: number,
    limit: number,
): boolean {
    return (
        Number.isSafeInteger(firstX) &&
        Number.isSafeInteger(firstY) &&
        Number.isSafeInteger(lastX) &&
        Number.isSafeInteger(lastY) &&
        (lastX - firstX + 1) * (lastY - firstY + 1) <= limit
    );
}

class SpatialHashLevel {
    private readonly rows = new Map<number, Map<number, Set<InternalNodeState>>>();

    constructor(
        readonly levelId: 1 | 2,
        readonly cellSize: number,
        readonly maxCells: number,
    ) {}

    insertCoords(
        node: InternalNodeState,
        firstX: number,
        firstY: number,
        lastX: number,
        lastY: number,
    ): void {
        if (
            node.gridLevel === this.levelId &&
            node.gridFirstX === firstX &&
            node.gridFirstY === firstY &&
            node.gridLastX === lastX &&
            node.gridLastY === lastY
        ) {
            return;
        }
        this.remove(node);
        node.gridLevel = this.levelId;
        node.gridFirstX = firstX;
        node.gridFirstY = firstY;
        node.gridLastX = lastX;
        node.gridLastY = lastY;
        for (let y = firstY; y <= lastY; y += 1) {
            let row = this.rows.get(y);
            if (!row) {
                row = new Map();
                this.rows.set(y, row);
            }
            for (let x = firstX; x <= lastX; x += 1) {
                let cell = row.get(x);
                if (!cell) {
                    cell = new Set();
                    row.set(x, cell);
                }
                cell.add(node);
            }
        }
    }

    remove(node: InternalNodeState): void {
        if (node.gridLevel !== this.levelId) return;
        const { gridFirstX, gridFirstY, gridLastX, gridLastY } = node;
        node.gridLevel = 0;
        for (let y = gridFirstY; y <= gridLastY; y += 1) {
            const row = this.rows.get(y);
            if (!row) continue;
            for (let x = gridFirstX; x <= gridLastX; x += 1) {
                const cell = row.get(x);
                if (!cell) continue;
                cell.delete(node);
                if (cell.size === 0) row.delete(x);
            }
            if (row.size === 0) this.rows.delete(y);
        }
    }

    enqueueCellsInBounds(
        firstX: number,
        firstY: number,
        lastX: number,
        lastY: number,
        coreMinX: number,
        coreMinY: number,
        coreMaxX: number,
        coreMaxY: number,
        maxCoreDistSq: number,
    ): void {
        const size = this.cellSize;
        for (let y = firstY; y <= lastY; y += 1) {
            const row = this.rows.get(y);
            if (!row) continue;
            const cellMinY = y * size;
            const cellMaxY = cellMinY + size;
            const dy =
                cellMaxY < coreMinY
                    ? coreMinY - cellMaxY
                    : cellMinY > coreMaxY
                      ? cellMinY - coreMaxY
                      : 0;
            const dySq = dy * dy;
            if (dySq > maxCoreDistSq) continue;
            for (let x = firstX; x <= lastX; x += 1) {
                const cell = row.get(x);
                if (!cell) continue;
                const cellMinX = x * size;
                const cellMaxX = cellMinX + size;
                const dx =
                    cellMaxX < coreMinX
                        ? coreMinX - cellMaxX
                        : cellMinX > coreMaxX
                          ? cellMinX - coreMaxX
                          : 0;
                const distSq = dx * dx + dySq;
                if (distSq <= maxCoreDistSq) {
                    pushAstarCell(cell, distSq);
                }
            }
        }
    }

    forEachInBounds(
        firstX: number,
        firstY: number,
        lastX: number,
        lastY: number,
        visit: (node: InternalNodeState) => void,
        coreMinX = -Infinity,
        coreMinY = -Infinity,
        coreMaxX = Infinity,
        coreMaxY = Infinity,
        maxCoreDistSq = Infinity,
    ): void {
        const pruneCorners = Number.isFinite(maxCoreDistSq);
        const size = this.cellSize;
        for (let y = firstY; y <= lastY; y += 1) {
            const row = this.rows.get(y);
            if (!row) continue;
            let dySq = 0;
            if (pruneCorners) {
                const cellMinY = y * size;
                const cellMaxY = cellMinY + size;
                const dy =
                    cellMaxY < coreMinY
                        ? coreMinY - cellMaxY
                        : cellMinY > coreMaxY
                          ? cellMinY - coreMaxY
                          : 0;
                dySq = dy * dy;
                if (dySq > maxCoreDistSq) continue;
            }
            for (let x = firstX; x <= lastX; x += 1) {
                const cell = row.get(x);
                if (!cell) continue;
                if (pruneCorners) {
                    const cellMinX = x * size;
                    const cellMaxX = cellMinX + size;
                    const dx =
                        cellMaxX < coreMinX
                            ? coreMinX - cellMaxX
                            : cellMinX > coreMaxX
                              ? cellMinX - coreMaxX
                              : 0;
                    if (dx * dx + dySq > maxCoreDistSq) continue;
                    for (const node of cell) {
                        visit(node);
                    }
                } else {
                    for (const node of cell) {
                        if (
                            x === (firstX > node.gridFirstX ? firstX : node.gridFirstX) &&
                            y === (firstY > node.gridFirstY ? firstY : node.gridFirstY)
                        ) {
                            visit(node);
                        }
                    }
                }
            }
        }
    }
}

const INITIAL_ASTAR_HEAP_CAPACITY = 96;
const astarHeapCells: Array<Set<InternalNodeState> | null> = new Array(INITIAL_ASTAR_HEAP_CAPACITY).fill(null);
let astarHeapDistSq = new Float64Array(INITIAL_ASTAR_HEAP_CAPACITY);
let astarHeapSize = 0;

let lastAstarExpandedCells = 0;
let lastAstarPrunedCells = 0;
let lastAstarEvaluatedNodes = 0;

export interface CoalescenceSearchStats {
    readonly expandedCells: number;
    readonly prunedCells: number;
    readonly evaluatedNodes: number;
}

export function getLastCoalescenceSearchStatsForTesting(): CoalescenceSearchStats {
    return {
        expandedCells: lastAstarExpandedCells,
        prunedCells: lastAstarPrunedCells,
        evaluatedNodes: lastAstarEvaluatedNodes,
    };
}

function pushAstarCell(cell: Set<InternalNodeState>, distSq: number): void {
    let idx = astarHeapSize;
    if (idx >= astarHeapDistSq.length) {
        const nextCapacity = astarHeapDistSq.length * 2;
        const nextDist = new Float64Array(nextCapacity);
        nextDist.set(astarHeapDistSq);
        astarHeapDistSq = nextDist;
        astarHeapCells.length = nextCapacity;
    }
    astarHeapSize = idx + 1;
    while (idx > 0) {
        const parent = (idx - 1) >> 1;
        const parentDist = astarHeapDistSq[parent]!;
        if (parentDist <= distSq) break;
        astarHeapDistSq[idx] = parentDist;
        astarHeapCells[idx] = astarHeapCells[parent]!;
        idx = parent;
    }
    astarHeapDistSq[idx] = distSq;
    astarHeapCells[idx] = cell;
}

function popAstarCell(): Set<InternalNodeState> {
    const topCell = astarHeapCells[0]!;
    const lastIdx = --astarHeapSize;
    if (lastIdx > 0) {
        const movedCell = astarHeapCells[lastIdx]!;
        const movedDist = astarHeapDistSq[lastIdx]!;
        let idx = 0;
        const half = lastIdx >> 1;
        while (idx < half) {
            let child = (idx << 1) + 1;
            const right = child + 1;
            if (right < lastIdx && astarHeapDistSq[right]! < astarHeapDistSq[child]!) {
                child = right;
            }
            if (movedDist <= astarHeapDistSq[child]!) break;
            astarHeapDistSq[idx] = astarHeapDistSq[child]!;
            astarHeapCells[idx] = astarHeapCells[child]!;
            idx = child;
        }
        astarHeapDistSq[idx] = movedDist;
        astarHeapCells[idx] = movedCell;
    }
    astarHeapCells[lastIdx] = null;
    return topCell;
}

function clearAstarHeap(): void {
    for (let idx = 0; idx < astarHeapSize; idx += 1) {
        astarHeapCells[idx] = null;
    }
    astarHeapSize = 0;
}

class CoalescenceGrid {
    private readonly fine = new SpatialHashLevel(1, GRID_CELL_SIZE, MAX_GRID_CELLS);
    private readonly coarse = new SpatialHashLevel(2, COARSE_GRID_CELL_SIZE, MAX_GRID_CELLS);
    private readonly oversized = new Set<InternalNodeState>();
    private readonly unread = new Set<InternalNodeState>();

    update(node: InternalNodeState): void {
        if (node.width < 2 || node.height < 2) {
            this.remove(node);
            if (!node.boundsProbed) {
                this.unread.add(node);
            }
            return;
        }
        const left = node.left;
        const top = node.top;
        const right = left + node.width;
        const bottom = top + node.height;

        const fineFirstX = Math.floor(left / GRID_CELL_SIZE);
        const fineFirstY = Math.floor(top / GRID_CELL_SIZE);
        const fineLastX = Math.floor(right / GRID_CELL_SIZE);
        const fineLastY = Math.floor(bottom / GRID_CELL_SIZE);
        if (fitsGridCoords(fineFirstX, fineFirstY, fineLastX, fineLastY, MAX_GRID_CELLS)) {
            if (node.gridLevel === 2) this.coarse.remove(node);
            this.fine.insertCoords(node, fineFirstX, fineFirstY, fineLastX, fineLastY);
            this.unread.delete(node);
            this.oversized.delete(node);
            return;
        }

        if (node.gridLevel === 1) this.fine.remove(node);
        const coarseFirstX = Math.floor(left / COARSE_GRID_CELL_SIZE);
        const coarseFirstY = Math.floor(top / COARSE_GRID_CELL_SIZE);
        const coarseLastX = Math.floor(right / COARSE_GRID_CELL_SIZE);
        const coarseLastY = Math.floor(bottom / COARSE_GRID_CELL_SIZE);
        if (fitsGridCoords(coarseFirstX, coarseFirstY, coarseLastX, coarseLastY, MAX_GRID_CELLS)) {
            this.coarse.insertCoords(node, coarseFirstX, coarseFirstY, coarseLastX, coarseLastY);
            this.unread.delete(node);
            this.oversized.delete(node);
            return;
        }

        this.remove(node);
        this.oversized.add(node);
    }

    remove(node: InternalNodeState): void {
        this.unread.delete(node);
        this.oversized.delete(node);
        if (node.gridLevel === 1) this.fine.remove(node);
        else if (node.gridLevel === 2) this.coarse.remove(node);
    }

    forEachInBounds(
        fineFirstX: number,
        fineFirstY: number,
        fineLastX: number,
        fineLastY: number,
        left: number,
        top: number,
        right: number,
        bottom: number,
        visit: (node: InternalNodeState) => void,
        coreMinX = -Infinity,
        coreMinY = -Infinity,
        coreMaxX = Infinity,
        coreMaxY = Infinity,
        maxCoreDistSq = Infinity,
    ): void {
        if (this.unread.size > 0) {
            for (const node of [...this.unread]) {
                this.unread.delete(node);
                ensureNodeBounds(node);
            }
        }

        for (const node of this.oversized) {
            visit(node);
        }
        this.coarse.forEachInBounds(
            Math.floor(left / COARSE_GRID_CELL_SIZE),
            Math.floor(top / COARSE_GRID_CELL_SIZE),
            Math.floor(right / COARSE_GRID_CELL_SIZE),
            Math.floor(bottom / COARSE_GRID_CELL_SIZE),
            visit,
            coreMinX,
            coreMinY,
            coreMaxX,
            coreMaxY,
            maxCoreDistSq,
        );
        this.fine.forEachInBounds(
            fineFirstX,
            fineFirstY,
            fineLastX,
            fineLastY,
            visit,
            coreMinX,
            coreMinY,
            coreMaxX,
            coreMaxY,
            maxCoreDistSq,
        );
    }

    /**
     * A* best-first branch-and-bound k-NN search over the 2-level spatial hash.
     * Each cell's priority key is its admissible lower-bound squared distance
     * from the query's rounded-rect inner core box, guaranteeing optimal early
     * termination as soon as the minimum cell bound exceeds the dynamic k-th cutoff.
     */
    visitBestFirstInBounds(
        fineFirstX: number,
        fineFirstY: number,
        fineLastX: number,
        fineLastY: number,
        left: number,
        top: number,
        right: number,
        bottom: number,
        coreMinX: number,
        coreMinY: number,
        coreMaxX: number,
        coreMaxY: number,
        initialMaxCoreDistSq: number,
        getCutoffCoreDistSq: () => number,
        visit: (node: InternalNodeState) => void,
    ): void {
        if (this.unread.size > 0) {
            for (const node of [...this.unread]) {
                this.unread.delete(node);
                ensureNodeBounds(node);
            }
        }

        const queryEpoch = ++currentQueryEpoch;
        lastAstarExpandedCells = 0;
        lastAstarPrunedCells = 0;
        lastAstarEvaluatedNodes = 0;

        for (const node of this.oversized) {
            if (node.lastQueryEpoch === queryEpoch) continue;
            node.lastQueryEpoch = queryEpoch;
            lastAstarEvaluatedNodes += 1;
            visit(node);
        }

        const currentBoundSq = Math.min(initialMaxCoreDistSq, getCutoffCoreDistSq());
        clearAstarHeap();
        try {
            this.coarse.enqueueCellsInBounds(
                Math.floor(left / COARSE_GRID_CELL_SIZE),
                Math.floor(top / COARSE_GRID_CELL_SIZE),
                Math.floor(right / COARSE_GRID_CELL_SIZE),
                Math.floor(bottom / COARSE_GRID_CELL_SIZE),
                coreMinX,
                coreMinY,
                coreMaxX,
                coreMaxY,
                currentBoundSq,
            );
            this.fine.enqueueCellsInBounds(
                fineFirstX,
                fineFirstY,
                fineLastX,
                fineLastY,
                coreMinX,
                coreMinY,
                coreMaxX,
                coreMaxY,
                currentBoundSq,
            );

            while (astarHeapSize > 0) {
                const cellDistSq = astarHeapDistSq[0]!;
                if (cellDistSq > getCutoffCoreDistSq()) {
                    lastAstarPrunedCells = astarHeapSize;
                    break;
                }
                const cell = popAstarCell();
                lastAstarExpandedCells += 1;
                for (const node of cell) {
                    if (node.lastQueryEpoch === queryEpoch) continue;
                    node.lastQueryEpoch = queryEpoch;
                    lastAstarEvaluatedNodes += 1;
                    visit(node);
                }
            }
        } finally {
            clearAstarHeap();
        }
    }
}

let spatialGrid: CoalescenceGrid | null = null;

function ensureSpatialGrid(): CoalescenceGrid {
    if (!spatialGrid) {
        spatialGrid = new CoalescenceGrid();
        for (const node of participantNodes.values()) spatialGrid.update(node);
    }
    return spatialGrid;
}

function visitCandidates(
    left: number,
    top: number,
    right: number,
    bottom: number,
    visit: (node: InternalNodeState) => void,
    coreMinX = -Infinity,
    coreMinY = -Infinity,
    coreMaxX = Infinity,
    coreMaxY = Infinity,
    maxCoreDistSq = Infinity,
): void {
    if (participantNodes.size < GRID_MIN_PARTICIPANTS) {
        for (const node of participantNodes.values()) visit(node);
        return;
    }
    const firstX = Math.floor(left / GRID_CELL_SIZE);
    const firstY = Math.floor(top / GRID_CELL_SIZE);
    const lastX = Math.floor(right / GRID_CELL_SIZE);
    const lastY = Math.floor(bottom / GRID_CELL_SIZE);
    if (!fitsGridCoords(firstX, firstY, lastX, lastY, MAX_QUERY_CELLS)) {
        for (const node of participantNodes.values()) visit(node);
        return;
    }
    ensureSpatialGrid().forEachInBounds(
        firstX,
        firstY,
        lastX,
        lastY,
        left,
        top,
        right,
        bottom,
        visit,
        coreMinX,
        coreMinY,
        coreMaxX,
        coreMaxY,
        maxCoreDistSq,
    );
}

function updateSelectedPeers(node: InternalNodeState, peers: InternalNodeState[] | null): void {
    if (node.selectedPeers) {
        for (const peer of node.selectedPeers) {
            if (peers?.includes(peer)) continue;
            peer.dependents?.delete(node);
            if (peer.dependents?.size === 0) peer.dependents = null;
        }
    }
    if (peers) {
        for (const peer of peers) {
            (peer.dependents ??= new Set()).add(node);
        }
    }
    node.selectedPeers = peers;
}

function releaseCoalescencePeers(node: InternalNodeState): void {
    updateSelectedPeers(node, null);
    const dependents = node.dependents;
    node.dependents = null;
    if (!dependents) return;
    for (const dependent of dependents) {
        if (dependent.selectedPeers) {
            const remaining = dependent.selectedPeers.filter((peer) => peer !== node);
            dependent.selectedPeers = remaining.length > 0 ? remaining : null;
        }
        dependent.participant.notifyPeerUpdate();
    }
}

export function clearCoalescenceGeometry(element: HTMLElement): void {
    const node = participantNodes.get(element);
    if (!node) return;
    node.boundsProbed = true;
    node.width = 0;
    node.height = 0;
    spatialGrid?.remove(node);
    releaseCoalescencePeers(node);
}

let lastWaveClockMs = 0;
let accumulatedWavePhase = 0;

function advanceWavePhase(motionImpulse: number): number {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const elapsedSec = lastWaveClockMs > 0 ? Math.min(0.05, Math.max(0, (now - lastWaveClockMs) * 0.001)) : 0.016;
    lastWaveClockMs = now;
    accumulatedWavePhase = (accumulatedWavePhase + elapsedSec * (3.2 + motionImpulse * 0.08)) % (Math.PI * 2);
    return accumulatedWavePhase;
}

function isWithinRoundedGap(
    selfLeft: number,
    selfTop: number,
    selfWidth: number,
    selfHeight: number,
    selfRadius: number,
    peerLeft: number,
    peerTop: number,
    peerWidth: number,
    peerHeight: number,
    peerRadius: number,
    maxGap: number,
): boolean {
    const selfHalfW = selfWidth * 0.5;
    const selfHalfH = selfHeight * 0.5;
    const peerHalfW = peerWidth * 0.5;
    const peerHalfH = peerHeight * 0.5;
    const safeSelfRadius = Math.max(0, Math.min(selfRadius, selfHalfW, selfHalfH));
    const safePeerRadius = Math.max(0, Math.min(peerRadius, peerHalfW, peerHalfH));

    const selfCenterX = selfLeft + selfHalfW;
    const selfCenterY = selfTop + selfHalfH;
    const peerCenterX = peerLeft + peerHalfW;
    const peerCenterY = peerTop + peerHalfH;

    const coreDeltaX = Math.max(
        0,
        Math.abs(peerCenterX - selfCenterX) - (selfHalfW - safeSelfRadius) - (peerHalfW - safePeerRadius),
    );
    const coreDeltaY = Math.max(
        0,
        Math.abs(peerCenterY - selfCenterY) - (selfHalfH - safeSelfRadius) - (peerHalfH - safePeerRadius),
    );
    const maxCoreDist = maxGap + safeSelfRadius + safePeerRadius;
    return coreDeltaX * coreDeltaX + coreDeltaY * coreDeltaY <= maxCoreDist * maxCoreDist;
}

export function registerCoalescenceParticipant(participant: CoalescenceParticipant): () => void {
    const node: InternalNodeState = {
        order: nextParticipantOrder++,
        participant,
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        radius: 18,
        bezel: 14,
        boundsProbed: false,
        gridLevel: 0,
        gridFirstX: 0,
        gridFirstY: 0,
        gridLastX: 0,
        gridLastY: 0,
        selectedPeers: null,
        dependents: null,
        lastNotifyEpoch: 0,
        lastQueryEpoch: 0,
    };
    if (!participantNodes.has(participant.element)) {
        participantNodes.set(participant.element, node);
        spatialGrid?.update(node);
    }

    return () => {
        if (participantNodes.get(participant.element) !== node) return;
        participantNodes.delete(participant.element);
        spatialGrid?.remove(node);
        if (participantNodes.size < GRID_MIN_PARTICIPANTS && spatialGrid !== null) {
            for (const remaining of participantNodes.values()) {
                remaining.gridLevel = 0;
            }
            spatialGrid = null;
        }
        releaseCoalescencePeers(node);
    };
}

export function syncCoalescenceGeometry(
    element: HTMLElement,
    left: number,
    top: number,
    width: number,
    height: number,
    radius: number,
    bezel: number,
    motionImpulse = 0,
    notifyPeers = true,
): void {
    const node = participantNodes.get(element);
    if (!node) return;

    const prevLeft = node.left;
    const prevTop = node.top;
    const prevWidth = node.width;
    const prevHeight = node.height;
    const prevRadius = node.radius;
    const opticalChanged = radius !== prevRadius || bezel !== node.bezel;
    const boundsChanged = left !== prevLeft || top !== prevTop || width !== prevWidth || height !== prevHeight;
    node.left = left;
    node.top = top;
    node.width = width;
    node.height = height;
    node.radius = radius;
    node.bezel = bezel;
    node.boundsProbed = true;
    if (boundsChanged) spatialGrid?.update(node);

    if (!notifyPeers || participantNodes.size < 2) return;

    const moved =
        Math.abs(left - prevLeft) > 0.25 ||
        Math.abs(top - prevTop) > 0.25 ||
        Math.abs(width - prevWidth) > 0.5 ||
        Math.abs(height - prevHeight) > 0.5;
    if (!moved && !opticalChanged && motionImpulse <= 0) return;

    advanceWavePhase(motionImpulse);

    const hasPrevBounds = prevWidth >= 2 && prevHeight >= 2;
    const unionLeft = hasPrevBounds ? Math.min(prevLeft, left) : left;
    const unionTop = hasPrevBounds ? Math.min(prevTop, top) : top;
    const unionRight = hasPrevBounds ? Math.max(prevLeft + prevWidth, left + width) : left + width;
    const unionBottom = hasPrevBounds ? Math.max(prevTop + prevHeight, top + height) : top + height;
    const notifyRange = DEFAULT_INTERACTION_RANGE_PX + 8;

    const epoch = ++currentNotifyEpoch;
    node.lastNotifyEpoch = epoch;
    const toNotify: InternalNodeState[] = [];
    if (node.dependents) {
        for (const dependent of node.dependents) {
            dependent.lastNotifyEpoch = epoch;
            toNotify.push(dependent);
        }
    }

    const unionWidth = unionRight - unionLeft;
    const unionHeight = unionBottom - unionTop;
    const inspectCandidate = (candidate: InternalNodeState): void => {
        if (candidate.lastNotifyEpoch === epoch || !ensureNodeBounds(candidate)) return;
        candidate.lastNotifyEpoch = epoch;
        if (exceedsAxialRange(
            unionLeft, unionTop, unionWidth, unionHeight,
            candidate.left, candidate.top, candidate.width, candidate.height, notifyRange,
        )) return;
        if (
            isWithinRoundedGap(
                left, top, width, height, radius,
                candidate.left, candidate.top, candidate.width, candidate.height, candidate.radius,
                notifyRange,
            ) ||
            (hasPrevBounds && isWithinRoundedGap(
                prevLeft, prevTop, prevWidth, prevHeight, prevRadius,
                candidate.left, candidate.top, candidate.width, candidate.height, candidate.radius,
                notifyRange,
            ))
        ) {
            if (!element.contains(candidate.participant.element) && !candidate.participant.element.contains(element)) {
                toNotify.push(candidate);
            }
        }
    };

    if (
        participantNodes.size >= GRID_MIN_PARTICIPANTS &&
        hasPrevBounds &&
        exceedsAxialRange(
            left, top, width, height, prevLeft, prevTop, prevWidth, prevHeight, notifyRange * 2,
        )
    ) {
        const oldLeft = prevLeft - notifyRange;
        const oldTop = prevTop - notifyRange;
        const oldRight = prevLeft + prevWidth + notifyRange;
        const oldBottom = prevTop + prevHeight + notifyRange;
        const newLeft = left - notifyRange;
        const newTop = top - notifyRange;
        const newRight = left + width + notifyRange;
        const newBottom = top + height + notifyRange;
        const oldFirstX = Math.floor(oldLeft / GRID_CELL_SIZE);
        const oldFirstY = Math.floor(oldTop / GRID_CELL_SIZE);
        const oldLastX = Math.floor(oldRight / GRID_CELL_SIZE);
        const oldLastY = Math.floor(oldBottom / GRID_CELL_SIZE);
        const newFirstX = Math.floor(newLeft / GRID_CELL_SIZE);
        const newFirstY = Math.floor(newTop / GRID_CELL_SIZE);
        const newLastX = Math.floor(newRight / GRID_CELL_SIZE);
        const newLastY = Math.floor(newBottom / GRID_CELL_SIZE);
        if (
            fitsGridCoords(oldFirstX, oldFirstY, oldLastX, oldLastY, MAX_QUERY_CELLS) &&
            fitsGridCoords(newFirstX, newFirstY, newLastX, newLastY, MAX_QUERY_CELLS)
        ) {
            const safePrevR = Math.max(0, Math.min(prevRadius, prevWidth * 0.5, prevHeight * 0.5));
            const oldBound = notifyRange + safePrevR;
            const safeNewR = Math.max(0, Math.min(radius, width * 0.5, height * 0.5));
            const newBound = notifyRange + safeNewR;
            const grid = ensureSpatialGrid();
            grid.forEachInBounds(
                oldFirstX, oldFirstY, oldLastX, oldLastY,
                oldLeft, oldTop, oldRight, oldBottom, inspectCandidate,
                prevLeft + safePrevR, prevTop + safePrevR,
                prevLeft + prevWidth - safePrevR, prevTop + prevHeight - safePrevR,
                oldBound * oldBound * (1 + 1e-12),
            );
            grid.forEachInBounds(
                newFirstX, newFirstY, newLastX, newLastY,
                newLeft, newTop, newRight, newBottom, inspectCandidate,
                left + safeNewR, top + safeNewR,
                left + width - safeNewR, top + height - safeNewR,
                newBound * newBound * (1 + 1e-12),
            );
        } else {
            for (const candidate of participantNodes.values()) inspectCandidate(candidate);
        }
    } else {
        visitCandidates(
            unionLeft - notifyRange, unionTop - notifyRange, unionRight + notifyRange, unionBottom + notifyRange,
            inspectCandidate,
            unionLeft, unionTop, unionRight, unionBottom,
            notifyRange * notifyRange * (1 + 1e-12),
        );
    }

    for (let idx = 0; idx < toNotify.length; idx += 1) {
        toNotify[idx]!.participant.notifyPeerUpdate();
    }
}

const scratchSelectedPeers: Array<InternalNodeState | null> = [null, null, null, null];
const scratchSelectedGaps = new Float64Array(MAX_PEERS_PER_ELEMENT);

export function collectCoalescenceSnapshot(element: HTMLElement): CoalescenceSnapshot {
    const selfNode = participantNodes.get(element);
    if (!selfNode || participantNodes.size < 2 || selfNode.width < 2 || selfNode.height < 2) {
        if (selfNode) updateSelectedPeers(selfNode, null);
        return EMPTY_COALESCENCE_SNAPSHOT;
    }

    const range = DEFAULT_INTERACTION_RANGE_PX;
    const selfLeft = selfNode.left;
    const selfTop = selfNode.top;
    const selfWidth = selfNode.width;
    const selfHeight = selfNode.height;
    const selfHalfW = selfWidth * 0.5;
    const selfHalfH = selfHeight * 0.5;
    const safeSelfRadius = Math.max(0, Math.min(selfNode.radius, selfHalfW, selfHalfH));
    const selfInnerHalfW = selfHalfW - safeSelfRadius;
    const selfInnerHalfH = selfHalfH - safeSelfRadius;
    const selfCenterX = selfLeft + selfHalfW;
    const selfCenterY = selfTop + selfHalfH;

    let selectedCount = 0;
    const inspectPeerCandidate = (other: InternalNodeState): void => {
        if (other === selfNode || !ensureNodeBounds(other)) return;
        if (exceedsAxialRange(
            selfLeft, selfTop, selfWidth, selfHeight,
            other.left, other.top, other.width, other.height, range,
        )) return;

        const peerHalfW = other.width * 0.5;
        const peerHalfH = other.height * 0.5;
        const safePeerRadius = Math.max(0, Math.min(other.radius, peerHalfW, peerHalfH));
        const coreDeltaX = Math.max(
            0,
            Math.abs(other.left + peerHalfW - selfCenterX) - selfInnerHalfW - (peerHalfW - safePeerRadius),
        );
        const coreDeltaY = Math.max(
            0,
            Math.abs(other.top + peerHalfH - selfCenterY) - selfInnerHalfH - (peerHalfH - safePeerRadius),
        );
        const radiusSum = safeSelfRadius + safePeerRadius;
        const cutoffGap =
            selectedCount === MAX_PEERS_PER_ELEMENT
                ? scratchSelectedGaps[MAX_PEERS_PER_ELEMENT - 1]!
                : range;
        const maxCoreDist = cutoffGap + radiusSum;
        const coreDistSq = coreDeltaX * coreDeltaX + coreDeltaY * coreDeltaY;
        if (coreDistSq > maxCoreDist * maxCoreDist * (1 + 1e-12)) return;
        const gap = coreDistSq <= radiusSum * radiusSum ? 0 : Math.sqrt(coreDistSq) - radiusSum;
        if (gap > range) return;

        let insertAt = selectedCount;
        while (insertAt > 0) {
            const previous = insertAt - 1;
            const previousGap = scratchSelectedGaps[previous]!;
            if (gap > previousGap || (gap === previousGap && other.order > scratchSelectedPeers[previous]!.order)) {
                break;
            }
            insertAt = previous;
        }
        if (insertAt === MAX_PEERS_PER_ELEMENT) return;
        if (element.contains(other.participant.element) || other.participant.element.contains(element)) return;

        const limit = Math.min(selectedCount, MAX_PEERS_PER_ELEMENT - 1);
        for (let index = limit; index > insertAt; index -= 1) {
            scratchSelectedPeers[index] = scratchSelectedPeers[index - 1]!;
            scratchSelectedGaps[index] = scratchSelectedGaps[index - 1]!;
        }
        scratchSelectedPeers[insertAt] = other;
        scratchSelectedGaps[insertAt] = gap;
        if (selectedCount < MAX_PEERS_PER_ELEMENT) selectedCount += 1;
    };

    try {
        const queryLeft = selfLeft - range;
        const queryTop = selfTop - range;
        const queryRight = selfLeft + selfWidth + range;
        const queryBottom = selfTop + selfHeight + range;
        const fineFirstX = Math.floor(queryLeft / GRID_CELL_SIZE);
        const fineFirstY = Math.floor(queryTop / GRID_CELL_SIZE);
        const fineLastX = Math.floor(queryRight / GRID_CELL_SIZE);
        const fineLastY = Math.floor(queryBottom / GRID_CELL_SIZE);

        if (
            participantNodes.size >= GRID_MIN_PARTICIPANTS &&
            fitsGridCoords(fineFirstX, fineFirstY, fineLastX, fineLastY, MAX_QUERY_CELLS)
        ) {
            const coreMinX = selfLeft + safeSelfRadius;
            const coreMinY = selfTop + safeSelfRadius;
            const coreMaxX = selfLeft + selfWidth - safeSelfRadius;
            const coreMaxY = selfTop + selfHeight - safeSelfRadius;
            const rangeCoreDist = range + safeSelfRadius;
            const rangeCoreDistSq = rangeCoreDist * rangeCoreDist * (1 + 1e-12);
            ensureSpatialGrid().visitBestFirstInBounds(
                fineFirstX,
                fineFirstY,
                fineLastX,
                fineLastY,
                queryLeft,
                queryTop,
                queryRight,
                queryBottom,
                coreMinX,
                coreMinY,
                coreMaxX,
                coreMaxY,
                rangeCoreDistSq,
                () => {
                    if (selectedCount < MAX_PEERS_PER_ELEMENT) return rangeCoreDistSq;
                    const bound = scratchSelectedGaps[MAX_PEERS_PER_ELEMENT - 1]! + safeSelfRadius;
                    return bound * bound * (1 + 1e-12);
                },
                inspectPeerCandidate,
            );
        } else {
            lastAstarExpandedCells = 0;
            lastAstarPrunedCells = 0;
            lastAstarEvaluatedNodes = 0;
            for (const other of participantNodes.values()) {
                lastAstarEvaluatedNodes += 1;
                inspectPeerCandidate(other);
            }
        }

        if (selectedCount === 0) {
            updateSelectedPeers(selfNode, null);
            return EMPTY_COALESCENCE_SNAPSHOT;
        }

        const prevSelected = selfNode.selectedPeers;
        let sameSelection = prevSelected !== null && prevSelected.length === selectedCount;
        if (sameSelection && prevSelected) {
            for (let idx = 0; idx < selectedCount; idx += 1) {
                if (prevSelected[idx] !== scratchSelectedPeers[idx]) {
                    sameSelection = false;
                    break;
                }
            }
        }
        const selected = sameSelection ? null : new Array<InternalNodeState>(selectedCount);
        const peers = new Array<CoalescencePeer>(selectedCount);
        for (let idx = 0; idx < selectedCount; idx += 1) {
            const other = scratchSelectedPeers[idx]!;
            if (selected) selected[idx] = other;
            const halfWidth = other.width * 0.5;
            const halfHeight = other.height * 0.5;
            const safeSelfBezel = Math.max(8, selfNode.bezel);
            const safePeerBezel = Math.max(8, other.bezel);
            const effectiveMeniscusRadius = evaluateDerjaguinEffectiveRadius(
                safeSelfBezel,
                safePeerBezel,
            );
            peers[idx] = {
                relCenterX: other.left + halfWidth - selfCenterX,
                relCenterY: other.top + halfHeight - selfCenterY,
                halfWidth,
                halfHeight,
                radius: Math.min(other.radius, halfWidth, halfHeight),
                mergeRadius: Math.min(48, Math.max(28, effectiveMeniscusRadius * 2.85)),
                wavePhase: accumulatedWavePhase + (other.order % 4) * 0.65,
                priorityWinsTie: selfNode.order < other.order,
            };
        }
        if (selected) {
            updateSelectedPeers(selfNode, selected);
        }

        const normalizedGap = Math.min(1, Math.max(0, scratchSelectedGaps[0]! / range));
        const quinticFalloff =
            normalizedGap * normalizedGap * normalizedGap * (normalizedGap * (normalizedGap * 6 - 15) + 10);
        const interferenceIntensity = 1 - quinticFalloff;
        return {
            peers,
            interferenceIntensity,
            requiredBleedPx: Math.min(MAX_CANVAS_BLEED_PX, Math.ceil(12 + interferenceIntensity * 12)),
        };
    } finally {
        scratchSelectedPeers.fill(null);
    }
}

export function resetCoalescenceForTesting(): void {
    participantNodes.clear();
    spatialGrid = null;
    scratchSelectedPeers.fill(null);
    clearAstarHeap();
    nextParticipantOrder = 1;
    currentNotifyEpoch = 0;
    currentQueryEpoch = 0;
    lastAstarExpandedCells = 0;
    lastAstarPrunedCells = 0;
    lastAstarEvaluatedNodes = 0;
    lastWaveClockMs = 0;
    accumulatedWavePhase = 0;
}
