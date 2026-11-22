import {
    computeMergedOptionPatch,
    parseElementGlassAttributes,
} from "./config.js";
import { createLiquidGlass } from "./controller.js";
import type { LiquidGlassInstance, LiquidGlassOptions } from "./types.js";

const SHORT_TO_DATA_ATTR: ReadonlyArray<readonly [string, string]> = [
    ["preset", "data-lg-preset"],
    ["theme", "data-lg-theme-mode"],
    ["surface", "data-lg-surface-profile"],
    ["engine", "data-lg-engine-mode"],
    ["thickness", "data-lg-thickness"],
    ["bezel", "data-lg-bezel"],
    ["adaptive-refraction", "data-lg-adaptive-refraction"],
    ["refraction-direction", "data-lg-refraction-direction"],
    ["refraction-edge-fade", "data-lg-refraction-edge-fade"],
    ["max-refraction-px", "data-lg-max-refraction-px"],
    ["scale-ratio", "data-lg-scale-ratio"],
    ["max-scale-multiplier", "data-lg-max-scale-multiplier"],
    ["blur", "data-lg-blur"],
    ["saturation", "data-lg-saturation"],
    ["ior", "data-lg-ior"],
    ["radius", "data-lg-radius"],
    ["corner-style", "data-lg-corner-style"],
    ["pill", "data-lg-pill"],
    ["hollow", "data-lg-hollow"],
    ["always-on", "data-lg-always-on"],
    ["tint-color", "data-lg-tint-color"],
    ["tint-opacity", "data-lg-tint-opacity"],
    ["highlight", "data-lg-highlight"],
    ["light-tilt", "data-lg-light-tilt"],
    ["pixel-ratio", "data-lg-pixel-ratio"],
    ["chromatic-aberration", "data-lg-chromatic-aberration"],
    ["abbe-number", "data-lg-abbe-number"],
    ["interactive", "data-lg-interactive"],
    ["draggable", "data-lg-draggable"],
    ["drag-bounds", "data-lg-drag-bounds"],
    ["coalesce", "data-lg-coalesce"],
];

const CONTROLLER_RUNTIME_ATTRS = new Set([
    "data-lg-surface",
    "data-lg-engine",
    "data-lg-theme",
    "data-lg-pill",
    "data-lg-corner-style",
    "data-lg-draggable",
    "data-lg-dragging",
    "data-lg-offset",
    "data-lg-coalescing",
    "data-lg-webgl-scene",
]);

const OBSERVED_ATTRIBUTES: string[] = [];
const DATA_TO_SHORT_ATTR = new Map<string, string>();
for (let index = 0; index < SHORT_TO_DATA_ATTR.length; index++) {
    const [shortName, dataName] = SHORT_TO_DATA_ATTR[index]!;
    DATA_TO_SHORT_ATTR.set(dataName, shortName);
    OBSERVED_ATTRIBUTES.push(shortName);
    if (!CONTROLLER_RUNTIME_ATTRS.has(dataName)) {
        OBSERVED_ATTRIBUTES.push(dataName);
    }
}

function readCustomElementGlassOptions(element: HTMLElement): LiquidGlassOptions {
    const attributeReader: Pick<Element, "getAttribute"> = {
        getAttribute(dataName: string): string | null {
            const shortName = DATA_TO_SHORT_ATTR.get(dataName);
            if (shortName !== undefined) {
                const shortVal = element.getAttribute(shortName);
                if (shortVal !== null) return shortVal;
            }
            if (CONTROLLER_RUNTIME_ATTRS.has(dataName)) {
                return null;
            }
            return element.getAttribute(dataName);
        },
    };
    const parsed = parseElementGlassAttributes(attributeReader);
    const options: LiquidGlassOptions = parsed ? { ...parsed } : {};

    const themeMode = element.getAttribute("theme") ?? element.getAttribute("data-lg-theme-mode");
    if (themeMode) {
        const normalized = themeMode.trim().toLowerCase();
        if (normalized === "auto" || normalized === "light" || normalized === "dark") {
            options.theme = normalized;
        }
    }

    const engineMode = element.getAttribute("engine") ?? element.getAttribute("data-lg-engine-mode");
    if (engineMode) {
        const normalized = engineMode.trim().toLowerCase();
        if (
            normalized === "auto" ||
            normalized === "wasm-svg" ||
            normalized === "webgl" ||
            normalized === "css"
        ) {
            options.engine = normalized;
        }
    }

    const surfaceProfile =
        element.getAttribute("surface") ?? element.getAttribute("data-lg-surface-profile");
    if (surfaceProfile) {
        const normalized = surfaceProfile.trim().toLowerCase();
        if (
            normalized === "convex_squircle" ||
            normalized === "convex_circle" ||
            normalized === "linear" ||
            normalized === "lip" ||
            normalized === "concave"
        ) {
            options.surface = normalized;
        }
    }

    return options;
}

export interface LiquidGlassCustomElement extends HTMLElement {
    readonly glassInstance: LiquidGlassInstance | null;
    refresh(): void;
    setLightTilt(horizontal: number, vertical: number): void;
    setDragOffset(offsetX: number, offsetY: number, animate?: boolean): void;
}

export function registerLiquidGlassElement(tagName = "liquid-glass"): boolean {
    if (
        typeof window === "undefined" ||
        typeof HTMLElement === "undefined" ||
        typeof customElements === "undefined" ||
        !tagName.includes("-")
    ) {
        return false;
    }

    if (customElements.get(tagName)) {
        return true;
    }

    class LiquidGlassElementImpl extends HTMLElement implements LiquidGlassCustomElement {
        private instance: LiquidGlassInstance | null = null;
        private lastOptions: LiquidGlassOptions = {};
        private isSyncing = false;

        static get observedAttributes(): string[] {
            return OBSERVED_ATTRIBUTES;
        }

        get glassInstance(): LiquidGlassInstance | null {
            return this.instance;
        }

        connectedCallback(): void {
            if (!this.style.display) {
                this.style.display = "block";
            }
            const nextOptions = readCustomElementGlassOptions(this);
            this.lastOptions = nextOptions;
            this.isSyncing = true;
            try {
                this.instance = createLiquidGlass(this, nextOptions);
            } finally {
                this.isSyncing = false;
            }
        }

        disconnectedCallback(): void {
            this.isSyncing = true;
            try {
                this.instance?.destroy();
            } finally {
                this.isSyncing = false;
                this.instance = null;
                this.lastOptions = {};
            }
        }

        attributeChangedCallback(
            _name: string,
            oldValue: string | null,
            newValue: string | null,
        ): void {
            if (this.isSyncing || oldValue === newValue || !this.instance) return;
            const nextOptions = readCustomElementGlassOptions(this);
            const patch = computeMergedOptionPatch(this.lastOptions, nextOptions);
            this.lastOptions = nextOptions;
            this.isSyncing = true;
            try {
                this.instance.update(patch);
            } finally {
                this.isSyncing = false;
            }
        }

        refresh(): void {
            this.instance?.refresh();
        }

        setLightTilt(horizontal: number, vertical: number): void {
            this.instance?.setLightTilt?.(horizontal, vertical);
        }

        setDragOffset(offsetX: number, offsetY: number, animate = true): void {
            this.instance?.setDragOffset?.(offsetX, offsetY, animate);
        }
    }

    customElements.define(tagName, LiquidGlassElementImpl);
    return true;
}
