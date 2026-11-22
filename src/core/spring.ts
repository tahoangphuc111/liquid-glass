export interface SpringController {
    press(): void;
    release(bounce?: boolean): void;
    setTilt(horizontal: number, vertical: number): void;
    setDrag(offsetX: number, offsetY: number, immediate?: boolean): void;
    impulseDrag(velocityX: number, velocityY: number): void;
    setFreeDragMode?(enabled: boolean): void;
    setReducedMotion(reduced: boolean): void;
    destroy(): void;
}

export interface SpringFrame {
    scaleX: number;
    scaleY: number;
    glow: number;
    tiltHorizontal: number;
    tiltVertical: number;
    dragX: number;
    dragY: number;
    velocityX: number;
    velocityY: number;
    stretchMatrix: readonly [number, number, number, number];
}

export interface DampedSpringParams {
    stiffness: number;
    gamma: number;
    settleDisplacement?: number;
    settleVelocity?: number;
}

export interface SpringStepResult {
    value: number;
    velocity: number;
    settled: boolean;
}

const PRESS_TARGET = -0.028;
const PRESS_STIFFNESS = 520;
const PRESS_GAMMA = 14;
const RELEASE_STIFFNESS = 380;
const RELEASE_GAMMA = 6.75;
const SETTLE_DISPLACEMENT = 0.0003;
const SETTLE_VELOCITY = 0.003;
const MAX_PROPAGATOR_DT_ENTRIES = 64;

const PRESS_SPRING_PARAMS: DampedSpringParams = {
    stiffness: PRESS_STIFFNESS,
    gamma: PRESS_GAMMA,
    settleDisplacement: SETTLE_DISPLACEMENT,
    settleVelocity: SETTLE_VELOCITY,
};

const RELEASE_SPRING_PARAMS: DampedSpringParams = {
    stiffness: RELEASE_STIFFNESS,
    gamma: RELEASE_GAMMA,
    settleDisplacement: SETTLE_DISPLACEMENT,
    settleVelocity: SETTLE_VELOCITY,
};

const TILT_SPRING_PARAMS: DampedSpringParams = {
    stiffness: 260,
    gamma: 16.2,
    settleDisplacement: 0.002,
    settleVelocity: 0.005,
};

const DRAG_ACTIVE_PARAMS: DampedSpringParams = {
    stiffness: 340,
    gamma: 19,
    settleDisplacement: 0.08,
    settleVelocity: 0.4,
};

const DRAG_RELEASE_PARAMS: DampedSpringParams = {
    stiffness: 260,
    gamma: 10.5,
    settleDisplacement: 0.08,
    settleVelocity: 0.4,
};

export interface SpringPropagator {
    c00: number;
    c01: number;
    c10: number;
    c11: number;
    settleDisplacement: number;
    settleVelocity: number;
}

const MAX_DT_BUCKET = 64;

interface PropagatorCacheEntry {
    stiffness: number;
    gamma: number;
    settleDisplacement: number;
    settleVelocity: number;
    byBucket: Array<SpringPropagator | undefined>;
    byDt: Map<number, SpringPropagator> | null;
}

const propagatorCache = new WeakMap<DampedSpringParams, PropagatorCacheEntry>();
const pressPropagatorTable = new Array<SpringPropagator | undefined>(MAX_DT_BUCKET + 1);
const releasePropagatorTable = new Array<SpringPropagator | undefined>(MAX_DT_BUCKET + 1);
const tiltPropagatorTable = new Array<SpringPropagator | undefined>(MAX_DT_BUCKET + 1);
const dragActivePropagatorTable = new Array<SpringPropagator | undefined>(MAX_DT_BUCKET + 1);
const dragReleasePropagatorTable = new Array<SpringPropagator | undefined>(MAX_DT_BUCKET + 1);

function resolveQuantizedDtBucket(dtMs: number): number {
    const safeMs = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 16;
    return Math.max(2, Math.min(MAX_DT_BUCKET, Math.round(safeMs * 2)));
}

