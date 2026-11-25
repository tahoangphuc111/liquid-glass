import Lenis from "lenis";
import { createLiquidGlass, stepSpring } from "../../src/index.js";
import "../../src/styles.css";
import "./preview.css";
import { createScene } from "./scene";
import { lensGeometry, smooth } from "./geometry";

const stage = document.querySelector<HTMLElement>(".stage")!;
const canvas = document.querySelector<HTMLCanvasElement>("#art")!;
const lens = document.querySelector<HTMLButtonElement>(".lens")!;
const hint = document.querySelector<HTMLElement>(".hint")!;
const actions = document.querySelector<HTMLElement>(".actions")!;
const status = document.querySelector<HTMLElement>("[role=status]")!;
const dialog = document.querySelector("dialog")!;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const paintScene = createScene(canvas);
const glass = createLiquidGlass(lens, {
    engine: "webgl",
    theme: "light",
    surface: "convex_circle",
    pill: true,
    sceneCanvas: canvas,
    sceneElement: canvas,
    chromaticAberration: 1,
    abbeNumber: 12,
    ior: 1.85,
    adaptiveRefraction: false,
    thickness: 16,
    scaleRatio: 0.78,
    bezel: 36,
    blur: 0.35,
    sharpness: 0.9,
    highlight: 0.78,
    tintOpacity: 0.08,
    coalesce: false,
    interactive: false,
});
const scroll = new Lenis({
    autoRaf: true,
    autoResize: false,
    lerp: .12,
    smoothWheel: !reduced.matches,
    prevent: () => dialog.open,
});
let progress = 0;
let frame = 0;
let lastFrame = 0;
let bloom = 0;
let drag: {
    mode: "lift" | "orb";
    id: number;
    startX: number;
    startY: number;
    startProgress: number;
    offsetX: number;
    offsetY: number;
    lastMove: number;
    moved: boolean;
} | null = null;
let suppressClick = false;
const spring = { stiffness: 180, gamma: 7.5, settleDisplacement: .08, settleVelocity: .8 };
const rest = () => ({ value: 0, velocity: 0, settled: true });
let orbX = rest();
let orbY = rest();
let previousProgress = -1;
let previousBloom = -1;
let previousCharge = -1;
let previousOrbOffsetX = Number.NaN;
let previousOrbOffsetY = Number.NaN;
let previousBezel = -1;
let chargeLevel = 0;
let driftTimeSeconds = 0;
let idleDriftRemaining = 0;
let canvasScale = 1;

function resolveChargeTarget() {
    return (drag || progress > .005 ? 1 : 0) * (1 - smooth(.22, .52, progress));
}

function draw(resized = false) {
    const geometry = lensGeometry(canvas.width, canvas.height, progress);
    const { radius } = geometry;
    const cssDiameter = Math.max(44, (radius * 2) / canvasScale);
    const nextBezel = Math.max(18, Math.round(cssDiameter * 0.5 * 0.64));
    if (nextBezel !== previousBezel) {
        previousBezel = nextBezel;
        glass.update({ bezel: nextBezel });
    }
    const orbOffsetX = orbX.value * canvasScale;
    const orbOffsetY = orbY.value * canvasScale;
    const cx = geometry.cx + orbOffsetX;
    const cy = geometry.cy + orbOffsetY;
    const charge = reduced.matches ? resolveChargeTarget() : chargeLevel;
    const orbMovedDuringCharge =
        charge > 0.002 &&
        (Math.abs(orbOffsetX - previousOrbOffsetX) > 0.25 ||
            Math.abs(orbOffsetY - previousOrbOffsetY) > 0.25);
    const bubblesAnimating = bloom > 0.004 && idleDriftRemaining > 0 && !reduced.matches;
    const sceneChanged =
        resized ||
        progress !== previousProgress ||
        bloom !== previousBloom ||
        bubblesAnimating ||
        Math.abs(charge - previousCharge) > 0.002 ||
        orbMovedDuringCharge;
    if (resized || progress !== previousProgress) {
        lens.style.width = lens.style.height = `${cssDiameter}px`;
        hint.style.opacity = String(1 - smooth(0, .1, progress));
        const showActions = progress >= 0.96;
        actions.setAttribute("data-visible", String(showActions));
        actions.inert = !showActions;
        lens.setAttribute(
            "aria-label",
            showActions ? "Kéo viên kính hoặc nhấn để xem lại" : "Nâng lớp kính để khám phá Velun",
        );
    }
    if (sceneChanged) {
        paintScene(
            geometry,
            canvasScale,
            progress,
            bloom,
            charge,
            orbOffsetX,
            orbOffsetY,
            driftTimeSeconds,
        );
        previousProgress = progress;
        previousBloom = bloom;
        previousCharge = charge;
        previousOrbOffsetX = orbOffsetX;
        previousOrbOffsetY = orbOffsetY;
    }
    lens.style.left = `${cx / canvasScale}px`;
    lens.style.top = `${cy / canvasScale}px`;
    if (glass.engine === "webgl") {
        if (sceneChanged) glass.setSceneCanvas(canvas);
        else glass.refresh();
    }
}

