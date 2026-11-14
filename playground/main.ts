import "../src/styles.css";
import "./playground.css";
import {
    createLiquidGlass,
    getLiquidGlassStats,
    type GlassEngineMode,
    type GlassSurface,
    type LiquidGlassOptions,
} from "../src/index.js";

function drawSceneCanvas(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, "#1d4ed8");
    grad.addColorStop(0.5, "#ec4899");
    grad.addColorStop(1, "#f59e0b");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
    ctx.lineWidth = 2;
    for (let x = 24; x < canvas.width; x += 36) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 40, canvas.height);
        ctx.stroke();
    }

    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.font = "700 32px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("REFRACTION GRID 12345", 32, 120);
}

const sceneEl = document.getElementById("scene")!;
const sceneArt = document.getElementById("scene-art") as HTMLCanvasElement;
drawSceneCanvas(sceneArt);

const dockEl = document.getElementById("glass-dock")!;
const panelEl = document.getElementById("glass-panel")!;
const pillEl = document.getElementById("glass-pill")!;
const sliderEl = document.getElementById("glass-slider") as HTMLInputElement;
const engineBadge = document.getElementById("engine-badge")!;
const statsOutput = document.getElementById("stats-output")!;

const ctrlEngine = document.getElementById("ctrl-engine") as HTMLSelectElement;
const ctrlSurface = document.getElementById("ctrl-surface") as HTMLSelectElement;
const ctrlThickness = document.getElementById("ctrl-thickness") as HTMLInputElement;
const ctrlBezel = document.getElementById("ctrl-bezel") as HTMLInputElement;
const ctrlIor = document.getElementById("ctrl-ior") as HTMLInputElement;
const ctrlBlur = document.getElementById("ctrl-blur") as HTMLInputElement;
const ctrlRadius = document.getElementById("ctrl-radius") as HTMLInputElement;
const ctrlHighlight = document.getElementById("ctrl-highlight") as HTMLInputElement;
const ctrlPill = document.getElementById("ctrl-pill") as HTMLInputElement;
const ctrlHollow = document.getElementById("ctrl-hollow") as HTMLInputElement;
const ctrlChroma = document.getElementById("ctrl-chroma") as HTMLInputElement;
const toggleThemeBtn = document.getElementById("toggle-theme") as HTMLButtonElement;

function readOptions(): LiquidGlassOptions {
    return {
        sceneElement: sceneEl,
        engine: ctrlEngine.value as GlassEngineMode,
        surface: ctrlSurface.value as GlassSurface,
        thickness: Number(ctrlThickness.value),
        bezel: Number(ctrlBezel.value),
        ior: Number(ctrlIor.value),
        blur: Number(ctrlBlur.value),
        radius: Number(ctrlRadius.value),
        highlight: Number(ctrlHighlight.value),
        pill: ctrlPill.checked,
        hollow: ctrlHollow.checked,
        chromaticAberration: ctrlChroma.checked,
        onEngineChange(nextEngine) {
            engineBadge.textContent = nextEngine;
            requestAnimationFrame(refreshStats);
        },
    };
}

const dockGlass = createLiquidGlass(dockEl, {
    ...readOptions(),
    pill: true,
});

const panelGlass = createLiquidGlass(panelEl, readOptions());

const pillGlass = createLiquidGlass(pillEl, {
    ...readOptions(),
    pill: true,
});

const sliderGlass = sliderEl.glassEffect({
    sceneElement: sceneEl,
    engine: ctrlEngine.value as GlassEngineMode,
    chromaticAberration: ctrlChroma.checked,
});

function refreshStats() {
    const stats = getLiquidGlassStats();
    engineBadge.textContent = panelGlass.engine;
    statsOutput.textContent =
        `engine: ${panelGlass.engine}\n` +
        `tier: ${stats.qualityTier}\n` +
        `filters: ${stats.liveFilters} (${stats.filterNodeCount} dom)\n` +
        `wasm: ${stats.wasmReady}`;
}