function getBucketPropagator(
    bucket: number,
    table: Array<SpringPropagator | undefined>,
    params: DampedSpringParams,
): SpringPropagator {
    let prop = table[bucket];
    if (!prop) {
        prop = buildSpringPropagator(bucket * 0.0005, params);
        table[bucket] = prop;
    }
    return prop;
}

export function quantizeSpringDtSeconds(dtMs: number): number {
    return resolveQuantizedDtBucket(dtMs) * 0.0005;
}

export function evaluateSpringEnergy(
    displacement: number,
    velocity: number,
    stiffness: number,
): number {
    if (!Number.isFinite(displacement) || !Number.isFinite(velocity) || !Number.isFinite(stiffness)) {
        return 0;
    }
    const safeStiffness = Math.max(0, stiffness);
    return 0.5 * safeStiffness * displacement * displacement + 0.5 * velocity * velocity;
}

export function predictMomentumOffset(
    position: number,
    velocity: number,
    decelerationRate = 6.5,
): number {
    if (!Number.isFinite(position)) return 0;
    if (!Number.isFinite(velocity)) return position;
    const safeRate = Number.isFinite(decelerationRate) ? Math.max(0.5, decelerationRate) : 6.5;
    return position + velocity / safeRate;
}

export function buildSpringPropagator(safeDt: number, params: DampedSpringParams): SpringPropagator {
    const {
        stiffness: rawStiffness,
        gamma: rawGamma,
        settleDisplacement = SETTLE_DISPLACEMENT,
        settleVelocity = SETTLE_VELOCITY,
    } = params;
    const stiffness = Number.isFinite(rawStiffness) ? Math.max(0, rawStiffness) : 0;
    const gamma = Number.isFinite(rawGamma) ? Math.max(0, rawGamma) : 0;
    const dt = Number.isFinite(safeDt) && safeDt > 0 ? safeDt : 0.016;
    const discriminant = stiffness - gamma * gamma;
    const phaseSquared = discriminant * dt * dt;

    let decayC0: number;
    let decayDtC1: number;

    if (Math.abs(phaseSquared) <= 1e-2) {
        const decay = Math.exp(-gamma * dt);
        const c0 = 1 - (phaseSquared * (1 - (phaseSquared * (1 - (phaseSquared * (1 - phaseSquared / 56)) / 30)) / 12)) / 2;
        const c1 = 1 - (phaseSquared * (1 - (phaseSquared * (1 - (phaseSquared * (1 - phaseSquared / 72)) / 42)) / 20)) / 6;
        decayC0 = decay * c0;
        decayDtC1 = decay * dt * c1;
    } else if (phaseSquared > 0) {
        const decay = Math.exp(-gamma * dt);
        const omegaD = Math.sqrt(discriminant);
        const phase = omegaD * dt;
        decayC0 = decay * Math.cos(phase);
        decayDtC1 = (decay * Math.sin(phase)) / omegaD;
    } else {
        const lambda = Math.sqrt(-discriminant);
        const expFast = Math.exp((-gamma + lambda) * dt);
        const expSlow = Math.exp((-gamma - lambda) * dt);
        decayC0 = 0.5 * (expFast + expSlow);
        decayDtC1 = (0.5 * (expFast - expSlow)) / lambda;
    }

    return {
        c00: decayC0 + gamma * decayDtC1,
        c01: decayDtC1,
        c10: -stiffness * decayDtC1,
        c11: decayC0 - gamma * decayDtC1,
        settleDisplacement,
        settleVelocity,
    };
}

