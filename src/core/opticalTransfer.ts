import type { GlassFrameParams } from "./webglRenderer.js";

const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_CACHE_PIXELS = 1_048_576;
const BYTES_PER_PIXEL = 24;

let totalAllocatedBytes = 0;

type SampleVariantKey =
    | "NO_SCENE"
    | "NO_SCENE_FULL"
    | "CLEAR"
    | "CLEAR_CLAMP"
    | "CLEAR_FULL"
    | "CLEAR_CLAMP_FULL"
    | "CLEAR_CHROMA"
    | "CLEAR_CHROMA_CLAMP"
    | "CLEAR_CHROMA_FULL"
    | "CLEAR_CHROMA_CLAMP_FULL"
    | "BLUR"
    | "BLUR_CLAMP"
    | "BLUR_FULL"
    | "BLUR_CLAMP_FULL"
    | "BLUR_CHROMA"
    | "BLUR_CHROMA_CLAMP"
    | "BLUR_CHROMA_FULL"
    | "BLUR_CHROMA_CLAMP_FULL";

interface SampleProgramEntry {
    readonly program: WebGLProgram;
    readonly uSizeLoc: WebGLUniformLocation | null;
    readonly uGeomLoc: WebGLUniformLocation | null;
    readonly uOpticalLoc: WebGLUniformLocation | null;
    readonly uTintLoc: WebGLUniformLocation | null;
    readonly uHighlightLoc: WebGLUniformLocation | null;
    readonly uSceneRectLoc: WebGLUniformLocation | null;
    readonly uDprLoc: WebGLUniformLocation | null;
    readonly uInteriorMarginLoc: WebGLUniformLocation | null;
    readonly uBlurOffset1Loc: WebGLUniformLocation | null;
    readonly uBlurOffset2Loc: WebGLUniformLocation | null;
    readonly uLightTiltLoc: WebGLUniformLocation | null;
    lastWidth: number;
    lastHeight: number;
    lastRadius: number;
    lastBezel: number;
    lastIor: number;
    lastThickness: number;
    lastScaleRatio: number;
    lastSurfaceId: number;
    lastTintR: number;
    lastTintG: number;
    lastTintB: number;
    lastTintA: number;
    lastHighlight: number;
    lastChromaStrength: number;
    lastBlurRadiusPx: number;
    lastRelX: number;
    lastRelY: number;
    lastRelW: number;
    lastRelH: number;
    lastDpr: number;
    lastInteriorMargin: number;
    lastBlurOffset1X: number;
    lastBlurOffset1Y: number;
    lastBlurOffset2X: number;
    lastBlurOffset2Y: number;
    lastLightTiltHorizontal: number;
    lastLightTiltVertical: number;
}

interface BuildProgramEntry {
    readonly program: WebGLProgram;
    readonly uSizeLoc: WebGLUniformLocation | null;
    readonly uGeomLoc: WebGLUniformLocation | null;
    readonly uOpticalLoc: WebGLUniformLocation | null;
    readonly uDprLoc: WebGLUniformLocation | null;
    readonly uInteriorMarginLoc: WebGLUniformLocation | null;
    readonly uLutScaleLoc: WebGLUniformLocation | null;
    lastLutSize: number;
}

