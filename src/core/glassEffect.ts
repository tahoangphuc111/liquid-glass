import {
    mergeGlassOptions,
    parseCssCornerRadiusPx,
    parseElementGlassAttributes,
} from "./config.js";
import { createLiquidGlass } from "./controller.js";
import { createGlassSlider } from "./slider.js";
import { createGlassSwitch } from "./switch.js";
import type {
    LiquidGlassInstance,
    LiquidGlassOptions,
    LiquidGlassSliderInstance,
    LiquidGlassSliderOptions,
    LiquidGlassSwitchInstance,
    LiquidGlassSwitchOptions,
} from "./types.js";

export interface LiquidGlassGroup {
    readonly instances: (LiquidGlassInstance | LiquidGlassSwitchInstance | LiquidGlassSliderInstance)[];
    update(options: Partial<LiquidGlassOptions | LiquidGlassSwitchOptions | LiquidGlassSliderOptions>): void;
    refresh(): void;
    setLightTilt(horizontal: number, vertical: number): void;
    setSceneCanvas(canvas: HTMLCanvasElement | null, sceneElement?: HTMLElement | null): void;
    destroy(): void;
}

const activeGlassInstances = new WeakMap<
    HTMLElement,
    LiquidGlassInstance | LiquidGlassSwitchInstance | LiquidGlassSliderInstance
