import { automaticRoundedPixelRatio, resizeCanvas, SMALL_FRAME_PIXELS, SMALL_SCENE_DIMENSION, useSmallMemoryBudget } from "./renderBudget.js";
import type { CoalescencePeer } from "./coalescence.js";
import type { GlassCornerStyle, GlassRefractionDirection, GlassSurface } from "./types.js";
import {
    CHROMATIC_BLUE_SHIFT_RATIO,
    CHROMATIC_RED_SHIFT_RATIO,
    resolveChromaticChannelScales,
    resolveCornerStyle,
    resolveEffectiveChromaticAberration,
    resolveGlassSaturation,
    resolveGlassSharpness,
    resolveSharpnessPixelRatio,
    resolveSurfaceId,
} from "./config.js";
import { buildOpticalLut, OPTICAL_LUT_SIZE, resolveGlassMedium, type GlassMediumCoefficients } from "./optics.js";
import { getOpticalLutPeak, getRefractionDirectionId, getRefractionSpan, resolveRefractionBezel, resolveRefractionEdgeFade, resolveRefractionTravel } from "./refractionBounds.js";
import { buildWebgl2Sources, canAllocateOpticalTransfer, OpticalTransferCache } from "./opticalTransfer.js";
import { parseCssColorToRgb } from "./cssColor.js";

export { parseCssColorToRgb };

export interface GlassFrameParams {
    width: number;
    height: number;
    radius: number;
    cornerStyle?: GlassCornerStyle;
    bezel: number;
    adaptiveRefraction?: boolean;
    refractionDirection?: GlassRefractionDirection;
    refractionEdgeFade?: number;
    maxRefractionPx?: number;
    maxScaleMultiplier?: number;
    thickness: number;
    scaleRatio: number;
    ior: number;
    blur: number;
    sharpness?: number;
    saturation?: number;
    surface: GlassSurface;
    tintColor: [number, number, number];
    tintOpacity: number;
    highlight: number;
    darkRimScale?: number;
    pixelRatio?: number;
    chromaticAberration?: boolean | number;
    abbeNumber?: number;
    lightTilt?: {
        readonly horizontal: number;
        readonly vertical: number;
    };
    sceneRect?: {
        relX: number;
        relY: number;
        relW: number;
        relH: number;
    };
    coalescePeers?: readonly CoalescencePeer[];
    bleedPx?: number;
}

const VERTEX_SHADER_SOURCE = `
attribute vec2 aPosition;
varying vec2 vUv;
uniform vec4 uCoalesceBleed;
#if defined(LG_SAMPLE_BLUR) || defined(LG_INTERIOR_PASS) || (!defined(LG_TRANSFER_BUILD) && !defined(LG_TRANSFER_SAMPLE))
varying vec2 vSceneUv;
varying vec2 vUv1P;
varying vec2 vUv1M;
varying vec2 vUv2P;
varying vec2 vUv2M;
uniform vec4 uSceneRect;
uniform vec2 uBlurOffset1;
uniform vec2 uBlurOffset2;
#endif
void main() {
    vec2 canvasUv = aPosition * 0.5 + 0.5;
    vUv = canvasUv * (1.0 + uCoalesceBleed.xy) + uCoalesceBleed.zw;
#if defined(LG_SAMPLE_BLUR) || defined(LG_INTERIOR_PASS) || (!defined(LG_TRANSFER_BUILD) && !defined(LG_TRANSFER_SAMPLE))
    vSceneUv = vec2(
        uSceneRect.x + vUv.x * uSceneRect.z,
        1.0 - (uSceneRect.y + (1.0 - vUv.y) * uSceneRect.w)
    );
    vUv1P = vSceneUv + uBlurOffset1;
    vUv1M = vSceneUv - uBlurOffset1;
    vUv2P = vSceneUv + uBlurOffset2;
    vUv2M = vSceneUv - uBlurOffset2;
#endif
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `precision highp float;

varying vec2 vUv;
#if defined(LG_SAMPLE_BLUR) || defined(LG_INTERIOR_PASS) || (!defined(LG_TRANSFER_BUILD) && !defined(LG_TRANSFER_SAMPLE))
varying vec2 vSceneUv;
varying vec2 vUv1P;
varying vec2 vUv1M;
varying vec2 vUv2P;
varying vec2 vUv2M;
#endif

uniform vec2 uSize;
uniform vec4 uGeom;
uniform vec4 uOptical;
uniform vec2 uRefraction;
uniform vec4 uTint;
uniform vec4 uMedium;
uniform float uSaturation;
uniform float uSharpness;
uniform vec4 uHighlight;
uniform vec4 uSceneRect;
uniform sampler2D uSceneTex;
uniform float uHasSceneTex;
uniform float uDpr;
uniform vec2 uPixelSize;
uniform sampler2D uOpticalLut;
uniform vec2 uLutScale;
uniform float uInteriorMargin;
uniform float uDirectBlurClamp;
uniform sampler2D uInteriorTex;
uniform float uUseInteriorTex;
uniform vec2 uLightTilt;
uniform float uSquircle;
uniform float uPeerCount;
uniform vec4 uPeerBounds[4];
uniform vec4 uPeerProps[4];

#ifdef LG_TRANSFER_BUILD
layout(location = 0) out vec4 transferGeometry;
layout(location = 1) out vec4 transferLighting;
#endif
#ifdef LG_TRANSFER_SAMPLE
uniform highp sampler2D uTransferGeometry;
uniform highp sampler2D uTransferLighting;
#endif

const vec3 HALF_PRIMARY = vec3(-0.199003, 0.479950, 0.854427);
const vec3 HALF_SECONDARY = vec3(0.214176, -0.464049, 0.859528);

const vec2 DECODE_LUT16 = vec2(65280.0 / 32767.0, 255.0 / 32767.0);

vec3 evalSquircleGeom(vec2 qPlus, float radius) {
    bool xMajor = qPlus.x >= qPlus.y;
    float major = xMajor ? qPlus.x : qPlus.y;
    float minor = xMajor ? qPlus.y : qPlus.x;
    float r = minor / major;
    float r2 = r * r;
    float r3 = r * r2;
    float r4 = r2 * r2;
    float m2 = sqrt(1.0 + r4);
    float m4 = sqrt(m2);
    float invG = inversesqrt(1.0 + r3 * r3);
    float sdCorner = (major * m4 - radius) * (m2 * m4 * invG);
    float minorNorm = r3 * invG;
    vec2 normalDir = xMajor ? vec2(invG, minorNorm) : vec2(minorNorm, invG);
    return vec3(sdCorner, normalDir);
}

float evalSquircleSd(vec2 qPlus, float radius) {
    float major = max(qPlus.x, qPlus.y);
    float minor = min(qPlus.x, qPlus.y);
    float r = minor / major;
    float r2 = r * r;
    float r3 = r * r2;
    float r4 = r2 * r2;
    float m2 = sqrt(1.0 + r4);
    float m4 = sqrt(m2);
    return (major * m4 - radius) * (m2 * m4 * inversesqrt(1.0 + r3 * r3));
}

float edgeCoverage(float sd, vec2 gradient) {
    // Project the pixel box onto the local gradient of the signed distance.
    vec2 projected = abs(gradient) * uPixelSize;
    float rawMajor = max(max(projected.x, projected.y), 1e-5);
    float rawMinor = min(projected.x, projected.y);
    // Widen the AA filter footprint on curved arcs (circles, pills, rounded corners)
    // so shallow curves do not show 1px box-filter stair-stepping.
    float curveBlend = smoothstep(0.0, 0.35, rawMinor / rawMajor);
    float filterScale = mix(1.0, 1.48, curveBlend);
    float major = rawMajor * filterScale;
    float minor = rawMinor * filterScale;
    float absSd = abs(sd);
    float plateau = (major - minor) * 0.5;
    float coverage;
    if (absSd <= plateau) {
        coverage = 0.5 - sd / major;
    } else {
        // Beyond the central strip, the area on the smaller side is a triangle.
        float tail = max(0.0, (major + minor) * 0.5 - absSd);
        float triangleArea = tail * tail / (2.0 * major * max(minor, 1e-5));
        coverage = sd > 0.0 ? triangleArea : 1.0 - triangleArea;
    }
    float clampedCov = clamp(coverage, 0.0, 1.0);
    float softCov = clampedCov * clampedCov * (3.0 - 2.0 * clampedCov);
    return mix(clampedCov, softCov, 0.35 * curveBlend);
}

vec2 sampleOpticalLut16(float depthT) {
    float fIdx = clamp(depthT, 0.0, 1.0) * uLutScale.x;
    float i0 = floor(fIdx);
    float frac = fIdx - i0;
    float u0 = (i0 + 0.5) * uLutScale.y;
    vec4 t0 = texture2D(uOpticalLut, vec2(u0, 0.5));
    vec4 t1 = texture2D(uOpticalLut, vec2(u0 + uLutScale.y, 0.5));
    vec4 t = mix(t0, t1, frac);
    return vec2(dot(t.rg, DECODE_LUT16), dot(t.ba, DECODE_LUT16)) - 1.0;
}

vec2 sminPoly(float aDist, float bDist, float kSmooth) {
    float safeK = max(kSmooth, 0.001);
    float h = max(safeK - abs(aDist - bDist), 0.0) / safeK;
    float blended = min(aDist, bDist) - (safeK / 6.0) * h * h * h;
    float weightA = aDist < bDist ? (1.0 - 0.5 * h * h) : (0.5 * h * h);
    return vec2(blended, weightA);
}

float evalAmbientSheen(vec2 uv) {
    vec2 shiftedCenter = vec2(0.34 + uLightTilt.x * 0.20, uLightTilt.y * 0.14);
    float smoothDeltaX = sqrt((uv.x - shiftedCenter.x) * (uv.x - shiftedCenter.x) + 0.015);
    float archTerm = clamp(uv.y * 0.90 + 0.08 + shiftedCenter.y - smoothDeltaX * 0.36, 0.0, 1.0);
    float archTermSq = archTerm * archTerm;
    float topArchSheen = archTermSq * archTerm * (0.82 + 0.18 * archTerm) * 0.068;
    float bounceTerm = clamp((0.45 - uv.y - shiftedCenter.y * 0.5) * 2.222222, 0.0, 1.0);
    float bottomBounce = bounceTerm * bounceTerm * (0.83 + 0.17 * bounceTerm) * 0.030;
    return topArchSheen + bottomBounce;
}

float compressHighlight(float rawHighlight) {
    float clamped = max(0.0, rawHighlight);
    return clamp(clamped / (1.0 + 0.50 * clamped), 0.0, 0.60);
}

#ifndef LG_TRANSFER_BUILD
vec4 sampleSceneTex(vec2 uv) {
#ifdef LG_WEBGL2
    vec2 gradX = vec2((uSceneRect.z / max(1.0, uSize.x)) * uPixelSize.x, 0.0);
    vec2 gradY = vec2(0.0, (uSceneRect.w / max(1.0, uSize.y)) * uPixelSize.y);
    return textureGrad(uSceneTex, uv, gradX, gradY);
#else
    return texture2D(uSceneTex, uv);
#endif
}
#endif

#if defined(LG_SAMPLE_BLUR) || defined(LG_INTERIOR_PASS) || (!defined(LG_TRANSFER_BUILD) && !defined(LG_TRANSFER_SAMPLE))
vec3 sampleInteriorBlur5Tap(bool clampUv) {
    if (clampUv) {
        vec3 centerG = sampleSceneTex(clamp(vSceneUv, 0.002, 0.998)).rgb;
        vec3 outerSum =
            sampleSceneTex(clamp(vUv1P, 0.002, 0.998)).rgb +
            sampleSceneTex(clamp(vUv1M, 0.002, 0.998)).rgb +
            sampleSceneTex(clamp(vUv2P, 0.002, 0.998)).rgb +
            sampleSceneTex(clamp(vUv2M, 0.002, 0.998)).rgb;
        return centerG * 0.24 + outerSum * 0.19;
    }
    vec3 centerG = sampleSceneTex(vSceneUv).rgb;
    vec3 outerSum =
        sampleSceneTex(vUv1P).rgb +
        sampleSceneTex(vUv1M).rgb +
        sampleSceneTex(vUv2P).rgb +
        sampleSceneTex(vUv2M).rgb;
    return centerG * 0.24 + outerSum * 0.19;
}
#endif

#if defined(LG_SPECIALIZED) && defined(LG_SAMPLE_BLUR) && !defined(LG_TRANSFER_BUILD)
vec3 sampleInteriorBlur() {
#ifdef LG_SAMPLE_CLAMP
    return sampleInteriorBlur5Tap(true);
#else
    return sampleInteriorBlur5Tap(false);
#endif
}
#endif

#if !defined(LG_TRANSFER_BUILD) && (!defined(LG_TRANSFER_SAMPLE) || defined(LG_SAMPLE_CHROMA))
vec3 sampleSpectralCenter(
    vec2 rayUv,
    vec2 chromaR,
    vec2 chromaB,
    vec3 centerG,
    float chromaMix,
    float dispersionPxSq
) {
    if (chromaMix <= 0.0) return centerG;
    vec2 uvR = clamp(rayUv - chromaR, 0.002, 0.998);
    vec2 uvB = clamp(rayUv + chromaB, 0.002, 0.998);
    float redSample = sampleSceneTex(uvR).r;
    float blueSample = sampleSceneTex(uvB).b;
    vec3 dualDispersed = vec3(redSample, centerG.g, blueSample);
    if (dispersionPxSq <= 2.25) {
        return mix(centerG, dualDispersed, chromaMix);
    }
    vec2 uvY = clamp(rayUv - chromaR * 0.35, 0.002, 0.998);
    vec2 uvC = clamp(rayUv + chromaB * 0.44, 0.002, 0.998);
    vec2 sampleY = sampleSceneTex(uvY).rg;
    vec2 sampleC = sampleSceneTex(uvC).gb;
    vec3 quadDispersed = vec3(
        redSample * 0.62 + sampleY.x * 0.38,
        sampleY.y * 0.22 + centerG.g * 0.56 + sampleC.x * 0.22,
        sampleC.y * 0.38 + blueSample * 0.62
    );
    float quadBlend = smoothstep(2.25, 6.25, dispersionPxSq);
    return mix(centerG, mix(dualDispersed, quadDispersed, quadBlend), chromaMix);
}