const VARIANT_DEFINES: Record<SampleVariantKey, readonly string[]> = {
    NO_SCENE: ["LG_TRANSFER_SAMPLE", "LG_SPECIALIZED", "LG_SAMPLE_NO_SCENE"],
    NO_SCENE_FULL: ["LG_TRANSFER_SAMPLE", "LG_SPECIALIZED", "LG_SAMPLE_NO_SCENE", "LG_NO_INTERIOR_FASTPATH"],
    CLEAR: ["LG_TRANSFER_SAMPLE", "LG_SPECIALIZED", "LG_SAMPLE_CLEAR"],
    CLEAR_CLAMP: ["LG_TRANSFER_SAMPLE", "LG_SPECIALIZED", "LG_SAMPLE_CLEAR", "LG_SAMPLE_CLAMP"],
    CLEAR_FULL: ["LG_TRANSFER_SAMPLE", "LG_SPECIALIZED", "LG_SAMPLE_CLEAR", "LG_NO_INTERIOR_FASTPATH"],
    CLEAR_CLAMP_FULL: [
        "LG_TRANSFER_SAMPLE",
        "LG_SPECIALIZED",
        "LG_SAMPLE_CLEAR",
        "LG_SAMPLE_CLAMP",
        "LG_NO_INTERIOR_FASTPATH",
    ],
    CLEAR_CHROMA: ["LG_TRANSFER_SAMPLE", "LG_SPECIALIZED", "LG_SAMPLE_CLEAR", "LG_SAMPLE_CHROMA"],
    CLEAR_CHROMA_CLAMP: [
        "LG_TRANSFER_SAMPLE",
        "LG_SPECIALIZED",
        "LG_SAMPLE_CLEAR",
        "LG_SAMPLE_CHROMA",
        "LG_SAMPLE_CLAMP",
    ],
    CLEAR_CHROMA_FULL: [
        "LG_TRANSFER_SAMPLE",
        "LG_SPECIALIZED",
        "LG_SAMPLE_CLEAR",
        "LG_SAMPLE_CHROMA",
        "LG_NO_INTERIOR_FASTPATH",
    ],
    CLEAR_CHROMA_CLAMP_FULL: [
        "LG_TRANSFER_SAMPLE",
        "LG_SPECIALIZED",
        "LG_SAMPLE_CLEAR",
        "LG_SAMPLE_CHROMA",
        "LG_SAMPLE_CLAMP",
        "LG_NO_INTERIOR_FASTPATH",
    ],
    BLUR: ["LG_TRANSFER_SAMPLE", "LG_SPECIALIZED", "LG_SAMPLE_BLUR"],
    BLUR_CLAMP: ["LG_TRANSFER_SAMPLE", "LG_SPECIALIZED", "LG_SAMPLE_BLUR", "LG_SAMPLE_CLAMP"],
    BLUR_FULL: ["LG_TRANSFER_SAMPLE", "LG_SPECIALIZED", "LG_SAMPLE_BLUR", "LG_NO_INTERIOR_FASTPATH"],
    BLUR_CLAMP_FULL: [
        "LG_TRANSFER_SAMPLE",
        "LG_SPECIALIZED",
        "LG_SAMPLE_BLUR",
        "LG_SAMPLE_CLAMP",
        "LG_NO_INTERIOR_FASTPATH",
    ],
    BLUR_CHROMA: ["LG_TRANSFER_SAMPLE", "LG_SPECIALIZED", "LG_SAMPLE_BLUR", "LG_SAMPLE_CHROMA"],
    BLUR_CHROMA_CLAMP: [
        "LG_TRANSFER_SAMPLE",
        "LG_SPECIALIZED",
        "LG_SAMPLE_BLUR",
        "LG_SAMPLE_CHROMA",
        "LG_SAMPLE_CLAMP",
    ],
    BLUR_CHROMA_FULL: [
        "LG_TRANSFER_SAMPLE",
        "LG_SPECIALIZED",
        "LG_SAMPLE_BLUR",
        "LG_SAMPLE_CHROMA",
        "LG_NO_INTERIOR_FASTPATH",
    ],
    BLUR_CHROMA_CLAMP_FULL: [
        "LG_TRANSFER_SAMPLE",
        "LG_SPECIALIZED",
        "LG_SAMPLE_BLUR",
        "LG_SAMPLE_CHROMA",
        "LG_SAMPLE_CLAMP",
        "LG_NO_INTERIOR_FASTPATH",
    ],
};

