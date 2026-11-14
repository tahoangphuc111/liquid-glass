export interface SpringController {
    press(): void;
    release(bounce?: boolean): void;
    setReducedMotion(reduced: boolean): void;
    destroy(): void;
}

export interface SpringFrame {
    scaleX: number;
    scaleY: number;
    glow: number;
}

const PRESS_TARGET = -0.028;
const PRESS_STIFFNESS = 520;
const PRESS_GAMMA = 14;
const PRESS_OMEGA_D = 18;
const PRESS_INV_OMEGA_D = 1 / 18;
const RELEASE_STIFFNESS = 380;
const RELEASE_GAMMA = 6.75;
const RELEASE_OMEGA_D = Math.sqrt(RELEASE_STIFFNESS - RELEASE_GAMMA * RELEASE_GAMMA);
const RELEASE_INV_OMEGA_D = 1 / RELEASE_OMEGA_D;
const SETTLE_DISPLACEMENT = 0.0003;
const SETTLE_VELOCITY = 0.003;

export function stepDampedSpring(
    displacement: number,
    velocity: number,
    target: number,
    pressed: boolean,
    dtSeconds: number,
): { displacement: number; velocity: number; settled: boolean } {
    const stiffness = pressed ? PRESS_STIFFNESS : RELEASE_STIFFNESS;
    const gamma = pressed ? PRESS_GAMMA : RELEASE_GAMMA;
    const omegaD = pressed ? PRESS_OMEGA_D : RELEASE_OMEGA_D;
    const invOmegaD = pressed ? PRESS_INV_OMEGA_D : RELEASE_INV_OMEGA_D;
    const offset = displacement - target;
    const phase = omegaD * dtSeconds;
    const decay = Math.exp(-gamma * dtSeconds);
    const cosPhase = Math.cos(phase);
    const sinOverOmega = Math.sin(phase) * invOmegaD;
    const nextOffset =
        decay * (offset * (cosPhase + gamma * sinOverOmega) + velocity * sinOverOmega);
    const nextVelocity =
        decay * (velocity * (cosPhase - gamma * sinOverOmega) - stiffness * offset * sinOverOmega);
    const nextDisplacement = target + nextOffset;
    const settled =
        Math.abs(nextOffset) < SETTLE_DISPLACEMENT && Math.abs(nextVelocity) < SETTLE_VELOCITY;

    return settled
        ? { displacement: target, velocity: 0, settled: true }
        : { displacement: nextDisplacement, velocity: nextVelocity, settled: false };
}

export function createInteractiveSpring(
    onFrame: (frame: SpringFrame) => void,
    onRest: () => void,
): SpringController {
    let displacement = 0;
    let velocity = 0;
    let target = 0;
    let pressed = false;
    let reducedMotion = false;
    let destroyed = false;
    let rafId: number | null = null;
    let lastTime = 0;

    const emitCurrent = () => {
        const scaleX = reducedMotion ? 1 : 1 + displacement * 1.04;
        const scaleY = reducedMotion ? 1 : 1 + displacement * 0.92;
        const glow = Math.min(0.18, Math.abs(displacement) * 2.4 + (pressed ? 0.1 : 0));
        onFrame({ scaleX, scaleY, glow });
    };

    const stopLoop = () => {
        if (rafId !== null && typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(rafId);
        }
        rafId = null;
        lastTime = 0;
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
        emitCurrent();

        if (!next.settled && !reducedMotion) {
            rafId = requestAnimationFrame(tick);
        } else {
            lastTime = 0;
            if (!pressed && Math.abs(displacement) < SETTLE_DISPLACEMENT) {
                displacement = 0;
                velocity = 0;
                onRest();
            }
        }
    };

    const ensureRunning = () => {
        if (destroyed) return;
        if (reducedMotion || typeof requestAnimationFrame !== "function") {
            emitCurrent();
            if (!pressed) {
                displacement = 0;
                velocity = 0;
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
        setReducedMotion(reduced: boolean) {
            reducedMotion = reduced;
            if (reduced) {
                stopLoop();
                displacement = 0;
                velocity = 0;
                if (pressed) {
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
            onRest();
        },
    };
}
