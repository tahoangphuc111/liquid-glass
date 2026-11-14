import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const wasmCrateDir = path.join(rootDir, "wasm");
const wasmManifestPath = path.join(wasmCrateDir, "Cargo.toml");
const rawWasmPath = path.join(
    wasmCrateDir,
    "target",
    "wasm32-unknown-unknown",
    "release",
    "liquid_glass_wasm.wasm",
);
const distWasmDir = path.join(wasmCrateDir, "dist");
const distWasmPath = path.join(distWasmDir, "liquid_glass_wasm.wasm");
const tsWasmPath = path.join(rootDir, "src", "core", "wasm.ts");

const checkOnly = process.argv.includes("--check");

function hasCommand(command) {
    const result = spawnSync("which", [command], { encoding: "utf8" });
    return result.status === 0;
}

function resolveRustToolchain() {
    if (hasCommand("rustup")) {
        const installed = execFileSync("rustup", ["target", "list", "--installed"], {
            encoding: "utf8",
        });
        if (!installed.split(/\r?\n/).includes("wasm32-unknown-unknown")) {
            console.error(
                "[build:wasm] Rust target `wasm32-unknown-unknown` is not installed.\n" +
                    "Run:\n  rustup target add wasm32-unknown-unknown",
            );
            process.exit(1);
        }

        const cargoBin = execFileSync("rustup", ["which", "cargo"], { encoding: "utf8" }).trim();
        const rustcBin = execFileSync("rustup", ["which", "rustc"], { encoding: "utf8" }).trim();
        const toolchainBinDir = path.dirname(cargoBin);
        return {
            cargoBin,
            env: {
                ...process.env,
                RUSTC: rustcBin,
                PATH: `${toolchainBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
            },
        };
    }

    if (!hasCommand("cargo")) {
        console.error(
            "[build:wasm] `cargo` was not found on PATH.\n" +
                "Install Rust via rustup (https://rustup.rs) and add the WASM target:\n" +
                "  rustup target add wasm32-unknown-unknown",
        );
        process.exit(1);
    }

    return { cargoBin: "cargo", env: process.env };
}

function verifyWasmBinary(wasmBytes) {
    const module = new WebAssembly.Module(wasmBytes);
    const instance = new WebAssembly.Instance(module);
    const {
        initTables,
        generateDisplacementBmp,
        getBmpOffset,
        getMaxDisplacementOffset,
        memory,
    } = instance.exports;

    if (
        typeof initTables !== "function" ||
        typeof generateDisplacementBmp !== "function" ||
        !(memory instanceof WebAssembly.Memory)
    ) {
        throw new Error("Compiled WASM is missing required exports (initTables, generateDisplacementBmp, memory)");
    }

    const bmpOffset = typeof getBmpOffset === "function" ? getBmpOffset() : 0x14c00;
    const maxDispOffset =
        typeof getMaxDisplacementOffset === "function" ? getMaxDisplacementOffset() : 0x00020;

    initTables();
    const len = generateDisplacementBmp(32, 16, 8, 6, 30, 1.0, 1.5, 0, 0);
    if (len !== 64 + 32 * 16 * 4) {
        throw new Error(`Unexpected BMP byte length: ${len}`);
    }

    const u8 = new Uint8Array(memory.buffer, bmpOffset, len);
    if (u8[0] !== 0x42 || u8[1] !== 0x4d) {
        throw new Error(`Compiled WASM did not produce a valid BM header at 0x${bmpOffset.toString(16)}`);
    }

    const f32 = new Float32Array(memory.buffer);
    const maxDisp = f32[maxDispOffset >> 2];
    if (!Number.isFinite(maxDisp) || maxDisp <= 0) {
        throw new Error(`Invalid maxDisplacement at 0x${maxDispOffset.toString(16)}: ${maxDisp}`);
    }
}

function main() {
    const { cargoBin, env } = resolveRustToolchain();

    console.log("[build:wasm] Building Rust WASM SIMD module...");
    execFileSync(
        cargoBin,
        [
            "build",
            "--manifest-path",
            wasmManifestPath,
            "--target",
            "wasm32-unknown-unknown",
            "--release",
        ],
        { stdio: "inherit", cwd: wasmCrateDir, env },
    );

    if (!fs.existsSync(rawWasmPath)) {
        throw new Error(`Expected compiled binary at ${rawWasmPath}`);
    }

    fs.mkdirSync(distWasmDir, { recursive: true });
    fs.copyFileSync(rawWasmPath, distWasmPath);

    if (hasCommand("wasm-opt")) {
        console.log("[build:wasm] Optimizing with wasm-opt -Oz --enable-simd...");
        execFileSync("wasm-opt", ["-Oz", "--enable-simd", distWasmPath, "-o", distWasmPath], {
            stdio: "inherit",
        });
    }

    const wasmBytes = fs.readFileSync(distWasmPath);
    verifyWasmBinary(wasmBytes);

    const base64 = wasmBytes.toString("base64");
    const tsSource = fs.readFileSync(tsWasmPath, "utf8");
    const base64Pattern = /(const WASM_SIMD_BASE64 =\s*")([A-Za-z0-9+/=]+)(";)/;

    if (!base64Pattern.test(tsSource)) {
        throw new Error(`Could not locate WASM_SIMD_BASE64 in ${tsWasmPath}`);
    }

    if (checkOnly) {
        const currentBase64 = tsSource.match(base64Pattern)[2];
        if (currentBase64 !== base64) {
            console.error("[build:wasm] src/core/wasm.ts is out of sync with wasm/src/lib.rs.");
            process.exit(1);
        }
        console.log(`[build:wasm] Verified (${wasmBytes.length} bytes).`);
        return;
    }

    const updatedSource = tsSource.replace(base64Pattern, `$1${base64}$3`);
    fs.writeFileSync(tsWasmPath, updatedSource, "utf8");
    console.log(
        `[build:wasm] Updated src/core/wasm.ts (${wasmBytes.length} bytes, ${base64.length} base64 chars).`,
    );
}

main();