function buildWebgl2Sources(
    vertexSource: string,
    fragmentSource: string,
    defines: readonly string[],
    isBuildPass: boolean,
): { vertex: string; fragment: string } {
    const defineBlock = defines.map((name) => `#define ${name}\n`).join("");
    const webgl2Vertex = `#version 300 es\n${defineBlock}${vertexSource
        .replace(/\battribute\b/g, "in")
        .replace(/\bvarying\b/g, "out")}`;
    const strippedFragment = fragmentSource
        .replace(/precision\s+highp\s+float\s*;/, "")
        .replace(/\bvarying\b/g, "in")
        .replace(/\btexture2D\b/g, "texture");
    const fragOutputDecl = isBuildPass ? "" : "out vec4 lgFragColor;\n#define gl_FragColor lgFragColor\n";
    const webgl2Fragment = `#version 300 es\nprecision highp float;\n${defineBlock}${fragOutputDecl}${strippedFragment}`;
    return { vertex: webgl2Vertex, fragment: webgl2Fragment };
}

function compileWebgl2Shader(
    gl: WebGL2RenderingContext,
    shaderType: number,
    source: string,
): WebGLShader | null {
    const shader = gl.createShader(shaderType);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function createProgramWithDefines(
    gl: WebGL2RenderingContext,
    vertexSource: string,
    fragmentSource: string,
    defines: readonly string[],
    isBuildPass: boolean,
): WebGLProgram | null {
    const program = gl.createProgram();
    if (!program) return null;
    const sources = buildWebgl2Sources(vertexSource, fragmentSource, defines, isBuildPass);
    const vertexShader = compileWebgl2Shader(gl, gl.VERTEX_SHADER, sources.vertex);
    if (!vertexShader) {
        gl.deleteProgram(program);
        return null;
    }
    const fragmentShader = compileWebgl2Shader(gl, gl.FRAGMENT_SHADER, sources.fragment);
    if (!fragmentShader) {
        gl.deleteShader(vertexShader);
        gl.deleteProgram(program);
        return null;
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        gl.deleteProgram(program);
        return null;
    }
    return program;
}

function createSampleEntry(gl: WebGL2RenderingContext, program: WebGLProgram): SampleProgramEntry {
    gl.useProgram(program);
    const uSceneTexLoc = gl.getUniformLocation(program, "uSceneTex");
    if (uSceneTexLoc) gl.uniform1i(uSceneTexLoc, 0);
    const uTransferGeometryLoc = gl.getUniformLocation(program, "uTransferGeometry");
    if (uTransferGeometryLoc) gl.uniform1i(uTransferGeometryLoc, 2);
    const uTransferLightingLoc = gl.getUniformLocation(program, "uTransferLighting");
    if (uTransferLightingLoc) gl.uniform1i(uTransferLightingLoc, 3);

    return {
        program,
        uSizeLoc: gl.getUniformLocation(program, "uSize"),
        uGeomLoc: gl.getUniformLocation(program, "uGeom"),
        uOpticalLoc: gl.getUniformLocation(program, "uOptical"),
        uTintLoc: gl.getUniformLocation(program, "uTint"),
        uHighlightLoc: gl.getUniformLocation(program, "uHighlight"),
        uSceneRectLoc: gl.getUniformLocation(program, "uSceneRect"),
        uDprLoc: gl.getUniformLocation(program, "uDpr"),
        uInteriorMarginLoc: gl.getUniformLocation(program, "uInteriorMargin"),
        uBlurOffset1Loc: gl.getUniformLocation(program, "uBlurOffset1"),
        uBlurOffset2Loc: gl.getUniformLocation(program, "uBlurOffset2"),
        uLightTiltLoc: gl.getUniformLocation(program, "uLightTilt"),
        lastWidth: -1,
        lastHeight: -1,
        lastRadius: -1,
        lastBezel: -1,
        lastIor: -1,
        lastThickness: -1,
        lastScaleRatio: -1,
        lastSurfaceId: -1,
        lastTintR: -1,
        lastTintG: -1,
        lastTintB: -1,
        lastTintA: -1,
        lastHighlight: -1,
        lastChromaStrength: -1,
        lastBlurRadiusPx: -1,
        lastRelX: -1,
        lastRelY: -1,
        lastRelW: -1,
        lastRelH: -1,
        lastDpr: -1,
        lastInteriorMargin: -1,
        lastBlurOffset1X: Number.NaN,
        lastBlurOffset1Y: Number.NaN,
        lastBlurOffset2X: Number.NaN,
        lastBlurOffset2Y: Number.NaN,
        lastLightTiltHorizontal: Number.NaN,
        lastLightTiltVertical: Number.NaN,
    };
}

function resolveSurfaceId(surface: GlassFrameParams["surface"]): number {
    if (surface === "convex_circle") return 1;
    if (surface === "linear") return 2;
    if (surface === "lip") return 3;
    return 0;
}

function selectSampleVariantKey(
    useScene: boolean,
    blurRadiusPx: number,
    hasChroma: boolean,
    clampNeeded: boolean,
    useInteriorBranch: boolean,
): SampleVariantKey {
    if (!useScene) {
        return useInteriorBranch ? "NO_SCENE" : "NO_SCENE_FULL";
    }
    const baseMode = blurRadiusPx > 0 ? "BLUR" : "CLEAR";
    const chromaTag = hasChroma ? "_CHROMA" : "";
    const clampTag = clampNeeded ? "_CLAMP" : "";
    const pathTag = useInteriorBranch ? "" : "_FULL";
    return `${baseMode}${chromaTag}${clampTag}${pathTag}` as SampleVariantKey;
}

export class OpticalTransferCache {
    private readonly gl: WebGL2RenderingContext;
    private readonly vertexSource: string;
    private readonly fragmentSource: string;
    private readonly maxTextureSize: number;
    private readonly buildEntry: BuildProgramEntry;
    private readonly sampleEntries = new Map<SampleVariantKey, SampleProgramEntry>();
    private readonly failedVariants = new Set<SampleVariantKey>();
    private framebuffer: WebGLFramebuffer | null;
    private geometryTexture: WebGLTexture | null = null;
    private lightingTexture: WebGLTexture | null = null;
    geometryKey = "";
    width = 0;
    height = 0;
    allocatedBytes = 0;
    private disposed = false;

    private constructor(
        gl: WebGL2RenderingContext,
        vertexSource: string,
        fragmentSource: string,
        maxTextureSize: number,
        buildEntry: BuildProgramEntry,
        initialSampleEntries: readonly [SampleVariantKey, SampleProgramEntry][],
        framebuffer: WebGLFramebuffer,
    ) {
        this.gl = gl;
        this.vertexSource = vertexSource;
        this.fragmentSource = fragmentSource;
        this.maxTextureSize = maxTextureSize;
        this.buildEntry = buildEntry;
        for (const [key, entry] of initialSampleEntries) {
            this.sampleEntries.set(key, entry);
        }
        this.framebuffer = framebuffer;
    }

    static create(
        rawGl: WebGLRenderingContext,
        vertexSource: string,
        fragmentSource: string,
    ): OpticalTransferCache | null {
        const gl = rawGl as WebGL2RenderingContext;
        if (typeof gl.drawBuffers !== "function") {
            return null;
        }
        if (!gl.getExtension("EXT_color_buffer_float")) {
            return null;
        }

        const buildProgram = createProgramWithDefines(
            gl,
            vertexSource,
            fragmentSource,
            ["LG_TRANSFER_BUILD", "LG_SPECIALIZED"],
            true,
        );
        if (!buildProgram) return null;

        const coreVariants: readonly SampleVariantKey[] = ["NO_SCENE", "CLEAR_CHROMA", "BLUR_CHROMA"];
        const compiledCore: [SampleVariantKey, SampleProgramEntry][] = [];
        for (const variantKey of coreVariants) {
            const sampleProgram = createProgramWithDefines(
                gl,
                vertexSource,
                fragmentSource,
                VARIANT_DEFINES[variantKey],
                false,
            );
            if (!sampleProgram) {
                gl.deleteProgram(buildProgram);
                for (const [, entry] of compiledCore) {
                    gl.deleteProgram(entry.program);
                }
                return null;
            }
            compiledCore.push([variantKey, createSampleEntry(gl, sampleProgram)]);
        }

        const framebuffer = gl.createFramebuffer();
        if (!framebuffer) {
            gl.deleteProgram(buildProgram);
            for (const [, entry] of compiledCore) {
                gl.deleteProgram(entry.program);
            }
            return null;
        }

        gl.useProgram(buildProgram);
        gl.uniform1i(gl.getUniformLocation(buildProgram, "uOpticalLut"), 1);
        gl.activeTexture(gl.TEXTURE0);

        const buildEntry: BuildProgramEntry = {
            program: buildProgram,
            uSizeLoc: gl.getUniformLocation(buildProgram, "uSize"),
            uGeomLoc: gl.getUniformLocation(buildProgram, "uGeom"),
            uOpticalLoc: gl.getUniformLocation(buildProgram, "uOptical"),
            uDprLoc: gl.getUniformLocation(buildProgram, "uDpr"),
            uInteriorMarginLoc: gl.getUniformLocation(buildProgram, "uInteriorMargin"),
            uLutScaleLoc: gl.getUniformLocation(buildProgram, "uLutScale"),
            lastLutSize: -1,
        };

        const maxTextureSize = Math.max(256, Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096);

        return new OpticalTransferCache(
            gl,
            vertexSource,
            fragmentSource,
            maxTextureSize,
            buildEntry,
            compiledCore,
            framebuffer,
        );
    }

    private getOrCompileSampleEntry(variantKey: SampleVariantKey): SampleProgramEntry | null {
        const existing = this.sampleEntries.get(variantKey);
        if (existing) return existing;
        if (this.failedVariants.has(variantKey)) return null;

        const { gl } = this;
        const program = createProgramWithDefines(
            gl,
            this.vertexSource,
            this.fragmentSource,
            VARIANT_DEFINES[variantKey],
            false,
        );
        if (!program) {
            this.failedVariants.add(variantKey);
            return null;
        }

        const entry = createSampleEntry(gl, program);
        this.sampleEntries.set(variantKey, entry);
        return entry;
    }

    private releaseStorage(): void {
        if (this.allocatedBytes > 0) {
            totalAllocatedBytes = Math.max(0, totalAllocatedBytes - this.allocatedBytes);
            this.allocatedBytes = 0;
        }
        if (this.geometryTexture) {
            this.gl.deleteTexture(this.geometryTexture);
            this.geometryTexture = null;
        }
        if (this.lightingTexture) {
            this.gl.deleteTexture(this.lightingTexture);
            this.lightingTexture = null;
        }
        this.width = 0;
        this.height = 0;
        this.geometryKey = "";
    }

    private ensureStorage(targetWidth: number, targetHeight: number): boolean {
        if (
            targetWidth === this.width &&
            targetHeight === this.height &&
            this.geometryTexture !== null &&
            this.lightingTexture !== null
        ) {
            return true;
        }
        if (!this.framebuffer) return false;

        const pixelCount = targetWidth * targetHeight;
        const requiredBytes = pixelCount * BYTES_PER_PIXEL;
        const projectedBytes = totalAllocatedBytes - this.allocatedBytes + requiredBytes;
        if (
            targetWidth <= 0 ||
            targetHeight <= 0 ||
            targetWidth > this.maxTextureSize ||
            targetHeight > this.maxTextureSize ||
            pixelCount > MAX_CACHE_PIXELS ||
            requiredBytes > MAX_CACHE_BYTES ||
            projectedBytes > MAX_CACHE_BYTES
        ) {
            this.releaseStorage();
            return false;
        }

        const { gl } = this;
        if (!this.geometryTexture) {
            this.geometryTexture = gl.createTexture();
        }
        if (!this.lightingTexture) {
            this.lightingTexture = gl.createTexture();
        }
        if (!this.geometryTexture || !this.lightingTexture) {
            this.dispose();
            return false;
        }

        const rgba32fFormat = gl.RGBA32F ?? gl.RGBA;
        const rgba16fFormat = gl.RGBA16F ?? gl.RGBA;
        const floatType = gl.FLOAT ?? 0x1406;
        const halfFloatType = gl.HALF_FLOAT ?? 0x140b;

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.geometryTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texImage2D(gl.TEXTURE_2D, 0, rgba32fFormat, targetWidth, targetHeight, 0, gl.RGBA, floatType, null);

        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, this.lightingTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texImage2D(gl.TEXTURE_2D, 0, rgba16fFormat, targetWidth, targetHeight, 0, gl.RGBA, halfFloatType, null);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.geometryTexture, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.lightingTexture, 0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        const glError = typeof gl.getError === "function" ? gl.getError() : gl.NO_ERROR;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.activeTexture(gl.TEXTURE0);

        if (status !== gl.FRAMEBUFFER_COMPLETE || glError !== gl.NO_ERROR) {
            this.dispose();
            return false;
        }

        totalAllocatedBytes = projectedBytes;
        this.allocatedBytes = requiredBytes;
        this.width = targetWidth;
        this.height = targetHeight;
        this.geometryKey = "";
        return true;
    }

    render(
        frame: GlassFrameParams,
        targetWidth: number,
        targetHeight: number,
        dpr: number,
        opticalTexture: WebGLTexture,
        opticalLutSize: number,
        useScene: boolean,
        blurRadiusPx: number,
        chromaStrength: number,
    ): boolean {
        if (this.disposed) return false;
        if (useScene && !frame.sceneRect) return false;

        const interiorMargin = Math.max(Math.max(1.0, frame.bezel), 14.0, 0.707107 / dpr + 0.5);
        const innerW = Math.max(0, frame.width - 2 * interiorMargin);
        const innerH = Math.max(0, frame.height - 2 * interiorMargin);
        const useInteriorBranch = (innerW * innerH) / Math.max(1, frame.width * frame.height) >= 0.45;
        const hasChroma = chromaStrength >= 1e-4;

        let blurOffset1X = 0;
        let blurOffset1Y = 0;
        let blurOffset2X = 0;
        let blurOffset2Y = 0;
        let clampNeeded = false;

        if (useScene && frame.sceneRect) {
            const { relX, relY, relW, relH } = frame.sceneRect;
            const blurUvX = blurRadiusPx > 0 ? (relW / Math.max(1.0, frame.width)) * blurRadiusPx : 0;
            const blurUvY = blurRadiusPx > 0 ? (relH / Math.max(1.0, frame.height)) * blurRadiusPx : 0;
            blurOffset1X = blurUvX * 0.86;
            blurOffset1Y = blurUvY * 0.34;
            blurOffset2X = -blurUvX * 0.34;
            blurOffset2Y = blurUvY * 0.86;
            const padX = Math.max(Math.abs(blurOffset1X), Math.abs(blurOffset2X));
            const padY = Math.max(Math.abs(blurOffset1Y), Math.abs(blurOffset2Y));
            clampNeeded =
                relX - padX < 0.002 ||
                relX + relW + padX > 0.998 ||
                relY - padY < 0.002 ||
                relY + relH + padY > 0.998;
        }

        const variantKey = selectSampleVariantKey(
            useScene,
            blurRadiusPx,
            hasChroma,
            clampNeeded,
            useInteriorBranch,
        );
        const sampleEntry = this.getOrCompileSampleEntry(variantKey);
        if (!sampleEntry) return false;

        if (!this.ensureStorage(targetWidth, targetHeight)) return false;

        const { gl } = this;
        const surfaceId = resolveSurfaceId(frame.surface);
        const nextGeometryKey = `${targetWidth}:${targetHeight}:${frame.width}:${frame.height}:${frame.radius}:${frame.bezel}:${dpr}:${frame.surface}:${frame.ior}:${interiorMargin}`;

        if (nextGeometryKey !== this.geometryKey && this.framebuffer) {
            const buildEntry = this.buildEntry;
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
            gl.useProgram(buildEntry.program);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, opticalTexture);
            if (buildEntry.lastLutSize !== opticalLutSize) {
                buildEntry.lastLutSize = opticalLutSize;
                if (buildEntry.uLutScaleLoc) {
                    gl.uniform2f(
                        buildEntry.uLutScaleLoc,
                        (opticalLutSize - 1) / opticalLutSize,
                        0.5 / opticalLutSize,
                    );
                }
            }
            if (buildEntry.uSizeLoc) gl.uniform2f(buildEntry.uSizeLoc, frame.width, frame.height);
            if (buildEntry.uGeomLoc) {
                gl.uniform4f(buildEntry.uGeomLoc, frame.width * 0.5, frame.height * 0.5, frame.radius, frame.bezel);
            }
            if (buildEntry.uOpticalLoc) {
                gl.uniform4f(buildEntry.uOpticalLoc, frame.ior, frame.thickness, frame.scaleRatio, surfaceId);
            }
            if (buildEntry.uDprLoc) gl.uniform1f(buildEntry.uDprLoc, dpr);
            if (buildEntry.uInteriorMarginLoc) gl.uniform1f(buildEntry.uInteriorMarginLoc, interiorMargin);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.activeTexture(gl.TEXTURE0);
            this.geometryKey = nextGeometryKey;
        }

        gl.useProgram(sampleEntry.program);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.geometryTexture);
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, this.lightingTexture);
        gl.activeTexture(gl.TEXTURE0);

        if (sampleEntry.uSizeLoc && (frame.width !== sampleEntry.lastWidth || frame.height !== sampleEntry.lastHeight)) {
            gl.uniform2f(sampleEntry.uSizeLoc, frame.width, frame.height);
        }
        if (sampleEntry.uDprLoc && dpr !== sampleEntry.lastDpr) {
            sampleEntry.lastDpr = dpr;
            gl.uniform1f(sampleEntry.uDprLoc, dpr);
        }
        if (sampleEntry.uInteriorMarginLoc && interiorMargin !== sampleEntry.lastInteriorMargin) {
            sampleEntry.lastInteriorMargin = interiorMargin;
            gl.uniform1f(sampleEntry.uInteriorMarginLoc, interiorMargin);
        }
        if (
            frame.width !== sampleEntry.lastWidth ||
            frame.height !== sampleEntry.lastHeight ||
            frame.radius !== sampleEntry.lastRadius ||
            frame.bezel !== sampleEntry.lastBezel
        ) {
            sampleEntry.lastWidth = frame.width;
            sampleEntry.lastHeight = frame.height;
            sampleEntry.lastRadius = frame.radius;
            sampleEntry.lastBezel = frame.bezel;
            if (sampleEntry.uGeomLoc) {
                gl.uniform4f(
                    sampleEntry.uGeomLoc,
                    frame.width * 0.5,
                    frame.height * 0.5,
                    frame.radius,
                    frame.bezel,
                );
            }
        }
        if (
            frame.ior !== sampleEntry.lastIor ||
            frame.thickness !== sampleEntry.lastThickness ||
            frame.scaleRatio !== sampleEntry.lastScaleRatio ||
            surfaceId !== sampleEntry.lastSurfaceId
        ) {
            sampleEntry.lastIor = frame.ior;
            sampleEntry.lastThickness = frame.thickness;
            sampleEntry.lastScaleRatio = frame.scaleRatio;
            sampleEntry.lastSurfaceId = surfaceId;
            if (sampleEntry.uOpticalLoc) {
                gl.uniform4f(sampleEntry.uOpticalLoc, frame.ior, frame.thickness, frame.scaleRatio, surfaceId);
            }
        }
        if (
            frame.tintColor[0] !== sampleEntry.lastTintR ||
            frame.tintColor[1] !== sampleEntry.lastTintG ||
            frame.tintColor[2] !== sampleEntry.lastTintB ||
            frame.tintOpacity !== sampleEntry.lastTintA
        ) {
            sampleEntry.lastTintR = frame.tintColor[0];
            sampleEntry.lastTintG = frame.tintColor[1];
            sampleEntry.lastTintB = frame.tintColor[2];
            sampleEntry.lastTintA = frame.tintOpacity;
            if (sampleEntry.uTintLoc) {
                gl.uniform4f(
                    sampleEntry.uTintLoc,
                    frame.tintColor[0],
                    frame.tintColor[1],
                    frame.tintColor[2],
                    frame.tintOpacity,
                );
            }
        }
        if (
            frame.highlight !== sampleEntry.lastHighlight ||
            chromaStrength !== sampleEntry.lastChromaStrength ||
            blurRadiusPx !== sampleEntry.lastBlurRadiusPx
        ) {
            sampleEntry.lastHighlight = frame.highlight;
            sampleEntry.lastChromaStrength = chromaStrength;
            sampleEntry.lastBlurRadiusPx = blurRadiusPx;
            if (sampleEntry.uHighlightLoc) {
                gl.uniform4f(sampleEntry.uHighlightLoc, frame.highlight, chromaStrength, 4.0, blurRadiusPx);
            }
        }
        if (useScene && frame.sceneRect) {
            const { relX, relY, relW, relH } = frame.sceneRect;
            if (
                sampleEntry.uSceneRectLoc &&
                (relX !== sampleEntry.lastRelX ||
                    relY !== sampleEntry.lastRelY ||
                    relW !== sampleEntry.lastRelW ||
                    relH !== sampleEntry.lastRelH)
            ) {
                sampleEntry.lastRelX = relX;
                sampleEntry.lastRelY = relY;
                sampleEntry.lastRelW = relW;
                sampleEntry.lastRelH = relH;
                gl.uniform4f(sampleEntry.uSceneRectLoc, relX, relY, relW, relH);
            }
            if (
                sampleEntry.uBlurOffset1Loc &&
                (blurOffset1X !== sampleEntry.lastBlurOffset1X || blurOffset1Y !== sampleEntry.lastBlurOffset1Y)
            ) {
                sampleEntry.lastBlurOffset1X = blurOffset1X;
                sampleEntry.lastBlurOffset1Y = blurOffset1Y;
                gl.uniform2f(sampleEntry.uBlurOffset1Loc, blurOffset1X, blurOffset1Y);
            }
            if (
                sampleEntry.uBlurOffset2Loc &&
                (blurOffset2X !== sampleEntry.lastBlurOffset2X || blurOffset2Y !== sampleEntry.lastBlurOffset2Y)
            ) {
                sampleEntry.lastBlurOffset2X = blurOffset2X;
                sampleEntry.lastBlurOffset2Y = blurOffset2Y;
                gl.uniform2f(sampleEntry.uBlurOffset2Loc, blurOffset2X, blurOffset2Y);
            }
        }

        const lightTiltHorizontal = frame.lightTilt?.horizontal ?? 0;
        const lightTiltVertical = frame.lightTilt?.vertical ?? 0;
        if (
            sampleEntry.uLightTiltLoc &&
            (lightTiltHorizontal !== sampleEntry.lastLightTiltHorizontal ||
                lightTiltVertical !== sampleEntry.lastLightTiltVertical)
        ) {
            sampleEntry.lastLightTiltHorizontal = lightTiltHorizontal;
            sampleEntry.lastLightTiltVertical = lightTiltVertical;
            gl.uniform2f(sampleEntry.uLightTiltLoc, lightTiltHorizontal, lightTiltVertical);
        }

        gl.drawArrays(gl.TRIANGLES, 0, 3);
        return true;
    }

    invalidate(): void {
        this.releaseStorage();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.releaseStorage();
        if (this.framebuffer) {
            this.gl.deleteFramebuffer(this.framebuffer);
            this.framebuffer = null;
        }
        this.gl.deleteProgram(this.buildEntry.program);
        for (const entry of this.sampleEntries.values()) {
            this.gl.deleteProgram(entry.program);
        }
        this.sampleEntries.clear();
        this.failedVariants.clear();
    }
}

export function resetOpticalTransferForTesting(): void {
    totalAllocatedBytes = 0;
}