>();

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
            const parsed = parseCssCornerRadiusPx(rawRadius, rect.width, rect.height);
            if (parsed !== null && Number.isFinite(parsed) && parsed >= halfMin * 0.96) {
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

function updateInstanceOptions(
    instance: LiquidGlassInstance | LiquidGlassSwitchInstance | LiquidGlassSliderInstance,
    options: Partial<LiquidGlassOptions | LiquidGlassSwitchOptions | LiquidGlassSliderOptions>,
): void {
    if ("activeIndex" in instance) {
        instance.update(options as Partial<LiquidGlassSwitchOptions>);
    } else if ("value" in instance) {
        instance.update(options as Partial<LiquidGlassSliderOptions>);
    } else {
        instance.update(options as Partial<LiquidGlassOptions>);
    }
}

function applyGlassToElement(
    element: HTMLElement,
    options: LiquidGlassOptions | LiquidGlassSwitchOptions | LiquidGlassSliderOptions = {},
): LiquidGlassInstance | LiquidGlassSwitchInstance | LiquidGlassSliderInstance {
    const existing = activeGlassInstances.get(element);
    if (existing) {
        updateInstanceOptions(existing, options);
        return existing;
    }

    const attrOverrides = parseElementGlassAttributes(element);
    const resolvedOptions = attrOverrides
        ? (mergeGlassOptions(attrOverrides, options as LiquidGlassOptions) as
              | LiquidGlassOptions
              | LiquidGlassSwitchOptions
              | LiquidGlassSliderOptions)
        : options;

    const isRangeInput =
        typeof HTMLInputElement !== "undefined" &&
        element instanceof HTMLInputElement &&
        element.type === "range";

    const isSwitch = !isRangeInput && isSwitchContainer(element, resolvedOptions);
    const baseInstance = isRangeInput
        ? createGlassSlider(element, resolvedOptions as LiquidGlassSliderOptions)
        : isSwitch
          ? createGlassSwitch(element, resolvedOptions as LiquidGlassSwitchOptions)
          : createLiquidGlass(element, inferMinimalOptions(element, resolvedOptions));

    const wrappedObj: Record<string, unknown> = {
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
        setLightTilt(horizontal: number, vertical: number) {
            baseInstance.setLightTilt?.(horizontal, vertical);
        },
        setSceneCanvas(canvas: HTMLCanvasElement | null, sceneElement?: HTMLElement | null) {
            baseInstance.setSceneCanvas(canvas, sceneElement);
        },
        destroy() {
            if (activeGlassInstances.get(element) === wrappedInstance) {
                activeGlassInstances.delete(element);
            }
            baseInstance.destroy();
        },
    };

    if (isSwitch) {
        const baseSwitch = baseInstance as LiquidGlassSwitchInstance;
        Object.defineProperties(wrappedObj, {
            value: { get: () => baseSwitch.value, enumerable: true },
            activeIndex: { get: () => baseSwitch.activeIndex, enumerable: true },
        });
        wrappedObj.setValue = (value: string, animate?: boolean) => baseSwitch.setValue(value, animate);
        wrappedObj.setActiveIndex = (index: number, animate?: boolean) =>
            baseSwitch.setActiveIndex(index, animate);
    } else if (isRangeInput) {
        const baseSlider = baseInstance as LiquidGlassSliderInstance;
        Object.defineProperty(wrappedObj, "value", { get: () => baseSlider.value, enumerable: true });
        wrappedObj.setValue = (value: number, animate?: boolean) => baseSlider.setValue(value, animate);
    } else {
        const baseGlass = baseInstance as LiquidGlassInstance;
        wrappedObj.setDragOffset = (offsetX: number, offsetY: number, animate?: boolean) =>
            baseGlass.setDragOffset?.(offsetX, offsetY, animate);
    }

    const wrappedInstance = wrappedObj as unknown as
        | LiquidGlassInstance
        | LiquidGlassSwitchInstance
        | LiquidGlassSliderInstance;

    activeGlassInstances.set(element, wrappedInstance);
    return wrappedInstance;
}

export function glassEffect(
    target: HTMLInputElement,
    options?: LiquidGlassSliderOptions,
): LiquidGlassSliderInstance;
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
    options?: LiquidGlassOptions | LiquidGlassSwitchOptions | LiquidGlassSliderOptions,
): LiquidGlassGroup;
export function glassEffect(
    target: HTMLElement | HTMLInputElement | string | Iterable<HTMLElement>,
    options: LiquidGlassOptions | LiquidGlassSwitchOptions | LiquidGlassSliderOptions = {},
): LiquidGlassInstance | LiquidGlassSwitchInstance | LiquidGlassSliderInstance | LiquidGlassGroup {
    if (typeof HTMLElement !== "undefined" && target instanceof HTMLElement) {
        return applyGlassToElement(target, options);
    }

    const instances: Array<LiquidGlassInstance | LiquidGlassSwitchInstance | LiquidGlassSliderInstance> = [];
    if (typeof target === "string") {
        if (typeof document !== "undefined") {
            const matched = document.querySelectorAll<HTMLElement>(target);
            for (const element of matched) {
                if (element instanceof HTMLElement) instances.push(applyGlassToElement(element, options));
            }
        }
    } else {
        for (const el of new Set(target as Iterable<HTMLElement>)) {
            if (typeof HTMLElement === "undefined" || el instanceof HTMLElement) {
                instances.push(applyGlassToElement(el, options));
            }
        }
    }

    const forEachInstance = (
        fn: (inst: LiquidGlassInstance | LiquidGlassSwitchInstance | LiquidGlassSliderInstance) => void,
    ) => {
        for (let index = 0; index < instances.length; index += 1) {
            fn(instances[index]!);
        }
    };

    return {
        instances,
        update(nextOptions: Partial<LiquidGlassOptions | LiquidGlassSwitchOptions | LiquidGlassSliderOptions>) {
            forEachInstance((inst) => updateInstanceOptions(inst, nextOptions));
        },
        refresh() {
            forEachInstance((inst) => inst.refresh());
        },
        setLightTilt(horizontal: number, vertical: number) {
            forEachInstance((inst) => inst.setLightTilt?.(horizontal, vertical));
        },
        setSceneCanvas(canvas: HTMLCanvasElement | null, sceneElement?: HTMLElement | null) {
            forEachInstance((inst) => inst.setSceneCanvas(canvas, sceneElement));
        },
        destroy() {
            forEachInstance((inst) => inst.destroy());
        },
    };
}

declare global {
    interface HTMLElement {
        glassEffect(options?: LiquidGlassSwitchOptions): LiquidGlassSwitchInstance;
        glassEffect(options?: LiquidGlassSliderOptions): LiquidGlassSliderInstance;
        glassEffect(options?: LiquidGlassOptions): LiquidGlassInstance;
    }
}

if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.glassEffect) {
    Object.defineProperty(HTMLElement.prototype, "glassEffect", {
        value(
            this: HTMLElement,
            options: LiquidGlassOptions | LiquidGlassSwitchOptions | LiquidGlassSliderOptions = {},
        ): LiquidGlassInstance | LiquidGlassSwitchInstance | LiquidGlassSliderInstance {
            return applyGlassToElement(this, options);
        },
        configurable: true,
        writable: true,
    });
}