function animate(now: number) {
    frame = 0;
    const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (drag?.mode !== "orb") {
        if (!orbX.settled) orbX = reduced.matches ? rest() : stepSpring(orbX.value, orbX.velocity, 0, dt, spring);
        if (!orbY.settled) orbY = reduced.matches ? rest() : stepSpring(orbY.value, orbY.velocity, 0, dt, spring);
    }
    if (progress >= 0.88) {
        if (bloom < 1) {
            bloom = reduced.matches ? 1 : Math.min(1, bloom + dt / 1.45);
            idleDriftRemaining = Math.max(idleDriftRemaining, 4.5);
        }
    } else if (bloom > 0) {
        bloom = reduced.matches ? 0 : Math.max(0, bloom - dt / 0.85);
    }
    if (bloom > 0.004 && idleDriftRemaining > 0 && !reduced.matches) {
        driftTimeSeconds += dt;
        idleDriftRemaining = Math.max(0, idleDriftRemaining - dt);
    }
    const chargeTarget = resolveChargeTarget();
    if (reduced.matches) {
        chargeLevel = chargeTarget;
    } else {
        const blend = 1 - Math.exp(-dt / 0.055);
        chargeLevel = chargeLevel + (chargeTarget - chargeLevel) * blend;
        if (Math.abs(chargeTarget - chargeLevel) < 0.002) {
            chargeLevel = chargeTarget;
        }
    }
    draw();
    if (
        (progress >= 0.88 && bloom < 1) ||
        (progress < 0.88 && bloom > 0) ||
        (bloom > 0.004 && idleDriftRemaining > 0 && !reduced.matches) ||
        (!reduced.matches && Math.abs(chargeTarget - chargeLevel) > 0.002) ||
        (!drag && (!orbX.settled || !orbY.settled))
    ) {
        frame = requestAnimationFrame(animate);
    }
}

function requestDraw() {
    if (frame) return;
    lastFrame = performance.now();
    frame = requestAnimationFrame(animate);
}

scroll.on("scroll", () => {
    const next = scroll.limit > 0 ? Math.min(1, Math.max(0, scroll.scroll / scroll.limit)) : 0;
    if (next === progress) return;
    progress = next;
    if (bloom > 0) idleDriftRemaining = Math.max(idleDriftRemaining, 4.5);
    status.textContent = progress === 1 ? "Xin chào Velun. Studio độc lập kiến tạo cùng ánh sáng."
        : progress === 0 ? "Vuốt lên để khám phá Velun." : "";
    requestDraw();
});

function settle(to: number) {
    scroll.scrollTo(to * scroll.limit, {
        immediate: reduced.matches,
        duration: Math.max(.16, 1.45 * Math.abs(to - progress)),
        easing: t => smooth(0, 1, t),
    });
}

