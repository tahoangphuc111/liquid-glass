# React, Next.js, and Vue 3

Framework wrappers manage lifecycle cleanup and reactive option updates automatically.

Import base styles once in your app entry:

```ts
import "@tahoangphuc111/liquid-glass/styles.css";
```

---

## React (`@tahoangphuc111/liquid-glass/react`)

Exports: `LiquidGlass`, `LiquidGlassSwitch`, `LiquidGlassProvider`, `useLiquidGlass`, `useGlassSwitch`, and `useLiquidGlassContext`.

Wrap WebGL scenes and glass components in `<LiquidGlassProvider>` so child surfaces share one captured scene canvas:

```tsx
import { useState } from "react";
import {
    LiquidGlass,
    LiquidGlassProvider,
    LiquidGlassSwitch,
} from "@tahoangphuc111/liquid-glass/react";

export function App() {
    const [tab, setTab] = useState("home");

    return (
        <LiquidGlassProvider
            captureScene="auto"
            defaults={{ surface: "convex_squircle", thickness: 44 }}
        >
            <LiquidGlass interactive draggable="elastic" className="hero-card">
                <h1>Glass Card</h1>
            </LiquidGlass>

            <LiquidGlassSwitch
                value={tab}
                onChange={(nextValue) => setTab(nextValue)}
                items={[
                    { value: "home", label: "Home" },
                    { value: "search", label: "Search" },
                    { value: "library", label: "Library" },
                ]}
            />
        </LiquidGlassProvider>
    );
}
```

### Hooks

- `useLiquidGlass(targetRef, options?)` returns `{ engine, refresh }`.
- `useGlassSwitch(targetRef, options?)` returns `{ engine, value, activeIndex, setValue, setActiveIndex, refresh }`.
- `useLiquidGlassContext()` returns the provider context (`null` if no provider is mounted).

```tsx
import { useRef } from "react";
import { useLiquidGlass } from "@tahoangphuc111/liquid-glass/react";

export function PillButton() {
    const ref = useRef<HTMLButtonElement>(null);
    useLiquidGlass(ref, { pill: true, interactive: true });
    return <button ref={ref}>Continue</button>;
}
```

Provider props: `sceneRef` (capture a custom DOM container instead of rendering a wrapper), `captureScene` (`"auto" | "always" | "never"`), and `defaults` (`Partial<LiquidGlassOptions>`). Both `LiquidGlass` and `LiquidGlassSwitch` accept any `LiquidGlassOptions` plus `as` to change the rendered tag.

---

## Next.js (`@tahoangphuc111/liquid-glass/next`)

Marked with `"use client";` for App Router and Pages Router. Re-exports the React components/hooks and adds pathname synchronization to `LiquidGlassSwitch`.

```tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
    LiquidGlassProvider,
    LiquidGlassSwitch,
} from "@tahoangphuc111/liquid-glass/next";

export function NavigationShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();

    return (
        <LiquidGlassProvider>
            {children}
            <LiquidGlassSwitch
                pathname={pathname}
                linkComponent={Link}
                prefetch
                onChange={(_value, _index, el) => {
                    const href = el.getAttribute("href");
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

Also exports `resolveSwitchValueForPathname(items, pathname)` for custom active-tab matching.

---

## Vue 3 (`@tahoangphuc111/liquid-glass/vue`)

Exports `LiquidGlassPlugin` (registers `LiquidGlass`, `LiquidGlassSwitch`, and `LiquidGlassProvider` globally), the components themselves, and the composables `useLiquidGlass`, `useGlassSwitch`, and `useLiquidGlassContext` (with `LIQUID_GLASS_INJECTION_KEY`).

`LiquidGlassSwitch` supports `v-model`, emits `change` and `engineChange`, and renders either `:items` or default slot content:

```vue
<script setup lang="ts">
import { ref } from "vue";
import {
    LiquidGlass,
    LiquidGlassProvider,
    LiquidGlassSwitch,
} from "@tahoangphuc111/liquid-glass/vue";

const activeTab = ref("home");
</script>

<template>
    <LiquidGlassProvider>
        <LiquidGlass surface="convex_squircle" :interactive="true" draggable="elastic">
            <span>Refracted Content</span>
        </LiquidGlass>

        <LiquidGlassSwitch
            v-model="activeTab"
            :items="[
                { value: 'home', label: 'Home' },
                { value: 'search', label: 'Search' },
                { value: 'library', label: 'Library' },
            ]"
        />
    </LiquidGlassProvider>
</template>
```

The composables accept a reactive `MaybeRefOrGetter` options source:

```vue
<script setup lang="ts">
import { ref } from "vue";
import { useLiquidGlass } from "@tahoangphuc111/liquid-glass/vue";

const cardRef = ref<HTMLElement | null>(null);
const { engine } = useLiquidGlass(cardRef, () => ({ thickness: 40 }));
</script>
```
