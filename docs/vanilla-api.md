# Vanilla JS & Core API

All functions below are exported from `@tahoangphuc111/liquid-glass`.

## Main Functions

### `createLiquidGlass(element, options?)`

Attaches liquid glass refraction to a DOM element and returns a `LiquidGlassInstance`.

```ts
import { createLiquidGlass } from "@tahoangphuc111/liquid-glass";
import "@tahoangphuc111/liquid-glass/styles.css";

const card = document.querySelector<HTMLElement>(".card")!;

const glass = createLiquidGlass(card, {
    surface: "convex_squircle",
    thickness: 48,
    bezel: 14,
    ior: 2.15,
    blur: 2,
    interactive: true,
    draggable: "elastic",
});

glass.update({ thickness: 36, tintColor: "#7dd3fc", tintOpacity: 0.14 });
glass.refresh();
glass.destroy();
```

`LiquidGlassInstance` provides:
- `element` (`HTMLElement`) and `engine` (`"wasm-svg" | "webgl" | "css"`)
- `update(options)`: updates options in place
- `refresh()`: re-measures layout and redraws
- `setSceneCanvas(canvas, sceneElement?)`: passes an external backdrop canvas for WebGL mode
- `destroy()`: removes observers, listeners, and allocated resources

---

### `glassEffect(target, options?)` and `element.glassEffect(options?)`

Applies glass automatically from an element, selector string, or element list:
- `<input type="range">` initializes `createGlassSlider`.
- `.lg-switch` or `[role="tablist"]` initializes `createGlassSwitch`.
- Other elements initialize `createLiquidGlass` with sensible defaults for buttons, pills, or cards.

Calling it again on an already-bound element updates the active instance.

```ts
import { glassEffect } from "@tahoangphuc111/liquid-glass";

const group = glassEffect(".toolbar-chip", { pill: true, interactive: true });
group.update({ blur: 4 });
group.destroy();

// Or via HTMLElement prototype
const button = document.querySelector<HTMLButtonElement>("#save-btn")!;
const btnGlass = button.glassEffect({ draggable: "elastic" });
```

Selector and iterable calls return a `LiquidGlassGroup` with `instances`, `update(options)`, `refresh()`, and `destroy()`.

---

### `createGlassSwitch(container, options?)`

Creates a sliding glass navigation switch with drag, click, and keyboard support.

```html
<nav id="bottom-nav" class="lg-switch" role="tablist">
    <button type="button" class="lg-switch-item" data-switch-value="home" role="tab">
        <span>Home</span>
    </button>
    <button type="button" class="lg-switch-item" data-switch-value="search" role="tab">
        <span>Search</span>
    </button>
</nav>
```

```ts
import { createGlassSwitch } from "@tahoangphuc111/liquid-glass";

const navSwitch = createGlassSwitch(document.querySelector("#bottom-nav")!, {
    defaultValue: "home",
    onChange(value, index) {
        console.log("Selected:", value, index);
    },
});

navSwitch.setValue("search");
navSwitch.setActiveIndex(0, false); // skip animation
```

Additional `LiquidGlassSwitchOptions` (extending `LiquidGlassOptions`):
- `value`, `defaultValue`: controlled or initial active tab value (resolved from `data-switch-value`, `data-value`, `value`, `href`, or item index)
- `itemSelector`, `gliderElement`: override default tab item lookup or provide a custom glider element
- `onChange(value, index, itemElement)`: fired when the active tab changes

The track and glider default to refraction along the switch orientation. For a horizontal switch the left and right caps refract, with the top and bottom feathered into the background. A vertical switch rotates the effect. Each part measures its own size.

Use `trackOptions` and `gliderOptions` to override shared glass settings on one layer. Both layers default to `blur: 0`. Pass `undefined` for either override object in `update()` to restore the shared settings for that layer.

```ts
const switchGlass = createGlassSwitch(nav, {
    refractionEdgeFade: 0.4,
    trackOptions: { scaleRatio: 0.65 },
    gliderOptions: {
        scaleRatio: 2.4,
        maxRefractionPx: 9,
    },
});
```

---

### `createGlassSlider(rangeInput, options?)`

Wraps a native `<input type="range">` with a glass thumb and track while keeping native value and events synchronized. Calling `destroy()` restores the original input.

```ts
import { createGlassSlider } from "@tahoangphuc111/liquid-glass";

const slider = createGlassSlider(document.querySelector("input[type='range']")!, {
    thickness: 36,
    bezel: 10,
});
```

---

## Batch Engine Helpers

For selector-driven pages without per-element controllers:

- `initLiquidGlass(configs?)`: initializes global observers and applies SVG glass across matching elements (defaults to `DEFAULT_GLASS_CONFIG.selector`, `"[data-liquid-glass], .lg-surface"`).
- `rebuildAllLiquidGlassFilters(configs?)`: re-scans selectors and updates active filters.
- `registerManagedElement(element, config)` / `unregisterManagedElement(element)`: adds or removes an element manually.
- `getLiquidGlassStats()`: returns live filter, pool, quality tier, and WASM status counts.
- `downgradeLiquidGlassToCss()`: forces CSS `backdrop-filter` fallback globally.
- `destroyLiquidGlass()`: tears down all global listeners and engine state.

---

