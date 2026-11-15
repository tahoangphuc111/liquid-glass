# liquid-glass

Optical refraction and glass displacement for Vanilla JS, React, Next.js, and Vue 3.

Uses WebAssembly (WASM SIMD) displacement maps on Chromium desktop, and falls back to WebGL scene capture or CSS backdrop filters on mobile and Safari.

![liquid-glass interactive playground demo](./assets/demo.gif)

## Installation

```bash
npm install @tahoangphuc111/liquid-glass
```

Import base styles once in your root stylesheet or entry file:

```ts
import "@tahoangphuc111/liquid-glass/styles.css";
```

## Quick Start

### Vanilla JavaScript

```ts
import { createLiquidGlass, glassEffect } from "@tahoangphuc111/liquid-glass";

const element = document.querySelector<HTMLElement>(".glass-card")!;

const glass = createLiquidGlass(element, {
    surface: "convex_squircle",
    thickness: 48,
    bezel: 14,
    ior: 2.15,
    blur: 2,
    interactive: true,
    draggable: "elastic",
});

// Quick helper on elements, selectors, range sliders, or switch bars
glassEffect(".glass-button", { pill: true, draggable: true });

// Update options at runtime
glass.update({ thickness: 56 });

// Clean up when removing the element
glass.destroy();
```

#### Bottom Navigation Switch (`createGlassSwitch`)

```ts
import { createGlassSwitch } from "@tahoangphuc111/liquid-glass";

const nav = document.querySelector<HTMLElement>("#bottom-nav")!;

const navSwitch = createGlassSwitch(nav, {
    defaultValue: "home",
    onChange(value, index) {
        console.log("Selected tab:", value, index);
    },
});

// Or activate directly via glassEffect on .lg-switch / [role="tablist"]
nav.glassEffect({ defaultValue: "home" });
```

### React

Wrap components with `<LiquidGlass>` or use `<LiquidGlassSwitch>`, `useLiquidGlass`, and `useGlassSwitch`:

```tsx
import { useState } from "react";
import { LiquidGlass, LiquidGlassSwitch } from "@tahoangphuc111/liquid-glass/react";

export function AppShell() {
    const [tab, setTab] = useState("home");

    return (
        <>
            <LiquidGlass
                surface="convex_squircle"
                interactive
                draggable="elastic"
                className="p-6 rounded-2xl"
            >
                <h2>Refracted Card</h2>
                <p>Content rendered inside liquid glass container.</p>
            </LiquidGlass>

            <LiquidGlassSwitch
                value={tab}
                onChange={(nextTab) => setTab(nextTab)}
                items={[
                    { value: "home", label: "Home" },
                    { value: "search", label: "Search" },
                    { value: "library", label: "Library" },
                ]}
            />
        </>
    );
}
```

Or using the hooks directly (`useLiquidGlass` / `useGlassSwitch`):

```tsx
import { useRef } from "react";
import { useLiquidGlass } from "@tahoangphuc111/liquid-glass/react";

export function CustomCard() {
    const ref = useRef<HTMLDivElement>(null);

    useLiquidGlass(ref, {
        surface: "convex_circle",
        pill: true,
        interactive: true,
    });

    return <div ref={ref} className="p-4">Pill button</div>;
}
```

### Next.js (App Router & Pages Router)

Import from `@tahoangphuc111/liquid-glass/next` (pre-marked with `"use client";` for Next.js App Router) and import base styles in `app/layout.tsx`:

```tsx
import "@tahoangphuc111/liquid-glass/styles.css";
```

Inside a Client Component (with `next/link` and `usePathname()`):

```tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
    LiquidGlassProvider,
    LiquidGlassSwitch,
} from "@tahoangphuc111/liquid-glass/next";

export function BottomNavShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();

    return (
        <LiquidGlassProvider>
            {children}
            <LiquidGlassSwitch
                pathname={pathname}
                linkComponent={Link}
                onChange={(_, __, itemElement) => {
                    const href = itemElement.getAttribute("href");
                    if (href) router.push(href);
                }}
                items={[
                    { value: "home", href: "/", label: "Home", exact: true },
                    { value: "search", href: "/search", label: "Search" },
                    { value: "library", href: "/library", label: "Library" },
                ]}
            />
        </LiquidGlassProvider>
    );
}
```