function syncControls() {
    document.getElementById("val-thickness")!.textContent = ctrlThickness.value;
    document.getElementById("val-bezel")!.textContent = ctrlBezel.value;
    document.getElementById("val-ior")!.textContent = ctrlIor.value;
    document.getElementById("val-blur")!.textContent = ctrlBlur.value;
    document.getElementById("val-radius")!.textContent = ctrlRadius.value;
    document.getElementById("val-highlight")!.textContent = ctrlHighlight.value;

    const opts = readOptions();
    panelGlass.update(opts);
    dockGlass.update({ ...opts, pill: true });
    pillGlass.update({ ...opts, pill: true });
    sliderGlass.update({
        engine: opts.engine,
        sceneElement: sceneEl,
        chromaticAberration: opts.chromaticAberration,
    });
    requestAnimationFrame(refreshStats);
}

for (const input of [
    ctrlEngine,
    ctrlSurface,
    ctrlThickness,
    ctrlBezel,
    ctrlIor,
    ctrlBlur,
    ctrlRadius,
    ctrlHighlight,
    ctrlPill,
    ctrlHollow,
    ctrlChroma,
]) {
    input.addEventListener("input", syncControls);
    input.addEventListener("change", syncControls);
}

toggleThemeBtn.addEventListener("click", () => {
    const isDark = document.documentElement.classList.toggle("dark");
    toggleThemeBtn.textContent = isDark ? "light wallpaper" : "dark wallpaper";
    panelGlass.refresh();
    dockGlass.refresh();
    pillGlass.refresh();
    sliderGlass.refresh();
});

let dragging = false;
let activePointerId: number | null = null;
let startX = 0;
let startY = 0;
let originLeft = 0;
let originTop = 0;

function stopDragging() {
    dragging = false;
    activePointerId = null;
}

panelEl.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    dragging = true;
    activePointerId = event.pointerId;
    panelEl.setPointerCapture(event.pointerId);
    const rect = panelEl.getBoundingClientRect();
    startX = event.clientX;
    startY = event.clientY;
    originLeft = rect.left;
    originTop = rect.top;
});

panelEl.addEventListener("pointermove", (event) => {
    if (!dragging || event.pointerId !== activePointerId) return;
    panelEl.style.left = `${Math.round(originLeft + (event.clientX - startX))}px`;
    panelEl.style.top = `${Math.round(originTop + (event.clientY - startY))}px`;
    panelGlass.refresh();
});

panelEl.addEventListener("pointerup", stopDragging);
panelEl.addEventListener("pointercancel", stopDragging);
panelEl.addEventListener("lostpointercapture", stopDragging);

// allow dragging the top capsule over any artwork or text to inspect refraction
const makeCapsuleDraggable = (targetEl: HTMLElement) => {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;
    targetEl.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        const rect = targetEl.getBoundingClientRect();
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        origLeft = rect.left;
        origTop = rect.top;
        targetEl.style.right = "auto";
        targetEl.style.marginInline = "0";
        targetEl.style.left = `${origLeft}px`;
        targetEl.style.top = `${origTop}px`;
        targetEl.setPointerCapture(event.pointerId);
    });
    targetEl.addEventListener("pointermove", (event) => {
        if (!dragging) return;
        targetEl.style.left = `${Math.max(8, Math.min(window.innerWidth - targetEl.offsetWidth - 8, origLeft + event.clientX - startX))}px`;
        targetEl.style.top = `${Math.max(8, Math.min(window.innerHeight - targetEl.offsetHeight - 8, origTop + event.clientY - startY))}px`;
        dockGlass.refresh();
    });
    const finish = () => {
        dragging = false;
    };
    targetEl.addEventListener("pointerup", finish);
    targetEl.addEventListener("pointercancel", finish);
    targetEl.addEventListener("lostpointercapture", finish);
};
makeCapsuleDraggable(dockEl);

const params = new URLSearchParams(window.location.search);
const queryTheme = params.get("theme");
if (queryTheme === "dark") {
    document.getElementById("toggle-theme")?.click();
}
const queryEngine = params.get("engine");
if (queryEngine === "wasm-svg" || queryEngine === "webgl" || queryEngine === "css" || queryEngine === "auto") {
    const engineSelect = document.getElementById("ctrl-engine") as HTMLSelectElement | null;
    if (engineSelect) {
        engineSelect.value = queryEngine;
        engineSelect.dispatchEvent(new Event("change"));
    }
}

refreshStats();