## Configuration Options (`LiquidGlassOptions`)

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `surface` | `"convex_squircle" \| "convex_circle" \| "linear" \| "lip"` | `"convex_squircle"` | Edge curvature profile |
| `engine` | `"auto" \| "wasm-svg" \| "webgl" \| "css"` | `"auto"` | Rendering backend |
| `thickness` | `number` | `48` | Virtual glass thickness in px |
| `bezel` | `number` | `14` | Requested refraction rim width in CSS px |
| `adaptiveRefraction` | `boolean` | `false` (`true` on switches) | Fits the rim and maximum refraction travel to the measured size of each glass surface |
| `refractionDirection` | `"all" \| "horizontal" \| "vertical"` | `"all"` (follows orientation on switches) | Refract around the entire rim, or only along one axis |
| `refractionEdgeFade` | `number` | `0.35` | Feather width as a fraction of half the cross-axis size, from 0 to 1. Directional modes retain a pixel-wide transition at 0 |
| `maxRefractionPx` | `number` | — | Optional travel limit in CSS px, including the strongest color channel. Use 0 to disable displacement |
| `scaleRatio` | `number` | `2.35` | Displacement strength multiplier |
| `maxScaleMultiplier` | `number` | `5.5` | Upper clamp on displacement scale relative to the fitted bezel |
| `blur` | `number` | `2` | Backdrop blur radius in px (`0` on switches) |
| `sharpness` | `number` | auto (`0.65` when `blur <= 0`, otherwise `0`) | Backdrop resolution & crispness multiplier from `0` (standard budget) to `1` (up to `4x` supersampling / `4096px` scene capture). Omit to automatically increase resolution when `blur` is `0` |
| `saturation` | `number` | renderer default | Backdrop color multiplier from 0 (grayscale) through 1 (unchanged color) to 4 |
| `ior` | `number` | `2.15` | Index of refraction (`1.0` air, `1.33` water, `1.5+` glass) |
| `radius` | `number` | `18` | Fallback corner radius in px when CSS border-radius is unset |
| `pill` | `boolean` | `false` | Locks corners to a full pill shape |
| `hollow` | `boolean` | `false` | Keeps the center flat (`coreFilter`) and refracts only the bezel |
| `alwaysOn` | `boolean` | `true` | Keeps filter active near viewport edges |
| `coreFilter` | `string` | `"blur(6px) saturate(200%) brightness(1.03)"` | Interior filter when `hollow` is `true` |
| `tintColor` | `string` | `undefined` | Tint color in hex, `rgb()`, or `rgba()` |
| `tintOpacity` | `number` | `0.12` (WebGL) | Tint blend opacity (`0` to `1`) |
| `highlight` | `number` | `0.44` (WebGL) | Rim highlight intensity |
| `pixelRatio` | `number` | Device DPR | Render scale override for WebGL / scene capture |
| `chromaticAberration` | `boolean \| number` | `false` | Normalized RGB edge dispersion from 0 (off) to 1 (full optical crystal strength). Use `true` for the default strength (`0.35`) or `false` to disable it |
| `abbeNumber` | `number` | `58.5` | Material Abbe number (`10` to `120`; lower values increase dispersion). Setting a positive `abbeNumber` activates dispersion unless `chromaticAberration: false` |
| `interactive` | `boolean` | `false` | Hover/press spring response |
| `draggable` | `boolean \| "elastic"` | `false` | Drag translation or elastic droplet stretch |
| `coalesce` | `boolean` | `true` | Merges nearby WebGL glass surfaces smoothly |
| `sceneElement` | `HTMLElement \| null` | `null` | Background DOM root captured for WebGL refraction |
| `sceneCanvas` | `HTMLCanvasElement \| null` | `null` | Shared backdrop canvas for WebGL instances |
| `onEngineChange` | `(engine: GlassEngine) => void` | `undefined` | Callback when active engine resolves or falls back |

Also exported from `@tahoangphuc111/liquid-glass`: `DEFAULT_GLASS_CONFIG`, `mergeGlassOptions`, and `resolveGlassConfig`.


### Adaptive refraction

WASM/SVG and WebGL reserve the middle third of the short dimension outside the refracting bezel, with a minimum bezel of one CSS pixel. They limit sample travel using the distance from the inside edge of the fitted bezel to the centerline, including the strongest color channel when chromatic aberration is active. The effect follows layout changes without requiring an explicit width or height.

Set `adaptiveRefraction: true` to enable adaptive fitting on standalone or compact surfaces (switches enable it by default; pass `adaptiveRefraction: false` on a switch to opt out). Pass the same option through React, Next.js, or Vue, use `data-lg-adaptive-refraction="true"` with `glassEffect` or the batch engine, or use `adaptive-refraction="true"` on `<liquid-glass>`.


Use the same options on standalone surfaces, slider thumbs, and framework components. For HTML, use `data-lg-refraction-direction`, `data-lg-refraction-edge-fade`, and `data-lg-max-refraction-px`. The `<liquid-glass>` element also accepts these names without `data-lg-`. CSS fallback retains the switch feather and uses its backdrop blur.


### Backdrop color and dispersion

```ts
const glass = createLiquidGlass(panel, {
    saturation: 1.3,
    chromaticAberration: 0.18,
});

glass.update({ saturation: undefined, chromaticAberration: undefined });
```

Omit these options to keep the renderer's existing look and the selected preset's dispersion. Saturation affects the backdrop before the tint is composited. A custom `coreFilter` controls its own CSS filter stack. WASM/SVG and WebGL share the same chromatic dispersion model (combining `chromaticAberration`, `abbeNumber`, and `ior` with asymmetric red/blue channel ratios), while the CSS fallback supports saturation.

Use `data-lg-saturation="1.3"`, `data-lg-chromatic-aberration="0.18"`, and `data-lg-abbe-number="28"` in HTML. The value `1` selects full strength, and `true` (or an empty boolean attribute such as `<liquid-glass chromatic-aberration>`) selects the default strength. The `<liquid-glass>` element also accepts `saturation`, `chromatic-aberration`, and `abbe-number` without the `data-lg-` prefix.
