# Documentation

`@tahoangphuc111/liquid-glass` adds glass refraction and interactive liquid surfaces for Vanilla JS, React, Next.js, and Vue 3.

On desktop Chromium it uses a WASM SIMD displacement filter (`wasm-svg`). On mobile browsers and Safari it renders through WebGL (`webgl`), falling back to CSS `backdrop-filter` (`css`) when needed.

## Install

```bash
npm install @tahoangphuc111/liquid-glass
```

Import the stylesheet once in your app entry or root layout:

```ts
import "@tahoangphuc111/liquid-glass/styles.css";
```

## Entry Points

| Import Path | Includes |
| :--- | :--- |
| `@tahoangphuc111/liquid-glass` | Core functions (`createLiquidGlass`, `glassEffect`, `createGlassSwitch`, `createGlassSlider`), batch engine, and helpers |
| `@tahoangphuc111/liquid-glass/react` | `LiquidGlass`, `LiquidGlassSwitch`, `LiquidGlassProvider`, `useLiquidGlass`, `useGlassSwitch` |
| `@tahoangphuc111/liquid-glass/next` | Next.js `"use client"` wrappers and route-aware `LiquidGlassSwitch` |
| `@tahoangphuc111/liquid-glass/vue` | `LiquidGlassPlugin`, components, provider, and composables |
| `@tahoangphuc111/liquid-glass/styles.css` | Base surface, rim highlight, slider, and switch styles |

## Guides

- [Vanilla JS & Core API](./vanilla-api.md): Core functions, controls, batch initialization, and configuration options.
- [React, Next.js, and Vue 3](./frameworks.md): Framework components, hooks, composables, and scene providers.
- [Styling & Performance](./advanced-and-styling.md): CSS variables, scene capture sharing, capability checks, and tuning tips.
- [Changelog](../CHANGELOG.md): Release history.
