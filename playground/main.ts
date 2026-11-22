import "../src/styles.css";
import "./playground.css";
import {
    GLASS_PRESETS,
    createGlassSwitch,
    createLiquidGlass,
    getLiquidGlassStats,
    type GlassEngineMode,
    type GlassPreset,
    type GlassRefractionDirection,
    type GlassTheme,
    type LiquidGlassSwitchOptions,
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
const circleEl = document.getElementById("glass-circle")!;
const sliderEl = document.getElementById("glass-slider") as HTMLInputElement;
const switchEl = document.getElementById("glass-switch")!;
const engineBadge = document.getElementById("engine-badge")!;
const statsOutput = document.getElementById("stats-output")!;

const controlsPanel = document.getElementById("controls-panel")!;
const ctrlEngine = document.getElementById("ctrl-engine") as HTMLSelectElement;
const ctrlTheme = document.getElementById("ctrl-theme") as HTMLSelectElement;
const ctrlPreset = document.getElementById("ctrl-preset") as HTMLSelectElement;
const ctrlSurface = document.getElementById("ctrl-surface") as HTMLSelectElement;
const ctrlLightTilt = document.getElementById("ctrl-light-tilt") as HTMLSelectElement;
const ctrlThickness = document.getElementById("ctrl-thickness") as HTMLInputElement;
const ctrlBezel = document.getElementById("ctrl-bezel") as HTMLInputElement;
const ctrlScaleRatio = document.getElementById("ctrl-scale-ratio") as HTMLInputElement;
const ctrlIor = document.getElementById("ctrl-ior") as HTMLInputElement;
const ctrlBlur = document.getElementById("ctrl-blur") as HTMLInputElement;
const ctrlRadius = document.getElementById("ctrl-radius") as HTMLInputElement;
const ctrlHighlight = document.getElementById("ctrl-highlight") as HTMLInputElement;
const ctrlPill = document.getElementById("ctrl-pill") as HTMLInputElement;
const ctrlSquircle = document.getElementById("ctrl-squircle") as HTMLInputElement;
const ctrlHollow = document.getElementById("ctrl-hollow") as HTMLInputElement;
const ctrlAdaptive = document.getElementById("ctrl-adaptive") as HTMLInputElement;
const ctrlCoalesce = document.getElementById("ctrl-coalesce") as HTMLInputElement;
const ctrlSaturation = document.getElementById("ctrl-saturation") as HTMLInputElement;
const ctrlChroma = document.getElementById("ctrl-chroma") as HTMLInputElement;
const ctrlAbbe = document.getElementById("ctrl-abbe") as HTMLInputElement;
const ctrlTintEnabled = document.getElementById("ctrl-tint-enabled") as HTMLInputElement;
const ctrlTintColor = document.getElementById("ctrl-tint-color") as HTMLInputElement;
const ctrlTintOpacity = document.getElementById("ctrl-tint-opacity") as HTMLInputElement;
const ctrlSwitchRefraction = document.getElementById("ctrl-switch-refraction") as HTMLSelectElement;
const ctrlSwitchFade = document.getElementById("ctrl-switch-fade") as HTMLInputElement;
const ctrlGliderStrength = document.getElementById("ctrl-glider-strength") as HTMLInputElement;
const ctrlSwitchColor = document.getElementById("ctrl-switch-color") as HTMLInputElement;
const ctrlSwitchTrackColor = document.getElementById("ctrl-switch-track-color") as HTMLInputElement;
const ctrlSwitchTrackOpacity = document.getElementById("ctrl-switch-track-opacity") as HTMLInputElement;
const ctrlSwitchGliderColor = document.getElementById("ctrl-switch-glider-color") as HTMLInputElement;
const ctrlSwitchGliderOpacity = document.getElementById("ctrl-switch-glider-opacity") as HTMLInputElement;
const toggleThemeBtn = document.getElementById("toggle-theme") as HTMLButtonElement;
const copyConfigBtn = document.getElementById("copy-config") as HTMLButtonElement;
const resetControlsBtn = document.getElementById("reset-controls") as HTMLButtonElement;
const togglePanelBtn = document.getElementById("toggle-panel") as HTMLButtonElement;

function hexToRgba(hex: string, alpha: number): string {
    const clean = hex.replace("#", "");
    const r = Number.parseInt(clean.slice(0, 2), 16) || 0;
    const g = Number.parseInt(clean.slice(2, 4), 16) || 0;
    const b = Number.parseInt(clean.slice(4, 6), 16) || 0;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function readOptions(): LiquidGlassOptions {
    return {
        sceneElement: sceneEl,
        engine: ctrlEngine.value as GlassEngineMode,
        theme: ctrlTheme.value as GlassTheme,
        surface: ctrlSurface.value as GlassSurface,
        thickness: Number(ctrlThickness.value),
        bezel: Number(ctrlBezel.value),
        scaleRatio: Number(ctrlScaleRatio.value),
        adaptiveRefraction: ctrlAdaptive.checked,
        ior: Number(ctrlIor.value),
        blur: Number(ctrlBlur.value),
        saturation: ctrlSaturation.valueAsNumber < 0 ? undefined : ctrlSaturation.valueAsNumber,
        radius: Number(ctrlRadius.value),
        highlight: Number(ctrlHighlight.value),
        lightTilt: ctrlLightTilt.value === "pointer" ? "pointer" : { horizontal: 0, vertical: 0 },
        tintColor: ctrlTintEnabled.checked ? ctrlTintColor.value : undefined,
        tintOpacity: ctrlTintEnabled.checked ? Number(ctrlTintOpacity.value) : undefined,
        pill: ctrlPill.checked,
        cornerStyle: ctrlSquircle.checked ? "squircle" : "circular",
        hollow: ctrlHollow.checked,
        coalesce: ctrlCoalesce.checked,
        chromaticAberration: ctrlChroma.valueAsNumber,
        abbeNumber: Number(ctrlAbbe.value),
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

const circleGlass = createLiquidGlass(circleEl, {
    ...readOptions(),
    pill: true,
});

const sliderGlass = sliderEl.glassEffect({
    sceneElement: sceneEl,
    engine: ctrlEngine.value as GlassEngineMode,
    chromaticAberration: ctrlChroma.valueAsNumber,
});

function toSwitchGlassOptions(options: LiquidGlassOptions): LiquidGlassSwitchOptions {
    return {
        ...options,
        adaptiveRefraction: true,
        blur: 0,
        ior: Number((1 + ((options.ior ?? 2.15) - 1) * 0.42).toFixed(2)),
        thickness: Math.max(14, Math.round((options.thickness ?? 52) * 0.54)),
        bezel: Math.min(11, Math.max(6, Math.round((options.bezel ?? 16) * 0.62))),
        refractionDirection: ctrlSwitchRefraction.value as GlassRefractionDirection,
        refractionEdgeFade: Number(ctrlSwitchFade.value),
        gliderOptions: { scaleRatio: Number(ctrlGliderStrength.value) },
        pill: true,
    };
}

const switchGlass = createGlassSwitch(switchEl, {
    ...toSwitchGlassOptions(readOptions()),
    defaultValue: "home",
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

function applyPresetValues(presetKey: GlassPreset): void {
    const preset = GLASS_PRESETS[presetKey];
    if (!preset) return;
    if (preset.surface) ctrlSurface.value = preset.surface;
    if (preset.thickness !== undefined) ctrlThickness.value = String(preset.thickness);
    if (preset.bezel !== undefined) ctrlBezel.value = String(preset.bezel);
    if (preset.scaleRatio !== undefined) ctrlScaleRatio.value = String(preset.scaleRatio);
    if (preset.ior !== undefined) ctrlIor.value = String(preset.ior);
    if (preset.blur !== undefined) ctrlBlur.value = String(preset.blur);
    if (preset.highlight !== undefined) ctrlHighlight.value = String(preset.highlight);
    if (preset.abbeNumber !== undefined) ctrlAbbe.value = String(preset.abbeNumber);
    if (preset.chromaticAberration !== undefined) {
        ctrlChroma.value = String(
            preset.chromaticAberration === true ? 0.5 : preset.chromaticAberration === false ? 0 : preset.chromaticAberration,
        );
    }
    if (preset.tintColor !== undefined || preset.tintOpacity !== undefined) {
        ctrlTintEnabled.checked = true;
        if (preset.tintColor && preset.tintColor.startsWith("#") && preset.tintColor.length === 7) {
            ctrlTintColor.value = preset.tintColor;
        }
        if (preset.tintOpacity !== undefined) ctrlTintOpacity.value = String(preset.tintOpacity);
    } else {
        ctrlTintEnabled.checked = false;
    }
}

function syncControls(event?: Event) {
    if (event?.target === ctrlPreset && ctrlPreset.value) {
        applyPresetValues(ctrlPreset.value as GlassPreset);
    } else if (event && event.target !== ctrlPreset && event.target !== ctrlEngine) {
        ctrlPreset.value = "";
    }

    document.getElementById("val-thickness")!.textContent = ctrlThickness.value;
    document.getElementById("val-bezel")!.textContent = ctrlBezel.value;
    document.getElementById("val-scale-ratio")!.textContent = ctrlScaleRatio.value;
    document.getElementById("val-ior")!.textContent = ctrlIor.value;
    document.getElementById("val-blur")!.textContent = ctrlBlur.value;
    document.getElementById("val-radius")!.textContent = ctrlRadius.value;
    document.getElementById("val-highlight")!.textContent = ctrlHighlight.value;
    document.getElementById("val-saturation")!.textContent = ctrlSaturation.valueAsNumber < 0 ? "auto" : ctrlSaturation.value;
    document.getElementById("val-chroma")!.textContent = ctrlChroma.valueAsNumber === 0 ? "off" : ctrlChroma.value;
    document.getElementById("val-abbe")!.textContent = ctrlAbbe.value;
    document.getElementById("val-tint-opacity")!.textContent = ctrlTintOpacity.value;
    document.getElementById("val-switch-fade")!.textContent = ctrlSwitchFade.value;
    document.getElementById("val-glider-strength")!.textContent = ctrlGliderStrength.value;
    document.getElementById("val-switch-color")!.textContent = ctrlSwitchColor.value;
    document.getElementById("val-switch-track-opacity")!.textContent = ctrlSwitchTrackOpacity.value;
    document.getElementById("val-switch-glider-opacity")!.textContent = ctrlSwitchGliderOpacity.value;

    switchEl.style.setProperty("--lg-switch-active-ink", ctrlSwitchColor.value);
    switchEl.style.setProperty(
        "--lg-switch-track-bg",
        hexToRgba(ctrlSwitchTrackColor.value, Number(ctrlSwitchTrackOpacity.value)),
    );
    switchEl.style.setProperty(
        "--lg-switch-glider-bg",
        hexToRgba(ctrlSwitchGliderColor.value, Number(ctrlSwitchGliderOpacity.value)),
    );

    const opts = readOptions();
    panelGlass.update(opts);
    dockGlass.update({ ...opts, pill: true });
    pillGlass.update({ ...opts, pill: true });
    circleGlass.update({ ...opts, pill: true });
    sliderGlass.update({
        engine: opts.engine,
        theme: opts.theme,
        sceneElement: sceneEl,
        chromaticAberration: opts.chromaticAberration,
        saturation: opts.saturation,
    });
    switchGlass.update(toSwitchGlassOptions(opts));
    requestAnimationFrame(refreshStats);
}

const allControls = [
    ctrlEngine,
    ctrlTheme,
    ctrlPreset,
    ctrlSurface,
    ctrlLightTilt,
    ctrlThickness,
    ctrlBezel,
    ctrlScaleRatio,
    ctrlIor,
    ctrlBlur,
    ctrlRadius,
    ctrlHighlight,
    ctrlPill,
    ctrlSquircle,
    ctrlHollow,
    ctrlAdaptive,
    ctrlCoalesce,
    ctrlSaturation,
    ctrlChroma,
    ctrlAbbe,
    ctrlTintEnabled,
    ctrlTintColor,
    ctrlTintOpacity,
    ctrlSwitchRefraction,
    ctrlSwitchFade,
    ctrlGliderStrength,
    ctrlSwitchColor,
    ctrlSwitchTrackColor,
    ctrlSwitchTrackOpacity,
    ctrlSwitchGliderColor,
    ctrlSwitchGliderOpacity,
];

for (const input of allControls) {
    input.addEventListener("input", syncControls);
    input.addEventListener("change", syncControls);
}

copyConfigBtn.addEventListener("click", async () => {
    const opts = readOptions();
    const { sceneElement: _scene, onEngineChange: _cb, ...serializable } = opts;
    const cleaned = Object.fromEntries(
        Object.entries(serializable).filter(([, value]) => value !== undefined),
    );
    const snippet = JSON.stringify(cleaned, null, 2);
    try {
        await navigator.clipboard.writeText(snippet);
        copyConfigBtn.textContent = "copied!";
        window.setTimeout(() => {
            copyConfigBtn.textContent = "copy";
        }, 1200);
    } catch {
        console.log(snippet);
    }
});

function applySwitchThemeDefaults(isDark: boolean): void {
    ctrlSwitchColor.value = isDark ? "#38bdf8" : "#007aff";
    ctrlSwitchTrackColor.value = isDark ? "#101216" : "#ffffff";
    ctrlSwitchTrackOpacity.value = isDark ? "0.38" : "0.22";
    ctrlSwitchGliderColor.value = isDark ? "#a2a8b2" : "#cbd5e1";
    ctrlSwitchGliderOpacity.value = isDark ? "0.26" : "0.36";
}

resetControlsBtn.addEventListener("click", () => {
    ctrlEngine.value = "auto";
    ctrlTheme.value = "auto";
    ctrlPreset.value = "";
    ctrlSurface.value = "convex_squircle";
    ctrlLightTilt.value = "off";
    ctrlThickness.value = "52";
    ctrlBezel.value = "16";
    ctrlScaleRatio.value = "2.35";
    ctrlIor.value = "2.15";
    ctrlBlur.value = "2";
    ctrlRadius.value = "22";
    ctrlHighlight.value = "0.4";
    ctrlSaturation.value = "-0.05";
    ctrlChroma.value = "0";
    ctrlAbbe.value = "58.5";
    ctrlTintEnabled.checked = false;
    ctrlTintColor.value = "#ffffff";
    ctrlTintOpacity.value = "0.12";
    ctrlPill.checked = false;
    ctrlSquircle.checked = false;
    ctrlHollow.checked = false;
    ctrlAdaptive.checked = false;
    ctrlCoalesce.checked = false;
    ctrlSwitchRefraction.value = "horizontal";
    ctrlSwitchFade.value = "0.35";
    ctrlGliderStrength.value = "2.1";
    applySwitchThemeDefaults(document.documentElement.classList.contains("dark"));
    syncControls();
});

togglePanelBtn.addEventListener("click", () => {
    const collapsed = controlsPanel.classList.toggle("is-collapsed");
    togglePanelBtn.textContent = collapsed ? "+" : "−";
    togglePanelBtn.setAttribute("aria-expanded", String(!collapsed));
});

toggleThemeBtn.addEventListener("click", () => {
    const isDark = document.documentElement.classList.toggle("dark");
    toggleThemeBtn.textContent = isDark ? "light" : "dark";
    applySwitchThemeDefaults(isDark);
    syncControls();
    panelGlass.refresh();
    dockGlass.refresh();
    pillGlass.refresh();
    circleGlass.refresh();
    sliderGlass.refresh();
    switchGlass.refresh();
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

const makeCapsuleDraggable = (targetEl: HTMLElement) => {
    let capsuleDragging = false;
    let capsuleStartX = 0;
    let capsuleStartY = 0;
    let origLeft = 0;
    let origTop = 0;
    targetEl.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        const rect = targetEl.getBoundingClientRect();
        capsuleDragging = true;
        capsuleStartX = event.clientX;
        capsuleStartY = event.clientY;
        origLeft = rect.left;
        origTop = rect.top;
        targetEl.style.right = "auto";
        targetEl.style.marginInline = "0";
        targetEl.style.left = `${origLeft}px`;
        targetEl.style.top = `${origTop}px`;
        targetEl.setPointerCapture(event.pointerId);
    });
    targetEl.addEventListener("pointermove", (event) => {
        if (!capsuleDragging) return;
        targetEl.style.left = `${Math.max(8, Math.min(window.innerWidth - targetEl.offsetWidth - 8, origLeft + event.clientX - capsuleStartX))}px`;
        targetEl.style.top = `${Math.max(8, Math.min(window.innerHeight - targetEl.offsetHeight - 8, origTop + event.clientY - capsuleStartY))}px`;
        dockGlass.refresh();
    });
    const finish = () => {
        capsuleDragging = false;
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
