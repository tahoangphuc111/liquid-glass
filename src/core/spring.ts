export interface SpringController {
    press(): void;
    release(bounce?: boolean): void;
    setTilt(horizontal: number, vertical: number): void;
    setDrag(offsetX: number, offsetY: number, immediate?: boolean): void;
    impulseDrag(velocityX: number, velocityY: number): void;
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

/**
 * Advances an analytical damped harmonic oscillator toward `target` by `dtSeconds`.
 */
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
    const safeDt = Number.isFinite(dtSeconds) && dtSeconds > 0 ? dtSeconds : 0.016;
    const {
        stiffness,
        gamma,
        settleDisplacement = SETTLE_DISPLACEMENT,
        settleVelocity = SETTLE_VELOCITY,
    } = params;
    const offset = value - target;
    const decay = Math.exp(-gamma * safeDt);
    const discriminant = stiffness - gamma * gamma;

    let nextOffset: number;
    let nextVelocity: number;

    if (discriminant > 1e-4) {
        const omegaD = Math.sqrt(discriminant);
        const invOmegaD = 1 / omegaD;
        const phase = omegaD * safeDt;
        const cosPhase = Math.cos(phase);
        const sinOverOmega = Math.sin(phase) * invOmegaD;
        nextOffset =
            decay * (offset * (cosPhase + gamma * sinOverOmega) + velocity * sinOverOmega);
        nextVelocity =
            decay *
            (velocity * (cosPhase - gamma * sinOverOmega) - stiffness * offset * sinOverOmega);
    } else {
        // Critically damped limit (omegaD -> 0) avoids division by zero when gamma^2 ~= stiffness.
        nextOffset = decay * (offset * (1 + gamma * safeDt) + velocity * safeDt);
        nextVelocity =
            decay *
            (velocity * (1 - gamma * safeDt) - gamma * gamma * offset * safeDt);
    }

    const nextValue = target + nextOffset;
    const settled =
        Math.abs(nextOffset) < settleDisplacement && Math.abs(nextVelocity) < settleVelocity;

    return settled
        ? { value: target, velocity: 0, settled: true }
        : { value: nextValue, velocity: nextVelocity, settled: false };
}

export function stepDampedSpring(
    displacement: number,
    velocity: number,
    target: number,
    pressed: boolean,
    dtSeconds: number,
): { displacement: number; velocity: number; settled: boolean } {
    const next = stepSpring(displacement, velocity, target, dtSeconds, {
        stiffness: pressed ? PRESS_STIFFNESS : RELEASE_STIFFNESS,
        gamma: pressed ? PRESS_GAMMA : RELEASE_GAMMA,
        settleDisplacement: SETTLE_DISPLACEMENT,
        settleVelocity: SETTLE_VELOCITY,
    });
    return { displacement: next.value, velocity: next.velocity, settled: next.settled };
}

