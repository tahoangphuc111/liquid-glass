# Styling & Performance

## CSS Classes and Custom Properties

`@tahoangphuc111/liquid-glass/styles.css` defines base classes for surfaces, switches, and sliders:

- `.lg-surface`: Base glass container (automatically receives `.lg-on`, `.lg-hollow`, and `.lg-interactive`).
- `.lg-switch`, `.lg-switch-track`, `.lg-switch-item`, `.lg-switch-glider`: Navigation switch container, background track, items, and sliding lens.
- `.lg-slider`, `.lg-slider-track`, `.lg-slider-fill`, `.lg-slider-thumb`: Range slider wrapper and glass thumb.

### Common CSS Overrides

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `--lg-radius` | `18px` | Element border radius when `pill` is `false` |
| `--lg-rim-width` | `0.45px` | Edge highlight thickness on CSS/SVG surfaces |
| `--lg-rim-opacity` | `1` (scaled by `highlight`) | Edge highlight opacity |
| `--lg-bg` / `--lg-tint` | `rgba(255, 255, 255, 0.11..0.14)` | Surface tint color |
| `--lg-switch-ink` | `rgba(255, 255, 255, 0.72)` | Inactive switch item text and icon color |
| `--lg-switch-active-ink` | `#007aff` | Active text/icon tint inside the sliding lens |
| `--lg-slider-height` | `34px` | Slider height |
| `--lg-slider-thumb-w` / `--lg-slider-thumb-h` | `54px` / `32px` | Slider thumb dimensions |

---

## Scene Capture & Low-Level Exports

In `webgl` mode, elements sample a rasterized `<canvas>` of the background DOM. By default, controllers targeting the same `sceneElement` automatically share one capture canvas and observer via `acquireSharedSceneCapture(sourceElement, getQualityOptions?)` and clean it up once the last instance is destroyed.

Additional low-level exports from `@tahoangphuc111/liquid-glass`:
- `createSceneCaptureController` and `captureDomToCanvas`: standalone DOM-to-canvas snapshot helpers.
- `GlassWebglRenderer` and `parseCssColorToRgb`: direct WebGL renderer and CSS color parser.
- `checkIsChromium`, `canUseSvgGlass`, `canUseWebglRefraction`, `resolveGlassEngine`: environment and capability detection.
- `initWasmSimdModule`, `getWasmDisplacementBmp`, `isWasmReady`, `onWasmReady`, `revokeBlobUrlSafely`: WASM module lifecycle and displacement cache helpers.

The library initializes WASM when it selects the SVG engine or receives a displacement-map request. Call `initWasmSimdModule()` to initialize it explicitly before querying its readiness.
- `qualityTier`, `isGlassDowngraded`, `qualityUpgrades`, `qualityDowngrades`, `applyQualityTier`, `recordJankFrame`, `downgradeLiquidGlass`: adaptive quality telemetry controls.

---

## Performance Tips

1. **Scope `sceneElement` or use `LiquidGlassProvider`**: Passing a specific container (instead of defaulting to `document.body`) limits DOM snapshots in WebGL mode to the region behind your glass UI.
2. **Keep `blur: 0` on navigation switches**: Switches default to `blur: 0` so underlying icons and labels remain sharp while refracting.
3. **Leave `pixelRatio` automatic on mobile**: WebGL surfaces adapt resolution during rapid drags and pause rendering when hidden or offscreen.
4. **Call `.destroy()` on manual instances**: Destroying controllers frees pooled SVG filters, `Image` preloads, shared observers, and scene capture leases.


### Rendering on devices with limited memory

When the browser reports 4 GB of RAM or less, or omits the estimate, managed surfaces share two active WebGL slots. Additional surfaces use the CSS fallback. Each WebGL drawing buffer is limited to 1,048,576 pixels. Background captures and scene uploads fit within 1024 × 1024 pixels, including explicit `pixelRatio` requests. The optical transfer cache has an 8 MiB global budget and the displacement bitmap cache has a 4 MiB eviction target.

Automatic WebGL resolution follows the surface radius. Square surfaces render at 0.25× CSS resolution. Rounded surfaces use the display pixel ratio clamped to 1.5×–2.5×. Set `pixelRatio` to override the automatic scale within the device's pixel budget. Background imagery is sized independently of the curved outline.
