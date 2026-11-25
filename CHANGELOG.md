# Changelog

All notable changes to `@tahoangphuc111/liquid-glass` are documented in this file.

## [0.5.0] - 2026-11-25

### Added
- `sharpness` option (`0` to `1`, auto-enabled when `blur <= 0`) for up to `4x` WebGL supersampling, `4096px` scene capture, and HiDPI WASM displacement maps.
- Optical & physics helpers exported from `src/index.ts` (Sellmeier dispersion, Beer-Lambert transmittance, thin-film interference, Young-Laplace / Derjaguin coalescence, and Rayleigh dissipation).

### Changed
- Refined glass edge highlights, dark hairline border, 3D bevel depth, and elevation shadows across CSS, WASM-SVG, WebGL, and switches.
- Optimized chromatic aberration in WebGL and WASM-SVG to reduce GPU texture fetches, SVG filter DOM/Skia rebuilds, and thermal throttling.

## [0.4.0] - 2026-11-22

### Added
- 10 material presets (`preset`), `concave` surface, `cornerStyle` (`"squircle"`), and `theme` (`"auto" | "light" | "dark"`).
- Adaptive & directional refraction (`adaptiveRefraction`, `refractionDirection`, `saturation`, `abbeNumber`).
- Free dragging (`draggable: "free"`, `dragBounds`) and dynamic lighting tilt (`lightTilt`, `requestDeviceTiltPermission`).
- `LiquidGlassSlider` / `useGlassSlider` for React, Next.js, and Vue 3, vertical orientation for sliders & switches, and `<liquid-glass>` custom element.
- Shared WebGL scene capture (`acquireSharedSceneCapture`) and documentation under `docs/`.

### Changed
- Refined smooth edge highlights, light/dark glass & switch themes, and press-to-reveal switch glider highlights.
- Major CPU/GPU/memory optimizations across WASM SIMD, WebGL, spring physics, coalescence, and scene capture.

### Fixed
- Fixed SVG chromatic aberration darkening and async filter/coalescence/WebGL edge cases.

## [0.3.1] - 2026-11-16

### Added
- Automatic element detection in `glassEffect` for sliders (`<input type="range">`), switches (`.lg-switch` / `[role="tablist"]`), and interactive buttons.
- Next.js pathname synchronization (`resolveSwitchValueForPathname` and history change tracking) in `@tahoangphuc111/liquid-glass/next`.
- Expanded tests across switch behavior, WebGL features, coalescence, and React/Next/Vue wrappers.

### Changed
- Improved switch drag inertia, label highlight synchronization, and framework option updates.

## [0.3.0] - 2026-11-15

### Added
- `createGlassSwitch`, `LiquidGlassSwitch`, `useGlassSwitch`, and `@tahoangphuc111/liquid-glass/next`.
- WebGL glass coalescence (`coalesce`), optical transfer caching, and WebGL pooling.

## [0.2.1] - 2026-11-14

### Changed
- Added JS optical LUT precomputation and expanded WASM SIMD displacement map generation.

## [0.2.0] - 2026-11-14

### Changed
- Updated package exports and build pipeline.

## [0.1.1] - 2026-11-14

### Changed
- Optimized CSS gradient/border-radius parsing in scene capture and cached border-radius lookups.

## [0.1.0] - 2026-11-14

### Added
- Initial release with WASM SIMD SVG displacement filters, WebGL scene-capture refraction, CSS fallback, `createLiquidGlass`, `createGlassSlider`, `glassEffect`, `initLiquidGlass`, and React + Vue 3 wrappers.