function getCachedSpringPropagator(dtSeconds: number, params: DampedSpringParams): SpringPropagator {
    const safeDt = Number.isFinite(dtSeconds) && dtSeconds > 0 ? dtSeconds : 0.016;
    const settleDisp = params.settleDisplacement ?? SETTLE_DISPLACEMENT;
    const settleVel = params.settleVelocity ?? SETTLE_VELOCITY;
    const bucket = Math.round(safeDt * 2000);
    const isBucketAligned =
        bucket >= 2 && bucket <= MAX_DT_BUCKET && Math.abs(bucket * 0.0005 - safeDt) <= 1e-12;
    let entry = propagatorCache.get(params);
    if (
        entry &&
        entry.stiffness === params.stiffness &&
        entry.gamma === params.gamma &&
        entry.settleDisplacement === settleDisp &&
        entry.settleVelocity === settleVel
    ) {
        if (isBucketAligned) {
            let prop = entry.byBucket[bucket];
            if (!prop) {
                prop = buildSpringPropagator(bucket * 0.0005, params);
                entry.byBucket[bucket] = prop;
            }
            return prop;
        }
        let byDt = entry.byDt;
        if (!byDt) {
            byDt = new Map<number, SpringPropagator>();
            entry.byDt = byDt;
        }
        const cached = byDt.get(safeDt);
        if (cached) return cached;
        const prop = buildSpringPropagator(safeDt, params);
        if (byDt.size >= MAX_PROPAGATOR_DT_ENTRIES) {
            byDt.delete(byDt.keys().next().value!);
        }
        byDt.set(safeDt, prop);
        return prop;
    }

    const byBucket = new Array<SpringPropagator | undefined>(MAX_DT_BUCKET + 1);
    let byDt: Map<number, SpringPropagator> | null = null;
    const prop = buildSpringPropagator(isBucketAligned ? bucket * 0.0005 : safeDt, params);
    if (isBucketAligned) {
        byBucket[bucket] = prop;
    } else {
        byDt = new Map<number, SpringPropagator>();
        byDt.set(safeDt, prop);
    }
    entry = {
        stiffness: params.stiffness,
        gamma: params.gamma,
        settleDisplacement: settleDisp,
        settleVelocity: settleVel,
        byBucket,
        byDt,
    };
    propagatorCache.set(params, entry);
    return prop;
}

function stepSpringWithPropagator(
    value: number,
    velocity: number,
    target: number,
    prop: SpringPropagator,
): SpringStepResult {
    if (!Number.isFinite(value) || !Number.isFinite(velocity) || !Number.isFinite(target)) {
        return { value: Number.isFinite(target) ? target : 0, velocity: 0, settled: true };
    }
    if (value === target && velocity === 0) {
        return { value: target, velocity: 0, settled: true };
    }
    const offset = value - target;
    const nextOffset = prop.c00 * offset + prop.c01 * velocity;
    const nextVelocity = prop.c10 * offset + prop.c11 * velocity;
    const settled =
        Math.abs(nextOffset) < prop.settleDisplacement &&
        Math.abs(nextVelocity) < prop.settleVelocity;

    return settled
        ? { value: target, velocity: 0, settled: true }
        : { value: target + nextOffset, velocity: nextVelocity, settled: false };
}

function stepSpringInPlace(
    state: Float64Array,
    slotIndex: number,
    target: number,
    prop: SpringPropagator,
): boolean {
    const valIdx = slotIndex * 2;
    const velIdx = valIdx + 1;
    const value = state[valIdx]!;
    const velocity = state[velIdx]!;
    if (value === target && velocity === 0) {
        return true;
    }
    if (!Number.isFinite(value) || !Number.isFinite(velocity) || !Number.isFinite(target)) {
        state[valIdx] = Number.isFinite(target) ? target : 0;
        state[velIdx] = 0;
        return true;
    }
    const offset = value - target;
    const nextOffset = prop.c00 * offset + prop.c01 * velocity;
    const nextVelocity = prop.c10 * offset + prop.c11 * velocity;
    if (
        Math.abs(nextOffset) < prop.settleDisplacement &&
        Math.abs(nextVelocity) < prop.settleVelocity
    ) {
        state[valIdx] = target;
        state[velIdx] = 0;
        return true;
    }
    state[valIdx] = target + nextOffset;
    state[velIdx] = nextVelocity;
    return false;
}