### Vue 3

Register as a global plugin (`LiquidGlass`, `LiquidGlassSwitch`, `LiquidGlassProvider`) or import directly:

```vue
<script setup lang="ts">
import { ref } from "vue";
import { LiquidGlass, LiquidGlassSwitch } from "@tahoangphuc111/liquid-glass/vue";

const activeTab = ref("home");
</script>

<template>
    <LiquidGlass
        surface="convex_squircle"
        :interactive="true"
        draggable="elastic"
        class="glass-panel"
    >
        <span>Vue Liquid Glass Panel</span>
    </LiquidGlass>

    <LiquidGlassSwitch
        v-model="activeTab"
        :items="[
            { value: 'home', label: 'Home' },
            { value: 'search', label: 'Search' },
            { value: 'library', label: 'Library' },
        ]"
    />
</template>
```

Or with the composable:

```vue
<script setup lang="ts">
import { ref } from "vue";
import { useLiquidGlass } from "@tahoangphuc111/liquid-glass/vue";

const panelRef = ref<HTMLElement | null>(null);

useLiquidGlass(panelRef, {
    surface: "convex_squircle",
    thickness: 35,
});
</script>

<template>
    <div ref="panelRef" class="glass-box">Content</div>
</template>
```

## How It Works

1. **Chromium Desktop (`wasm-svg`)**: Calculates refraction displacement using a WebAssembly SIMD kernel and outputs dynamic displacement maps directly into SVG `feDisplacementMap` filters.
2. **Mobile and Safari (`webgl`)**: When full SVG refraction is unsupported, samples background DOM elements onto a canvas or offscreen buffer and applies real-time GLSL fragment shaders.
3. **Low-power or fallback (`css`)**: Automatically steps down to CSS `backdrop-filter` if the GPU drops frames or battery-saving mode is active.

## Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `surface` | `"convex_squircle" \| "convex_circle" \| "linear" \| "lip"` | `"convex_squircle"` | Geometric refraction profile. |
| `engine` | `"auto" \| "wasm-svg" \| "webgl" \| "css"` | `"auto"` | Execution engine. `auto` picks the best supported engine. |
| `thickness` | `number` | `48` | Virtual lens thickness in pixels. |
| `bezel` | `number` | `14` | Width of the refraction boundary edge in pixels. |
| `scaleRatio` | `number` | `2.35` | Refraction displacement scale factor. |
| `ior` | `number` | `2.15` | Index of refraction. 1.0 is air, 1.33 is water, 1.5+ is glass. |
| `blur` | `number` | `2` | Gaussian blur radius applied behind the displacement filter. |
| `radius` | `number` | `18` | Corner radius override in pixels. Defaults to element border radius. |
| `pill` | `boolean` | `false` | Locks corners to full pill or circular shape. |
| `hollow` | `boolean` | `false` | Keeps inner area flat and limits refraction only to bezel edges. |
| `interactive` | `boolean` | `false` | Enables spring physics on cursor hover and click. |
| `draggable` | `boolean \| "elastic"` | `false` | Enables micro-drag or droplet elastic drag motion on interactive elements. |
| `coalesce` | `boolean` | `true` | Enables nearby liquid glass coalescence in WebGL mode. |
| `chromaticAberration` | `boolean \| number` | `false` | Enables RGB dispersion on WebGL and WASM SVG displacement engines. |
| `highlight` | `number` | `0.44` | Specular rim highlight intensity. |
| `tintColor` | `string` | `undefined` | Overlay tint color in hex or rgb format. |
| `tintOpacity` | `number` | `0.12` (WebGL) | Opacity of the tint layer (0 to 1). |
| `sceneElement` | `HTMLElement` | `null` | Target DOM element to sample for WebGL refraction mode. |
| `onEngineChange` | `(engine: GlassEngine) => void` | `undefined` | Callback fired when engine resolves or falls back. |

## Development

```bash
# Install dependencies
npm install

# Start local interactive playground
npm run dev

# Run unit tests
npm test

# Rebuild the Rust WASM SIMD kernel and update src/core/wasm.ts (requires rustup + wasm32-unknown-unknown)
npm run build:wasm

# Build package
npm run build
```

## License

MIT