vec2 sampleSpectralBlur5Tap(
    vec2 rayUv,
    vec2 chromaR,
    vec2 chromaB,
    vec2 tap1,
    vec2 tap2,
    float centerWeight,
    float crossWeight
) {
    vec2 uvR = rayUv - chromaR;
    vec2 uvB = rayUv + chromaB;
#ifdef LG_WEBGL2
    vec2 baseGradX = vec2((uSceneRect.z / max(1.0, uSize.x)) * uPixelSize.x, 0.0);
    vec2 baseGradY = vec2(0.0, (uSceneRect.w / max(1.0, uSize.y)) * uPixelSize.y);
    float spanX = max(abs(tap1.x), abs(tap2.x));
    float spanY = max(abs(tap1.y), abs(tap2.y));
    if (centerWeight >= 0.26) {
        vec2 blurGradX = vec2(max(spanX * 1.45, baseGradX.x), 0.0);
        vec2 blurGradY = vec2(0.0, max(spanY * 1.45, baseGradY.y));
        float redBlur = textureGrad(uSceneTex, clamp(uvR, 0.002, 0.998), blurGradX, blurGradY).r;
        float blueBlur = textureGrad(uSceneTex, clamp(uvB, 0.002, 0.998), blurGradX, blurGradY).b;
        return vec2(redBlur, blueBlur);
    }
    vec2 dipoleStep = (tap1 + tap2) * 0.36;
    vec2 dipoleGradX = vec2(max(spanX * 1.05, baseGradX.x), 0.0);
    vec2 dipoleGradY = vec2(0.0, max(spanY * 1.05, baseGradY.y));
    float redBlur = 0.5 * (
        textureGrad(uSceneTex, clamp(uvR + dipoleStep, 0.002, 0.998), dipoleGradX, dipoleGradY).r +
        textureGrad(uSceneTex, clamp(uvR - dipoleStep, 0.002, 0.998), dipoleGradX, dipoleGradY).r
    );
    float blueBlur = 0.5 * (
        textureGrad(uSceneTex, clamp(uvB + dipoleStep, 0.002, 0.998), dipoleGradX, dipoleGradY).b +
        textureGrad(uSceneTex, clamp(uvB - dipoleStep, 0.002, 0.998), dipoleGradX, dipoleGradY).b
    );
    return vec2(redBlur, blueBlur);
#else
    float redBlur =
        sampleSceneTex(clamp(uvR, 0.002, 0.998)).r * centerWeight +
        (sampleSceneTex(clamp(uvR + tap1, 0.002, 0.998)).r +
         sampleSceneTex(clamp(uvR - tap1, 0.002, 0.998)).r +
         sampleSceneTex(clamp(uvR + tap2, 0.002, 0.998)).r +
         sampleSceneTex(clamp(uvR - tap2, 0.002, 0.998)).r) * crossWeight;
    float blueBlur =
        sampleSceneTex(clamp(uvB, 0.002, 0.998)).b * centerWeight +
        (sampleSceneTex(clamp(uvB + tap1, 0.002, 0.998)).b +
         sampleSceneTex(clamp(uvB - tap1, 0.002, 0.998)).b +
         sampleSceneTex(clamp(uvB + tap2, 0.002, 0.998)).b +
         sampleSceneTex(clamp(uvB - tap2, 0.002, 0.998)).b) * crossWeight;
    return vec2(redBlur, blueBlur);
#endif
}
#endif

#if !defined(LG_TRANSFER_BUILD) && (!defined(LG_TRANSFER_SAMPLE) || defined(LG_SAMPLE_BLUR) || defined(LG_SAMPLE_CLEAR))
vec3 applySceneSharpening(vec2 rayUv, vec3 centerColor, vec2 sharpStep, float sharpness) {
    if (sharpness <= 0.0001) return centerColor;
    vec3 tapN = sampleSceneTex(clamp(rayUv + vec2(0.0, sharpStep.y), 0.002, 0.998)).rgb;
    vec3 tapS = sampleSceneTex(clamp(rayUv - vec2(0.0, sharpStep.y), 0.002, 0.998)).rgb;
    vec3 tapE = sampleSceneTex(clamp(rayUv + vec2(sharpStep.x, 0.0), 0.002, 0.998)).rgb;
    vec3 tapW = sampleSceneTex(clamp(rayUv - vec2(sharpStep.x, 0.0), 0.002, 0.998)).rgb;
    vec3 neighborAvg = (tapN + tapS + tapE + tapW) * 0.25;
    vec3 neighborMin = min(centerColor, min(min(tapN, tapS), min(tapE, tapW)));
    vec3 neighborMax = max(centerColor, max(max(tapN, tapS), max(tapE, tapW)));
    vec3 detail = centerColor - neighborAvg;
    float haloMargin = 0.04 * sharpness;
    return clamp(
        centerColor + detail * (sharpness * 0.45),
        max(vec3(0.0), neighborMin - haloMargin),
        min(vec3(1.0), neighborMax + haloMargin)
    );
}

vec3 sampleBorderScene(
    vec2 rayUv,
    vec2 dispUv,
    float chromaSpread,
    vec2 blurUv,
    vec2 sharpStep,
    float chromaMix,
    float dispersionPxSq,
    float sharpness
) {
    vec2 uvG = clamp(rayUv, 0.002, 0.998);
    vec3 centerG = sampleSceneTex(uvG).rgb;
#if !defined(LG_TRANSFER_SAMPLE) || defined(LG_SAMPLE_CHROMA)
    vec2 chromaR = vec2(0.0);
    vec2 chromaB = vec2(0.0);
    if (chromaMix > 0.0) {
        chromaR = dispUv * min(chromaSpread * ${CHROMATIC_RED_SHIFT_RATIO.toFixed(2)}, 1.0);
        chromaB = dispUv * (chromaSpread * ${CHROMATIC_BLUE_SHIFT_RATIO.toFixed(2)});
    }
#endif
    float blurExtent = max(blurUv.x, blurUv.y);
    if (blurExtent <= 0.00001) {
        vec2 invSharpStep = vec2(1.0) / max(sharpStep, vec2(1e-6));
        float dispStrength = length(dispUv * invSharpStep) * 0.65;
        float rgssWeight = smoothstep(0.25, 3.8, dispStrength);
        vec3 filteredG = centerG;
        if (rgssWeight > 0.01) {
            vec2 rgssRadius = sharpStep * (0.55 * rgssWeight);
            vec2 rgssA = vec2(0.35, 0.85) * rgssRadius;
            vec2 rgssB = vec2(-0.85, 0.35) * rgssRadius;
            vec3 rgssSample = (
                sampleSceneTex(clamp(uvG + rgssA, 0.002, 0.998)).rgb +
                sampleSceneTex(clamp(uvG - rgssA, 0.002, 0.998)).rgb +
                sampleSceneTex(clamp(uvG + rgssB, 0.002, 0.998)).rgb +
                sampleSceneTex(clamp(uvG - rgssB, 0.002, 0.998)).rgb
            ) * 0.25;
            filteredG = mix(centerG, rgssSample, rgssWeight * 0.85);
        }
        vec3 crispG = applySceneSharpening(uvG, filteredG, sharpStep, sharpness);
#if !defined(LG_TRANSFER_SAMPLE) || defined(LG_SAMPLE_CHROMA)
        if (chromaMix <= 0.0) return crispG;
        vec3 spectral = sampleSpectralCenter(rayUv, chromaR, chromaB, filteredG, chromaMix, dispersionPxSq);
        return clamp(crispG + (spectral - filteredG), 0.0, 1.0);
#else
        return crispG;
#endif
    }

    vec2 offset1 = blurUv * vec2(0.86, 0.34);
    vec2 offset2 = blurUv * vec2(-0.34, 0.86);
    if (blurExtent < 0.0045) {
        vec2 tap1 = offset1 * 0.64;
        vec2 tap2 = offset2 * 0.64;
        vec3 crossSum =
            sampleSceneTex(clamp(uvG + tap1, 0.002, 0.998)).rgb +
            sampleSceneTex(clamp(uvG - tap1, 0.002, 0.998)).rgb +
            sampleSceneTex(clamp(uvG + tap2, 0.002, 0.998)).rgb +
            sampleSceneTex(clamp(uvG - tap2, 0.002, 0.998)).rgb;
        vec3 baseSmall = centerG * 0.28 + crossSum * 0.18;
        vec3 smallSample = baseSmall;
#if !defined(LG_TRANSFER_SAMPLE) || defined(LG_SAMPLE_CHROMA)
        if (chromaMix > 0.0) {
            vec2 dispersedRb = sampleSpectralBlur5Tap(rayUv, chromaR, chromaB, tap1, tap2, 0.28, 0.18);
            smallSample = mix(baseSmall, vec3(dispersedRb.x, baseSmall.g, dispersedRb.y), chromaMix);
        }
#endif
        if (sharpness > 0.0001) {
            vec3 crispSmall = applySceneSharpening(uvG, centerG, sharpStep, sharpness);
            return clamp(mix(smallSample, crispSmall + (smallSample - baseSmall), sharpness * 0.35), 0.0, 1.0);
        }
        return smallSample;
    }

    vec2 inner1 = (offset1 + offset2) * 0.36;
    vec2 inner2 = (offset1 - offset2) * 0.36;
    vec3 innerSum =
        sampleSceneTex(clamp(uvG + inner1, 0.002, 0.998)).rgb +
        sampleSceneTex(clamp(uvG - inner1, 0.002, 0.998)).rgb +
        sampleSceneTex(clamp(uvG + inner2, 0.002, 0.998)).rgb +
        sampleSceneTex(clamp(uvG - inner2, 0.002, 0.998)).rgb;
    vec3 outerSum =
        sampleSceneTex(clamp(uvG + offset1, 0.002, 0.998)).rgb +
        sampleSceneTex(clamp(uvG - offset1, 0.002, 0.998)).rgb +
        sampleSceneTex(clamp(uvG + offset2, 0.002, 0.998)).rgb +
        sampleSceneTex(clamp(uvG - offset2, 0.002, 0.998)).rgb;
    vec3 base = centerG * 0.20 + innerSum * 0.12 + outerSum * 0.08;
    vec3 blurredSample = base;
#if !defined(LG_TRANSFER_SAMPLE) || defined(LG_SAMPLE_CHROMA)
    if (chromaMix > 0.0) {
        vec2 dispersedRb = sampleSpectralBlur5Tap(rayUv, chromaR, chromaB, offset1 * 0.76, offset2 * 0.76, 0.24, 0.19);
        blurredSample = mix(base, vec3(dispersedRb.x, base.g, dispersedRb.y), chromaMix);
    }
#endif
    if (sharpness > 0.0001) {
        vec3 crispLarge = applySceneSharpening(uvG, centerG, sharpStep, sharpness);
        return clamp(mix(blurredSample, crispLarge + (blurredSample - base), sharpness * 0.35), 0.0, 1.0);
    }
    return blurredSample;
}
#endif

#if !defined(LG_TRANSFER_BUILD) && (defined(LG_INTERIOR_PASS) || !defined(LG_TRANSFER_SAMPLE) || defined(LG_SAMPLE_BLUR) || defined(LG_SAMPLE_CLEAR))
vec3 sampleSharpInterior(vec2 sceneUv, vec3 centerColor, float sharpness, bool isBlurred) {
    if (sharpness <= 0.0001) return centerColor;
    vec2 uvPerCssPx = vec2(
        uSceneRect.z / max(1.0, uSize.x),
        uSceneRect.w / max(1.0, uSize.y)
    );
    vec2 sharpStep = uvPerCssPx * 0.65;
    vec2 clampedUv = clamp(sceneUv, 0.002, 0.998);
    if (!isBlurred) {
        vec3 tapN = sampleSceneTex(clamp(clampedUv + vec2(0.0, sharpStep.y), 0.002, 0.998)).rgb;
        vec3 tapS = sampleSceneTex(clamp(clampedUv - vec2(0.0, sharpStep.y), 0.002, 0.998)).rgb;
        vec3 tapE = sampleSceneTex(clamp(clampedUv + vec2(sharpStep.x, 0.0), 0.002, 0.998)).rgb;
        vec3 tapW = sampleSceneTex(clamp(clampedUv - vec2(sharpStep.x, 0.0), 0.002, 0.998)).rgb;
        vec3 neighborAvg = (tapN + tapS + tapE + tapW) * 0.25;
        vec3 neighborMin = min(centerColor, min(min(tapN, tapS), min(tapE, tapW)));
        vec3 neighborMax = max(centerColor, max(max(tapN, tapS), max(tapE, tapW)));
        float haloMargin = 0.04 * sharpness;
        return clamp(
            centerColor + (centerColor - neighborAvg) * (sharpness * 0.45),
            max(vec3(0.0), neighborMin - haloMargin),
            min(vec3(1.0), neighborMax + haloMargin)
        );
    }
    vec3 rawCenter = sampleSceneTex(clampedUv).rgb;
    vec3 tapN = sampleSceneTex(clamp(clampedUv + vec2(0.0, sharpStep.y), 0.002, 0.998)).rgb;
    vec3 tapS = sampleSceneTex(clamp(clampedUv - vec2(0.0, sharpStep.y), 0.002, 0.998)).rgb;
    vec3 tapE = sampleSceneTex(clamp(clampedUv + vec2(sharpStep.x, 0.0), 0.002, 0.998)).rgb;
    vec3 tapW = sampleSceneTex(clamp(clampedUv - vec2(sharpStep.x, 0.0), 0.002, 0.998)).rgb;
    vec3 neighborAvg = (tapN + tapS + tapE + tapW) * 0.25;
    vec3 neighborMin = min(rawCenter, min(min(tapN, tapS), min(tapE, tapW)));
    vec3 neighborMax = max(rawCenter, max(max(tapN, tapS), max(tapE, tapW)));
    float haloMargin = 0.04 * sharpness;
    vec3 crispCenter = clamp(
        rawCenter + (rawCenter - neighborAvg) * (sharpness * 0.45),
        max(vec3(0.0), neighborMin - haloMargin),
        min(vec3(1.0), neighborMax + haloMargin)
    );
    return mix(centerColor, crispCenter, sharpness * 0.35);
}
#endif

float spectralMix(vec2 shiftPx) {
    return smoothstep(0.0625, 0.5625, dot(shiftPx, shiftPx));
}

vec4 applyGlassMedium(vec3 sceneColor) {
    float luma = dot(sceneColor, vec3(0.299, 0.587, 0.114));
    vec3 vibrantScene;
    if (uSaturation < 0.0) {
        vibrantScene = uHighlight.w >= 2.199
            ? clamp(mix(vec3(luma), sceneColor, 2.05) * 1.03, 0.0, 1.0)
            : sceneColor;
    } else if (uSaturation == 1.0) {
        vibrantScene = sceneColor;
    } else {
        float filterLuma = dot(sceneColor, vec3(0.213, 0.715, 0.072));
        vibrantScene = clamp(mix(vec3(filterLuma), sceneColor, uSaturation), 0.0, 1.0);
    }
    return vec4(vibrantScene * uMedium.rgb + uTint.rgb * uMedium.a, luma);
}

vec3 compositeInteriorScene(vec3 sceneColor, float ambientSheen) {
    vec4 medium = applyGlassMedium(sceneColor);
    float ambientSheenScale = mix(0.42, 1.0, smoothstep(0.08, 0.45, medium.a));
    float effectiveHighlight = compressHighlight((ambientSheen * ambientSheenScale) * uHighlight.x);
    return clamp(mix(medium.rgb, vec3(1.0), effectiveHighlight * 0.34), 0.0, 1.0);
}

float computeWhiteRimFactor(float baseRimTerms, float ambientSheen, float ambientSheenScale) {
    float rawRim = max(0.0, baseRimTerms * min(1.0, uHighlight.x * 2.5) * 1.15);
    float rimHighlight = clamp(rawRim / (1.0 + 0.18 * rawRim), 0.0, 1.0);
    float sheenHighlight = compressHighlight(ambientSheen * ambientSheenScale * uHighlight.x) * 0.34;
    return clamp(max(rimHighlight, sheenHighlight), 0.0, 1.0);
}

