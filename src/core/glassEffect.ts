import { createLiquidGlass } from "./controller.js";
import { createGlassSlider } from "./slider.js";
import type { LiquidGlassInstance, LiquidGlassOptions } from "./types.js";

export interface LiquidGlassGroup {
    readonly instances: LiquidGlassInstance[];
    update(options: Partial<LiquidGlassOptions>): void;
    refresh(): void;
    destroy(): void;
}

const activeGlassInstances = new WeakMap<HTMLElement, LiquidGlassInstance>();

function inferMinimalOptions(
    element: HTMLElement,
    options: LiquidGlassOptions,
): LiquidGlassOptions {
    const resolved: LiquidGlassOptions = { ...options };

    if (resolved.interactive === undefined) {
        const tag = element.tagName;
        const role = element.getAttribute("role");
        if (tag === "BUTTON" || tag === "A" || role === "button" || role === "slider") {
            resolved.interactive = true;
        }
    }

    if (
        resolved.pill === undefined &&
        typeof window !== "undefined" &&
        typeof window.getComputedStyle === "function"
    ) {
        const rect = element.getBoundingClientRect();
        const halfMin = Math.min(rect.width, rect.height) * 0.5;
        if (halfMin > 0) {
            const rawRadius = window.getComputedStyle(element).borderTopLeftRadius;
            const parsed = rawRadius.endsWith("%")
                ? (parseFloat(rawRadius) / 100) * Math.min(rect.width, rect.height)
                : parseFloat(rawRadius);
            if (Number.isFinite(parsed) && parsed >= halfMin * 0.96) {
                resolved.pill = true;
            }
        }
    }

    return resolved;
}

function applyGlassToElement(
    element: HTMLElement,
    options: LiquidGlassOptions = {},
): LiquidGlassInstance {
    const existing = activeGlassInstances.get(element);
    if (existing) {
        existing.update(options);
        return existing;
    }

    const isRangeInput =
        typeof HTMLInputElement !== "undefined" &&
        element instanceof HTMLInputElement &&
        element.type === "range";

    const baseInstance = isRangeInput
        ? createGlassSlider(element, options)
        : createLiquidGlass(element, inferMinimalOptions(element, options));
    const wrappedInstance: LiquidGlassInstance = {
        get element() {
            return baseInstance.element;
        },
        get engine() {
            return baseInstance.engine;
        },
        update(nextOptions: Partial<LiquidGlassOptions>) {
            baseInstance.update(nextOptions);
        },
        refresh() {
            baseInstance.refresh();
        },
        setSceneCanvas(canvas: HTMLCanvasElement | null, sceneElement?: HTMLElement | null) {
            baseInstance.setSceneCanvas(canvas, sceneElement);
        },
        destroy() {
            activeGlassInstances.delete(element);
            baseInstance.destroy();
        },
    };

    activeGlassInstances.set(element, wrappedInstance);
    return wrappedInstance;
}

export function glassEffect(
    target: HTMLElement,
    options?: LiquidGlassOptions,
): LiquidGlassInstance;
export function glassEffect(
    target: string | Iterable<HTMLElement>,
    options?: LiquidGlassOptions,
): LiquidGlassGroup;
export function glassEffect(
    target: HTMLElement | string | Iterable<HTMLElement>,
    options: LiquidGlassOptions = {},
): LiquidGlassInstance | LiquidGlassGroup {
    if (typeof HTMLElement !== "undefined" && target instanceof HTMLElement) {
        return applyGlassToElement(target, options);
    }

    const elements =
        typeof target === "string"
            ? Array.from(document.querySelectorAll<HTMLElement>(target))
            : Array.from(target as Iterable<HTMLElement>);

    const instances = elements.map((el) => applyGlassToElement(el, options));

    return {
        instances,
        update(nextOptions: Partial<LiquidGlassOptions>) {
            for (const instance of instances) {
                instance.update(nextOptions);
            }
        },
        refresh() {
            for (const instance of instances) {
                instance.refresh();
            }
        },
        destroy() {
            for (const instance of instances) {
                instance.destroy();
            }
        },
    };
}

declare global {
    interface HTMLElement {
        glassEffect(options?: LiquidGlassOptions): LiquidGlassInstance;
    }
}

if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.glassEffect) {
    Object.defineProperty(HTMLElement.prototype, "glassEffect", {
        value(this: HTMLElement, options: LiquidGlassOptions = {}): LiquidGlassInstance {
            return applyGlassToElement(this, options);
        },
        configurable: true,
        writable: true,
    });
}