export function stepSpring(
    value: number,
    velocity: number,
    target: number,
    dtSeconds: number,
    params: DampedSpringParams,
): SpringStepResult {
    if (!Number.isFinite(value) || !Number.isFinite(velocity) || !Number.isFinite(target)) {
        return { value: Number.isFinite(target) ? target : 0, velocity: 0, settled: true };
    }
    return stepSpringWithPropagator(
        value,
        velocity,
        target,
        getCachedSpringPropagator(dtSeconds, params),
    );
}

export function stepDampedSpring(
    displacement: number,
    velocity: number,
    target: number,
    pressed: boolean,
    dtSeconds: number,
): { displacement: number; velocity: number; settled: boolean } {
    const next = stepSpring(
        displacement,
        velocity,
        target,
        dtSeconds,
        pressed ? PRESS_SPRING_PARAMS : RELEASE_SPRING_PARAMS,
    );
    return { displacement: next.value, velocity: next.velocity, settled: next.settled };
}

export function createInteractiveSpring(
    onFrame: (frame: SpringFrame) => void,
    onRest: () => void,
): SpringController {
    const springState = new Float64Array(10);
    let target = 0;
    let targetTiltHorizontal = 0;
    let targetTiltVertical = 0;
    let targetDragX = 0;
    let targetDragY = 0;
    let pressed = false;
    let freeDragMode = false;
    let reducedMotion = false;
    let destroyed = false;
    let rafId: number | null = null;
    let lastTime = 0;
    const scratchStretchMatrix: [number, number, number, number] = [1, 0, 0, 1];
    const scratchFrame: SpringFrame = {
        scaleX: 1,
        scaleY: 1,
        glow: 0,
        tiltHorizontal: 0,
        tiltVertical: 0,
        dragX: 0,
        dragY: 0,
        velocityX: 0,
        velocityY: 0,
        stretchMatrix: scratchStretchMatrix,
    };

    const emitCurrent = () => {
        const displacement = springState[0]!;
        const tiltHorizontal = springState[2]!;
        const tiltVertical = springState[4]!;
        const dragX = springState[6]!;
        const dragVelocityX = springState[7]!;
        const dragY = springState[8]!;
        const dragVelocityY = springState[9]!;

        const baseScaleX = reducedMotion ? 1 : 1 + displacement * 1.04;
        const baseScaleY = reducedMotion ? 1 : 1 + displacement * 0.92;
        let dropletFactorX = 1;
        let dropletFactorY = 1;
        scratchStretchMatrix[0] = baseScaleX;
        scratchStretchMatrix[1] = 0;
        scratchStretchMatrix[2] = 0;
        scratchStretchMatrix[3] = baseScaleY;
        if (!reducedMotion) {
            const tensionX = freeDragMode
                ? (targetDragX - dragX) * 8 + dragVelocityX
                : dragX * 14 + dragVelocityX;
            const tensionY = freeDragMode
                ? (targetDragY - dragY) * 8 + dragVelocityY
                : dragY * 14 + dragVelocityY;
            const tensionMagSq = tensionX * tensionX + tensionY * tensionY;
            if (tensionMagSq > 1) {
                const tensionMag = Math.sqrt(tensionMagSq);
                const invTensionMag = 1 / tensionMag;
                const dirX = tensionX * invTensionMag;
                const dirY = tensionY * invTensionMag;
                const stretchMagnitude = Math.min(0.048, tensionMag * (1 / 2400));
                const expStretch = Math.exp(stretchMagnitude);
                const invExpStretch = 1 / expStretch;
                const coshStretch = (expStretch + invExpStretch) * 0.5;
                const sinhStretch = (expStretch - invExpStretch) * 0.5;
                const cos2Theta = dirX * dirX - dirY * dirY;
                const sin2Theta = 2 * dirX * dirY;
                dropletFactorX = Math.exp(stretchMagnitude * cos2Theta);
                dropletFactorY = 1 / dropletFactorX;
                const s11 = coshStretch + sinhStretch * cos2Theta;
                const s12 = sinhStretch * sin2Theta;
                const s22 = coshStretch - sinhStretch * cos2Theta;
                scratchStretchMatrix[0] = baseScaleX * s11;
                scratchStretchMatrix[1] = baseScaleY * s12;
                scratchStretchMatrix[2] = baseScaleX * s12;
                scratchStretchMatrix[3] = baseScaleY * s22;
            }
        }
        const glow = Math.min(0.18, Math.abs(displacement) * 2.4 + (pressed ? 0.1 : 0));
        scratchFrame.scaleX = baseScaleX * dropletFactorX;
        scratchFrame.scaleY = baseScaleY * dropletFactorY;
        scratchFrame.glow = glow;
        scratchFrame.tiltHorizontal = reducedMotion ? 0 : tiltHorizontal;
        scratchFrame.tiltVertical = reducedMotion ? 0 : tiltVertical;
        scratchFrame.dragX = dragX;
        scratchFrame.dragY = dragY;
        scratchFrame.velocityX = reducedMotion ? 0 : dragVelocityX;
        scratchFrame.velocityY = reducedMotion ? 0 : dragVelocityY;
        onFrame(scratchFrame);
    };

    const stopLoop = () => {
        if (rafId !== null && typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(rafId);
        }
        rafId = null;
        lastTime = 0;
    };

    const isAtRest = () =>
        !pressed &&
        Math.abs(springState[0]!) < SETTLE_DISPLACEMENT &&
        Math.abs(springState[2]!) < 0.002 &&
        Math.abs(springState[4]!) < 0.002 &&
        (freeDragMode
            ? Math.abs(springState[6]! - targetDragX) < 0.08 &&
              Math.abs(springState[8]! - targetDragY) < 0.08
            : Math.abs(targetDragX) < 0.08 &&
              Math.abs(targetDragY) < 0.08 &&
              Math.abs(springState[6]!) < 0.08 &&
              Math.abs(springState[8]!) < 0.08) &&
        Math.abs(springState[7]!) < 0.4 &&
        Math.abs(springState[9]!) < 0.4;

    const resetSettledState = () => {
        springState[0] = 0;
        springState[1] = 0;
        springState[2] = 0;
        springState[3] = 0;
        springState[4] = 0;
        springState[5] = 0;
        springState[6] = targetDragX;
        springState[7] = 0;
        springState[8] = targetDragY;
        springState[9] = 0;
    };

    const tick = (now: number) => {
        rafId = null;
        if (destroyed) return;

        const dtMs = lastTime > 0 ? now - lastTime : 16;
        lastTime = now;
        const dtBucket = resolveQuantizedDtBucket(dtMs);

        let pressSettled = true;
        if (springState[0] !== target || springState[1] !== 0) {
            const pressProp = pressed
                ? getBucketPropagator(dtBucket, pressPropagatorTable, PRESS_SPRING_PARAMS)
                : getBucketPropagator(dtBucket, releasePropagatorTable, RELEASE_SPRING_PARAMS);
            pressSettled = stepSpringInPlace(springState, 0, target, pressProp);
        }

        let tiltHSettled = true;
        let tiltVSettled = true;
        if (
            springState[2] !== targetTiltHorizontal ||
            springState[3] !== 0 ||
            springState[4] !== targetTiltVertical ||
            springState[5] !== 0
        ) {
            const tiltProp = getBucketPropagator(dtBucket, tiltPropagatorTable, TILT_SPRING_PARAMS);
            tiltHSettled = stepSpringInPlace(springState, 1, targetTiltHorizontal, tiltProp);
            tiltVSettled = stepSpringInPlace(springState, 2, targetTiltVertical, tiltProp);
        }

        let dragXSettled = true;
        let dragYSettled = true;
        if (
            springState[6] !== targetDragX ||
            springState[7] !== 0 ||
            springState[8] !== targetDragY ||
            springState[9] !== 0
        ) {
            const useActiveDrag = freeDragMode
                ? pressed
                : targetDragX !== 0 || targetDragY !== 0;
            const dragProp = useActiveDrag
                ? getBucketPropagator(dtBucket, dragActivePropagatorTable, DRAG_ACTIVE_PARAMS)
                : getBucketPropagator(dtBucket, dragReleasePropagatorTable, DRAG_RELEASE_PARAMS);
            dragXSettled = stepSpringInPlace(springState, 3, targetDragX, dragProp);
            dragYSettled = stepSpringInPlace(springState, 4, targetDragY, dragProp);
        }

        emitCurrent();

        const allSettled =
            pressSettled && tiltHSettled && tiltVSettled && dragXSettled && dragYSettled;
        if (!allSettled && !reducedMotion) {
            rafId = requestAnimationFrame(tick);
        } else {
            lastTime = 0;
            if (isAtRest()) {
                resetSettledState();
                onRest();
            }
        }
    };

    const ensureRunning = () => {
        if (destroyed) return;
        if (reducedMotion || typeof requestAnimationFrame !== "function") {
            emitCurrent();
            if (isAtRest()) {
                resetSettledState();
                onRest();
            }
            return;
        }
        if (rafId === null) {
            lastTime = typeof performance !== "undefined" ? performance.now() : Date.now();
            rafId = requestAnimationFrame(tick);
        }
    };

    return {
        press() {
            if (destroyed) return;
            pressed = true;
            target = PRESS_TARGET;
            if (reducedMotion) {
                springState[0] = 0;
                springState[1] = 0;
            }
            ensureRunning();
        },
        release(bounce = true) {
            if (destroyed) return;
            const wasPressed = pressed;
            pressed = false;
            target = 0;
            if (!reducedMotion && bounce && wasPressed) {
                if (springState[0]! > -0.012) {
                    springState[0] = Math.min(springState[0]!, -0.018);
                }
                springState[1] = Math.max(springState[1]!, 0.34);
            }
            ensureRunning();
        },
        setTilt(horizontal: number, vertical: number) {
            if (destroyed) return;
            targetTiltHorizontal = Math.max(-1, Math.min(1, Number.isFinite(horizontal) ? horizontal : 0));
            targetTiltVertical = Math.max(-1, Math.min(1, Number.isFinite(vertical) ? vertical : 0));
            if (reducedMotion) {
                springState[2] = 0;
                springState[3] = 0;
                springState[4] = 0;
                springState[5] = 0;
                return;
            }
            ensureRunning();
        },
        setDrag(offsetX: number, offsetY: number, immediate = false) {
            if (destroyed) return;
            targetDragX = Number.isFinite(offsetX) ? offsetX : 0;
            targetDragY = Number.isFinite(offsetY) ? offsetY : 0;
            if (reducedMotion || immediate) {
                springState[6] = targetDragX;
                springState[8] = targetDragY;
                springState[7] = 0;
                springState[9] = 0;
            }
            ensureRunning();
        },
        impulseDrag(impulseVelocityX: number, impulseVelocityY: number) {
            if (destroyed || reducedMotion) return;
            springState[7] = springState[7]! + (Number.isFinite(impulseVelocityX) ? impulseVelocityX : 0);
            springState[9] = springState[9]! + (Number.isFinite(impulseVelocityY) ? impulseVelocityY : 0);
            ensureRunning();
        },
        setFreeDragMode(enabled: boolean) {
            freeDragMode = enabled;
        },
        setReducedMotion(reduced: boolean) {
            reducedMotion = reduced;
            if (reduced) {
                stopLoop();
                resetSettledState();
                if (pressed || targetDragX !== 0 || targetDragY !== 0) {
                    emitCurrent();
                }
                if (isAtRest()) {
                    onRest();
                }
            }
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            stopLoop();
            try {
                onRest();
            } catch {
            }
        },
    };
}