vec3 compositeBorderScene(
    vec3 sceneColor,
    float ambientSheen,
    float baseRimTerms,
    float outerStroke,
    float additiveGlow,
    vec3 interferenceTint
) {
    vec4 medium = applyGlassMedium(sceneColor);
    float ambientSheenScale = mix(0.42, 1.0, smoothstep(0.08, 0.45, medium.a));
    float whiteRimFactor = computeWhiteRimFactor(baseRimTerms, ambientSheen, ambientSheenScale);
    vec3 framedScene = mix(medium.rgb, vec3(0.0), outerStroke * (1.0 - whiteRimFactor) * 0.40 * uHighlight.z);
    vec3 litColor = mix(framedScene, vec3(1.0), whiteRimFactor);
    vec3 specularBoost = (vec3(1.0) - litColor * 0.35) * (additiveGlow * uHighlight.x);
    return clamp(litColor + specularBoost + interferenceTint, 0.0, 1.0);
}

void main() {
#ifdef LG_INTERIOR_PASS
    vec3 interiorScene = sampleSharpInterior(
        vSceneUv,
        sampleInteriorBlur5Tap(uDirectBlurClamp > 0.5),
        uSharpness,
        uHighlight.w > 0.00001
    );
    gl_FragColor = vec4(compositeInteriorScene(interiorScene, evalAmbientSheen(vUv)), 1.0);
    return;
#endif
#ifndef LG_TRANSFER_SAMPLE
    float edgeAaLimit = 0.78 * length(uPixelSize);
#endif
#if defined(LG_SPECIALIZED) && !defined(LG_NO_INTERIOR_FASTPATH)
    vec2 halfExtents = uSize * 0.5;
    vec2 pt = (vUv - 0.5) * uSize;
    float radius = clamp(uGeom.z, 0.0, min(halfExtents.x, halfExtents.y));
    vec2 q = abs(pt) - halfExtents + vec2(radius);
    vec2 qPlus = max(q, 0.0);
    bool isSquircleCorner = uSquircle > 0.5 && qPlus.x > 0.0 && qPlus.y > 0.0;
#ifdef LG_TRANSFER_BUILD
    float outLen = 0.0;
    vec2 squircleNormal = vec2(0.0);
    float sd;
    if (isSquircleCorner) {
        vec3 sqGeom = evalSquircleGeom(qPlus, radius);
        sd = sqGeom.x;
        squircleNormal = sqGeom.yz;
    } else {
        outLen = length(qPlus);
        sd = outLen + min(max(q.x, q.y), 0.0) - radius;
    }
    if (sd >= edgeAaLimit) {
        transferGeometry = vec4(0.0);
        transferLighting = vec4(0.0);
        return;
    }
    bool interior = sd <= -uInteriorMargin;
#else
    bool interior;
    float cachedSqSd = 0.0;
    float cachedSqDist = 0.0;
    if (isSquircleCorner) {
        cachedSqSd = evalSquircleSd(qPlus, radius);
        interior = cachedSqSd <= -uInteriorMargin;
    } else {
        cachedSqDist = dot(qPlus, qPlus);
        float inset = radius - uInteriorMargin - min(max(q.x, q.y), 0.0);
        interior = inset >= 0.0 && cachedSqDist <= inset * inset;
    }
#endif
    if (interior) {
#ifdef LG_TRANSFER_BUILD
        transferGeometry = vec4(0.0, 0.0, 0.5, 1.0);
        transferLighting = vec4(0.0, evalAmbientSheen(vUv), 0.0, 0.0);
        return;
#else
        float ambientSheen = evalAmbientSheen(vUv);
#ifdef LG_SAMPLE_NO_SCENE
        float highlight = clamp(ambientSheen * uHighlight.x, 0.0, 0.97);
        float fallbackAlpha = clamp(max(uTint.a, highlight * 0.78), 0.0, 0.92);
        vec3 fallbackColor = clamp(mix(uTint.rgb, vec3(1.0), highlight), 0.0, 1.0);
        gl_FragColor = vec4(fallbackColor * fallbackAlpha, fallbackAlpha);
        return;
#else
#ifdef LG_SAMPLE_BLUR
        if (uUseInteriorTex > 0.5) {
            gl_FragColor = vec4(texture2D(uInteriorTex, vUv).rgb, 1.0);
            return;
        }
        vec3 sceneColor = sampleSharpInterior(vSceneUv, sampleInteriorBlur(), uSharpness, true);
#else
        vec2 sceneUv = vec2(
            uSceneRect.x + vUv.x * uSceneRect.z,
            1.0 - (uSceneRect.y + (1.0 - vUv.y) * uSceneRect.w)
        );
#ifdef LG_SAMPLE_CLAMP
        vec3 sceneColor = sampleSceneTex(clamp(sceneUv, 0.002, 0.998)).rgb;
#else
        vec3 sceneColor = sampleSceneTex(sceneUv).rgb;
#endif
        sceneColor = sampleSharpInterior(sceneUv, sceneColor, uSharpness, false);
#endif
        gl_FragColor = vec4(compositeInteriorScene(sceneColor, ambientSheen), 1.0);
        return;
#endif
#endif
    }
#endif

#ifdef LG_TRANSFER_SAMPLE
    vec4 geometry = texelFetch(uTransferGeometry, ivec2(gl_FragCoord.xy), 0);
    float edgeAA = geometry.w;
    if (edgeAA == 0.0) {
        gl_FragColor = vec4(0.0);
        return;
    }
    vec4 lighting = texelFetch(uTransferLighting, ivec2(gl_FragCoord.xy), 0);
    vec2 displacement = geometry.xy;
    float packedChromaClarity = geometry.z;
    float chromaFactor = floor(packedChromaClarity) * (1.0 / 2047.0);
#ifdef LG_SAMPLE_BLUR
    float rimClarity = clamp(fract(packedChromaClarity) * 2.0, 0.0, 1.0);
#endif
    float baseRimTerms = lighting.x;
    float ambientSheen = lighting.y;
    float additiveGlow = lighting.z;
    float outerStroke = lighting.w;
    vec3 interferenceTint = vec3(0.0);
    if (dot(uLightTilt, uLightTilt) > 1e-6) {
        float dispLenSq = dot(displacement, displacement);
        if (dispLenSq > 1e-8 && additiveGlow > 1e-5) {
            float invDispLen = inversesqrt(dispLenSq);
            float dispSign = uOptical.w > 3.5 ? 1.0 : -1.0;
            vec2 normXy = (dispSign * displacement) * invDispLen;
            vec3 approxDome = vec3(normXy * 0.68, 0.733212);
            vec3 dynHalf = normalize(HALF_PRIMARY + vec3(uLightTilt * 0.30, 0.0));
            float staticNdh = clamp(dot(approxDome, HALF_PRIMARY), 0.0, 1.0);
            float staticSq = staticNdh * staticNdh;
            float staticQuad = staticSq * staticSq;
            float staticLobe = (staticQuad * staticQuad) / (12.0 - 11.0 * staticSq);
            float dynamicNdh = clamp(dot(approxDome, dynHalf), 0.0, 1.0);
            float dynamicSq = dynamicNdh * dynamicNdh;
            float dynamicQuad = dynamicSq * dynamicSq;
            float dynamicLobe = (dynamicQuad * dynamicQuad) / (12.0 - 11.0 * dynamicSq);
            float specularRatio = clamp(dynamicLobe / max(staticLobe, 0.015), 0.25, 2.2);
            additiveGlow = clamp(additiveGlow * mix(1.0, specularRatio, clamp(length(uLightTilt), 0.0, 1.0)), 0.0, 0.60);
        }
        ambientSheen = evalAmbientSheen(vUv);
    }
#else
#if !defined(LG_SPECIALIZED) || defined(LG_NO_INTERIOR_FASTPATH)
    vec2 halfExtents = uSize * 0.5;
    vec2 pt = (vUv - 0.5) * uSize;
    float radius = clamp(uGeom.z, 0.0, min(halfExtents.x, halfExtents.y));
    float bezel = max(1.0, uGeom.w);

    vec2 q = abs(pt) - halfExtents + vec2(radius);
    vec2 qPlus = max(q, 0.0);
    vec2 quadrantSign = sign(pt);
    float axisSelector = step(q.y, q.x);
    float selfSd;
    vec2 edgeNormal;
    if (uSquircle > 0.5 && qPlus.x > 0.0 && qPlus.y > 0.0) {
        vec3 sqGeom = evalSquircleGeom(qPlus, radius);
        selfSd = sqGeom.x;
        edgeNormal = quadrantSign * sqGeom.yz;
    } else {
        float outLen = length(qPlus);
        selfSd = outLen + min(max(q.x, q.y), 0.0) - radius;
        edgeNormal = quadrantSign * (outLen > 1e-8 ? qPlus / outLen : vec2(axisSelector, 1.0 - axisSelector));
    }
    vec2 coverageGradient = edgeNormal;
    float sd = selfSd;
    float proximityFactor = 0.0;
    float saddleBlend = 0.0;
    float bridgeNormFactor = 1.0;
    float interferenceWave = 0.0;
    float interferenceMask = 0.0;
    float interferencePhase = 0.0;

    if (uPeerCount > 0.5) {
        for (int peerIdx = 0; peerIdx < 4; peerIdx++) {
            if (float(peerIdx) >= uPeerCount) break;
            vec4 peerBounds = uPeerBounds[peerIdx];
            vec4 peerProps = uPeerProps[peerIdx];
            vec2 peerPt = pt - peerBounds.xy;
            vec2 peerQ = abs(peerPt) - peerBounds.zw + vec2(peerProps.x);
            vec2 peerQPlus = max(peerQ, 0.0);
            vec2 peerSign = sign(peerPt);
            float peerSd;
            vec2 peerNormal;
            if (uSquircle > 0.5 && peerQPlus.x > 0.0 && peerQPlus.y > 0.0) {
                vec3 peerSqGeom = evalSquircleGeom(peerQPlus, peerProps.x);
                peerSd = peerSqGeom.x;
                peerNormal = peerSign * peerSqGeom.yz;
            } else {
                float peerOutLen = length(peerQPlus);
                peerSd = peerOutLen + min(max(peerQ.x, peerQ.y), 0.0) - peerProps.x;
                float peerAxisSelector = step(peerQ.y, peerQ.x);
                peerNormal = peerSign * (peerOutLen > 1e-8 ? peerQPlus / peerOutLen : vec2(peerAxisSelector, 1.0 - peerAxisSelector));
            }
            float tieMargin = peerProps.w > 0.5 ? 0.02 : -0.02;
            if (selfSd > peerSd + tieMargin) {
#ifdef LG_TRANSFER_BUILD
                transferGeometry = vec4(0.0);
                transferLighting = vec4(0.0);
#else
                gl_FragColor = vec4(0.0);
#endif
                return;
            }
            float gapDiff = abs(selfSd - peerSd);
            float sumGap = max(0.0, selfSd) + max(0.0, peerSd);
            float pairProximity = exp(-(sumGap * 0.045 + gapDiff * 0.04));
            proximityFactor = max(proximityFactor, pairProximity);
            vec2 merged = sminPoly(sd, peerSd, peerProps.y);
            float hBlend = 4.0 * merged.y * (1.0 - merged.y);
            float smoothH = hBlend * hBlend * (3.0 - 2.0 * hBlend);
            sd = merged.x;
            coverageGradient = mix(peerNormal, coverageGradient, merged.y);
            if (hBlend > 0.0) {
                saddleBlend = max(saddleBlend, smoothH * pairProximity);
                vec2 rawMixedNormal = mix(peerNormal, edgeNormal, merged.y);
                float mixedNormLenSq = dot(rawMixedNormal, rawMixedNormal);
                if (mixedNormLenSq > 1e-8) {
                    float invMixedLen = inversesqrt(mixedNormLenSq);
                    float mixedNormLen = mixedNormLenSq * invMixedLen;
                    bridgeNormFactor = min(bridgeNormFactor, mix(1.0, smoothstep(0.0, 0.52, mixedNormLen), smoothH));
                    edgeNormal = rawMixedNormal * invMixedLen;
                } else {
                    bridgeNormFactor = min(bridgeNormFactor, 1.0 - smoothH);
                    vec2 saddleAxis = edgeNormal - peerNormal;
                    vec2 saddlePerp = vec2(-saddleAxis.y, saddleAxis.x);
                    float saddlePerpLenSq = dot(saddlePerp, saddlePerp);
                    edgeNormal = saddlePerpLenSq > 1e-8
                        ? (saddlePerp * inversesqrt(saddlePerpLenSq)) * (dot(saddlePerp, pt) >= 0.0 ? 1.0 : -1.0)
                        : vec2(0.0, sign(pt.y + 1e-4));
                }
            } else if (merged.y < 0.5) {
                edgeNormal = peerNormal;
            }
            float fringeEnv = exp(-gapDiff * 0.11) * smoothstep(-44.0, 8.0, selfSd) * smoothstep(-44.0, 8.0, peerSd);
            float standing = 0.5 + 0.5 * cos(gapDiff * 0.62 - peerProps.z);
            interferenceWave += standing * fringeEnv;
            interferenceMask = max(interferenceMask, fringeEnv);
            interferencePhase += gapDiff * 0.42 - peerProps.z;
        }
    }

    if (sd >= edgeAaLimit) {
#ifdef LG_TRANSFER_BUILD
        transferGeometry = vec4(0.0);
        transferLighting = vec4(0.0);
#else
        gl_FragColor = vec4(0.0);
#endif
        return;
    }
#ifndef LG_SPECIALIZED
    if (sd <= -uInteriorMargin && uPeerCount < 0.5) {
        if (uHasSceneTex > 0.5) {
            if (uUseInteriorTex > 0.5) {
                gl_FragColor = vec4(texture2D(uInteriorTex, vUv).rgb, 1.0);
                return;
            }
            float ambientSheen = evalAmbientSheen(vUv);
            vec3 sceneColor;
            if (uHighlight.w <= 0.00001) {
                sceneColor = sampleSharpInterior(
                    vSceneUv,
                    sampleSceneTex(clamp(vSceneUv, 0.002, 0.998)).rgb,
                    uSharpness,
                    false
                );
            } else {
                sceneColor = sampleSharpInterior(
                    vSceneUv,
                    sampleInteriorBlur5Tap(uDirectBlurClamp > 0.5),
                    uSharpness,
                    true
                );
            }
            gl_FragColor = vec4(compositeInteriorScene(sceneColor, ambientSheen), 1.0);
            return;
        }
        float ambientSheen = evalAmbientSheen(vUv);
        float highlight = clamp(ambientSheen * uHighlight.x, 0.0, 0.97);
        float fallbackAlpha = clamp(max(uTint.a, highlight * 0.78), 0.0, 0.92);
        vec3 fallbackColor = clamp(mix(uTint.rgb, vec3(1.0), highlight), 0.0, 1.0);
        gl_FragColor = vec4(fallbackColor * fallbackAlpha, fallbackAlpha);
        return;
    }
#endif
#else
    float bezel = max(1.0, uGeom.w);
    float proximityFactor = 0.0;
    float saddleBlend = 0.0;
    float bridgeNormFactor = 1.0;
    float interferenceWave = 0.0;
    float interferenceMask = 0.0;
    float interferencePhase = 0.0;
    vec2 quadrantSign = sign(pt);
    float axisSelector = step(q.y, q.x);
    vec2 edgeNormal = isSquircleCorner
        ? quadrantSign * squircleNormal
        : quadrantSign * (outLen > 1e-8 ? qPlus / outLen : vec2(axisSelector, 1.0 - axisSelector));
    vec2 coverageGradient = edgeNormal;
#endif
    float edgeAA = sd <= -edgeAaLimit ? 1.0 : edgeCoverage(sd, coverageGradient);
    float invDpr = 1.0 / max(uDpr, 0.0001);
    float pixelSpan = max(invDpr, max(uPixelSize.x, uPixelSize.y));
    float insideEdgeMask = smoothstep(-0.08 * pixelSpan, 1.48 * pixelSpan, -sd);
    float dprScale = max(1.0, uDpr * 0.75);
    float rimInset = max(0.32 / dprScale, 0.58 * pixelSpan);
    float absSdRim = abs(sd + rimInset);
    float hairlineWidth = max(0.95 / dprScale, 1.68 * invDpr);
    float hairlineRatio = absSdRim / (hairlineWidth * 0.34);
    float hairlineInv = 1.0 / (1.0 + hairlineRatio * hairlineRatio);
    float hairline = hairlineInv * hairlineInv * insideEdgeMask;

    float depthInBezel = clamp(-sd / bezel, 0.0, 1.0);
    float inBezelMask = 1.0 - smoothstep(0.90, 1.0, depthInBezel);

    float refractedTilt = 0.0;
    float meniscusTilt = 0.0;
    vec3 domeNormal = vec3(0.0, 0.0, 1.0);
    vec2 dispDir = vec2(0.0);
    float specSharp1 = 0.0;
    float specSharp2 = 0.0;
    if (depthInBezel < 1.0) {
        float interiorShift = bezel * (0.08 + 0.38 * depthInBezel * depthInBezel);
        vec2 rawShift = q + interiorShift;
        float smoothCornerEps = radius > 0.5 ? max(bezel * 0.035, 0.12) : max(bezel * 0.16, 0.5);
        vec2 bezelVec = rawShift + sqrt(rawShift * rawShift + vec2(smoothCornerEps));
        vec2 rawBezelNormal = quadrantSign * (bezelVec * inversesqrt(dot(bezelVec, bezelVec)));
        vec2 bezelNormal = rawBezelNormal;
        if (uPeerCount > 0.5) {
            vec2 blendedNormal = mix(rawBezelNormal, edgeNormal, clamp(proximityFactor * 2.2 + saddleBlend, 0.0, 1.0));
            bezelNormal = blendedNormal * inversesqrt(max(dot(blendedNormal, blendedNormal), 1e-8));
        }
        vec2 optical = sampleOpticalLut16(depthInBezel);
        float xyMag = optical.x;
        refractedTilt = optical.y;
        float tiltDenom = 1.0 + depthInBezel * (0.725 + 0.21 * depthInBezel);
        meniscusTilt = inBezelMask / (tiltDenom * tiltDenom);
        domeNormal = vec3(bezelNormal * xyMag, sqrt(max(0.0, 1.0 - xyMag * xyMag)));
        dispDir = (uRefraction.x > 0.5 ? edgeNormal : bezelNormal) * abs(xyMag);
#ifndef LG_TRANSFER_BUILD
        if (uHighlight.x > 1e-4) {
#endif
            vec3 primaryHalf = dot(uLightTilt, uLightTilt) > 1e-6
                ? normalize(HALF_PRIMARY + vec3(uLightTilt * 0.30, 0.0))
                : HALF_PRIMARY;
            float ndoth1 = clamp(dot(domeNormal, primaryHalf), 0.0, 1.0);
            float ndoth1Sq = ndoth1 * ndoth1;
            float ndoth1Quad = ndoth1Sq * ndoth1Sq;
            specSharp1 = (ndoth1Quad * ndoth1Quad) / (12.0 - 11.0 * ndoth1Sq);

            vec3 secondaryHalf = dot(uLightTilt, uLightTilt) > 1e-6
                ? normalize(HALF_SECONDARY - vec3(uLightTilt * 0.24, 0.0))
                : HALF_SECONDARY;
            float ndoth2 = clamp(dot(domeNormal, secondaryHalf), 0.0, 1.0);
            float ndoth2Sq = ndoth2 * ndoth2;
            float ndoth2Quad = ndoth2Sq * ndoth2Sq;
            specSharp2 = (ndoth2Quad * ndoth2Quad) / (12.0 - 11.0 * ndoth2Sq);
#ifndef LG_TRANSFER_BUILD
        }
#endif
    }

    float nxSq = edgeNormal.x * edgeNormal.x;
    float nySq = edgeNormal.y * edgeNormal.y;
    float cornerArc = 4.0 * nxSq * nySq;
    float rimY = clamp(abs(edgeNormal.y), 0.0, 1.0);
    float rimT = clamp((rimY - 0.68) / 0.32, 0.0, 1.0);
    float rimSmooth = rimT * rimT * rimT * (rimT * (6.0 * rimT - 15.0) + 10.0);
    float topRimWeight = rimSmooth * rimSmooth;
    float cornerRimWeight = cornerArc * cornerArc * 0.08 * rimSmooth;
    float dualRimWeight = 1.0 - (1.0 - topRimWeight) * (1.0 - cornerRimWeight);

    float fresnelCosI = clamp(domeNormal.z, 0.0, 1.0);
    float fresnelN = max(1.01, uOptical.x);
    float fresnelSinTSq = max(0.0, 1.0 - fresnelCosI * fresnelCosI) / (fresnelN * fresnelN);
    float fresnelCosT = sqrt(max(0.0, 1.0 - fresnelSinTSq));
    float fresnelRs = (fresnelCosI - fresnelN * fresnelCosT) / max(1e-5, fresnelCosI + fresnelN * fresnelCosT);
    float fresnelRp = (fresnelCosT - fresnelN * fresnelCosI) / max(1e-5, fresnelCosT + fresnelN * fresnelCosI);
    float fresnelTerm = 0.5 * (fresnelRs * fresnelRs + fresnelRp * fresnelRp);
    float fresnelRimBoost = mix(0.88, 1.18, clamp(fresnelTerm * 1.35, 0.0, 1.0));
    float verticalRimBias = edgeNormal.y >= 0.0 ? 1.0 : 0.88;
    float baseRimTerms = hairline * dualRimWeight * 0.96 * verticalRimBias * fresnelRimBoost;
    vec2 displacement = -dispDir * (bezel * refractedTilt * (1.35 + 0.14 * cornerArc));
    displacement *= (0.35 + 0.65 * bridgeNormFactor) * mix(1.0, 0.45, saddleBlend);
    displacement *= 1.0 + 0.10 * interferenceMask * (interferenceWave - 0.5);
    float directionalRim = 1.0;
    if (uRefraction.x > 0.5) {
        bool horizontal = uRefraction.x < 1.5;
        vec2 axis = horizontal ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        float crossHalf = horizontal ? halfExtents.y : halfExtents.x;
        float crossPosition = horizontal ? pt.y : pt.x;
        float halfPixel = 0.5 * invDpr;
        float fadeWidth = max(invDpr, crossHalf * uRefraction.y - halfPixel);
        float t = clamp((crossHalf - abs(crossPosition) - halfPixel) / fadeWidth, 0.0, 1.0);
        float feather = t * t * t * (t * (6.0 * t - 15.0) + 10.0);
        float mainNormal = abs(dot(edgeNormal, axis));
        float dirT = clamp((mainNormal - 0.45) / 0.55, 0.0, 1.0);
        float dirSmooth = dirT * dirT * dirT * (dirT * (6.0 * dirT - 15.0) + 10.0);
        displacement = axis * (dot(displacement, axis) * feather);
        directionalRim = dirSmooth * dirSmooth * feather;
        baseRimTerms = hairline * directionalRim * 0.96 * fresnelRimBoost;
    }
    float chromaFactor = smoothstep(0.08, 0.82, meniscusTilt) * inBezelMask;
    float ambientSheen = evalAmbientSheen(vUv);
    float meniscusSpecMask =
        smoothstep(0.04, 0.24, depthInBezel) *
        (1.0 - smoothstep(0.30, 0.82, depthInBezel)) *
        inBezelMask;
    float bevelSkyLift = max(0.0, domeNormal.y);
    float bevelDepthShade = max(0.0, -domeNormal.y);
    float fresnelSpecGain = 0.55 + 0.95 * clamp(fresnelTerm * 1.5, 0.0, 1.0);
    float additiveGlow =
        (specSharp1 * 0.20 * hairline +
            ((specSharp1 * 0.14 + specSharp2 * 0.06) * fresnelSpecGain +
                bevelSkyLift * bevelSkyLift * fresnelTerm * 0.22) *
                meniscusSpecMask) *
        directionalRim;
    float darkRimWidth = max(0.68 / dprScale, 1.42 * invDpr);
    float darkRimRatio = absSdRim / (darkRimWidth * 0.26);
    float darkRimInv = 1.0 / (1.0 + darkRimRatio * darkRimRatio);
    float outerStroke = clamp(
        (darkRimInv * darkRimInv * insideEdgeMask +
            bevelDepthShade * bevelDepthShade * meniscusSpecMask * 0.26) *
            (1.0 - saddleBlend) *
            directionalRim,
        0.0,
        1.0
    );
    vec3 interferenceTint = uPeerCount > 0.5
        ? (0.5 - 0.5 * cos(vec3(0.8185, 1.0, 1.1565) * interferencePhase)) * (interferenceMask * interferenceWave * 0.09)
        : vec3(0.0);
#endif

#ifdef LG_TRANSFER_BUILD
    float rimClarity = smoothstep(0.08, 0.62, depthInBezel);
    float packedChromaClarity = floor(clamp(chromaFactor, 0.0, 1.0) * 2047.0 + 0.5) + clamp(rimClarity, 0.0, 1.0) * 0.5;
    transferGeometry = vec4(displacement, packedChromaClarity, edgeAA);
    transferLighting = vec4(baseRimTerms, ambientSheen, additiveGlow, outerStroke);
#else
#ifdef LG_SPECIALIZED
#ifdef LG_SAMPLE_NO_SCENE
    float highlight = computeWhiteRimFactor(baseRimTerms, ambientSheen, 1.0);
    float darkWeight = outerStroke * (1.0 - highlight) * 0.40 * uHighlight.z;
    float fallbackAlpha = clamp(max(uTint.a, max(highlight * 0.92, darkWeight)), 0.0, 0.96) * edgeAA;
    vec3 fallbackBase = mix(uTint.rgb, vec3(0.0), darkWeight);
    vec3 fallbackColor = clamp(mix(fallbackBase, vec3(1.0), highlight) + vec3(1.0) * additiveGlow * uHighlight.x + interferenceTint, 0.0, 1.0);
    gl_FragColor = vec4(fallbackColor * fallbackAlpha, fallbackAlpha);
    return;
#else
    vec2 uvPerCssPx = vec2(
        uSceneRect.z / max(1.0, uSize.x),
        uSceneRect.w / max(1.0, uSize.y)
    );
#ifdef LG_SAMPLE_BLUR
    vec2 sceneUv = vSceneUv;
#else
    vec2 sceneUv = vec2(
        uSceneRect.x + vUv.x * uSceneRect.z,
        1.0 - (uSceneRect.y + (1.0 - vUv.y) * uSceneRect.w)
    );
#endif
    float thicknessBoost = clamp(0.95 + uOptical.y * 0.015625, 1.0, 2.25);
    vec2 dispPx = displacement * (uOptical.z * thicknessBoost);
    vec2 dispUv = dispPx * uvPerCssPx;
    vec2 uvG = sceneUv + dispUv;
    float chromaSpread = uHighlight.y * chromaFactor;
    vec2 chromaShiftPx = dispPx * (chromaSpread * uDpr);
    float dispersionPxSq = dot(chromaShiftPx, chromaShiftPx);
    float chromaMix = spectralMix(chromaShiftPx);
    vec2 sharpStep = uvPerCssPx * 0.65;
#ifdef LG_SAMPLE_BLUR
#ifndef LG_TRANSFER_SAMPLE
    float rimClarity = smoothstep(0.08, 0.62, depthInBezel);
#endif
    float dispAaPx = min(1.45, length(dispPx) * 0.065) * mix(1.0, 0.48, uSharpness);
    vec2 blurUv = uvPerCssPx * max(uHighlight.w * mix(0.45, 1.0, rimClarity), dispAaPx);
    vec3 sceneColor = sampleBorderScene(uvG, dispUv, chromaSpread, blurUv, sharpStep, chromaMix, dispersionPxSq, uSharpness);
#else
    vec3 sceneColor = sampleBorderScene(uvG, dispUv, chromaSpread, vec2(0.0), sharpStep, chromaMix, dispersionPxSq, uSharpness);
#endif
    vec3 finalColor = compositeBorderScene(
        sceneColor,
        ambientSheen,
        baseRimTerms,
        outerStroke,
        additiveGlow,
        interferenceTint
    );
    gl_FragColor = vec4(finalColor * edgeAA, edgeAA);
    return;
#endif
#else
    if (uHasSceneTex > 0.5) {
        vec2 uvPerCssPx = vec2(
            uSceneRect.z / max(1.0, uSize.x),
            uSceneRect.w / max(1.0, uSize.y)
        );
        float thicknessBoost = clamp(0.95 + uOptical.y * 0.015625, 1.0, 2.25);
        vec2 dispPx = displacement * (uOptical.z * thicknessBoost);
        vec2 blurUv = vec2(0.0);
        if (uHighlight.w > 0.0) {
            float rimClarity = smoothstep(0.08, 0.62, depthInBezel);
            float dispAaPx = min(1.45, length(dispPx) * 0.065) * mix(1.0, 0.48, uSharpness);
            blurUv = uvPerCssPx * max(uHighlight.w * mix(0.45, 1.0, rimClarity), dispAaPx);
        }
        vec2 dispUv = dispPx * uvPerCssPx;
        vec2 uvG = vSceneUv + dispUv;
        float chromaSpread = uHighlight.y * chromaFactor;
        vec2 chromaShiftPx = dispPx * (chromaSpread * uDpr);
        float dispersionPxSq = dot(chromaShiftPx, chromaShiftPx);
        float chromaMix = spectralMix(chromaShiftPx);
        vec2 sharpStep = uvPerCssPx * 0.65;
        vec3 sceneColor = sampleBorderScene(uvG, dispUv, chromaSpread, blurUv, sharpStep, chromaMix, dispersionPxSq, uSharpness);

        vec3 finalColor = compositeBorderScene(
            sceneColor,
            ambientSheen,
            baseRimTerms,
            outerStroke,
            additiveGlow,
            interferenceTint
        );
        gl_FragColor = vec4(finalColor * edgeAA, edgeAA);
        return;
    }

    float fallbackHighlight = computeWhiteRimFactor(baseRimTerms, ambientSheen, 1.0);
    float darkWeight = outerStroke * (1.0 - fallbackHighlight) * 0.40 * uHighlight.z;
    float fallbackAlpha = clamp(max(uTint.a, max(fallbackHighlight * 0.92, darkWeight)), 0.0, 0.96) * edgeAA;
    vec3 fallbackBase = mix(uTint.rgb, vec3(0.0), darkWeight);
    vec3 fallbackColor = clamp(mix(fallbackBase, vec3(1.0), fallbackHighlight) + vec3(1.0) * additiveGlow * uHighlight.x + interferenceTint, 0.0, 1.0);
    gl_FragColor = vec4(fallbackColor * fallbackAlpha, fallbackAlpha);
#endif
#endif
}
`;

const KAWASE_DOWNSAMPLE_VERTEX = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const KAWASE_DOWNSAMPLE_FRAGMENT = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uSourceTex;
uniform vec2 uHalfPixel;
uniform float uAlignedDownsample;
void main() {
    vec3 center = texture2D(uSourceTex, clamp(vUv, 0.002, 0.998)).rgb;
    if (uAlignedDownsample > 0.5 &&
        all(greaterThanEqual(vUv - uHalfPixel, vec2(0.002))) &&
        all(lessThanEqual(vUv + uHalfPixel, vec2(0.998)))) {
        gl_FragColor = vec4(center, 1.0);
        return;
    }
    vec3 sum = center * 0.36;
    sum += texture2D(uSourceTex, clamp(vUv + vec2(-uHalfPixel.x, -uHalfPixel.y), 0.002, 0.998)).rgb * 0.16;
    sum += texture2D(uSourceTex, clamp(vUv + vec2(uHalfPixel.x, -uHalfPixel.y), 0.002, 0.998)).rgb * 0.16;
    sum += texture2D(uSourceTex, clamp(vUv + vec2(-uHalfPixel.x, uHalfPixel.y), 0.002, 0.998)).rgb * 0.16;
    sum += texture2D(uSourceTex, clamp(vUv + vec2(uHalfPixel.x, uHalfPixel.y), 0.002, 0.998)).rgb * 0.16;
    gl_FragColor = vec4(sum, 1.0);
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

const ROUNDED_MIN_WEBGL_PIXEL_RATIO = 2;
const ROUNDED_MAX_WEBGL_PIXEL_RATIO = 3;
const EXPLICIT_MAX_WEBGL_PIXEL_RATIO = 4;
const UNROUNDED_WEBGL_PIXEL_RATIO = 0.125;

const MAX_WEBGL_FRAMEBUFFER_PIXELS = 4_194_304;

export function resolveWebglPixelRatio(requestedPixelRatio?: number, radius = 18): number {
    if (
        typeof requestedPixelRatio === "number" &&
        Number.isFinite(requestedPixelRatio) &&
        requestedPixelRatio > 0
    ) {
        return Math.min(EXPLICIT_MAX_WEBGL_PIXEL_RATIO, Math.max(0.5, requestedPixelRatio));
    }
    if (radius <= 0) {
        return UNROUNDED_WEBGL_PIXEL_RATIO;
    }
    return automaticRoundedPixelRatio(ROUNDED_MIN_WEBGL_PIXEL_RATIO, ROUNDED_MAX_WEBGL_PIXEL_RATIO);
}

export class GlassWebglRenderer {
    private readonly canvas: HTMLCanvasElement;
    private readonly gl: WebGLRenderingContext;
    private readonly isWebgl2: boolean;
    private readonly program: WebGLProgram;
    private readonly vertexBuffer: WebGLBuffer;
    private readonly maxViewportWidth: number;
    private readonly maxViewportHeight: number;
    private readonly maxTextureSize: number;
    private readonly maxSceneTextureSize: number;
    private readonly smallMemory = useSmallMemoryBudget();
    private readonly framePixelLimit = this.smallMemory ? SMALL_FRAME_PIXELS : MAX_WEBGL_FRAMEBUFFER_PIXELS;
    private readonly opticalTexture: WebGLTexture;
    private readonly opticalLutSize: number;
    private opticalLut: Uint8Array | null = null;
    private opticalLutPeak: number | undefined;
    private opticalSurface: GlassSurface | null = null;
    private opticalIor = -1;
    private uploadCanvas: HTMLCanvasElement | null = null;
    private readonly uSizeLoc: WebGLUniformLocation | null;
    private readonly uGeomLoc: WebGLUniformLocation | null;
    private readonly uOpticalLoc: WebGLUniformLocation | null;
    private readonly uRefractionLoc: WebGLUniformLocation | null;
    private lastRefractionDirection = -1;
    private lastRefractionEdgeFade = -1;
    private readonly uTintLoc: WebGLUniformLocation | null;
    private readonly uMediumLoc: WebGLUniformLocation | null;
    private mediumCoefficients: GlassMediumCoefficients | null = null;
    private mediumTintR = Number.NaN;
    private mediumTintG = Number.NaN;
    private mediumTintB = Number.NaN;
    private mediumTintA = Number.NaN;
    private mediumThickness = Number.NaN;
    private lastDirectMedium: GlassMediumCoefficients | null = null;
    private readonly uSaturationLoc: WebGLUniformLocation | null;
    private lastSaturation = -2;
    private readonly uSharpnessLoc: WebGLUniformLocation | null;
    private lastSharpness = -1;
    private readonly uHighlightLoc: WebGLUniformLocation | null;
    private readonly uSceneRectLoc: WebGLUniformLocation | null;
    private readonly uSceneTexLoc: WebGLUniformLocation | null;
    private readonly uHasSceneTexLoc: WebGLUniformLocation | null;
    private readonly uDprLoc: WebGLUniformLocation | null;
    private readonly uPixelSizeLoc: WebGLUniformLocation | null;
    private readonly uInteriorMarginLoc: WebGLUniformLocation | null;
    private readonly uBlurOffset1Loc: WebGLUniformLocation | null;
    private readonly uBlurOffset2Loc: WebGLUniformLocation | null;
    private readonly uDirectBlurClampLoc: WebGLUniformLocation | null;
    private readonly uInteriorTexLoc: WebGLUniformLocation | null;
    private readonly uUseInteriorTexLoc: WebGLUniformLocation | null;
    private readonly uLightTiltLoc: WebGLUniformLocation | null;
    private readonly uSquircleLoc: WebGLUniformLocation | null;
    private readonly uCoalesceBleedLoc: WebGLUniformLocation | null;
    private readonly uPeerCountLoc: WebGLUniformLocation | null;
    private readonly uPeerBoundsLoc: WebGLUniformLocation | null;
    private readonly uPeerPropsLoc: WebGLUniformLocation | null;
    private sceneTexture: WebGLTexture | null = null;
    private boundSceneTexture: WebGLTexture | null = null;
    private hasSceneTextureData = false;
    private hasSceneTextureInitialized = false;
    private sceneTextureMipmapped = false;
    private sceneCanvasWidth = 0;
    private sceneCanvasHeight = 0;
    private blurDownsampleProgram: WebGLProgram | null = null;
    private blurDownsampleHalfPixelLoc: WebGLUniformLocation | null = null;
    private blurDownsampleAlignedLoc: WebGLUniformLocation | null = null;
    private blurHalfDownFbo: WebGLFramebuffer | null = null;
    private blurHalfDownTexture: WebGLTexture | null = null;
    private blurHalfFbo: WebGLFramebuffer | null = null;
    private blurHalfTexture: WebGLTexture | null = null;
    private blurHalfWidth = 0;
    private blurHalfHeight = 0;
    private cachedKawaseBlurValue = -1;
    private sceneBlurDirty = false;
    private blurDownsampleFailed = false;
    private interiorProgram: WebGLProgram | null = null;
    private interiorUSizeLoc: WebGLUniformLocation | null = null;
    private interiorUTintLoc: WebGLUniformLocation | null = null;
    private interiorUMediumLoc: WebGLUniformLocation | null = null;
    private interiorUSaturationLoc: WebGLUniformLocation | null = null;
    private interiorUSharpnessLoc: WebGLUniformLocation | null = null;
    private interiorUPixelSizeLoc: WebGLUniformLocation | null = null;
    private lastInteriorSaturation = -2;
    private lastInteriorSharpness = -1;
    private lastInteriorPixelSizeX = 0;
    private lastInteriorPixelSizeY = 0;
    private interiorUHighlightLoc: WebGLUniformLocation | null = null;
    private interiorUSceneRectLoc: WebGLUniformLocation | null = null;
    private interiorUBlurOffset1Loc: WebGLUniformLocation | null = null;
    private interiorUBlurOffset2Loc: WebGLUniformLocation | null = null;
    private interiorUDirectBlurClampLoc: WebGLUniformLocation | null = null;
    private interiorULightTiltLoc: WebGLUniformLocation | null = null;
    private interiorFbo: WebGLFramebuffer | null = null;
    private interiorTexture: WebGLTexture | null = null;
    private interiorWidth = 0;
    private interiorHeight = 0;
    private lastInteriorFrameW = -1;
    private lastInteriorFrameH = -1;
    private lastInteriorBlurPx = -1;
    private lastInteriorMedium: GlassMediumCoefficients | null = null;
    private lastInteriorHighlight = -1;
    private lastInteriorTiltH = Number.NaN;
    private lastInteriorTiltV = Number.NaN;
    private lastInteriorRelX = -1;
    private lastInteriorRelY = -1;
    private lastInteriorRelW = -1;
    private lastInteriorRelH = -1;
    private lastInteriorUseBlurHalf = false;
    private hasInteriorKey = false;
    private sceneInteriorDirty = false;
    private interiorPassFailed = false;
    private boundInteriorTexture: WebGLTexture | null = null;
    private lastUseInteriorTex = -1;
    private pixelWidth = 0;
    private pixelHeight = 0;
    private lastCssWidth = -1;
    private lastCssHeight = -1;
    private lastDpr = -1;
    private lastPixelSizeX = 0;
    private lastPixelSizeY = 0;
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
    private lastDarkRimScale = -1;
    private lastChromaStrength = -1;
    private lastBlurRadiusPx = -1;
    private lastHasScene = -1;
    private lastRelX = -1;
    private lastRelY = -1;
    private lastRelW = -1;
    private lastRelH = -1;
    private lastInteriorMargin = -1;
    private lastBlurOffset1X = Number.NaN;
    private lastBlurOffset1Y = Number.NaN;
    private lastBlurOffset2X = Number.NaN;
    private lastBlurOffset2Y = Number.NaN;
    private lastDirectBlurClamp = -1;
    private lastLightTiltHorizontal = Number.NaN;
    private lastLightTiltVertical = Number.NaN;
    private lastSquircle = -1;
    private stableGeomCornerStyle: "circular" | "squircle" | null = null;
    private lastBleedPx = -1;
    private lastPeerCount = -1;
    private lastUploadedPeerBoundsCount = 0;
    private lastUploadedPeerPropsCount = 0;
    private readonly peerBoundsBuffer = new Float32Array(16);
    private readonly peerPropsBuffer = new Float32Array(16);
    private disposed = false;
    private transferCache: OpticalTransferCache | null = null;
    private transferCacheChecked = false;
    private stableGeometryFrames = 0;

    private constructor(
        canvas: HTMLCanvasElement,
        gl: WebGLRenderingContext,
        isWebgl2: boolean,
        program: WebGLProgram,
        vertexBuffer: WebGLBuffer,
        opticalTexture: WebGLTexture,
    ) {
        this.canvas = canvas;
        this.gl = gl;
        this.isWebgl2 = isWebgl2;
        this.program = program;
        this.vertexBuffer = vertexBuffer;
        const viewportDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as ArrayLike<number> | null;
        const maxTextureSize = Math.max(256, Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096);
        this.maxTextureSize = maxTextureSize;
        this.maxSceneTextureSize = this.smallMemory ? Math.min(maxTextureSize, SMALL_SCENE_DIMENSION) : maxTextureSize;
        this.opticalLutSize = Math.min(OPTICAL_LUT_SIZE, maxTextureSize);
        this.opticalTexture = opticalTexture;
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.opticalTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const nearestFilter = gl.NEAREST ?? 0x2600;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearestFilter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearestFilter);
        gl.uniform1i(gl.getUniformLocation(program, "uOpticalLut"), 1);
        gl.uniform2f(gl.getUniformLocation(program, "uLutScale"),
            this.opticalLutSize - 1, 1 / this.opticalLutSize);
        this.maxViewportWidth =
            viewportDims && Number(viewportDims[0]) > 0 ? Number(viewportDims[0]) : maxTextureSize;
        this.maxViewportHeight =
            viewportDims && Number(viewportDims[1]) > 0 ? Number(viewportDims[1]) : maxTextureSize;
        this.uSizeLoc = gl.getUniformLocation(program, "uSize");
        this.uGeomLoc = gl.getUniformLocation(program, "uGeom");
        this.uOpticalLoc = gl.getUniformLocation(program, "uOptical");
        this.uRefractionLoc = gl.getUniformLocation(program, "uRefraction");
        this.uTintLoc = gl.getUniformLocation(program, "uTint");
        this.uMediumLoc = gl.getUniformLocation(program, "uMedium");
        this.uSaturationLoc = gl.getUniformLocation(program, "uSaturation");
        this.uSharpnessLoc = gl.getUniformLocation(program, "uSharpness");
        this.uHighlightLoc = gl.getUniformLocation(program, "uHighlight");
        this.uSceneRectLoc = gl.getUniformLocation(program, "uSceneRect");
        this.uSceneTexLoc = gl.getUniformLocation(program, "uSceneTex");
        this.uHasSceneTexLoc = gl.getUniformLocation(program, "uHasSceneTex");
        this.uDprLoc = gl.getUniformLocation(program, "uDpr");
        this.uPixelSizeLoc = gl.getUniformLocation(program, "uPixelSize");
        this.uInteriorMarginLoc = gl.getUniformLocation(program, "uInteriorMargin");
        this.uBlurOffset1Loc = gl.getUniformLocation(program, "uBlurOffset1");
        this.uBlurOffset2Loc = gl.getUniformLocation(program, "uBlurOffset2");
        this.uDirectBlurClampLoc = gl.getUniformLocation(program, "uDirectBlurClamp");
        this.uInteriorTexLoc = gl.getUniformLocation(program, "uInteriorTex");
        this.uUseInteriorTexLoc = gl.getUniformLocation(program, "uUseInteriorTex");
        this.uLightTiltLoc = gl.getUniformLocation(program, "uLightTilt");
        this.uSquircleLoc = gl.getUniformLocation(program, "uSquircle");
        this.uCoalesceBleedLoc = gl.getUniformLocation(program, "uCoalesceBleed");
        this.uPeerCountLoc = gl.getUniformLocation(program, "uPeerCount");
        this.uPeerBoundsLoc =
            gl.getUniformLocation(program, "uPeerBounds[0]") ?? gl.getUniformLocation(program, "uPeerBounds");
        this.uPeerPropsLoc =
            gl.getUniformLocation(program, "uPeerProps[0]") ?? gl.getUniformLocation(program, "uPeerProps");
        gl.uniform1i(this.uSceneTexLoc, 0);
        gl.uniform1f(this.uHasSceneTexLoc, 0);
        gl.uniform1f(this.uDprLoc, 1);
        gl.uniform1f(this.uInteriorMarginLoc, 14);
        gl.uniform2f(this.uBlurOffset1Loc, 0, 0);
        gl.uniform2f(this.uBlurOffset2Loc, 0, 0);
        gl.uniform1f(this.uDirectBlurClampLoc, 0);
        if (this.uInteriorTexLoc) {
            gl.uniform1i(this.uInteriorTexLoc, 4);
        }
        if (this.uUseInteriorTexLoc) {
            gl.uniform1f(this.uUseInteriorTexLoc, 0);
        }
        if (this.uLightTiltLoc) {
            gl.uniform2f(this.uLightTiltLoc, 0, 0);
        }
        if (this.uSquircleLoc) {
            gl.uniform1f(this.uSquircleLoc, 0);
        }
        if (this.uCoalesceBleedLoc) {
            gl.uniform4f(this.uCoalesceBleedLoc, 0, 0, 0, 0);
        }
        if (this.uPeerCountLoc) {
            gl.uniform1f(this.uPeerCountLoc, 0);
        }
    }

    static create(canvas: HTMLCanvasElement): GlassWebglRenderer | null {
        const contextOptions: WebGLContextAttributes = {
            alpha: true,
            antialias: false,
            depth: false,
            stencil: false,
            premultipliedAlpha: true,
            preserveDrawingBuffer: false,
            powerPreference: "low-power",
        };

        let gl: WebGLRenderingContext | null = null;
        let isWebgl2 = false;
        for (const version of ["webgl2", "webgl"] as const) {
            try {
                gl = canvas.getContext(version, contextOptions) as WebGLRenderingContext | null;
                if (gl) {
                    isWebgl2 = version === "webgl2";
                    break;
                }
            } catch {
            }
        }
        if (!gl) return null;

        const programSources = isWebgl2
            ? buildWebgl2Sources(VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE, ["LG_WEBGL2"], false)
            : { vertex: VERTEX_SHADER_SOURCE, fragment: FRAGMENT_SHADER_SOURCE };
        const vertexShader = compileShader(gl, gl.VERTEX_SHADER, programSources.vertex);
        const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, programSources.fragment);
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
        gl.bindAttribLocation(program, 0, "aPosition");
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

        const opticalTexture = gl.createTexture();
        if (!opticalTexture) {
            gl.deleteBuffer(vertexBuffer);
            gl.deleteProgram(program);
            return null;
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

        const posLocation = gl.getAttribLocation(program, "aPosition");
        gl.useProgram(program);
        gl.enableVertexAttribArray(posLocation);
        gl.vertexAttribPointer(posLocation, 2, gl.FLOAT, false, 0, 0);

        return new GlassWebglRenderer(canvas, gl, isWebgl2, program, vertexBuffer, opticalTexture);
    }

    get hasSceneTexture(): boolean {
        return this.hasSceneTextureData;
    }

    setSceneCanvas(sourceCanvas: HTMLCanvasElement | null, sharpness = 0): void {
        if (this.disposed) return;
        const { gl } = this;
        if (typeof gl.isContextLost === "function" && gl.isContextLost()) {
            this.hasSceneTextureData = false;
            return;
        }
        if (!sourceCanvas || sourceCanvas.width <= 0 || sourceCanvas.height <= 0) {
            this.releaseSceneStorage();
            return;
        }

        const safeSharpness = Number.isFinite(sharpness) && sharpness > 0 ? Math.min(1, sharpness) : 0;
        const effectiveMaxSceneDim =
            safeSharpness > 0
                ? Math.min(
                      this.maxTextureSize,
                      Math.max(
                          this.maxSceneTextureSize,
                          Math.round(SMALL_SCENE_DIMENSION + (4096 - SMALL_SCENE_DIMENSION) * safeSharpness),
                      ),
                  )
                : this.maxSceneTextureSize;

        let uploadSource = sourceCanvas;
        if (
            sourceCanvas.width > effectiveMaxSceneDim ||
            sourceCanvas.height > effectiveMaxSceneDim
        ) {
            const fitScale = Math.min(
                effectiveMaxSceneDim / sourceCanvas.width,
                effectiveMaxSceneDim / sourceCanvas.height,
            );
            const scaledWidth = Math.max(1, Math.floor(sourceCanvas.width * fitScale));
            const scaledHeight = Math.max(1, Math.floor(sourceCanvas.height * fitScale));
            if (!this.uploadCanvas && typeof document !== "undefined") {
                this.uploadCanvas = document.createElement("canvas");
            }
            if (this.uploadCanvas) {
                resizeCanvas(this.uploadCanvas, scaledWidth, scaledHeight);
                const uploadCtx = this.uploadCanvas.getContext("2d");
                if (uploadCtx) {
                    uploadCtx.imageSmoothingEnabled = true;
                    uploadCtx.imageSmoothingQuality = "high";
                    uploadCtx.clearRect(0, 0, scaledWidth, scaledHeight);
                    uploadCtx.drawImage(sourceCanvas, 0, 0, scaledWidth, scaledHeight);
                    uploadSource = this.uploadCanvas;
                }
            }
            if (uploadSource === sourceCanvas) {
                this.releaseSceneStorage();
                return;
            }
        } else {
            this.releaseUploadCanvas();
        }

        if (!this.sceneTexture) {
            this.sceneTexture = gl.createTexture();
            this.hasSceneTextureInitialized = false;
        }
        if (!this.sceneTexture) return;

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
        const canGenerateMipmap = this.supportsMipmapGeneration();
        const minFilter = canGenerateMipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR;
        if (
            this.hasSceneTextureInitialized &&
            uploadSource.width === this.sceneCanvasWidth &&
            uploadSource.height === this.sceneCanvasHeight &&
            typeof gl.texSubImage2D === "function"
        ) {
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, uploadSource);
            if (this.sceneTextureMipmapped !== canGenerateMipmap) {
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
                this.sceneTextureMipmapped = canGenerateMipmap;
            }
        } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, uploadSource);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
            this.hasSceneTextureInitialized = true;
            this.sceneTextureMipmapped = canGenerateMipmap;
        }
        if (canGenerateMipmap) {
            gl.generateMipmap(gl.TEXTURE_2D);
        }
        this.sceneCanvasWidth = uploadSource.width;
        this.sceneCanvasHeight = uploadSource.height;
        this.boundSceneTexture = this.sceneTexture;
        this.sceneBlurDirty = true;
        this.sceneInteriorDirty = true;
        this.hasSceneTextureData = true;
    }

    private supportsMipmapGeneration(): boolean {
        return (
            this.isWebgl2 &&
            typeof this.gl.generateMipmap === "function" &&
            typeof this.gl.LINEAR_MIPMAP_LINEAR === "number"
        );
    }

    private allocateHalfResTarget(
        fbo: WebGLFramebuffer,
        texture: WebGLTexture,
        width: number,
        height: number,
        useMipmap = false,
    ): boolean {
        const { gl } = this;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(
            gl.TEXTURE_2D,
            gl.TEXTURE_MIN_FILTER,
            useMipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR,
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    }

    private prepareActiveSceneTexture(blurValue: number, useScene: boolean): WebGLTexture | null {
        if (!useScene || !this.sceneTexture) {
            return this.sceneTexture;
        }
        if (
            blurValue <= 6 ||
            this.blurDownsampleFailed ||
            this.sceneCanvasWidth < 4 ||
            this.sceneCanvasHeight < 4
        ) {
            return this.sceneTexture;
        }

        const { gl } = this;
        const blurDownsampleScale =
            blurValue >= 10 && this.sceneCanvasWidth >= 16 && this.sceneCanvasHeight >= 16
                ? 0.25
                : 0.5;
        const halfWidth = Math.max(2, Math.floor(this.sceneCanvasWidth * blurDownsampleScale));
        const halfHeight = Math.max(2, Math.floor(this.sceneCanvasHeight * blurDownsampleScale));

        if (!this.blurDownsampleProgram) {
            const vShader = compileShader(gl, gl.VERTEX_SHADER, KAWASE_DOWNSAMPLE_VERTEX);
            const fShader = compileShader(gl, gl.FRAGMENT_SHADER, KAWASE_DOWNSAMPLE_FRAGMENT);
            if (!vShader || !fShader) {
                if (vShader) gl.deleteShader(vShader);
                if (fShader) gl.deleteShader(fShader);
                this.blurDownsampleFailed = true;
                return this.sceneTexture;
            }
            const downsampleProgram = gl.createProgram();
            if (!downsampleProgram) {
                gl.deleteShader(vShader);
                gl.deleteShader(fShader);
                this.blurDownsampleFailed = true;
                return this.sceneTexture;
            }
            gl.attachShader(downsampleProgram, vShader);
            gl.attachShader(downsampleProgram, fShader);
            gl.bindAttribLocation(downsampleProgram, 0, "aPosition");
            gl.linkProgram(downsampleProgram);
            gl.deleteShader(vShader);
            gl.deleteShader(fShader);
            if (!gl.getProgramParameter(downsampleProgram, gl.LINK_STATUS)) {
                gl.deleteProgram(downsampleProgram);
                this.blurDownsampleFailed = true;
                return this.sceneTexture;
            }
            gl.useProgram(downsampleProgram);
            gl.uniform1i(gl.getUniformLocation(downsampleProgram, "uSourceTex"), 0);
            this.blurDownsampleHalfPixelLoc = gl.getUniformLocation(downsampleProgram, "uHalfPixel");
            this.blurDownsampleAlignedLoc = gl.getUniformLocation(downsampleProgram, "uAlignedDownsample");
            this.blurDownsampleProgram = downsampleProgram;
        }

        if (!this.blurHalfDownFbo) {
            this.blurHalfDownFbo = gl.createFramebuffer();
        }
        if (!this.blurHalfDownTexture) {
            this.blurHalfDownTexture = gl.createTexture();
        }
        if (!this.blurHalfFbo) {
            this.blurHalfFbo = gl.createFramebuffer();
        }
        if (!this.blurHalfTexture) {
            this.blurHalfTexture = gl.createTexture();
        }
        if (
            !this.blurHalfDownFbo ||
            !this.blurHalfDownTexture ||
            !this.blurHalfFbo ||
            !this.blurHalfTexture
        ) {
            if (this.blurHalfDownFbo) {
                gl.deleteFramebuffer(this.blurHalfDownFbo);
                this.blurHalfDownFbo = null;
            }
            if (this.blurHalfDownTexture) {
                gl.deleteTexture(this.blurHalfDownTexture);
                this.blurHalfDownTexture = null;
            }
            if (this.blurHalfFbo) {
                gl.deleteFramebuffer(this.blurHalfFbo);
                this.blurHalfFbo = null;
            }
            if (this.blurHalfTexture) {
                gl.deleteTexture(this.blurHalfTexture);
                this.blurHalfTexture = null;
            }
            this.blurDownsampleFailed = true;
            return this.sceneTexture;
        }

        if (halfWidth !== this.blurHalfWidth || halfHeight !== this.blurHalfHeight) {
            this.blurHalfWidth = halfWidth;
            this.blurHalfHeight = halfHeight;
            const downReady = this.allocateHalfResTarget(
                this.blurHalfDownFbo,
                this.blurHalfDownTexture,
                halfWidth,
                halfHeight,
            );
            const spreadReady = downReady
                ? this.allocateHalfResTarget(
                      this.blurHalfFbo,
                      this.blurHalfTexture,
                      halfWidth,
                      halfHeight,
                      this.supportsMipmapGeneration(),
                  )
                : false;
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            if (!spreadReady) {
                gl.deleteFramebuffer(this.blurHalfDownFbo);
                gl.deleteTexture(this.blurHalfDownTexture);
                gl.deleteFramebuffer(this.blurHalfFbo);
                gl.deleteTexture(this.blurHalfTexture);
                this.blurHalfDownFbo = null;
                this.blurHalfDownTexture = null;
                this.blurHalfFbo = null;
                this.blurHalfTexture = null;
                this.blurHalfWidth = 0;
                this.blurHalfHeight = 0;
                this.boundSceneTexture = null;
                this.blurDownsampleFailed = true;
                return this.sceneTexture;
            }
            this.sceneBlurDirty = true;
            this.cachedKawaseBlurValue = -1;
            this.boundSceneTexture = this.blurHalfTexture;
        }

        const needsDownsamplePass = this.sceneBlurDirty;
        const needsSpreadPass =
            needsDownsamplePass || Math.abs(blurValue - this.cachedKawaseBlurValue) > 0.35;

        if (needsSpreadPass) {
            this.sceneInteriorDirty = true;
            gl.viewport(0, 0, halfWidth, halfHeight);
            gl.useProgram(this.blurDownsampleProgram);
            gl.activeTexture(gl.TEXTURE0);

            if (needsDownsamplePass) {
                this.sceneBlurDirty = false;
                gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurHalfDownFbo);
                gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
                if (this.blurDownsampleAlignedLoc) {
                    const aligned = this.sceneCanvasWidth === halfWidth * 2 &&
                        this.sceneCanvasHeight === halfHeight * 2;
                    gl.uniform1f(this.blurDownsampleAlignedLoc, aligned ? 1 : 0);
                }
                if (this.blurDownsampleHalfPixelLoc) {
                    gl.uniform2f(
                        this.blurDownsampleHalfPixelLoc,
                        0.25 / halfWidth,
                        0.25 / halfHeight,
                    );
                }
                gl.drawArrays(gl.TRIANGLES, 0, 3);
            }

            this.cachedKawaseBlurValue = blurValue;
            const kawaseSpread = 1.0 + Math.max(0, blurValue - 6) * 0.35;
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurHalfFbo);
            gl.bindTexture(gl.TEXTURE_2D, this.blurHalfDownTexture);
            if (this.blurDownsampleAlignedLoc) gl.uniform1f(this.blurDownsampleAlignedLoc, 0);
            if (this.blurDownsampleHalfPixelLoc) {
                gl.uniform2f(
                    this.blurDownsampleHalfPixelLoc,
                    kawaseSpread / halfWidth,
                    kawaseSpread / halfHeight,
                );
            }
            gl.drawArrays(gl.TRIANGLES, 0, 3);

            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, this.pixelWidth, this.pixelHeight);
            gl.bindTexture(gl.TEXTURE_2D, this.blurHalfTexture);
            if (this.supportsMipmapGeneration()) {
                gl.generateMipmap(gl.TEXTURE_2D);
            }
            this.boundSceneTexture = this.blurHalfTexture;
        }

        return this.blurHalfTexture;
    }

    private getMediumCoefficients(frame: GlassFrameParams): GlassMediumCoefficients {
        const [r, g, b] = frame.tintColor;
        const { tintOpacity, thickness } = frame;
        if (
            this.mediumCoefficients === null || r !== this.mediumTintR || g !== this.mediumTintG ||
            b !== this.mediumTintB || tintOpacity !== this.mediumTintA || thickness !== this.mediumThickness
        ) {
            this.mediumTintR = r;
            this.mediumTintG = g;
            this.mediumTintB = b;
            this.mediumTintA = tintOpacity;
            this.mediumThickness = thickness;
            this.mediumCoefficients = resolveGlassMedium(r, g, b, tintOpacity, thickness);
        }
        return this.mediumCoefficients;
    }

    private prepareCoarseInterior(
        frame: GlassFrameParams,
        activeSceneTex: WebGLTexture | null,
        medium: GlassMediumCoefficients,
        blurRadiusPx: number,
        saturation: number,
        sharpness: number,
        dpr: number,
        interiorMargin: number,
        lightTiltHorizontal: number,
        lightTiltVertical: number,
    ): boolean {
        const innerCssW = frame.width - 2 * interiorMargin;
        const innerCssH = frame.height - 2 * interiorMargin;
        if (
            this.interiorPassFailed ||
            !activeSceneTex ||
            !frame.sceneRect ||
            blurRadiusPx <= 0 ||
            sharpness > 0 ||
            innerCssW < 96 ||
            innerCssH < 96 ||
            this.pixelWidth * this.pixelHeight < 200_000
        ) {
            return false;
        }

        const { gl } = this;
        if (!this.interiorProgram) {
            const interiorSources = this.isWebgl2
                ? buildWebgl2Sources(VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE, ["LG_WEBGL2", "LG_INTERIOR_PASS"], false)
                : {
                      vertex: `#define LG_INTERIOR_PASS\n${VERTEX_SHADER_SOURCE}`,
                      fragment: `#define LG_INTERIOR_PASS\n${FRAGMENT_SHADER_SOURCE}`,
                  };
            const vShader = compileShader(
                gl,
                gl.VERTEX_SHADER,
                interiorSources.vertex,
            );
            const fShader = compileShader(
                gl,
                gl.FRAGMENT_SHADER,
                interiorSources.fragment,
            );
            if (!vShader || !fShader) {
                if (vShader) gl.deleteShader(vShader);
                if (fShader) gl.deleteShader(fShader);
                this.interiorPassFailed = true;
                return false;
            }
            const prog = gl.createProgram();
            if (!prog) {
                gl.deleteShader(vShader);
                gl.deleteShader(fShader);
                this.interiorPassFailed = true;
                return false;
            }
            gl.attachShader(prog, vShader);
            gl.attachShader(prog, fShader);
            gl.bindAttribLocation(prog, 0, "aPosition");
            gl.linkProgram(prog);
            gl.deleteShader(vShader);
            gl.deleteShader(fShader);
            if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
                gl.deleteProgram(prog);
                this.interiorPassFailed = true;
                return false;
            }
            gl.useProgram(prog);
            gl.uniform1i(gl.getUniformLocation(prog, "uSceneTex"), 0);
            const bleedLoc = gl.getUniformLocation(prog, "uCoalesceBleed");
            if (bleedLoc) gl.uniform4f(bleedLoc, 0, 0, 0, 0);
            this.interiorUSizeLoc = gl.getUniformLocation(prog, "uSize");
            this.interiorUTintLoc = gl.getUniformLocation(prog, "uTint");
            this.interiorUMediumLoc = gl.getUniformLocation(prog, "uMedium");
            this.interiorUSaturationLoc = gl.getUniformLocation(prog, "uSaturation");
            this.interiorUSharpnessLoc = gl.getUniformLocation(prog, "uSharpness");
            this.interiorUPixelSizeLoc = gl.getUniformLocation(prog, "uPixelSize");
            this.interiorUHighlightLoc = gl.getUniformLocation(prog, "uHighlight");
            this.interiorUSceneRectLoc = gl.getUniformLocation(prog, "uSceneRect");
            this.interiorUBlurOffset1Loc = gl.getUniformLocation(prog, "uBlurOffset1");
            this.interiorUBlurOffset2Loc = gl.getUniformLocation(prog, "uBlurOffset2");
            this.interiorUDirectBlurClampLoc = gl.getUniformLocation(prog, "uDirectBlurClamp");
            this.interiorULightTiltLoc = gl.getUniformLocation(prog, "uLightTilt");
            this.interiorProgram = prog;
        }

        if (!this.interiorFbo) this.interiorFbo = gl.createFramebuffer();
        if (!this.interiorTexture) this.interiorTexture = gl.createTexture();
        if (!this.interiorFbo || !this.interiorTexture) {
            if (this.interiorFbo) {
                gl.deleteFramebuffer(this.interiorFbo);
                this.interiorFbo = null;
            }
            if (this.interiorTexture) {
                gl.deleteTexture(this.interiorTexture);
                this.interiorTexture = null;
            }
            this.boundInteriorTexture = null;
            this.interiorPassFailed = true;
            return false;
        }

        const interiorScale = Math.min(dpr, this.smallMemory ? 0.5 : 1, Math.max(0.5, dpr * 0.4));
        const interiorW = Math.min(this.maxSceneTextureSize, Math.max(32, Math.round(frame.width * interiorScale)));
        const interiorH = Math.min(this.maxSceneTextureSize, Math.max(32, Math.round(frame.height * interiorScale)));

        if (interiorW !== this.interiorWidth || interiorH !== this.interiorHeight) {
            this.interiorWidth = interiorW;
            this.interiorHeight = interiorH;
            const ready = this.allocateHalfResTarget(
                this.interiorFbo,
                this.interiorTexture,
                interiorW,
                interiorH,
            );
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, activeSceneTex);
            this.boundSceneTexture = activeSceneTex;
            if (!ready) {
                gl.deleteFramebuffer(this.interiorFbo);
                gl.deleteTexture(this.interiorTexture);
                this.interiorFbo = null;
                this.interiorTexture = null;
                this.interiorWidth = 0;
                this.interiorHeight = 0;
                this.boundInteriorTexture = null;
                this.interiorPassFailed = true;
                return false;
            }
            this.sceneInteriorDirty = true;
        }

        const { relX, relY, relW, relH } = frame.sceneRect;
        const useBlurHalf = activeSceneTex === this.blurHalfTexture;
        const interiorParamsChanged =
            !this.hasInteriorKey ||
            frame.width !== this.lastInteriorFrameW ||
            frame.height !== this.lastInteriorFrameH ||
            blurRadiusPx !== this.lastInteriorBlurPx ||
            saturation !== this.lastInteriorSaturation ||
            sharpness !== this.lastInteriorSharpness ||
            medium !== this.lastInteriorMedium ||
            frame.highlight !== this.lastInteriorHighlight ||
            lightTiltHorizontal !== this.lastInteriorTiltH ||
            lightTiltVertical !== this.lastInteriorTiltV ||
            relX !== this.lastInteriorRelX ||
            relY !== this.lastInteriorRelY ||
            relW !== this.lastInteriorRelW ||
            relH !== this.lastInteriorRelH ||
            useBlurHalf !== this.lastInteriorUseBlurHalf;

        if (this.sceneInteriorDirty || interiorParamsChanged) {
            const blurUvX = (relW / Math.max(1.0, frame.width)) * blurRadiusPx;
            const blurUvY = (relH / Math.max(1.0, frame.height)) * blurRadiusPx;
            const blurOffset1X = blurUvX * 0.86;
            const blurOffset1Y = blurUvY * 0.34;
            const blurOffset2X = -blurUvX * 0.34;
            const blurOffset2Y = blurUvY * 0.86;
            const padX = Math.max(Math.abs(blurOffset1X), Math.abs(blurOffset2X));
            const padY = Math.max(Math.abs(blurOffset1Y), Math.abs(blurOffset2Y));
            const clampFlag =
                relX - padX < 0.002 ||
                relX + relW + padX > 0.998 ||
                relY - padY < 0.002 ||
                relY + relH + padY > 0.998
                    ? 1
                    : 0;

            gl.bindFramebuffer(gl.FRAMEBUFFER, this.interiorFbo);
            gl.viewport(0, 0, interiorW, interiorH);
            gl.useProgram(this.interiorProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, activeSceneTex);
            this.boundSceneTexture = activeSceneTex;

            if (this.interiorUSizeLoc && (frame.width !== this.lastInteriorFrameW || frame.height !== this.lastInteriorFrameH)) {
                gl.uniform2f(this.interiorUSizeLoc, frame.width, frame.height);
            }
            const interiorPixelSizeX = frame.width / interiorW;
            const interiorPixelSizeY = frame.height / interiorH;
            if (
                this.interiorUPixelSizeLoc &&
                (interiorPixelSizeX !== this.lastInteriorPixelSizeX ||
                    interiorPixelSizeY !== this.lastInteriorPixelSizeY)
            ) {
                this.lastInteriorPixelSizeX = interiorPixelSizeX;
                this.lastInteriorPixelSizeY = interiorPixelSizeY;
                gl.uniform2f(this.interiorUPixelSizeLoc, interiorPixelSizeX, interiorPixelSizeY);
            }
            if (this.interiorUSaturationLoc && saturation !== this.lastInteriorSaturation) {
                gl.uniform1f(this.interiorUSaturationLoc, saturation);
            }
            if (this.interiorUSharpnessLoc && sharpness !== this.lastInteriorSharpness) {
                gl.uniform1f(this.interiorUSharpnessLoc, sharpness);
            }
            if (medium !== this.lastInteriorMedium) {
                if (this.interiorUTintLoc) {
                    gl.uniform4f(this.interiorUTintLoc, ...frame.tintColor, frame.tintOpacity);
                }
                if (this.interiorUMediumLoc) {
                    gl.uniform4f(this.interiorUMediumLoc, ...medium);
                }
            }
            if (this.interiorUHighlightLoc) {
                gl.uniform4f(this.interiorUHighlightLoc, frame.highlight, 0, 4.0, blurRadiusPx);
            }
            if (this.interiorUSceneRectLoc) {
                gl.uniform4f(this.interiorUSceneRectLoc, relX, relY, relW, relH);
            }
            if (this.interiorUBlurOffset1Loc) {
                gl.uniform2f(this.interiorUBlurOffset1Loc, blurOffset1X, blurOffset1Y);
            }
            if (this.interiorUBlurOffset2Loc) {
                gl.uniform2f(this.interiorUBlurOffset2Loc, blurOffset2X, blurOffset2Y);
            }
            if (this.interiorUDirectBlurClampLoc) {
                gl.uniform1f(this.interiorUDirectBlurClampLoc, clampFlag);
            }
            if (this.interiorULightTiltLoc) {
                gl.uniform2f(this.interiorULightTiltLoc, lightTiltHorizontal, lightTiltVertical);
            }

            gl.drawArrays(gl.TRIANGLES, 0, 3);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, this.pixelWidth, this.pixelHeight);

            this.sceneInteriorDirty = false;
            this.hasInteriorKey = true;
            this.lastInteriorFrameW = frame.width;
            this.lastInteriorFrameH = frame.height;
            this.lastInteriorBlurPx = blurRadiusPx;
            this.lastInteriorSaturation = saturation;
            this.lastInteriorSharpness = sharpness;
            this.lastInteriorMedium = medium;
            this.lastInteriorHighlight = frame.highlight;
            this.lastInteriorTiltH = lightTiltHorizontal;
            this.lastInteriorTiltV = lightTiltVertical;
            this.lastInteriorRelX = relX;
            this.lastInteriorRelY = relY;
            this.lastInteriorRelW = relW;
            this.lastInteriorRelH = relH;
            this.lastInteriorUseBlurHalf = useBlurHalf;
        }

        if (this.boundInteriorTexture !== this.interiorTexture) {
            const tex4 = (gl as unknown as { TEXTURE4?: number }).TEXTURE4 ?? gl.TEXTURE0 + 4;
            gl.activeTexture(tex4);
            gl.bindTexture(gl.TEXTURE_2D, this.interiorTexture);
            gl.activeTexture(gl.TEXTURE0);
            this.boundInteriorTexture = this.interiorTexture;
        }
        return true;
    }

    render(frame: GlassFrameParams): void {
        if (this.disposed) return;
        if (typeof this.gl.isContextLost === "function" && this.gl.isContextLost()) return;
        const minSpan = Math.min(frame.width, frame.height);
        if (!Number.isFinite(Math.max(frame.width, frame.height)) || minSpan < 2) return;
        const bezel = resolveRefractionBezel(minSpan, frame.bezel, frame.adaptiveRefraction === true);
        const direction = getRefractionDirectionId(frame.refractionDirection);
        const edgeFade = direction === 0 ? 0 : resolveRefractionEdgeFade(frame.refractionEdgeFade);

        const peers = frame.coalescePeers ?? [];
        const peerCount = Math.min(4, peers.length);
        const bleedPx = peerCount > 0 ? Math.max(0, frame.bleedPx ?? 0) : 0;
        const cssCanvasWidth = frame.width + bleedPx * 2;
        const cssCanvasHeight = frame.height + bleedPx * 2;

        const sharpness = resolveGlassSharpness(frame.sharpness, frame.blur);
        const deviceDpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
        const requestedPixelRatio =
            frame.pixelRatio ??
            (sharpness > 0 ? resolveSharpnessPixelRatio(sharpness, deviceDpr) : undefined);
        const desiredDpr = resolveWebglPixelRatio(requestedPixelRatio, frame.radius);
        const explicitDeviceMemory =
            typeof navigator !== "undefined"
                ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory
                : undefined;
        const hasConstrainedMemoryHint =
            typeof explicitDeviceMemory === "number" &&
            Number.isFinite(explicitDeviceMemory) &&
            explicitDeviceMemory <= 4;
        const activeFramePixelLimit =
            (frame.sharpness !== undefined && frame.sharpness > 0) ||
            (sharpness > 0 && !hasConstrainedMemoryHint)
                ? Math.max(this.framePixelLimit, MAX_WEBGL_FRAMEBUFFER_PIXELS)
                : this.framePixelLimit;
        const maxAreaScale = Math.sqrt(activeFramePixelLimit / (cssCanvasWidth * cssCanvasHeight));
        const maxDimScale = Math.min(
            this.maxViewportWidth / Math.max(1, cssCanvasWidth),
            this.maxViewportHeight / Math.max(1, cssCanvasHeight),
        );
        const dpr = Math.min(desiredDpr, maxAreaScale, maxDimScale);
        const targetWidth = Math.max(
            1,
            Math.min(this.maxViewportWidth, Math.floor(cssCanvasWidth * dpr)),
        );
        const targetHeight = Math.max(
            1,
            Math.min(this.maxViewportHeight, Math.floor(cssCanvasHeight * dpr)),
        );

        const dimensionsChanged = targetWidth !== this.pixelWidth || targetHeight !== this.pixelHeight;
        if (dimensionsChanged) {
            this.pixelWidth = targetWidth;
            this.pixelHeight = targetHeight;
            resizeCanvas(this.canvas, targetWidth, targetHeight);
            this.gl.viewport(0, 0, targetWidth, targetHeight);
        }

        const { gl } = this;
        const cornerStyle = resolveCornerStyle(frame.cornerStyle);
        const squircleFlag = cornerStyle === "squircle" ? 1 : 0;
        const geometryChanged = dimensionsChanged ||
            frame.width !== this.lastCssWidth || frame.height !== this.lastCssHeight ||
            frame.radius !== this.lastRadius || bezel !== this.lastBezel || dpr !== this.lastDpr ||
            frame.surface !== this.opticalSurface || frame.ior !== this.opticalIor ||
            cornerStyle !== this.stableGeomCornerStyle;
        this.stableGeomCornerStyle = cornerStyle;
        if (geometryChanged) {
            this.transferCache?.invalidate(dimensionsChanged);
        }
        this.stableGeometryFrames = geometryChanged ? 0 : this.stableGeometryFrames + 1;
        if (frame.surface !== this.opticalSurface || frame.ior !== this.opticalIor) {
            const lut = buildOpticalLut(frame.surface, frame.ior, this.opticalLutSize);
            if (lut !== this.opticalLut) {
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, this.opticalTexture);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
                gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.opticalLutSize, 1, 0,
                    gl.RGBA, gl.UNSIGNED_BYTE, lut);
                gl.activeTexture(gl.TEXTURE0);
                this.opticalLut = lut;
                this.opticalLutPeak = undefined;
            }
            this.opticalSurface = frame.surface;
            this.opticalIor = frame.ior;
        }

        const blurRadiusPx = frame.blur > 0 ? Math.min(22.0, frame.blur * 2.2) : 0;
        const saturation = resolveGlassSaturation(frame.saturation) ?? -1;
        const chromaStrength = resolveEffectiveChromaticAberration(
            frame.chromaticAberration,
            frame.abbeNumber,
            frame.ior,
        );
        let scaleRatio = Math.max(0, frame.scaleRatio);
        const travelSpan = getRefractionSpan(frame.width, frame.height, frame.refractionDirection);
        const travelLimit = frame.adaptiveRefraction === true ? resolveRefractionTravel(travelSpan, bezel) : Infinity;
        const maxTravel = Math.min(
            travelLimit,
            Math.max(0, frame.maxScaleMultiplier ?? Infinity) * bezel * 0.5,
            Math.max(0, frame.maxRefractionPx ?? Infinity),
        );
        if (scaleRatio > 0 && this.opticalLut && Number.isFinite(maxTravel)) {
            const peak = this.opticalLutPeak ??= getOpticalLutPeak(this.opticalLut);
            const thicknessBoost = Math.min(2.25, Math.max(1, 0.95 + frame.thickness * 0.015625));
            const { blueMultiplier: blueGain } = resolveChromaticChannelScales(1, chromaStrength);
            const interferenceGain = 1 + 0.10 * Math.max(0, peerCount - 0.5);
            const geometryGain = (1.35 + 0.14) * interferenceGain;
            const peakTravel = bezel * peak * geometryGain * thicknessBoost * blueGain;
            if (peakTravel > 0) scaleRatio = Math.min(scaleRatio, maxTravel / peakTravel);
        }
        const useSceneFlag = this.hasSceneTextureData && Boolean(frame.sceneRect) ? 1.0 : 0.0;
        const medium = useSceneFlag > 0.5 ? this.getMediumCoefficients(frame) : null;
        const activeSceneTex = this.prepareActiveSceneTexture(frame.blur, useSceneFlag > 0.5);
        if (useSceneFlag > 0.5 && activeSceneTex && activeSceneTex !== this.boundSceneTexture) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, activeSceneTex);
            this.boundSceneTexture = activeSceneTex;
        }
        const interiorMargin = Math.max(Math.max(1.0, bezel), 14.0, 0.707107 / dpr + 0.5);
        const lightTiltHorizontal = frame.lightTilt?.horizontal ?? 0;
        const lightTiltVertical = frame.lightTilt?.vertical ?? 0;
        const useInteriorTex =
            medium && peerCount === 0 && bleedPx === 0
                ? this.prepareCoarseInterior(
                      frame,
                      activeSceneTex ?? this.sceneTexture,
                      medium,
                      blurRadiusPx,
                      saturation,
                      sharpness,
                      dpr,
                      interiorMargin,
                      lightTiltHorizontal,
                      lightTiltVertical,
                  )
                : false;
        if (this.stableGeometryFrames >= 2 && peerCount === 0 && bleedPx === 0) {
            if (!this.transferCacheChecked && canAllocateOpticalTransfer(targetWidth, targetHeight, this.maxTextureSize)) {
                this.transferCacheChecked = true;
                this.transferCache = OpticalTransferCache.create(gl, VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
            }
            if (
                this.transferCache?.render(
                    frame,
                    bezel,
                    scaleRatio,
                    direction,
                    edgeFade,
                    targetWidth,
                    targetHeight,
                    dpr,
                    this.opticalTexture,
                    this.opticalLutSize,
                    useSceneFlag > 0.5,
                    blurRadiusPx,
                    scaleRatio > 0 ? chromaStrength : 0,
                    saturation,
                    sharpness,
                    medium,
                    useInteriorTex,
                )
            ) {
                return;
            }
        }
        gl.useProgram(this.program);

        const surfaceId = resolveSurfaceId(frame.surface);
        if (direction !== this.lastRefractionDirection || edgeFade !== this.lastRefractionEdgeFade) {
            this.lastRefractionDirection = direction;
            this.lastRefractionEdgeFade = edgeFade;
            gl.uniform2f(this.uRefractionLoc, direction, edgeFade);
        }

        if (
            this.uCoalesceBleedLoc &&
            (bleedPx !== this.lastBleedPx ||
                frame.width !== this.lastCssWidth ||
                frame.height !== this.lastCssHeight)
        ) {
            this.lastBleedPx = bleedPx;
            const bleedScaleX = (2 * bleedPx) / Math.max(1, frame.width);
            const bleedScaleY = (2 * bleedPx) / Math.max(1, frame.height);
            const bleedOffsetX = bleedPx > 0 ? -bleedPx / Math.max(1, frame.width) : 0;
            const bleedOffsetY = bleedPx > 0 ? -bleedPx / Math.max(1, frame.height) : 0;
            gl.uniform4f(this.uCoalesceBleedLoc, bleedScaleX, bleedScaleY, bleedOffsetX, bleedOffsetY);
        }

        if (frame.width !== this.lastCssWidth || frame.height !== this.lastCssHeight) {
            gl.uniform2f(this.uSizeLoc, frame.width, frame.height);
        }
        if (dpr !== this.lastDpr) {
            this.lastDpr = dpr;
            gl.uniform1f(this.uDprLoc, dpr);
        }
        const pixelSizeX = cssCanvasWidth / targetWidth;
        const pixelSizeY = cssCanvasHeight / targetHeight;
        if (pixelSizeX !== this.lastPixelSizeX || pixelSizeY !== this.lastPixelSizeY) {
            this.lastPixelSizeX = pixelSizeX;
            this.lastPixelSizeY = pixelSizeY;
            gl.uniform2f(this.uPixelSizeLoc, pixelSizeX, pixelSizeY);
        }
        if (
            frame.width !== this.lastCssWidth ||
            frame.height !== this.lastCssHeight ||
            frame.radius !== this.lastRadius ||
            bezel !== this.lastBezel
        ) {
            this.lastCssWidth = frame.width;
            this.lastCssHeight = frame.height;
            this.lastRadius = frame.radius;
            this.lastBezel = bezel;
            gl.uniform4f(
                this.uGeomLoc,
                frame.width * 0.5,
                frame.height * 0.5,
                frame.radius,
                bezel,
            );
        }
        if (
            frame.ior !== this.lastIor ||
            frame.thickness !== this.lastThickness ||
            scaleRatio !== this.lastScaleRatio ||
            surfaceId !== this.lastSurfaceId
        ) {
            this.lastIor = frame.ior;
            this.lastThickness = frame.thickness;
            this.lastScaleRatio = scaleRatio;
            this.lastSurfaceId = surfaceId;
            gl.uniform4f(
                this.uOpticalLoc,
                frame.ior,
                frame.thickness,
                scaleRatio,
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
        if (medium && medium !== this.lastDirectMedium) {
            this.lastDirectMedium = medium;
            if (this.uMediumLoc) {
                gl.uniform4f(this.uMediumLoc, ...medium);
            }
        }

        const darkRimScale = frame.darkRimScale ?? 1;
        if (this.uSaturationLoc && saturation !== this.lastSaturation) {
            this.lastSaturation = saturation;
            gl.uniform1f(this.uSaturationLoc, saturation);
        }
        if (this.uSharpnessLoc && sharpness !== this.lastSharpness) {
            this.lastSharpness = sharpness;
            gl.uniform1f(this.uSharpnessLoc, sharpness);
        }
        const samplingChroma = scaleRatio > 0 ? chromaStrength : 0;
        if (
            frame.highlight !== this.lastHighlight ||
            darkRimScale !== this.lastDarkRimScale ||
            samplingChroma !== this.lastChromaStrength ||
            blurRadiusPx !== this.lastBlurRadiusPx
        ) {
            this.lastHighlight = frame.highlight;
            this.lastDarkRimScale = darkRimScale;
            this.lastChromaStrength = samplingChroma;
            this.lastBlurRadiusPx = blurRadiusPx;
            gl.uniform4f(this.uHighlightLoc, frame.highlight, samplingChroma, darkRimScale, blurRadiusPx);
        }

        if (interiorMargin !== this.lastInteriorMargin) {
            this.lastInteriorMargin = interiorMargin;
            gl.uniform1f(this.uInteriorMarginLoc, interiorMargin);
        }

        const useInteriorFlag = useInteriorTex ? 1 : 0;
        if (this.uUseInteriorTexLoc && useInteriorFlag !== this.lastUseInteriorTex) {
            this.lastUseInteriorTex = useInteriorFlag;
            gl.uniform1f(this.uUseInteriorTexLoc, useInteriorFlag);
        }

        if (useSceneFlag !== this.lastHasScene) {
            this.lastHasScene = useSceneFlag;
            gl.uniform1f(this.uHasSceneTexLoc, useSceneFlag);
        }
        if (useSceneFlag > 0.5 && frame.sceneRect) {
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
            const blurUvX = blurRadiusPx > 0 ? (relW / Math.max(1.0, frame.width)) * blurRadiusPx : 0;
            const blurUvY = blurRadiusPx > 0 ? (relH / Math.max(1.0, frame.height)) * blurRadiusPx : 0;
            const blurOffset1X = blurUvX * 0.86;
            const blurOffset1Y = blurUvY * 0.34;
            const blurOffset2X = -blurUvX * 0.34;
            const blurOffset2Y = blurUvY * 0.86;
            if (blurOffset1X !== this.lastBlurOffset1X || blurOffset1Y !== this.lastBlurOffset1Y) {
                this.lastBlurOffset1X = blurOffset1X;
                this.lastBlurOffset1Y = blurOffset1Y;
                gl.uniform2f(this.uBlurOffset1Loc, blurOffset1X, blurOffset1Y);
            }
            if (blurOffset2X !== this.lastBlurOffset2X || blurOffset2Y !== this.lastBlurOffset2Y) {
                this.lastBlurOffset2X = blurOffset2X;
                this.lastBlurOffset2Y = blurOffset2Y;
                gl.uniform2f(this.uBlurOffset2Loc, blurOffset2X, blurOffset2Y);
            }
            const padX = Math.max(Math.abs(blurOffset1X), Math.abs(blurOffset2X));
            const padY = Math.max(Math.abs(blurOffset1Y), Math.abs(blurOffset2Y));
            const directBlurClamp =
                relX - padX < 0.002 ||
                relX + relW + padX > 0.998 ||
                relY - padY < 0.002 ||
                relY + relH + padY > 0.998
                    ? 1
                    : 0;
            if (directBlurClamp !== this.lastDirectBlurClamp) {
                this.lastDirectBlurClamp = directBlurClamp;
                gl.uniform1f(this.uDirectBlurClampLoc, directBlurClamp);
            }
        }

        if (
            this.uLightTiltLoc &&
            (lightTiltHorizontal !== this.lastLightTiltHorizontal ||
                lightTiltVertical !== this.lastLightTiltVertical)
        ) {
            this.lastLightTiltHorizontal = lightTiltHorizontal;
            this.lastLightTiltVertical = lightTiltVertical;
            gl.uniform2f(this.uLightTiltLoc, lightTiltHorizontal, lightTiltVertical);
        }

        if (this.uSquircleLoc && squircleFlag !== this.lastSquircle) {
            this.lastSquircle = squircleFlag;
            gl.uniform1f(this.uSquircleLoc, squircleFlag);
        }

        if (this.uPeerCountLoc && (peerCount !== this.lastPeerCount || peerCount > 0)) {
            if (peerCount !== this.lastPeerCount) {
                this.lastPeerCount = peerCount;
                gl.uniform1f(this.uPeerCountLoc, peerCount);
            }
            if (peerCount > 0) {
                let boundsChanged = peerCount !== this.lastUploadedPeerBoundsCount;
                let propsChanged = peerCount !== this.lastUploadedPeerPropsCount;
                for (let index = 0; index < peerCount; index += 1) {
                    const peer = peers[index]!;
                    const base = index * 4;
                    const bx = Math.fround(peer.relCenterX);
                    const by = Math.fround(-peer.relCenterY);
                    const bw = Math.fround(peer.halfWidth);
                    const bh = Math.fround(peer.halfHeight);
                    if (
                        this.peerBoundsBuffer[base] !== bx ||
                        this.peerBoundsBuffer[base + 1] !== by ||
                        this.peerBoundsBuffer[base + 2] !== bw ||
                        this.peerBoundsBuffer[base + 3] !== bh
                    ) {
                        this.peerBoundsBuffer[base] = bx;
                        this.peerBoundsBuffer[base + 1] = by;
                        this.peerBoundsBuffer[base + 2] = bw;
                        this.peerBoundsBuffer[base + 3] = bh;
                        boundsChanged = true;
                    }
                    const pr = Math.fround(peer.radius);
                    const pm = Math.fround(peer.mergeRadius);
                    const pw = Math.fround(peer.wavePhase);
                    const tieFlag = peer.priorityWinsTie ? 1 : 0;
                    if (
                        this.peerPropsBuffer[base] !== pr ||
                        this.peerPropsBuffer[base + 1] !== pm ||
                        this.peerPropsBuffer[base + 2] !== pw ||
                        this.peerPropsBuffer[base + 3] !== tieFlag
                    ) {
                        this.peerPropsBuffer[base] = pr;
                        this.peerPropsBuffer[base + 1] = pm;
                        this.peerPropsBuffer[base + 2] = pw;
                        this.peerPropsBuffer[base + 3] = tieFlag;
                        propsChanged = true;
                    }
                }
                if (boundsChanged && this.uPeerBoundsLoc && typeof gl.uniform4fv === "function") {
                    this.lastUploadedPeerBoundsCount = peerCount;
                    gl.uniform4fv(this.uPeerBoundsLoc, this.peerBoundsBuffer);
                }
                if (propsChanged && this.uPeerPropsLoc && typeof gl.uniform4fv === "function") {
                    this.lastUploadedPeerPropsCount = peerCount;
                    gl.uniform4fv(this.uPeerPropsLoc, this.peerPropsBuffer);
                }
            }
        }

        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    private releaseUploadCanvas(): void {
        if (!this.uploadCanvas) return;
        this.uploadCanvas.width = 0;
        this.uploadCanvas.height = 0;
        this.uploadCanvas = null;
    }

    private releaseSceneStorage(): void {
        if (this.blurHalfDownFbo) this.gl.deleteFramebuffer(this.blurHalfDownFbo);
        if (this.blurHalfFbo) this.gl.deleteFramebuffer(this.blurHalfFbo);
        if (this.interiorFbo) this.gl.deleteFramebuffer(this.interiorFbo);
        this.blurHalfDownFbo = null;
        this.blurHalfFbo = null;
        this.interiorFbo = null;
        if (this.sceneTexture) {
            this.gl.deleteTexture(this.sceneTexture);
            this.sceneTexture = null;
        }
        if (this.blurHalfDownTexture) {
            this.gl.deleteTexture(this.blurHalfDownTexture);
            this.blurHalfDownTexture = null;
        }
        if (this.blurHalfTexture) {
            this.gl.deleteTexture(this.blurHalfTexture);
            this.blurHalfTexture = null;
        }
        if (this.interiorTexture) {
            this.gl.deleteTexture(this.interiorTexture);
            this.interiorTexture = null;
        }
        this.blurHalfWidth = 0;
        this.blurHalfHeight = 0;
        this.interiorWidth = 0;
        this.interiorHeight = 0;
        this.hasInteriorKey = false;
        this.boundSceneTexture = null;
        this.boundInteriorTexture = null;
        this.hasSceneTextureInitialized = false;
        this.sceneTextureMipmapped = false;
        this.hasSceneTextureData = false;
        this.releaseUploadCanvas();
    }

    dispose(releaseContext = false): void {
        if (this.disposed) return;
        this.disposed = true;
        this.opticalLut = null;
        this.releaseSceneStorage();
        if (this.blurDownsampleProgram) {
            this.gl.deleteProgram(this.blurDownsampleProgram);
            this.blurDownsampleProgram = null;
        }
        if (this.interiorProgram) {
            this.gl.deleteProgram(this.interiorProgram);
            this.interiorProgram = null;
        }
        this.transferCache?.dispose();
        this.transferCache = null;
        this.gl.deleteTexture(this.opticalTexture);
        this.gl.deleteBuffer(this.vertexBuffer);
        this.gl.deleteProgram(this.program);
        if (releaseContext) this.gl.getExtension?.("WEBGL_lose_context")?.loseContext?.();
    }
}
