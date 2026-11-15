import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "tsup";

const CLIENT_ENTRY_FILES = [
    "react/index.js",
    "react/index.cjs",
    "next/index.js",
    "next/index.cjs",
];

function ensureUseClientDirective(filePath: string): void {
    const content = readFileSync(filePath, "utf8");
    if (content.startsWith('"use client";') || content.startsWith("'use client';")) {
        return;
    }
    writeFileSync(filePath, `"use client";\n${content}`, "utf8");
}

export default defineConfig({
    entry: {
        index: "src/index.ts",
        "react/index": "src/react/index.ts",
        "next/index": "src/next/index.ts",
        "vue/index": "src/vue/index.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    splitting: true,
    target: "es2022",
    external: ["next", "react", "react-dom", "react/jsx-runtime", "vue"],
    esbuildOptions(options) {
        options.jsx = "automatic";
    },
    async onSuccess() {
        const distDir = path.resolve("dist");
        mkdirSync(distDir, { recursive: true });
        copyFileSync(path.resolve("src/styles.css"), path.join(distDir, "styles.css"));
        for (const relativePath of CLIENT_ENTRY_FILES) {
            ensureUseClientDirective(path.join(distDir, relativePath));
        }
    },
});