export function createInteractiveSpring(
    onFrame: (frame: SpringFrame) => void,
    onRest: () => void,
): SpringController {
    let displacement = 0;
    let velocity = 0;
    let target = 0;
    let tiltHorizontal = 0;
    let tiltHorizontalVelocity = 0;
    let targetTiltHorizontal = 0;
    let tiltVertical = 0;
    let tiltVerticalVelocity = 0;
    let targetTiltVertical = 0;
    let dragX = 0;
    let dragVelocityX = 0;
    let targetDragX = 0;
    let dragY = 0;
    let dragVelocityY = 0;
    let targetDragY = 0;
    let pressed = false;
    let reducedMotion = false;
    let destroyed = false;
    let rafId: number | null = null;
    let lastTime = 0;

    const TILT_SPRING_PARAMS: DampedSpringParams = {
        stiffness: 260,
        gamma: 22,
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

    const emitCurrent = () => {
        const baseScaleX = reducedMotion ? 1 : 1 + displacement * 1.04;
        const baseScaleY = reducedMotion ? 1 : 1 + displacement * 0.92;
        let dropletFactorX = 1;
        let dropletFactorY = 1;
        let stretchMatrix: readonly [number, number, number, number] = [baseScaleX, 0, 0, baseScaleY];
        if (!reducedMotion) {
            const tensionX = dragX * 14 + dragVelocityX;
            const tensionY = dragY * 14 + dragVelocityY;
            const tensionMag = Math.hypot(tensionX, tensionY);
            if (tensionMag > 1) {
                const dirX = tensionX / tensionMag;
                const dirY = tensionY / tensionMag;
                const stretchMagnitude = Math.min(0.11, tensionMag / 1400);
                const elongate = Math.exp(stretchMagnitude);
                const compress = Math.exp(-stretchMagnitude);
                const cosSq = dirX * dirX;
                const sinSq = dirY * dirY;
                const cosSin = dirX * dirY;
                const axisBias = cosSq - sinSq;
                dropletFactorX = Math.exp(stretchMagnitude * axisBias);
                dropletFactorY = Math.exp(-stretchMagnitude * axisBias);
                const m11 = baseScaleX * (elongate * cosSq + compress * sinSq);
                const m12 = (elongate - compress) * cosSin;
                const m22 = baseScaleY * (elongate * sinSq + compress * cosSq);
                stretchMatrix = [m11, baseScaleX * m12, baseScaleY * m12, m22];
            }
        }
        const glow = Math.min(0.18, Math.abs(displacement) * 2.4 + (pressed ? 0.1 : 0));
        onFrame({
            scaleX: baseScaleX * dropletFactorX,
            scaleY: baseScaleY * dropletFactorY,
            glow,
            tiltHorizontal: reducedMotion ? 0 : tiltHorizontal,
            tiltVertical: reducedMotion ? 0 : tiltVertical,
            dragX,
            dragY,
            velocityX: reducedMotion ? 0 : dragVelocityX,
            velocityY: reducedMotion ? 0 : dragVelocityY,
            stretchMatrix,
        });
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
        Math.abs(displacement) < SETTLE_DISPLACEMENT &&
        Math.abs(tiltHorizontal) < 0.002 &&
        Math.abs(tiltVertical) < 0.002 &&
        Math.abs(dragX - targetDragX) < 0.08 &&
        Math.abs(dragY - targetDragY) < 0.08 &&
        Math.abs(dragVelocityX) < 0.4 &&
        Math.abs(dragVelocityY) < 0.4;

    const resetSettledState = () => {
        displacement = 0;
        velocity = 0;
        tiltHorizontal = 0;
        tiltHorizontalVelocity = 0;
        tiltVertical = 0;
        tiltVerticalVelocity = 0;
        dragX = targetDragX;
        dragVelocityX = 0;
        dragY = targetDragY;
        dragVelocityY = 0;
    };

    const tick = (now: number) => {
        rafId = null;
        if (destroyed) return;

        const dtMs = lastTime > 0 ? now - lastTime : 16;
        lastTime = now;
        const dtSeconds = Math.min(0.032, Math.max(0.001, dtMs * 0.001));

        const next = stepDampedSpring(displacement, velocity, target, pressed, dtSeconds);
        displacement = next.displacement;
        velocity = next.velocity;

        const tiltHStep = stepSpring(
            tiltHorizontal,
            tiltHorizontalVelocity,
            targetTiltHorizontal,
            dtSeconds,
            TILT_SPRING_PARAMS,
        );
        tiltHorizontal = tiltHStep.value;
        tiltHorizontalVelocity = tiltHStep.velocity;

        const tiltVStep = stepSpring(
            tiltVertical,
            tiltVerticalVelocity,
            targetTiltVertical,
            dtSeconds,
            TILT_SPRING_PARAMS,
        );
        tiltVertical = tiltVStep.value;
        tiltVerticalVelocity = tiltVStep.velocity;

        const dragSpringParams =
            targetDragX !== 0 || targetDragY !== 0 ? DRAG_ACTIVE_PARAMS : DRAG_RELEASE_PARAMS;
        const dragXStep = stepSpring(dragX, dragVelocityX, targetDragX, dtSeconds, dragSpringParams);
        dragX = dragXStep.value;
        dragVelocityX = dragXStep.velocity;

        const dragYStep = stepSpring(dragY, dragVelocityY, targetDragY, dtSeconds, dragSpringParams);
        dragY = dragYStep.value;
        dragVelocityY = dragYStep.velocity;

        emitCurrent();

        const allSettled =
            next.settled &&
            tiltHStep.settled &&
            tiltVStep.settled &&
            dragXStep.settled &&
            dragYStep.settled;
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
                displacement = 0;
                velocity = 0;
            }
            ensureRunning();
        },
        release(bounce = true) {
            if (destroyed) return;
            const wasPressed = pressed;
            pressed = false;
            target = 0;
            if (!reducedMotion && bounce && wasPressed) {
                if (displacement > -0.012) {
                    displacement = Math.min(displacement, -0.018);
                }
                velocity = Math.max(velocity, 0.34);
            }
            ensureRunning();
        },
        setTilt(horizontal: number, vertical: number) {
            if (destroyed) return;
            targetTiltHorizontal = Math.max(-1, Math.min(1, Number.isFinite(horizontal) ? horizontal : 0));
            targetTiltVertical = Math.max(-1, Math.min(1, Number.isFinite(vertical) ? vertical : 0));
            if (reducedMotion) {
                tiltHorizontal = 0;
                tiltHorizontalVelocity = 0;
                tiltVertical = 0;
                tiltVerticalVelocity = 0;
                return;
            }
            ensureRunning();
        },
        setDrag(offsetX: number, offsetY: number, immediate = false) {
            if (destroyed) return;
            targetDragX = Number.isFinite(offsetX) ? offsetX : 0;
            targetDragY = Number.isFinite(offsetY) ? offsetY : 0;
            if (reducedMotion || immediate) {
                dragX = targetDragX;
                dragY = targetDragY;
                dragVelocityX = 0;
                dragVelocityY = 0;
            }
            ensureRunning();
        },
        impulseDrag(impulseVelocityX: number, impulseVelocityY: number) {
            if (destroyed || reducedMotion) return;
            dragVelocityX += Number.isFinite(impulseVelocityX) ? impulseVelocityX : 0;
            dragVelocityY += Number.isFinite(impulseVelocityY) ? impulseVelocityY : 0;
            ensureRunning();
        },
        setReducedMotion(reduced: boolean) {
            reducedMotion = reduced;
            if (reduced) {
                stopLoop();
                resetSettledState();
                if (pressed || targetDragX !== 0 || targetDragY !== 0) {
                    emitCurrent();
                } else {
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
                // ignore
            }
        },
    };
}