lens.addEventListener("pointerdown", event => {
    if (!event.isPrimary || event.button !== 0 || drag) return;
    scroll.stop();
    suppressClick = false;
    drag = {
        mode: progress === 1 ? "orb" : "lift",
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startProgress: progress,
        offsetX: orbX.value,
        offsetY: orbY.value,
        lastMove: event.timeStamp,
        moved: false,
    };
    orbX.velocity = orbY.velocity = 0;
    lens.setPointerCapture(event.pointerId);
    requestDraw();
});

function followPointer(offset: number, previous: typeof orbX, dt: number) {
    const speed = Math.max(-1600, Math.min(1600, (offset - previous.value) / dt));
    const weight = 1 - Math.exp(-dt / .028);
    return { value: offset, velocity: previous.velocity + (speed - previous.velocity) * weight, settled: false };
}

lens.addEventListener("pointermove", event => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    drag.moved ||= Math.hypot(dx, dy) > 4;
    if (drag.mode === "lift") {
        scroll.scrollTo(drag.startProgress * scroll.limit - dy, { immediate: true, force: true });
    } else {
        const dt = Math.max(.001, (event.timeStamp - drag.lastMove) / 1000);
        orbX = followPointer(drag.offsetX + dx, orbX, dt);
        orbY = followPointer(drag.offsetY + dy, orbY, dt);
        drag.lastMove = event.timeStamp;
    }
    syncPointerTilt(event.clientX, event.clientY);
    requestDraw();
});

function release(event: PointerEvent, cancel = false) {
    if (!drag || drag.id !== event.pointerId) return;
    const { mode, moved, startProgress, lastMove } = drag;
    drag = null;
    scroll.start();
    suppressClick = moved || cancel;
    if (mode === "orb") {
        const decay = cancel ? 0 : Math.exp(-Math.max(0, event.timeStamp - lastMove) / 40);
        orbX.velocity *= decay;
        orbY.velocity *= decay;
    } else if (suppressClick) {
        settle((cancel ? startProgress : progress) >= .5 ? 1 : 0);
    }
    requestDraw();
}
lens.addEventListener("pointerup", event => release(event));
lens.addEventListener("pointercancel", event => release(event, true));
lens.addEventListener("lostpointercapture", event => release(event, true));
lens.addEventListener("click", event => {
    if (!suppressClick || event.detail === 0) settle(progress === 1 ? 0 : 1);
    suppressClick = false;
});
document.querySelector("#replay")!.addEventListener("click", event => {
    if ((event as MouseEvent).detail === 0) {
        lens.focus({ preventScroll: true });
    }
    settle(0);
});
document.querySelector("#studio")!.addEventListener("click", () => {
    scroll.stop();
    dialog.showModal();
});
dialog.addEventListener("close", () => scroll.start());
reduced.addEventListener("change", () => {
    scroll.options.smoothWheel = !reduced.matches;
    requestDraw();
});
function syncPointerTilt(clientX: number, clientY: number) {
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    const horizontal = Math.max(-1, Math.min(1, (clientX / width) * 2 - 1));
    const vertical = Math.max(-1, Math.min(1, -((clientY / height) * 2 - 1)));
    glass.setLightTilt?.(horizontal * 0.65, vertical * 0.65);
}

stage.addEventListener("pointermove", event => {
    if (event.pointerType === "mouse" && !drag) {
        syncPointerTilt(event.clientX, event.clientY);
    }
}, { passive: true });

function resize() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height) return;
    const progressBeforeResize = progress;
    scroll.resize();
    scroll.scrollTo(progressBeforeResize * scroll.limit, { immediate: true, force: true });
    const scale = Math.min(devicePixelRatio || 1, 3, Math.sqrt(3_600_000 / (width * height)));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvasScale = canvas.width / width;
    draw(true);
}
new ResizeObserver(resize).observe(stage);
resize();
