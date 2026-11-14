import type { GlassSurface } from "./types.js";

export interface GlassFrameParams {
    width: number;
    height: number;
    radius: number;
    bezel: number;
    thickness: number;
    scaleRatio: number;
    ior: number;
    blur: number;
    surface: GlassSurface;
    tintColor: [number, number, number];
    tintOpacity: number;
    highlight: number;
    pixelRatio?: number;
    chromaticAberration?: boolean | number;
    sceneRect?: {
        relX: number;
        relY: number;
        relW: number;
        relH: number;
    };
}

const VERTEX_SHADER_SOURCE = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision highp float;

varying vec2 vUv;

uniform vec2 uSize;
uniform vec4 uGeom;
uniform vec4 uOptical;
uniform vec4 uTint;
uniform vec4 uHighlight;
uniform vec4 uSceneRect;
uniform sampler2D uSceneTex;
uniform float uHasSceneTex;
uniform float uDpr;

const vec3 HALF_PRIMARY = vec3(-0.199003, 0.479950, 0.854427);
const vec3 HALF_SECONDARY = vec3(0.188434, -0.494640, 0.848425);

float evalSurfaceSlope(float x, float surfaceId) {
    float cx = clamp(x, 0.001, 0.999);
    float u = 1.0 - cx;
    if (surfaceId < 0.5) {
        float u2 = u * u;
        float u4 = u2 * u2;
        float invC = inversesqrt(max(1e-6, 1.0 - u2));
        float invS2 = inversesqrt(max(1e-6, 1.0 - u4));
        float invS3 = invS2 * sqrt(invS2);
        return u * (0.30 * invC + 0.70 * u2 * invS3);
    }
    if (surfaceId < 1.5) {
        return u * inversesqrt(max(1e-6, 1.0 - u * u));
    }
    if (surfaceId < 2.5) {
        return 1.0;
    }
    float xu = cx * u;
    return 6.0 * xu + (1.0 - 2.0 * cx) * 1.2;
}

vec3 sampleChromaticFrostedScene(vec2 uvG, vec2 chromaDelta, vec2 blurUv, float hasChroma) {
    vec3 centerG = texture2D(uSceneTex, uvG).rgb;
    if (max(blurUv.x, blurUv.y) <= 0.00001) {
        if (hasChroma < 0.5) {
            return centerG;
        }
        vec2 uvR = clamp(uvG - chromaDelta, 0.002, 0.998);
        vec2 uvB = clamp(uvG + chromaDelta, 0.002, 0.998);
        return vec3(
            texture2D(uSceneTex, uvR).r,
            centerG.g,
            texture2D(uSceneTex, uvB).b
        );
    }
    vec2 offset1 = blurUv * vec2(0.62, 0.28);
    vec2 offset2 = blurUv * vec2(-0.28, 0.62);
    vec3 ringSum =
        texture2D(uSceneTex, clamp(uvG + offset1, 0.002, 0.998)).rgb +
        texture2D(uSceneTex, clamp(uvG - offset1, 0.002, 0.998)).rgb +
        texture2D(uSceneTex, clamp(uvG + offset2, 0.002, 0.998)).rgb +
        texture2D(uSceneTex, clamp(uvG - offset2, 0.002, 0.998)).rgb;
    if (hasChroma < 0.5) {
        return centerG * 0.24 + ringSum * 0.19;
    }
    vec2 uvR = clamp(uvG - chromaDelta * 1.35, 0.002, 0.998);
    vec2 uvB = clamp(uvG + chromaDelta * 1.35, 0.002, 0.998);
    float rCenter = texture2D(uSceneTex, uvR).r;
    float bCenter = texture2D(uSceneTex, uvB).b;
    return vec3(
        rCenter * 0.44 + ringSum.r * 0.14,
        centerG.g * 0.24 + ringSum.g * 0.19,
        bCenter * 0.44 + ringSum.b * 0.14
    );
}

