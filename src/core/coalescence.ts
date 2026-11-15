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

let nextParticipantOrder = 1;

interface InternalNodeState {
    readonly order: number;
    readonly participant: CoalescenceParticipant;
    left: number;
    top: number;
    width: number;
    height: number;
    radius: number;
    bezel: number;
    lastPeerCount: number;
}

const participantNodes = new Map<HTMLElement, InternalNodeState>();
let lastWaveClockMs = 0;
let accumulatedWavePhase = 0;

function advanceWavePhase(motionImpulse: number): number {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const elapsedSec = lastWaveClockMs > 0 ? Math.min(0.05, Math.max(0, (now - lastWaveClockMs) * 0.001)) : 0.016;
    lastWaveClockMs = now;
    accumulatedWavePhase = (accumulatedWavePhase + elapsedSec * (3.2 + motionImpulse * 0.08)) % (Math.PI * 2);
    return accumulatedWavePhase;
}

function measureRectGap(
    selfLeft: number,
    selfTop: number,
    selfWidth: number,
    selfHeight: number,
    peerLeft: number,
    peerTop: number,
    peerWidth: number,
    peerHeight: number,
): number {
    const gapHorizontal = Math.max(0, peerLeft - (selfLeft + selfWidth), selfLeft - (peerLeft + peerWidth));
    const gapVertical = Math.max(0, peerTop - (selfTop + selfHeight), selfTop - (peerTop + peerHeight));
    return Math.hypot(gapHorizontal, gapVertical);
}

export function registerCoalescenceParticipant(participant: CoalescenceParticipant): () => void {
    const existing = participantNodes.get(participant.element);
    if (!existing) {
        participantNodes.set(participant.element, {
            order: nextParticipantOrder++,
            participant,
            left: 0,
            top: 0,
            width: 0,
            height: 0,
            radius: 18,
            bezel: 14,
            lastPeerCount: 0,
        });
    }

    return () => {
        const node = participantNodes.get(participant.element);
        if (!node) return;
        participantNodes.delete(participant.element);
        if (node.lastPeerCount > 0) {
            for (const other of participantNodes.values()) {
                other.participant.notifyPeerUpdate();
            }
        }
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
    node.left = left;
    node.top = top;
    node.width = width;
    node.height = height;
    node.radius = radius;
    node.bezel = bezel;

    if (!notifyPeers || participantNodes.size < 2) return;

    const moved =
        Math.abs(left - prevLeft) > 0.25 ||
        Math.abs(top - prevTop) > 0.25 ||
        Math.abs(width - prevWidth) > 0.5 ||
        Math.abs(height - prevHeight) > 0.5;
    if (!moved && motionImpulse <= 0) return;

    advanceWavePhase(motionImpulse);

    for (const candidate of participantNodes.values()) {
        if (candidate.participant.element === element) continue;
        if (
            element.contains(candidate.participant.element) ||
            candidate.participant.element.contains(element)
        ) {
            continue;
        }
        if (candidate.width < 2 || candidate.height < 2) {
            const bounds = candidate.participant.readBounds();
            if (!bounds) continue;
            candidate.left = bounds.left;
            candidate.top = bounds.top;
            candidate.width = bounds.width;
            candidate.height = bounds.height;
            candidate.radius = bounds.radius;
            candidate.bezel = bounds.bezel;
        }
        const prevGap = measureRectGap(
            prevLeft,
            prevTop,
            prevWidth,
            prevHeight,
            candidate.left,
            candidate.top,
            candidate.width,
            candidate.height,
        );
        const currGap = measureRectGap(
            left,
            top,
            width,
            height,
            candidate.left,
            candidate.top,
            candidate.width,
            candidate.height,
        );
        if (
            prevGap <= DEFAULT_INTERACTION_RANGE_PX + 8 ||
            currGap <= DEFAULT_INTERACTION_RANGE_PX + 8 ||
            candidate.lastPeerCount > 0
        ) {
            candidate.participant.notifyPeerUpdate();
        }
    }
}

export function collectCoalescenceSnapshot(element: HTMLElement): CoalescenceSnapshot {
    const selfNode = participantNodes.get(element);
    if (!selfNode || participantNodes.size < 2 || selfNode.width < 2 || selfNode.height < 2) {
        if (selfNode) selfNode.lastPeerCount = 0;
        return { peers: [], interferenceIntensity: 0, requiredBleedPx: 0 };
    }

    const selfCenterX = selfNode.left + selfNode.width * 0.5;
    const selfCenterY = selfNode.top + selfNode.height * 0.5;
    const candidates: Array<{ peer: CoalescencePeer; gap: number }> = [];
    let maxStrength = 0;

    for (const other of participantNodes.values()) {
        if (other === selfNode) continue;
        if (
            element.contains(other.participant.element) ||
            other.participant.element.contains(element)
        ) {
            continue;
        }
        if (other.width < 2 || other.height < 2) {
            const bounds = other.participant.readBounds();
            if (!bounds) continue;
            other.left = bounds.left;
            other.top = bounds.top;
            other.width = bounds.width;
            other.height = bounds.height;
            other.radius = bounds.radius;
            other.bezel = bounds.bezel;
        }
        const gap = measureRectGap(
            selfNode.left,
            selfNode.top,
            selfNode.width,
            selfNode.height,
            other.left,
            other.top,
            other.width,
            other.height,
        );
        if (gap > DEFAULT_INTERACTION_RANGE_PX) continue;

        const minBezel = Math.max(8, Math.min(selfNode.bezel, other.bezel));
        const mergeRadius = Math.min(40, Math.max(22, minBezel * 2.25));
        const otherCenterX = other.left + other.width * 0.5;
        const otherCenterY = other.top + other.height * 0.5;
        const strength = Math.max(0, 1 - gap / DEFAULT_INTERACTION_RANGE_PX);
        if (strength > maxStrength) maxStrength = strength;

        candidates.push({
            gap,
            peer: {
                relCenterX: otherCenterX - selfCenterX,
                relCenterY: otherCenterY - selfCenterY,
                halfWidth: other.width * 0.5,
                halfHeight: other.height * 0.5,
                radius: Math.min(other.radius, other.width * 0.5, other.height * 0.5),
                mergeRadius,
                wavePhase: accumulatedWavePhase + (other.order % 4) * 0.65,
                priorityWinsTie: selfNode.order < other.order,
            },
        });
    }

    candidates.sort((first, second) => first.gap - second.gap);
    const peers = candidates.slice(0, MAX_PEERS_PER_ELEMENT).map((entry) => entry.peer);
    selfNode.lastPeerCount = peers.length;
    const requiredBleedPx = peers.length > 0 ? Math.min(MAX_CANVAS_BLEED_PX, Math.ceil(12 + maxStrength * 12)) : 0;

    return {
        peers,
        interferenceIntensity: maxStrength,
        requiredBleedPx,
    };
}

export function resetCoalescenceForTesting(): void {
    participantNodes.clear();
    nextParticipantOrder = 1;
    lastWaveClockMs = 0;
    accumulatedWavePhase = 0;
}
