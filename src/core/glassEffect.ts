import { createLiquidGlass } from "./controller.js";
import { createGlassSlider } from "./slider.js";
import { createGlassSwitch } from "./switch.js";
import type {
    LiquidGlassInstance,
    LiquidGlassOptions,
    LiquidGlassSwitchInstance,
    LiquidGlassSwitchOptions,
} from "./types.js";

export interface LiquidGlassGroup {
    readonly instances: (LiquidGlassInstance | LiquidGlassSwitchInstance)[];
    update(options: Partial<LiquidGlassOptions | LiquidGlassSwitchOptions>): void;
    refresh(): void;
    destroy(): void;
}

const activeGlassInstances = new WeakMap<HTMLElement, LiquidGlassInstance | LiquidGlassSwitchInstance>();

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

function isSwitchContainer(
    element: HTMLElement,
    options: LiquidGlassOptions | LiquidGlassSwitchOptions,
): boolean {
    const switchOptions = options as LiquidGlassSwitchOptions;
    return (
        element.classList.contains("lg-switch") ||
        element.getAttribute("role") === "tablist" ||
        element.hasAttribute("data-lg-switch") ||
        Boolean(
            switchOptions.itemSelector ||
            switchOptions.gliderElement ||
            switchOptions.value !== undefined ||
            switchOptions.defaultValue !== undefined ||
            typeof switchOptions.onChange === "function",
        )
    );
}

function applyGlassToElement(
    element: HTMLElement,
    options: LiquidGlassOptions | LiquidGlassSwitchOptions = {},
): LiquidGlassInstance | LiquidGlassSwitchInstance {
    const existing = activeGlassInstances.get(element);
    if (existing) {
        existing.update(options as any);
        return existing;
    }

    const isRangeInput =
        typeof HTMLInputElement !== "undefined" &&
        element instanceof HTMLInputElement &&
        element.type === "range";

    const isSwitch = isSwitchContainer(element, options);
    const baseInstance = isRangeInput
        ? createGlassSlider(element, options)
        : isSwitch
          ? createGlassSwitch(element, options as LiquidGlassSwitchOptions)
          : createLiquidGlass(element, inferMinimalOptions(element, options));

    const baseSwitch = "setValue" in baseInstance ? (baseInstance as LiquidGlassSwitchInstance) : null;

    const wrappedInstance: LiquidGlassInstance | LiquidGlassSwitchInstance = baseSwitch
        ? {
              get element() {
                  return baseInstance.element;
              },
              get engine() {
                  return baseInstance.engine;
              },
              get value() {
                  return baseSwitch.value;
              },
              get activeIndex() {
                  return baseSwitch.activeIndex;
              },
              setValue(value: string, animate?: boolean) {
                  baseSwitch.setValue(value, animate);
              },
              setActiveIndex(index: number, animate?: boolean) {
                  baseSwitch.setActiveIndex(index, animate);
              },
              update(nextOptions: Partial<LiquidGlassSwitchOptions>) {
                  baseInstance.update(nextOptions as any);
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
          }
        : {
              get element() {
                  return baseInstance.element;
              },
              get engine() {
                  return baseInstance.engine;
              },
              update(nextOptions: Partial<LiquidGlassOptions>) {
                  baseInstance.update(nextOptions as any);
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
    options?: LiquidGlassSwitchOptions,
): LiquidGlassSwitchInstance;
export function glassEffect(
    target: HTMLElement,
    options?: LiquidGlassOptions,
): LiquidGlassInstance;
export function glassEffect(
    target: string | Iterable<HTMLElement>,
    options?: LiquidGlassOptions | LiquidGlassSwitchOptions,
): LiquidGlassGroup;
export function glassEffect(
    target: HTMLElement | string | Iterable<HTMLElement>,
    options: LiquidGlassOptions | LiquidGlassSwitchOptions = {},
): LiquidGlassInstance | LiquidGlassSwitchInstance | LiquidGlassGroup {
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
        update(nextOptions: Partial<LiquidGlassOptions | LiquidGlassSwitchOptions>) {
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
        glassEffect(options?: LiquidGlassSwitchOptions): LiquidGlassSwitchInstance;
        glassEffect(options?: LiquidGlassOptions): LiquidGlassInstance;
    }
}

if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.glassEffect) {
    Object.defineProperty(HTMLElement.prototype, "glassEffect", {
        value(
            this: HTMLElement,
            options: LiquidGlassOptions | LiquidGlassSwitchOptions = {},
        ): LiquidGlassInstance | LiquidGlassSwitchInstance {
            return applyGlassToElement(this, options);
        },
        configurable: true,
        writable: true,
    });
}