void main() {
    vec2 halfExtents = uSize * 0.5;
    vec2 pt = (vUv - 0.5) * uSize;
    float radius = clamp(uGeom.z, 0.0, min(halfExtents.x, halfExtents.y));
    float bezel = max(1.0, uGeom.w);

    vec2 quadrantSign = sign(pt);
    vec2 q = abs(pt) - halfExtents + vec2(radius);
    vec2 qPlus = max(q, 0.0);
    float outLen = length(qPlus);
    float sd = outLen + min(max(q.x, q.y), 0.0) - radius;

    float aa = 0.42 / max(1.0, uDpr);
    if (sd > aa) {
        gl_FragColor = vec4(0.0);
        return;
    }

    float edgeAA = 1.0 - smoothstep(-aa, aa, sd);
    float depthInBezel = clamp(-sd / bezel, 0.0, 1.0);
    float inBezelMask = 1.0 - smoothstep(0.90, 1.0, depthInBezel);

    vec2 edgeVec = max(q + 0.16, 0.0);
    float edgeLenSq = dot(edgeVec, edgeVec);
    vec2 edgeNormal = quadrantSign * (edgeLenSq > 1e-8 ? edgeVec * inversesqrt(edgeLenSq) : step(q.yx, q.xy));

    float interiorShift = bezel * (0.08 + 0.38 * depthInBezel * depthInBezel);
    vec2 bezelVec = max(q + interiorShift, 1e-4);
    vec2 bezelNormal = quadrantSign * (bezelVec * inversesqrt(dot(bezelVec, bezelVec)));

    float slope = evalSurfaceSlope(depthInBezel, uOptical.w);

    float eta = 1.0 / max(1.01, uOptical.x);
    float slope2 = slope * slope;
    float refractedFactor = (1.0 - eta * eta) / max(0.35, 1.0 + eta * sqrt(1.0 + slope2));
    float tiltDenom = 1.0 + depthInBezel * (0.725 + 0.21 * depthInBezel);
    float meniscusTilt = inBezelMask / (tiltDenom * tiltDenom);
    float xyMag = clamp(meniscusTilt * (0.50 + 0.50 * min(2.0, slope)), 0.0, 0.98);
    vec3 domeNormal = vec3(bezelNormal * xyMag, sqrt(max(0.0, 1.0 - xyMag * xyMag)));

    float ndotv = clamp(domeNormal.z, 0.0, 1.0);
    float fresnelBase = 1.0 - ndotv;
    float fresnelSq = fresnelBase * fresnelBase;
    float fresnel = 0.04 + 0.96 * fresnelSq * fresnelSq;

    float ndoth1 = clamp(dot(domeNormal, HALF_PRIMARY), 0.0, 1.0);
    float ndoth1Sq = ndoth1 * ndoth1;
    float ndoth1Quad = ndoth1Sq * ndoth1Sq;
    float specBroad1 = ndoth1Quad * ndoth1;
    float specSharp1 = (ndoth1Quad * ndoth1Quad) / (12.0 - 11.0 * ndoth1Sq);

    float ndoth2 = clamp(dot(domeNormal, HALF_SECONDARY), 0.0, 1.0);
    float ndoth2Sq = ndoth2 * ndoth2;
    float ndoth2Quad = ndoth2Sq * ndoth2Sq;
    float specCorner2 = (ndoth2Quad * ndoth2Quad) / (10.0 - 9.0 * ndoth2Sq);

    float nxSq = edgeNormal.x * edgeNormal.x;
    float nySq = edgeNormal.y * edgeNormal.y;
    float cornerArc = 4.0 * nxSq * nySq;
    float rimY = clamp(abs(edgeNormal.y), 0.0, 1.0);
    float rimSmooth = smoothstep(0.78, 0.985, rimY);
    float dualRimWeight = max(rimSmooth * rimSmooth, cornerArc * 0.72 + 0.16);

    float dprScale = max(1.0, uDpr * 0.85);
    float rimInset = 0.46 / dprScale;
    float hairlineDist = abs(sd + rimInset);
    float hairlineDistSq = hairlineDist * hairlineDist;
    float hairlineInv = 1.0 / (1.0 + hairlineDistSq * (7.25 * dprScale));
    float hairline = hairlineInv * hairlineInv;

    float innerDepth = max(0.0, -sd);
    float glowDenom = 1.0 + innerDepth * (0.575 + 0.16 * innerDepth);
    float rimGlow = (step(sd, 0.0) * dualRimWeight) / (glowDenom * glowDenom);

    float cornerGlint = (specSharp1 * 0.24 + specCorner2 * 0.16) * inBezelMask * (0.24 + 0.76 * dualRimWeight);
    float archTerm = clamp(vUv.y * 0.90 + 0.08 - abs(vUv.x - 0.34) * 0.36, 0.0, 1.0);
    float archTermSq = archTerm * archTerm;
    float topArchSheen = archTermSq * archTerm * (0.82 + 0.18 * archTerm) * 0.085;
    float bounceTerm = clamp((0.45 - vUv.y) * 2.222222, 0.0, 1.0);
    float bottomBounce = bounceTerm * bounceTerm * (0.83 + 0.17 * bounceTerm) * 0.045;
    float innerBezelSheen = fresnel * (0.12 * inBezelMask) * dualRimWeight;

    float baseRimTerms =
        hairline * dualRimWeight +
        rimGlow * 0.15 +
        cornerGlint +
        hairline * 0.14 * specSharp1 +
        innerBezelSheen +
        specBroad1 * 0.055 * inBezelMask;
    float highlight = clamp((baseRimTerms + topArchSheen + bottomBounce) * uHighlight.x, 0.0, 0.97);

    vec3 baseGlass = uTint.rgb;
    if (uHasSceneTex > 0.5) {
        vec2 uvPerCssPx = vec2(
            uSceneRect.z / max(1.0, uSize.x),
            uSceneRect.w / max(1.0, uSize.y)
        );
        vec2 sceneUv = vec2(
            uSceneRect.x + vUv.x * uSceneRect.z,
            1.0 - (uSceneRect.y + (1.0 - vUv.y) * uSceneRect.w)
        );
        float thicknessBoost = clamp(0.95 + uOptical.y * 0.015625, 1.0, 2.25);
        float dispPixels = bezel * uOptical.z * refractedFactor * meniscusTilt * thicknessBoost * (1.35 + 0.14 * cornerArc);
        vec2 dispUv = -domeNormal.xy * dispPixels * uvPerCssPx;
        vec2 blurUv = uvPerCssPx * uHighlight.w;
        vec2 uvG = clamp(sceneUv + dispUv, 0.002, 0.998);

        float chromaSpread = uHighlight.y * smoothstep(0.10, 0.88, meniscusTilt) * inBezelMask;
        float hasChroma = step(1e-4, chromaSpread);
        vec3 sceneColor = sampleChromaticFrostedScene(uvG, dispUv * chromaSpread, blurUv, hasChroma);

        float luma = dot(sceneColor, vec3(0.299, 0.587, 0.114));
        vec3 vibrantScene = clamp(mix(vec3(luma), sceneColor, 2.30) * 1.04, 0.0, 1.0);
        vec3 tintedScene = mix(vibrantScene, baseGlass, clamp(uTint.a, 0.0, 0.85));
        float strokeInv = 1.0 / (1.0 + hairlineDistSq * (12.0 * max(1.0, uDpr)));
        float outerStroke = strokeInv * strokeInv * 0.06;
        vec3 framedScene = mix(tintedScene, vec3(0.06, 0.09, 0.16), outerStroke * step(0.55, luma));
        float ambientSheenScale = mix(0.35, 1.0, smoothstep(0.08, 0.45, luma));
        float effectiveHighlight = clamp(
            (baseRimTerms + (topArchSheen + bottomBounce) * ambientSheenScale) * uHighlight.x,
            0.0,
            0.97
        );
        vec3 litColor = mix(framedScene, vec3(1.0), effectiveHighlight * 0.86);
        vec3 finalColor = clamp(litColor + vec3(1.0) * (rimGlow * 0.07 + cornerGlint * 0.12) * uHighlight.x, 0.0, 1.0);
        gl_FragColor = vec4(finalColor * edgeAA, edgeAA);
        return;
    }

    float fallbackAlpha = clamp(max(uTint.a, highlight * 0.78), 0.0, 0.92) * edgeAA;
    vec3 fallbackColor = clamp(mix(baseGlass, vec3(1.0), highlight) + vec3(1.0) * (rimGlow * 0.07 + cornerGlint * 0.12) * uHighlight.x, 0.0, 1.0);
    gl_FragColor = vec4(fallbackColor * fallbackAlpha, fallbackAlpha);
}
`;

function compileShader(
    gl: WebGLRenderingContext,
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

export function parseCssColorToRgb(colorStr = "#ffffff"): [number, number, number] {
    const trimmed = colorStr.trim();
    if (trimmed.startsWith("#")) {
        const hex = trimmed.slice(1);
        if (hex.length === 3) {
            return [
                parseInt(hex[0] + hex[0], 16) / 255,
                parseInt(hex[1] + hex[1], 16) / 255,
                parseInt(hex[2] + hex[2], 16) / 255,
            ];
        }
        if (hex.length >= 6) {
            return [
                parseInt(hex.slice(0, 2), 16) / 255,
                parseInt(hex.slice(2, 4), 16) / 255,
                parseInt(hex.slice(4, 6), 16) / 255,
            ];
        }
    }
    const rgbMatch = trimmed.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (rgbMatch) {
        return [
            Math.min(1, Math.max(0, Number(rgbMatch[1]) / 255)),
            Math.min(1, Math.max(0, Number(rgbMatch[2]) / 255)),
            Math.min(1, Math.max(0, Number(rgbMatch[3]) / 255)),
        ];
    }
    return [1, 1, 1];
}

const ROUNDED_MIN_WEBGL_PIXEL_RATIO = 2;
const ROUNDED_MAX_WEBGL_PIXEL_RATIO = 3;
const EXPLICIT_MAX_WEBGL_PIXEL_RATIO = 4;
const UNROUNDED_WEBGL_PIXEL_RATIO = 1;
const ROUNDED_RADIUS_THRESHOLD = 2;
const MAX_WEBGL_FRAMEBUFFER_PIXELS = 4_194_304;

export function resolveWebglPixelRatio(requestedPixelRatio?: number, radius = 18): number {
    if (
        typeof requestedPixelRatio === "number" &&
        Number.isFinite(requestedPixelRatio) &&
        requestedPixelRatio > 0
    ) {
        return Math.min(EXPLICIT_MAX_WEBGL_PIXEL_RATIO, Math.max(0.5, requestedPixelRatio));
    }
    if (radius <= ROUNDED_RADIUS_THRESHOLD) {
        return UNROUNDED_WEBGL_PIXEL_RATIO;
    }
    const deviceDpr =
        typeof window !== "undefined" &&
        typeof window.devicePixelRatio === "number" &&
        Number.isFinite(window.devicePixelRatio) &&
        window.devicePixelRatio > 0
            ? window.devicePixelRatio
            : 1;
    return Math.min(
        ROUNDED_MAX_WEBGL_PIXEL_RATIO,
        Math.max(ROUNDED_MIN_WEBGL_PIXEL_RATIO, deviceDpr),
    );
}

export class GlassWebglRenderer {
    private readonly canvas: HTMLCanvasElement;
    private readonly gl: WebGLRenderingContext;
    private readonly program: WebGLProgram;
    private readonly vertexBuffer: WebGLBuffer;
    private readonly maxViewportWidth: number;
    private readonly maxViewportHeight: number;
    private readonly maxTextureSize: number;
    private uploadCanvas: HTMLCanvasElement | null = null;
    private readonly uSizeLoc: WebGLUniformLocation | null;
    private readonly uGeomLoc: WebGLUniformLocation | null;
    private readonly uOpticalLoc: WebGLUniformLocation | null;
    private readonly uTintLoc: WebGLUniformLocation | null;
    private readonly uHighlightLoc: WebGLUniformLocation | null;
    private readonly uSceneRectLoc: WebGLUniformLocation | null;
    private readonly uSceneTexLoc: WebGLUniformLocation | null;
    private readonly uHasSceneTexLoc: WebGLUniformLocation | null;
    private readonly uDprLoc: WebGLUniformLocation | null;
    private sceneTexture: WebGLTexture | null = null;
    private hasSceneTextureData = false;
    private pixelWidth = 0;
    private pixelHeight = 0;
    private lastCssWidth = -1;
    private lastCssHeight = -1;
    private lastDpr = -1;
    private lastRadius = -1;
    private lastBezel = -1;
    private lastIor = -1;
    private lastThickness = -1;
    private lastScaleRatio = -1;
    private lastSurfaceId = -1;
    private lastTintR = -1;
    private lastTintG = -1;
    private lastTintB = -1;
    private lastTintA = -1;
    private lastHighlight = -1;
    private lastChromaStrength = -1;
    private lastBlurRadiusPx = -1;
    private lastHasScene = -1;
    private lastRelX = -1;
    private lastRelY = -1;
    private lastRelW = -1;
    private lastRelH = -1;
    private disposed = false;

    private constructor(
        canvas: HTMLCanvasElement,
        gl: WebGLRenderingContext,
        program: WebGLProgram,
        vertexBuffer: WebGLBuffer,
    ) {
        this.canvas = canvas;
        this.gl = gl;
        this.program = program;
        this.vertexBuffer = vertexBuffer;
        const viewportDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as ArrayLike<number> | null;
        const maxTextureSize = Math.max(256, Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096);
        this.maxTextureSize = maxTextureSize;
        this.maxViewportWidth =
            viewportDims && Number(viewportDims[0]) > 0 ? Number(viewportDims[0]) : maxTextureSize;
        this.maxViewportHeight =
            viewportDims && Number(viewportDims[1]) > 0 ? Number(viewportDims[1]) : maxTextureSize;
        this.uSizeLoc = gl.getUniformLocation(program, "uSize");
        this.uGeomLoc = gl.getUniformLocation(program, "uGeom");
        this.uOpticalLoc = gl.getUniformLocation(program, "uOptical");
        this.uTintLoc = gl.getUniformLocation(program, "uTint");
        this.uHighlightLoc = gl.getUniformLocation(program, "uHighlight");
        this.uSceneRectLoc = gl.getUniformLocation(program, "uSceneRect");
        this.uSceneTexLoc = gl.getUniformLocation(program, "uSceneTex");
        this.uHasSceneTexLoc = gl.getUniformLocation(program, "uHasSceneTex");
        this.uDprLoc = gl.getUniformLocation(program, "uDpr");
        gl.uniform1i(this.uSceneTexLoc, 0);
        gl.uniform1f(this.uHasSceneTexLoc, 0);
        gl.uniform1f(this.uDprLoc, 1);
    }

    static create(canvas: HTMLCanvasElement): GlassWebglRenderer | null {
        const contextOptions: WebGLContextAttributes = {
            alpha: true,
            antialias: false,
            depth: false,
            stencil: false,
            premultipliedAlpha: true,
            preserveDrawingBuffer: false,
            powerPreference: "high-performance",
        };

        const gl =
            (canvas.getContext("webgl2", contextOptions) as WebGLRenderingContext | null) ||
            canvas.getContext("webgl", contextOptions);
        if (!gl) return null;

        const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
        const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
        if (!vertexShader || !fragmentShader) {
            if (vertexShader) gl.deleteShader(vertexShader);
            if (fragmentShader) gl.deleteShader(fragmentShader);
            return null;
        }

        const program = gl.createProgram();
        if (!program) {
            gl.deleteShader(vertexShader);
            gl.deleteShader(fragmentShader);
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

        const vertexBuffer = gl.createBuffer();
        if (!vertexBuffer) {
            gl.deleteProgram(program);
            return null;
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

        const posLocation = gl.getAttribLocation(program, "aPosition");
        gl.useProgram(program);
        gl.enableVertexAttribArray(posLocation);
        gl.vertexAttribPointer(posLocation, 2, gl.FLOAT, false, 0, 0);

        return new GlassWebglRenderer(canvas, gl, program, vertexBuffer);
    }

    setSceneCanvas(sourceCanvas: HTMLCanvasElement | null): void {
        if (this.disposed) return;
        const { gl } = this;
        if (typeof gl.isContextLost === "function" && gl.isContextLost()) {
            this.hasSceneTextureData = false;
            return;
        }
        if (!sourceCanvas || sourceCanvas.width === 0 || sourceCanvas.height === 0) {
            this.hasSceneTextureData = false;
            return;
        }

        let uploadSource = sourceCanvas;
        if (
            sourceCanvas.width > this.maxTextureSize ||
            sourceCanvas.height > this.maxTextureSize
        ) {
            const fitScale = Math.min(
                this.maxTextureSize / sourceCanvas.width,
                this.maxTextureSize / sourceCanvas.height,
            );
            const scaledWidth = Math.max(2, Math.floor(sourceCanvas.width * fitScale));
            const scaledHeight = Math.max(2, Math.floor(sourceCanvas.height * fitScale));
            if (!this.uploadCanvas && typeof document !== "undefined") {
                this.uploadCanvas = document.createElement("canvas");
            }
            if (this.uploadCanvas) {
                if (this.uploadCanvas.width !== scaledWidth) this.uploadCanvas.width = scaledWidth;
                if (this.uploadCanvas.height !== scaledHeight) {
                    this.uploadCanvas.height = scaledHeight;
                }
                const uploadCtx = this.uploadCanvas.getContext("2d");
                if (uploadCtx) {
                    uploadCtx.imageSmoothingEnabled = true;
                    uploadCtx.imageSmoothingQuality = "high";
                    uploadCtx.clearRect(0, 0, scaledWidth, scaledHeight);
                    uploadCtx.drawImage(sourceCanvas, 0, 0, scaledWidth, scaledHeight);
                    uploadSource = this.uploadCanvas;
                }
            }
        }

        if (!this.sceneTexture) {
            this.sceneTexture = gl.createTexture();
        }
        if (!this.sceneTexture) return;

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, uploadSource);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        this.hasSceneTextureData = true;
    }

    render(frame: GlassFrameParams): void {
        if (this.disposed) return;
        if (typeof this.gl.isContextLost === "function" && this.gl.isContextLost()) return;
        if (frame.width < 2 || frame.height < 2) return;

        const desiredDpr = resolveWebglPixelRatio(frame.pixelRatio, frame.radius);
        const maxAreaScale = Math.sqrt(
            MAX_WEBGL_FRAMEBUFFER_PIXELS / Math.max(1, frame.width * frame.height),
        );
        const maxDimScale = Math.min(
            this.maxViewportWidth / Math.max(1, frame.width),
            this.maxViewportHeight / Math.max(1, frame.height),
        );
        const dpr = Math.max(0.25, Math.min(desiredDpr, maxAreaScale, maxDimScale));
        const targetWidth = Math.max(
            1,
            Math.min(this.maxViewportWidth, Math.round(frame.width * dpr)),
        );
        const targetHeight = Math.max(
            1,
            Math.min(this.maxViewportHeight, Math.round(frame.height * dpr)),
        );

        if (targetWidth !== this.pixelWidth || targetHeight !== this.pixelHeight) {
            this.pixelWidth = targetWidth;
            this.pixelHeight = targetHeight;
            this.canvas.width = targetWidth;
            this.canvas.height = targetHeight;
            this.gl.viewport(0, 0, targetWidth, targetHeight);
        }

        const { gl } = this;
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        let surfaceId = 0;
        if (frame.surface === "convex_circle") surfaceId = 1;
        else if (frame.surface === "linear") surfaceId = 2;
        else if (frame.surface === "lip") surfaceId = 3;

        if (frame.width !== this.lastCssWidth || frame.height !== this.lastCssHeight) {
            gl.uniform2f(this.uSizeLoc, frame.width, frame.height);
        }
        if (dpr !== this.lastDpr) {
            this.lastDpr = dpr;
            gl.uniform1f(this.uDprLoc, dpr);
        }
        if (
            frame.width !== this.lastCssWidth ||
            frame.height !== this.lastCssHeight ||
            frame.radius !== this.lastRadius ||
            frame.bezel !== this.lastBezel
        ) {
            this.lastCssWidth = frame.width;
            this.lastCssHeight = frame.height;
            this.lastRadius = frame.radius;
            this.lastBezel = frame.bezel;
            gl.uniform4f(
                this.uGeomLoc,
                frame.width * 0.5,
                frame.height * 0.5,
                frame.radius,
                frame.bezel,
            );
        }
        if (
            frame.ior !== this.lastIor ||
            frame.thickness !== this.lastThickness ||
            frame.scaleRatio !== this.lastScaleRatio ||
            surfaceId !== this.lastSurfaceId
        ) {
            this.lastIor = frame.ior;
            this.lastThickness = frame.thickness;
            this.lastScaleRatio = frame.scaleRatio;
            this.lastSurfaceId = surfaceId;
            gl.uniform4f(
                this.uOpticalLoc,
                frame.ior,
                frame.thickness,
                frame.scaleRatio,
                surfaceId,
            );
        }
        if (
            frame.tintColor[0] !== this.lastTintR ||
            frame.tintColor[1] !== this.lastTintG ||
            frame.tintColor[2] !== this.lastTintB ||
            frame.tintOpacity !== this.lastTintA
        ) {
            this.lastTintR = frame.tintColor[0];
            this.lastTintG = frame.tintColor[1];
            this.lastTintB = frame.tintColor[2];
            this.lastTintA = frame.tintOpacity;
            gl.uniform4f(
                this.uTintLoc,
                frame.tintColor[0],
                frame.tintColor[1],
                frame.tintColor[2],
                frame.tintOpacity,
            );
        }

        const blurRadiusPx = frame.blur > 0 ? Math.min(18.0, frame.blur * 2.4) : 0;
        const chromaStrength =
            typeof frame.chromaticAberration === "number"
                ? Number.isFinite(frame.chromaticAberration)
                    ? Math.min(0.25, Math.max(0, frame.chromaticAberration))
                    : 0
                : frame.chromaticAberration === true
                  ? 0.085
                  : 0;
        if (
            frame.highlight !== this.lastHighlight ||
            chromaStrength !== this.lastChromaStrength ||
            blurRadiusPx !== this.lastBlurRadiusPx
        ) {
            this.lastHighlight = frame.highlight;
            this.lastChromaStrength = chromaStrength;
            this.lastBlurRadiusPx = blurRadiusPx;
            gl.uniform4f(this.uHighlightLoc, frame.highlight, chromaStrength, 4.0, blurRadiusPx);
        }

        const useSceneFlag = this.hasSceneTextureData && Boolean(frame.sceneRect) ? 1.0 : 0.0;
        if (useSceneFlag !== this.lastHasScene) {
            this.lastHasScene = useSceneFlag;
            gl.uniform1f(this.uHasSceneTexLoc, useSceneFlag);
        }
        if (useSceneFlag > 0.5 && frame.sceneRect) {
            if (this.sceneTexture) {
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
            }
            const { relX, relY, relW, relH } = frame.sceneRect;
            if (
                relX !== this.lastRelX ||
                relY !== this.lastRelY ||
                relW !== this.lastRelW ||
                relH !== this.lastRelH
            ) {
                this.lastRelX = relX;
                this.lastRelY = relY;
                this.lastRelW = relW;
                this.lastRelH = relH;
                gl.uniform4f(this.uSceneRectLoc, relX, relY, relW, relH);
            }
        }

        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.sceneTexture) {
            this.gl.deleteTexture(this.sceneTexture);
            this.sceneTexture = null;
        }
        this.uploadCanvas = null;
        this.gl.deleteBuffer(this.vertexBuffer);
        this.gl.deleteProgram(this.program);
    }
}
