import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "tsup";

export default defineConfig({
    entry: {
        index: "src/index.ts",
        "react/index": "src/react/index.ts",
        "vue/index": "src/vue/index.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    splitting: true,
    target: "es2022",
    external: ["react", "react-dom", "react/jsx-runtime", "vue"],
    esbuildOptions(options) {
        options.jsx = "automatic";
    },
    async onSuccess() {
        const distDir = path.resolve("dist");
        mkdirSync(distDir, { recursive: true });
        copyFileSync(path.resolve("src/styles.css"), path.join(distDir, "styles.css"));
    },
});
