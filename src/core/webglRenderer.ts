import type { CoalescencePeer } from "./coalescence.js";
import type { GlassSurface } from "./types.js";
import { resolveChromaticAberration } from "./config.js";
import { buildOpticalLut, OPTICAL_LUT_SIZE } from "./optics.js";
import { OpticalTransferCache } from "./opticalTransfer.js";

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
#if defined(LG_SAMPLE_BLUR) || (!defined(LG_TRANSFER_BUILD) && !defined(LG_TRANSFER_SAMPLE))
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
#if defined(LG_SAMPLE_BLUR) || (!defined(LG_TRANSFER_BUILD) && !defined(LG_TRANSFER_SAMPLE))
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

const FRAGMENT_SHADER_SOURCE = `
precision highp float;

varying vec2 vUv;
#if defined(LG_SAMPLE_BLUR) || (!defined(LG_TRANSFER_BUILD) && !defined(LG_TRANSFER_SAMPLE))
varying vec2 vSceneUv;
varying vec2 vUv1P;
varying vec2 vUv1M;
varying vec2 vUv2P;
varying vec2 vUv2M;
#endif

uniform vec2 uSize;
uniform vec4 uGeom;
uniform vec4 uOptical;
uniform vec4 uTint;
uniform vec4 uHighlight;
uniform vec4 uSceneRect;
uniform sampler2D uSceneTex;
uniform float uHasSceneTex;
uniform float uDpr;
uniform sampler2D uOpticalLut;
uniform vec2 uLutScale;
uniform float uInteriorMargin;
uniform float uDirectBlurClamp;
uniform vec2 uLightTilt;
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
const vec3 HALF_SECONDARY = vec3(0.188434, -0.494640, 0.848425);

vec2 sminPoly(float aDist, float bDist, float kSmooth) {
    float h = clamp(0.5 + 0.5 * (bDist - aDist) / max(kSmooth, 0.001), 0.0, 1.0);
    float blended = mix(bDist, aDist, h) - kSmooth * h * (1.0 - h);
    return vec2(blended, h);
}

float evalAmbientSheen(vec2 uv) {
    vec2 shiftedCenter = vec2(0.34 + uLightTilt.x * 0.20, uLightTilt.y * 0.14);
    float smoothDeltaX = sqrt((uv.x - shiftedCenter.x) * (uv.x - shiftedCenter.x) + 0.015);
    float archTerm = clamp(uv.y * 0.90 + 0.08 + shiftedCenter.y - smoothDeltaX * 0.36, 0.0, 1.0);
    float archTermSq = archTerm * archTerm;
    float topArchSheen = archTermSq * archTerm * (0.82 + 0.18 * archTerm) * 0.032;
    float bounceTerm = clamp((0.45 - uv.y - shiftedCenter.y * 0.5) * 2.222222, 0.0, 1.0);
    float bottomBounce = bounceTerm * bounceTerm * (0.83 + 0.17 * bounceTerm) * 0.016;
    return topArchSheen + bottomBounce;
}

float compressHighlight(float rawHighlight) {
    float clamped = max(0.0, rawHighlight);
    return clamp(clamped / (1.0 + 0.55 * clamped), 0.0, 0.52);
}

#ifdef LG_SPECIALIZED
#ifndef LG_TRANSFER_BUILD
#ifdef LG_SAMPLE_BLUR
vec3 sampleInteriorBlur() {
    vec2 offset1 = vUv1P - vSceneUv;
    vec2 offset2 = vUv2P - vSceneUv;
    vec2 inner1 = (offset1 + offset2) * 0.36;
    vec2 inner2 = (offset1 - offset2) * 0.36;
#ifdef LG_SAMPLE_CLAMP
    vec3 centerG = texture2D(uSceneTex, clamp(vSceneUv, 0.002, 0.998)).rgb;
    vec3 innerSum =
        texture2D(uSceneTex, clamp(vSceneUv + inner1, 0.002, 0.998)).rgb +
        texture2D(uSceneTex, clamp(vSceneUv - inner1, 0.002, 0.998)).rgb +
        texture2D(uSceneTex, clamp(vSceneUv + inner2, 0.002, 0.998)).rgb +
        texture2D(uSceneTex, clamp(vSceneUv - inner2, 0.002, 0.998)).rgb;
    vec3 outerSum =
        texture2D(uSceneTex, clamp(vUv1P, 0.002, 0.998)).rgb +
        texture2D(uSceneTex, clamp(vUv1M, 0.002, 0.998)).rgb +
        texture2D(uSceneTex, clamp(vUv2P, 0.002, 0.998)).rgb +
        texture2D(uSceneTex, clamp(vUv2M, 0.002, 0.998)).rgb;
#else
    vec3 centerG = texture2D(uSceneTex, vSceneUv).rgb;
    vec3 innerSum =
        texture2D(uSceneTex, vSceneUv + inner1).rgb +
        texture2D(uSceneTex, vSceneUv - inner1).rgb +
        texture2D(uSceneTex, vSceneUv + inner2).rgb +
        texture2D(uSceneTex, vSceneUv - inner2).rgb;
    vec3 outerSum =
        texture2D(uSceneTex, vUv1P).rgb +
        texture2D(uSceneTex, vUv1M).rgb +
        texture2D(uSceneTex, vUv2P).rgb +
        texture2D(uSceneTex, vUv2M).rgb;
#endif
    return centerG * 0.20 + innerSum * 0.12 + outerSum * 0.08;
}

vec3 sampleBorderBlur(vec2 uvG, vec2 chromaDelta, vec2 blurUv, float hasChroma) {
    vec3 centerG = texture2D(uSceneTex, uvG).rgb;
    vec2 offset1 = blurUv * vec2(0.86, 0.34);
    vec2 offset2 = blurUv * vec2(-0.34, 0.86);
    vec2 inner1 = (offset1 + offset2) * 0.36;
    vec2 inner2 = (offset1 - offset2) * 0.36;
    vec3 innerSum =
        texture2D(uSceneTex, clamp(uvG + inner1, 0.002, 0.998)).rgb +
        texture2D(uSceneTex, clamp(uvG - inner1, 0.002, 0.998)).rgb +
        texture2D(uSceneTex, clamp(uvG + inner2, 0.002, 0.998)).rgb +
        texture2D(uSceneTex, clamp(uvG - inner2, 0.002, 0.998)).rgb;
    vec3 outerSum =
        texture2D(uSceneTex, clamp(uvG + offset1, 0.002, 0.998)).rgb +
        texture2D(uSceneTex, clamp(uvG - offset1, 0.002, 0.998)).rgb +
        texture2D(uSceneTex, clamp(uvG + offset2, 0.002, 0.998)).rgb +
        texture2D(uSceneTex, clamp(uvG - offset2, 0.002, 0.998)).rgb;
#ifdef LG_SAMPLE_CHROMA
    if (hasChroma < 0.5) return centerG * 0.20 + innerSum * 0.12 + outerSum * 0.08;
    vec2 uvR = clamp(uvG - chromaDelta * 1.15, 0.002, 0.998);
    vec2 uvB = clamp(uvG + chromaDelta * 1.15, 0.002, 0.998);
    float rCore = texture2D(uSceneTex, uvR).r * 0.24 +
        (texture2D(uSceneTex, clamp(uvG + inner1 - chromaDelta, 0.002, 0.998)).r +
         texture2D(uSceneTex, clamp(uvG - inner1 - chromaDelta, 0.002, 0.998)).r) * 0.22;
    float bCore = texture2D(uSceneTex, uvB).b * 0.24 +
        (texture2D(uSceneTex, clamp(uvG + inner2 + chromaDelta, 0.002, 0.998)).b +
         texture2D(uSceneTex, clamp(uvG - inner2 + chromaDelta, 0.002, 0.998)).b) * 0.22;
    return vec3(
        rCore + outerSum.r * 0.08,
        centerG.g * 0.20 + innerSum.g * 0.12 + outerSum.g * 0.08,
        bCore + outerSum.b * 0.08
    );
#else
    return centerG * 0.20 + innerSum * 0.12 + outerSum * 0.08;
#endif
}
#endif
#ifdef LG_SAMPLE_CLEAR
vec3 sampleBorderClear(vec2 uvG, vec2 chromaDelta, float hasChroma) {
    vec3 centerG = texture2D(uSceneTex, uvG).rgb;
#ifdef LG_SAMPLE_CHROMA
    if (hasChroma < 0.5) return centerG;
    return vec3(
        texture2D(uSceneTex, clamp(uvG - chromaDelta, 0.002, 0.998)).r,
        centerG.g,
        texture2D(uSceneTex, clamp(uvG + chromaDelta, 0.002, 0.998)).b
    );
#else
    return centerG;
#endif
}
#endif
#endif
#endif

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
    vec2 offset1 = blurUv * vec2(0.86, 0.34);
    vec2 offset2 = blurUv * vec2(-0.34, 0.86);
    vec2 inner1 = (offset1 + offset2) * 0.36;
    vec2 inner2 = (offset1 - offset2) * 0.36;
    vec3 innerSum =
        texture2D(uSceneTex, clamp(uvG + inner1, 0.002, 0.998)).rgb +
        texture2D(uSceneTex, clamp(uvG - inner1, 0.002, 0.998)).rgb +
        texture2D(uSceneTex, clamp(uvG + inner2, 0.002, 0.998)).rgb +
        texture2D(uSceneTex, clamp(uvG - inner2, 0.002, 0.998)).rgb;
    vec3 outerSum =
        texture2D(uSceneTex, clamp(uvG + offset1, 0.002, 0.998)).rgb +
        texture2D(uSceneTex, clamp(uvG - offset1, 0.002, 0.998)).rgb +
        texture2D(uSceneTex, clamp(uvG + offset2, 0.002, 0.998)).rgb +
        texture2D(uSceneTex, clamp(uvG - offset2, 0.002, 0.998)).rgb;
    if (hasChroma < 0.5) {
        return centerG * 0.20 + innerSum * 0.12 + outerSum * 0.08;
    }
    vec2 uvR = clamp(uvG - chromaDelta * 1.15, 0.002, 0.998);
    vec2 uvB = clamp(uvG + chromaDelta * 1.15, 0.002, 0.998);
    float rCore = texture2D(uSceneTex, uvR).r * 0.24 +
        (texture2D(uSceneTex, clamp(uvG + inner1 - chromaDelta, 0.002, 0.998)).r +
         texture2D(uSceneTex, clamp(uvG - inner1 - chromaDelta, 0.002, 0.998)).r) * 0.22;
    float bCore = texture2D(uSceneTex, uvB).b * 0.24 +
        (texture2D(uSceneTex, clamp(uvG + inner2 + chromaDelta, 0.002, 0.998)).b +
         texture2D(uSceneTex, clamp(uvG - inner2 + chromaDelta, 0.002, 0.998)).b) * 0.22;
    return vec3(
        rCore + outerSum.r * 0.08,
        centerG.g * 0.20 + innerSum.g * 0.12 + outerSum.g * 0.08,
        bCore + outerSum.b * 0.08
    );
}

vec3 compositeInteriorScene(vec3 sceneColor, float ambientSheen) {
    float luma = dot(sceneColor, vec3(0.299, 0.587, 0.114));
    vec3 vibrantScene = clamp(mix(vec3(luma), sceneColor, 2.80) * 1.05, 0.0, 1.0);
    vec3 tintedScene = mix(vibrantScene, uTint.rgb, clamp(uTint.a, 0.0, 0.85));
    float ambientSheenScale = mix(0.35, 1.0, smoothstep(0.08, 0.45, luma));
    float effectiveHighlight = compressHighlight((ambientSheen * ambientSheenScale) * uHighlight.x);
    return clamp(mix(tintedScene, vec3(1.0), effectiveHighlight * 0.44), 0.0, 1.0);
}

void main() {
#if defined(LG_SPECIALIZED) && !defined(LG_NO_INTERIOR_FASTPATH)
    vec2 halfExtents = uSize * 0.5;
    vec2 pt = (vUv - 0.5) * uSize;
    float radius = clamp(uGeom.z, 0.0, min(halfExtents.x, halfExtents.y));
    vec2 q = abs(pt) - halfExtents + vec2(radius);
    vec2 qPlus = max(q, 0.0);
    float outLen = length(qPlus);
    float sd = outLen + min(max(q.x, q.y), 0.0) - radius;
    float aa = 0.707107 / uDpr;
    if (sd > aa) {
#ifdef LG_TRANSFER_BUILD
        transferGeometry = vec4(0.0);
        transferLighting = vec4(0.0);
#else
        gl_FragColor = vec4(0.0);
#endif
        return;
    }
    if (sd <= -uInteriorMargin) {
#ifdef LG_TRANSFER_BUILD
        transferGeometry = vec4(0.0, 0.0, 0.0, 1.0);
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
        vec3 sceneColor = sampleInteriorBlur();
#else
        vec2 sceneUv = vec2(
            uSceneRect.x + vUv.x * uSceneRect.z,
            1.0 - (uSceneRect.y + (1.0 - vUv.y) * uSceneRect.w)
        );
#ifdef LG_SAMPLE_CLAMP
        vec3 sceneColor = texture2D(uSceneTex, clamp(sceneUv, 0.002, 0.998)).rgb;
#else
        vec3 sceneColor = texture2D(uSceneTex, sceneUv).rgb;
#endif
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
    float chromaFactor = geometry.z;
    float baseRimTerms = lighting.x;
    float ambientSheen = lighting.y;
    float additiveGlow = lighting.z;
    float outerStroke = lighting.w;
    if (dot(uLightTilt, uLightTilt) > 1e-6) {
        float dispLen = length(displacement);
        if (dispLen > 1e-4) {
            vec2 normXy = -displacement / dispLen;
            vec3 approxDome = vec3(normXy * 0.68, 0.733212);
            vec3 dynHalf = normalize(HALF_PRIMARY + vec3(uLightTilt * 0.46, 0.0));
            float staticNdh = clamp(dot(approxDome, HALF_PRIMARY), 0.0, 1.0);
            float dynamicNdh = clamp(dot(approxDome, dynHalf), 0.0, 1.0);
            float specularDelta = (pow(dynamicNdh, 5.0) - pow(staticNdh, 5.0)) * clamp(length(uLightTilt), 0.0, 1.0);
            float bezelBlend = smoothstep(0.0, 0.25, dispLen);
            baseRimTerms = max(0.0, baseRimTerms + specularDelta * bezelBlend * 0.28);
            additiveGlow = max(0.0, additiveGlow + max(0.0, specularDelta) * bezelBlend * 0.04);
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
    float outLen = length(qPlus);
    float selfSd = outLen + min(max(q.x, q.y), 0.0) - radius;
    vec2 quadrantSign = sign(pt);
    vec2 edgeNormal = quadrantSign * (outLen > 1e-8 ? qPlus / outLen : step(q.yx, q.xy));
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
            float peerOutLen = length(peerQPlus);
            float peerSd = peerOutLen + min(max(peerQ.x, peerQ.y), 0.0) - peerProps.x;
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
            vec2 peerSign = sign(peerPt);
            vec2 peerNormal = peerSign * (peerOutLen > 1e-8 ? peerQPlus / peerOutLen : step(peerQ.yx, peerQ.xy));
            float gapDiff = abs(selfSd - peerSd);
            float sumGap = max(0.0, selfSd) + max(0.0, peerSd);
            float pairProximity = exp(-sumGap * 0.065) * exp(-gapDiff * 0.055);
            proximityFactor = max(proximityFactor, pairProximity);
            vec2 merged = sminPoly(sd, peerSd, peerProps.y);
            float hBlend = 4.0 * merged.y * (1.0 - merged.y);
            saddleBlend = max(saddleBlend, hBlend * pairProximity);
            sd = merged.x;
            vec2 rawMixedNormal = mix(peerNormal, edgeNormal, merged.y);
            float mixedNormLen = length(rawMixedNormal);
            bridgeNormFactor = min(bridgeNormFactor, mix(1.0, smoothstep(0.0, 0.35, mixedNormLen), hBlend));
            edgeNormal = mixedNormLen > 1e-4 ? rawMixedNormal / mixedNormLen : vec2(0.0, sign(pt.y + 1e-4));
            float fringeEnv = exp(-gapDiff * 0.11) * smoothstep(-44.0, 8.0, selfSd) * smoothstep(-44.0, 8.0, peerSd);
            float standing = 0.5 + 0.5 * cos(gapDiff * 0.62 - peerProps.z);
            interferenceWave += standing * fringeEnv;
            interferenceMask = max(interferenceMask, fringeEnv);
            interferencePhase += gapDiff * 0.42 - peerProps.z;
        }
    }

    float aa = 0.707107 / uDpr;
    if (sd > aa) {
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
        float ambientSheen = evalAmbientSheen(vUv);
        if (uHasSceneTex > 0.5) {
            vec3 sceneColor;
            if (uHighlight.w <= 0.00001) {
                vec2 sceneUv = vec2(
                    uSceneRect.x + vUv.x * uSceneRect.z,
                    1.0 - (uSceneRect.y + (1.0 - vUv.y) * uSceneRect.w)
                );
                sceneColor = texture2D(uSceneTex, clamp(sceneUv, 0.002, 0.998)).rgb;
            } else if (uDirectBlurClamp < 0.5) {
                vec2 offset1 = vUv1P - vSceneUv;
                vec2 offset2 = vUv2P - vSceneUv;
                vec2 inner1 = (offset1 + offset2) * 0.36;
                vec2 inner2 = (offset1 - offset2) * 0.36;
                vec3 innerSum =
                    texture2D(uSceneTex, vSceneUv + inner1).rgb +
                    texture2D(uSceneTex, vSceneUv - inner1).rgb +
                    texture2D(uSceneTex, vSceneUv + inner2).rgb +
                    texture2D(uSceneTex, vSceneUv - inner2).rgb;
                vec3 outerSum =
                    texture2D(uSceneTex, vUv1P).rgb +
                    texture2D(uSceneTex, vUv1M).rgb +
                    texture2D(uSceneTex, vUv2P).rgb +
                    texture2D(uSceneTex, vUv2M).rgb;
                sceneColor = texture2D(uSceneTex, vSceneUv).rgb * 0.20 + innerSum * 0.12 + outerSum * 0.08;
            } else {
                vec2 offset1 = vUv1P - vSceneUv;
                vec2 offset2 = vUv2P - vSceneUv;
                vec2 inner1 = (offset1 + offset2) * 0.36;
                vec2 inner2 = (offset1 - offset2) * 0.36;
                vec3 innerSum =
                    texture2D(uSceneTex, clamp(vSceneUv + inner1, 0.002, 0.998)).rgb +
                    texture2D(uSceneTex, clamp(vSceneUv - inner1, 0.002, 0.998)).rgb +
                    texture2D(uSceneTex, clamp(vSceneUv + inner2, 0.002, 0.998)).rgb +
                    texture2D(uSceneTex, clamp(vSceneUv - inner2, 0.002, 0.998)).rgb;
                vec3 outerSum =
                    texture2D(uSceneTex, clamp(vUv1P, 0.002, 0.998)).rgb +
                    texture2D(uSceneTex, clamp(vUv1M, 0.002, 0.998)).rgb +
                    texture2D(uSceneTex, clamp(vUv2P, 0.002, 0.998)).rgb +
                    texture2D(uSceneTex, clamp(vUv2M, 0.002, 0.998)).rgb;
                sceneColor =
                    texture2D(uSceneTex, clamp(vSceneUv, 0.002, 0.998)).rgb * 0.20 +
                    innerSum * 0.12 +
                    outerSum * 0.08;
            }
            gl_FragColor = vec4(compositeInteriorScene(sceneColor, ambientSheen), 1.0);
            return;
        }
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
    vec2 edgeNormal = quadrantSign * (outLen > 1e-8 ? qPlus / outLen : step(q.yx, q.xy));
#endif
    float edgeAA = 1.0;
    if (sd > -aa) {
        vec2 pixelNormal = abs(edgeNormal);
        float majorAxis = max(pixelNormal.x, pixelNormal.y);
        float minorAxis = min(pixelNormal.x, pixelNormal.y);
        float pixelDistance = -sd * uDpr;
        float support = (majorAxis + minorAxis) * 0.5;
        float tail = max(support - abs(pixelDistance), 0.0);
        float coverage = abs(pixelDistance) <= (majorAxis - minorAxis) * 0.5
            ? 0.5 - abs(pixelDistance) / max(majorAxis, 1e-6)
            : tail * tail / max(2.0 * majorAxis * minorAxis, 1e-6);
        edgeAA = pixelDistance >= 0.0 ? 1.0 - coverage : coverage;
    }
    float depthInBezel = clamp(-sd / bezel, 0.0, 1.0);
    float inBezelMask = 1.0 - smoothstep(0.90, 1.0, depthInBezel);

    float refractedTilt = 0.0;
    float meniscusTilt = 0.0;
    vec3 domeNormal = vec3(0.0, 0.0, 1.0);
    float fresnel = 0.04;
    float specBroad1 = 0.455380908;
    float specSharp1 = 0.071558949;
    float specCorner2 = 0.076237859;
    if (depthInBezel < 1.0) {
        float interiorShift = bezel * (0.08 + 0.38 * depthInBezel * depthInBezel);
        vec2 bezelVec = max(q + interiorShift, 1e-4);
        vec2 rawBezelNormal = quadrantSign * (bezelVec * inversesqrt(dot(bezelVec, bezelVec)));
        vec2 bezelNormal = uPeerCount > 0.5
            ? normalize(mix(rawBezelNormal, edgeNormal, clamp(proximityFactor * 2.2 + saddleBlend, 0.0, 1.0)))
            : rawBezelNormal;
        vec4 optical = texture2D(uOpticalLut, vec2(depthInBezel * uLutScale.x + uLutScale.y, 0.5));
        float xyMag = dot(optical.rg, vec2(65280.0, 255.0)) / 65535.0;
        refractedTilt = dot(optical.ba, vec2(65280.0, 255.0)) / 65535.0;
        float tiltDenom = 1.0 + depthInBezel * (0.725 + 0.21 * depthInBezel);
        meniscusTilt = inBezelMask / (tiltDenom * tiltDenom);
        domeNormal = vec3(bezelNormal * xyMag, sqrt(max(0.0, 1.0 - xyMag * xyMag)));
        float fresnelBase = 1.0 - domeNormal.z;
        float fresnelSq = fresnelBase * fresnelBase;
        fresnel += 0.96 * fresnelSq * fresnelSq;
        float hasLightTilt = step(1e-6, dot(uLightTilt, uLightTilt));
        vec3 primaryHalf = hasLightTilt > 0.5 ? normalize(HALF_PRIMARY + vec3(uLightTilt * 0.46, 0.0)) : HALF_PRIMARY;
        vec3 secondaryHalf = hasLightTilt > 0.5 ? normalize(HALF_SECONDARY - vec3(uLightTilt * 0.28, 0.0)) : HALF_SECONDARY;
        float ndoth1 = clamp(dot(domeNormal, primaryHalf), 0.0, 1.0);
        float ndoth1Sq = ndoth1 * ndoth1;
        float ndoth1Quad = ndoth1Sq * ndoth1Sq;
        specBroad1 = ndoth1Quad * ndoth1;
        specSharp1 = (ndoth1Quad * ndoth1Quad) / (12.0 - 11.0 * ndoth1Sq);
        float ndoth2 = clamp(dot(domeNormal, secondaryHalf), 0.0, 1.0);
        float ndoth2Sq = ndoth2 * ndoth2;
        float ndoth2Quad = ndoth2Sq * ndoth2Sq;
        specCorner2 = (ndoth2Quad * ndoth2Quad) / (10.0 - 9.0 * ndoth2Sq);
    }

    float nxSq = edgeNormal.x * edgeNormal.x;
    float nySq = edgeNormal.y * edgeNormal.y;
    float cornerArc = 4.0 * nxSq * nySq;
    float rimY = clamp(abs(edgeNormal.y), 0.0, 1.0);
    float rimSmooth = smoothstep(0.76, 0.995, rimY);
    float topRimWeight = rimSmooth * rimSmooth;
    float cornerRimWeight = cornerArc * cornerArc * 0.42;
    float dualRimWeight = 0.04 + 0.96 * (1.0 - (1.0 - topRimWeight) * (1.0 - cornerRimWeight));

    float insideEdgeMask = smoothstep(aa * 0.65, -aa * 1.15, sd);
    float dprScale = max(1.0, uDpr * 0.75);
    float rimInset = 0.54 / dprScale;
    float hairlineDist = abs(sd + rimInset);
    float hairlineDistSq = hairlineDist * hairlineDist;
    float hairlineInv = 1.0 / (1.0 + hairlineDistSq * (4.6 * dprScale * dprScale));
    float hairline = hairlineInv * hairlineInv * insideEdgeMask;

    float innerDepth = max(0.0, -sd);
    float glowDenom = 1.0 + innerDepth * (0.95 + 0.28 * innerDepth);
    float rimGlow = (insideEdgeMask * dualRimWeight) / (glowDenom * glowDenom);

    float cornerGlint = (specSharp1 * 0.08 + specCorner2 * 0.05) * inBezelMask * (0.18 + 0.82 * dualRimWeight);
    float innerBezelSheen = fresnel * (0.028 * inBezelMask) * dualRimWeight;

    float baseRimTerms =
        hairline * dualRimWeight * 0.36 +
        rimGlow * 0.024 +
        cornerGlint +
        hairline * 0.045 * specSharp1 +
        innerBezelSheen +
        specBroad1 * 0.012 * inBezelMask;
    vec2 displacement = -domeNormal.xy * (bezel * refractedTilt * (1.35 + 0.14 * cornerArc));
    displacement *= (0.25 + 0.75 * bridgeNormFactor) * mix(1.0, 0.35, saddleBlend);
    displacement *= 1.0 + 0.10 * interferenceMask * (interferenceWave - 0.5);
    float chromaFactor = smoothstep(0.10, 0.88, meniscusTilt) * inBezelMask;
    float ambientSheen = evalAmbientSheen(vUv);
    float additiveGlow = rimGlow * 0.006 + cornerGlint * 0.018;
    float nonHighlightMask = clamp(1.0 - dualRimWeight * 0.90 - cornerGlint * 1.40, 0.0, 1.0);
    nonHighlightMask *= 1.0 - smoothstep(0.04, 0.35, proximityFactor + saddleBlend * 0.6);
    float darkRimInset = 0.36 / dprScale;
    float darkRimDist = abs(sd + darkRimInset);
    float darkRimInv = 1.0 / (1.0 + darkRimDist * darkRimDist * (16.0 * dprScale * dprScale));
    float outerStroke = darkRimInv * darkRimInv * insideEdgeMask * nonHighlightMask * (1.0 - saddleBlend);
    vec3 interferenceTint = uPeerCount > 0.5
        ? (0.5 + 0.5 * cos(vec3(0.0, 2.094, 4.188) + interferencePhase)) * (interferenceMask * interferenceWave * 0.09)
        : vec3(0.0);
#endif

#ifdef LG_TRANSFER_BUILD
    transferGeometry = vec4(displacement, chromaFactor, edgeAA);
    transferLighting = vec4(baseRimTerms, ambientSheen, additiveGlow, outerStroke);
#else
#ifdef LG_SPECIALIZED
#ifdef LG_SAMPLE_NO_SCENE
    float highlight = compressHighlight((baseRimTerms + ambientSheen) * uHighlight.x);
    float fallbackAlpha = clamp(max(uTint.a, highlight * 0.78), 0.0, 0.92) * edgeAA;
    vec3 fallbackBase = mix(uTint.rgb, vec3(0.015, 0.02, 0.03), outerStroke * 0.28);
    vec3 fallbackColor = clamp(mix(fallbackBase, vec3(1.0), highlight) + vec3(1.0) * additiveGlow * uHighlight.x + interferenceTint, 0.0, 1.0);
    gl_FragColor = vec4(fallbackColor * fallbackAlpha, fallbackAlpha);
    return;
#else
    vec2 uvPerCssPx = vec2(
        uSceneRect.z / max(1.0, uSize.x),
        uSceneRect.w / max(1.0, uSize.y)
    );
    vec2 sceneUv = vec2(
        uSceneRect.x + vUv.x * uSceneRect.z,
        1.0 - (uSceneRect.y + (1.0 - vUv.y) * uSceneRect.w)
    );
    float thicknessBoost = clamp(0.95 + uOptical.y * 0.015625, 1.0, 2.25);
    vec2 dispUv = displacement * (uOptical.z * thicknessBoost) * uvPerCssPx;
    vec2 uvG = clamp(sceneUv + dispUv, 0.002, 0.998);
    float chromaSpread = uHighlight.y * chromaFactor;
    float hasChroma = step(1e-4, chromaSpread);
#ifdef LG_SAMPLE_BLUR
    vec2 blurUv = uvPerCssPx * uHighlight.w;
    vec3 sceneColor = sampleBorderBlur(uvG, dispUv * chromaSpread, blurUv, hasChroma);
#else
    vec3 sceneColor = sampleBorderClear(uvG, dispUv * chromaSpread, hasChroma);
#endif
    float luma = dot(sceneColor, vec3(0.299, 0.587, 0.114));
    vec3 vibrantScene = clamp(mix(vec3(luma), sceneColor, 2.80) * 1.05, 0.0, 1.0);
    vec3 tintedScene = mix(vibrantScene, uTint.rgb, clamp(uTint.a, 0.0, 0.85));
    vec3 framedScene = mix(tintedScene, vec3(0.015, 0.02, 0.03), outerStroke * mix(0.24, 0.36, smoothstep(0.14, 0.65, luma)));
    float ambientSheenScale = mix(0.35, 1.0, smoothstep(0.08, 0.45, luma));
    float effectiveHighlight = compressHighlight((baseRimTerms + ambientSheen * ambientSheenScale) * uHighlight.x);
    vec3 litColor = mix(framedScene, vec3(1.0), effectiveHighlight * 0.44);
    vec3 finalColor = clamp(litColor + vec3(1.0) * additiveGlow * uHighlight.x + interferenceTint, 0.0, 1.0);
    gl_FragColor = vec4(finalColor * edgeAA, edgeAA);
    return;
#endif
#else
    float highlight = compressHighlight((baseRimTerms + ambientSheen) * uHighlight.x);

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
        vec2 dispUv = displacement * (uOptical.z * thicknessBoost) * uvPerCssPx;
        vec2 blurUv = uvPerCssPx * uHighlight.w;
        vec2 uvG = clamp(sceneUv + dispUv, 0.002, 0.998);

        float chromaSpread = uHighlight.y * chromaFactor;
        float hasChroma = step(1e-4, chromaSpread);
        vec3 sceneColor = sampleChromaticFrostedScene(uvG, dispUv * chromaSpread, blurUv, hasChroma);

        float luma = dot(sceneColor, vec3(0.299, 0.587, 0.114));
        vec3 vibrantScene = clamp(mix(vec3(luma), sceneColor, 2.80) * 1.05, 0.0, 1.0);
        vec3 tintedScene = mix(vibrantScene, baseGlass, clamp(uTint.a, 0.0, 0.85));
        vec3 framedScene = mix(tintedScene, vec3(0.015, 0.02, 0.03), outerStroke * mix(0.24, 0.36, smoothstep(0.14, 0.65, luma)));
        float ambientSheenScale = mix(0.35, 1.0, smoothstep(0.08, 0.45, luma));
        float effectiveHighlight = compressHighlight((baseRimTerms + ambientSheen * ambientSheenScale) * uHighlight.x);
        vec3 litColor = mix(framedScene, vec3(1.0), effectiveHighlight * 0.44);
        vec3 finalColor = clamp(litColor + vec3(1.0) * additiveGlow * uHighlight.x + interferenceTint, 0.0, 1.0);
        gl_FragColor = vec4(finalColor * edgeAA, edgeAA);
        return;
    }

    float fallbackAlpha = clamp(max(uTint.a, highlight * 0.78), 0.0, 0.92) * edgeAA;
    vec3 fallbackBase = mix(baseGlass, vec3(0.015, 0.02, 0.03), outerStroke * 0.28);
    vec3 fallbackColor = clamp(mix(fallbackBase, vec3(1.0), highlight) + vec3(1.0) * additiveGlow * uHighlight.x + interferenceTint, 0.0, 1.0);
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
void main() {
    vec3 sum = texture2D(uSourceTex, clamp(vUv, 0.002, 0.998)).rgb * 0.20;
    sum += texture2D(uSourceTex, clamp(vUv + vec2(-uHalfPixel.x, -uHalfPixel.y), 0.002, 0.998)).rgb * 0.20;
    sum += texture2D(uSourceTex, clamp(vUv + vec2(uHalfPixel.x, -uHalfPixel.y), 0.002, 0.998)).rgb * 0.20;
    sum += texture2D(uSourceTex, clamp(vUv + vec2(-uHalfPixel.x, uHalfPixel.y), 0.002, 0.998)).rgb * 0.20;
    sum += texture2D(uSourceTex, clamp(vUv + vec2(uHalfPixel.x, uHalfPixel.y), 0.002, 0.998)).rgb * 0.20;
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
    const rgbMatch = trimmed.match(/rgba?\(\s*([\d.]+%?)[,\s]+([\d.]+%?)[,\s]+([\d.]+%?)/i);
    if (rgbMatch) {
        const parseChannel = (channelStr: string) =>
            channelStr.endsWith("%")
                ? Math.min(1, Math.max(0, parseFloat(channelStr) / 100))
                : Math.min(1, Math.max(0, parseFloat(channelStr) / 255));
        return [
            parseChannel(rgbMatch[1]!),
            parseChannel(rgbMatch[2]!),
            parseChannel(rgbMatch[3]!),
        ];
    }
    return [1, 1, 1];
}

const ROUNDED_MIN_WEBGL_PIXEL_RATIO = 2;
const ROUNDED_MAX_WEBGL_PIXEL_RATIO = 3;
const EXPLICIT_MAX_WEBGL_PIXEL_RATIO = 4;
const UNROUNDED_WEBGL_PIXEL_RATIO = 0.375;
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
    private readonly opticalTexture: WebGLTexture;
    private readonly opticalLutSize: number;
    private opticalSurface: GlassSurface | null = null;
    private opticalIor = -1;
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
    private readonly uInteriorMarginLoc: WebGLUniformLocation | null;
    private readonly uBlurOffset1Loc: WebGLUniformLocation | null;
    private readonly uBlurOffset2Loc: WebGLUniformLocation | null;
    private readonly uDirectBlurClampLoc: WebGLUniformLocation | null;
    private readonly uLightTiltLoc: WebGLUniformLocation | null;
    private readonly uCoalesceBleedLoc: WebGLUniformLocation | null;
    private readonly uPeerCountLoc: WebGLUniformLocation | null;
    private readonly uPeerBoundsLoc: WebGLUniformLocation | null;
    private readonly uPeerPropsLoc: WebGLUniformLocation | null;
    private sceneTexture: WebGLTexture | null = null;
    private boundSceneTexture: WebGLTexture | null = null;
    private hasSceneTextureData = false;
    private sceneCanvasWidth = 0;
    private sceneCanvasHeight = 0;
    private blurDownsampleProgram: WebGLProgram | null = null;
    private blurDownsampleHalfPixelLoc: WebGLUniformLocation | null = null;
    private blurHalfDownFbo: WebGLFramebuffer | null = null;
    private blurHalfDownTexture: WebGLTexture | null = null;
    private blurHalfFbo: WebGLFramebuffer | null = null;
    private blurHalfTexture: WebGLTexture | null = null;
    private blurHalfWidth = 0;
    private blurHalfHeight = 0;
    private cachedKawaseBlurValue = -1;
    private sceneBlurDirty = false;
    private blurDownsampleFailed = false;
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
    private lastInteriorMargin = -1;
    private lastBlurOffset1X = Number.NaN;
    private lastBlurOffset1Y = Number.NaN;
    private lastBlurOffset2X = Number.NaN;
    private lastBlurOffset2Y = Number.NaN;
    private lastDirectBlurClamp = -1;
    private lastLightTiltHorizontal = Number.NaN;
    private lastLightTiltVertical = Number.NaN;
    private lastBleedPx = -1;
    private lastPeerCount = -1;
    private readonly peerBoundsBuffer = new Float32Array(16);
    private readonly peerPropsBuffer = new Float32Array(16);
    private disposed = false;
    private transferCache: OpticalTransferCache | null = null;
    private transferCacheChecked = false;
    private stableGeometryFrames = 0;

    private constructor(
        canvas: HTMLCanvasElement,
        gl: WebGLRenderingContext,
        program: WebGLProgram,
        vertexBuffer: WebGLBuffer,
        opticalTexture: WebGLTexture,
    ) {
        this.canvas = canvas;
        this.gl = gl;
        this.program = program;
        this.vertexBuffer = vertexBuffer;
        const viewportDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as ArrayLike<number> | null;
        const maxTextureSize = Math.max(256, Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096);
        this.maxTextureSize = maxTextureSize;
        this.opticalLutSize = Math.min(OPTICAL_LUT_SIZE, maxTextureSize);
        this.opticalTexture = opticalTexture;
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.opticalTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.uniform1i(gl.getUniformLocation(program, "uOpticalLut"), 1);
        gl.uniform2f(gl.getUniformLocation(program, "uLutScale"),
            (this.opticalLutSize - 1) / this.opticalLutSize, 0.5 / this.opticalLutSize);
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
        this.uInteriorMarginLoc = gl.getUniformLocation(program, "uInteriorMargin");
        this.uBlurOffset1Loc = gl.getUniformLocation(program, "uBlurOffset1");
        this.uBlurOffset2Loc = gl.getUniformLocation(program, "uBlurOffset2");
        this.uDirectBlurClampLoc = gl.getUniformLocation(program, "uDirectBlurClamp");
        this.uLightTiltLoc = gl.getUniformLocation(program, "uLightTilt");
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
        if (this.uLightTiltLoc) {
            gl.uniform2f(this.uLightTiltLoc, 0, 0);
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

        return new GlassWebglRenderer(canvas, gl, program, vertexBuffer, opticalTexture);
    }

    setSceneCanvas(sourceCanvas: HTMLCanvasElement | null): void {
        if (this.disposed) return;
        const { gl } = this;
        if (typeof gl.isContextLost === "function" && gl.isContextLost()) {
            this.hasSceneTextureData = false;
            return;
        }
        if (!sourceCanvas || sourceCanvas.width <= 0 || sourceCanvas.height <= 0) {
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
        this.sceneCanvasWidth = uploadSource.width;
        this.sceneCanvasHeight = uploadSource.height;
        this.boundSceneTexture = this.sceneTexture;
        this.sceneBlurDirty = true;
        this.hasSceneTextureData = true;
    }

    private allocateHalfResTarget(
        fbo: WebGLFramebuffer,
        texture: WebGLTexture,
        width: number,
        height: number,
    ): boolean {
        const { gl } = this;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
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
        const halfWidth = Math.max(2, Math.floor(this.sceneCanvasWidth * 0.5));
        const halfHeight = Math.max(2, Math.floor(this.sceneCanvasHeight * 0.5));

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
                  )
                : false;
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            if (!spreadReady) {
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

        if (needsDownsamplePass || needsSpreadPass) {
            gl.viewport(0, 0, halfWidth, halfHeight);
            gl.useProgram(this.blurDownsampleProgram);
            gl.activeTexture(gl.TEXTURE0);

            if (needsDownsamplePass) {
                this.sceneBlurDirty = false;
                gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurHalfDownFbo);
                gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
                if (this.blurDownsampleHalfPixelLoc) {
                    gl.uniform2f(
                        this.blurDownsampleHalfPixelLoc,
                        0.5 / this.sceneCanvasWidth,
                        0.5 / this.sceneCanvasHeight,
                    );
                }
                gl.drawArrays(gl.TRIANGLES, 0, 3);
            }

            if (needsSpreadPass) {
                this.cachedKawaseBlurValue = blurValue;
                const kawaseSpread = 1.0 + Math.max(0, blurValue - 6) * 0.35;
                gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurHalfFbo);
                gl.bindTexture(gl.TEXTURE_2D, this.blurHalfDownTexture);
                if (this.blurDownsampleHalfPixelLoc) {
                    gl.uniform2f(
                        this.blurDownsampleHalfPixelLoc,
                        kawaseSpread / halfWidth,
                        kawaseSpread / halfHeight,
                    );
                }
                gl.drawArrays(gl.TRIANGLES, 0, 3);
            }

            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, this.pixelWidth, this.pixelHeight);
            gl.bindTexture(gl.TEXTURE_2D, this.blurHalfTexture);
            this.boundSceneTexture = this.blurHalfTexture;
        }

        return this.blurHalfTexture;
    }

    render(frame: GlassFrameParams): void {
        if (this.disposed) return;
        if (typeof this.gl.isContextLost === "function" && this.gl.isContextLost()) return;
        if (frame.width < 2 || frame.height < 2) return;

        const peers = frame.coalescePeers ?? [];
        const peerCount = Math.min(4, peers.length);
        const bleedPx = peerCount > 0 ? Math.max(0, frame.bleedPx ?? 0) : 0;
        const cssCanvasWidth = frame.width + bleedPx * 2;
        const cssCanvasHeight = frame.height + bleedPx * 2;

        const desiredDpr = resolveWebglPixelRatio(frame.pixelRatio, frame.radius);
        const maxAreaScale = Math.sqrt(
            MAX_WEBGL_FRAMEBUFFER_PIXELS / Math.max(1, cssCanvasWidth * cssCanvasHeight),
        );
        const maxDimScale = Math.min(
            this.maxViewportWidth / Math.max(1, cssCanvasWidth),
            this.maxViewportHeight / Math.max(1, cssCanvasHeight),
        );
        const dpr = Math.max(0.25, Math.min(desiredDpr, maxAreaScale, maxDimScale));
        const targetWidth = Math.max(
            1,
            Math.min(this.maxViewportWidth, Math.round(cssCanvasWidth * dpr)),
        );
        const targetHeight = Math.max(
            1,
            Math.min(this.maxViewportHeight, Math.round(cssCanvasHeight * dpr)),
        );

        if (targetWidth !== this.pixelWidth || targetHeight !== this.pixelHeight) {
            this.pixelWidth = targetWidth;
            this.pixelHeight = targetHeight;
            this.canvas.width = targetWidth;
            this.canvas.height = targetHeight;
            this.gl.viewport(0, 0, targetWidth, targetHeight);
        }

        const { gl } = this;
        const geometryChanged = frame.width !== this.lastCssWidth || frame.height !== this.lastCssHeight ||
            frame.radius !== this.lastRadius || frame.bezel !== this.lastBezel || dpr !== this.lastDpr ||
            frame.surface !== this.opticalSurface || frame.ior !== this.opticalIor;
        if (geometryChanged) this.transferCache?.invalidate();
        this.stableGeometryFrames = geometryChanged ? 0 : this.stableGeometryFrames + 1;
        if (frame.surface !== this.opticalSurface || frame.ior !== this.opticalIor) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.opticalTexture);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.opticalLutSize, 1, 0,
                gl.RGBA, gl.UNSIGNED_BYTE, buildOpticalLut(frame.surface, frame.ior, this.opticalLutSize));
            this.opticalSurface = frame.surface;
            this.opticalIor = frame.ior;
        }

        const blurRadiusPx = frame.blur > 0 ? Math.min(22.0, frame.blur * 2.2) : 0;
        const chromaStrength = resolveChromaticAberration(frame.chromaticAberration);
        const useSceneFlag = this.hasSceneTextureData && Boolean(frame.sceneRect) ? 1.0 : 0.0;
        const activeSceneTex = this.prepareActiveSceneTexture(frame.blur, useSceneFlag > 0.5);
        if (useSceneFlag > 0.5 && activeSceneTex && activeSceneTex !== this.boundSceneTexture) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, activeSceneTex);
            this.boundSceneTexture = activeSceneTex;
        }
        if (this.stableGeometryFrames >= 2 && peerCount === 0 && bleedPx === 0) {
            if (!this.transferCacheChecked) {
                this.transferCacheChecked = true;
                this.transferCache = OpticalTransferCache.create(gl, VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
            }
            if (
                this.transferCache?.render(
                    frame,
                    targetWidth,
                    targetHeight,
                    dpr,
                    this.opticalTexture,
                    this.opticalLutSize,
                    useSceneFlag > 0.5,
                    blurRadiusPx,
                    chromaStrength,
                )
            ) {
                this.lastHighlight = -1;
                this.lastTintR = -1;
                this.lastIor = -1;
                this.lastHasScene = -1;
                this.lastRelX = -1;
                this.lastInteriorMargin = -1;
                this.lastDirectBlurClamp = -1;
                this.lastLightTiltHorizontal = Number.NaN;
                this.lastLightTiltVertical = Number.NaN;
                this.lastBleedPx = -1;
                this.lastPeerCount = -1;
                return;
            }
        }
        gl.useProgram(this.program);

        let surfaceId = 0;
        if (frame.surface === "convex_circle") surfaceId = 1;
        else if (frame.surface === "linear") surfaceId = 2;
        else if (frame.surface === "lip") surfaceId = 3;

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

        const interiorMargin = Math.max(Math.max(1.0, frame.bezel), 14.0, 0.707107 / dpr + 0.5);
        if (interiorMargin !== this.lastInteriorMargin) {
            this.lastInteriorMargin = interiorMargin;
            gl.uniform1f(this.uInteriorMarginLoc, interiorMargin);
        }

        if (useSceneFlag !== this.lastHasScene) {
            this.lastHasScene = useSceneFlag;
            gl.uniform1f(this.uHasSceneTexLoc, useSceneFlag);
        }
        if (useSceneFlag > 0.5 && frame.sceneRect) {
            const targetSceneTex = activeSceneTex ?? this.sceneTexture;
            if (targetSceneTex) {
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, targetSceneTex);
                this.boundSceneTexture = targetSceneTex;
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

        const lightTiltHorizontal = frame.lightTilt?.horizontal ?? 0;
        const lightTiltVertical = frame.lightTilt?.vertical ?? 0;
        if (
            this.uLightTiltLoc &&
            (lightTiltHorizontal !== this.lastLightTiltHorizontal ||
                lightTiltVertical !== this.lastLightTiltVertical)
        ) {
            this.lastLightTiltHorizontal = lightTiltHorizontal;
            this.lastLightTiltVertical = lightTiltVertical;
            gl.uniform2f(this.uLightTiltLoc, lightTiltHorizontal, lightTiltVertical);
        }

        if (this.uPeerCountLoc && (peerCount !== this.lastPeerCount || peerCount > 0)) {
            this.lastPeerCount = peerCount;
            gl.uniform1f(this.uPeerCountLoc, peerCount);
            if (peerCount > 0) {
                this.peerBoundsBuffer.fill(0);
                this.peerPropsBuffer.fill(0);
                for (let index = 0; index < peerCount; index += 1) {
                    const peer = peers[index]!;
                    const base = index * 4;
                    this.peerBoundsBuffer[base] = peer.relCenterX;
                    this.peerBoundsBuffer[base + 1] = -peer.relCenterY;
                    this.peerBoundsBuffer[base + 2] = peer.halfWidth;
                    this.peerBoundsBuffer[base + 3] = peer.halfHeight;
                    this.peerPropsBuffer[base] = peer.radius;
                    this.peerPropsBuffer[base + 1] = peer.mergeRadius;
                    this.peerPropsBuffer[base + 2] = peer.wavePhase;
                    this.peerPropsBuffer[base + 3] = peer.priorityWinsTie ? 1 : 0;
                }
                if (this.uPeerBoundsLoc && typeof gl.uniform4fv === "function") {
                    gl.uniform4fv(this.uPeerBoundsLoc, this.peerBoundsBuffer);
                }
                if (this.uPeerPropsLoc && typeof gl.uniform4fv === "function") {
                    gl.uniform4fv(this.uPeerPropsLoc, this.peerPropsBuffer);
                }
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
        if (this.blurHalfDownTexture) {
            this.gl.deleteTexture(this.blurHalfDownTexture);
            this.blurHalfDownTexture = null;
        }
        if (this.blurHalfDownFbo) {
            this.gl.deleteFramebuffer(this.blurHalfDownFbo);
            this.blurHalfDownFbo = null;
        }
        if (this.blurHalfTexture) {
            this.gl.deleteTexture(this.blurHalfTexture);
            this.blurHalfTexture = null;
        }
        if (this.blurHalfFbo) {
            this.gl.deleteFramebuffer(this.blurHalfFbo);
            this.blurHalfFbo = null;
        }
        if (this.blurDownsampleProgram) {
            this.gl.deleteProgram(this.blurDownsampleProgram);
            this.blurDownsampleProgram = null;
        }
        this.boundSceneTexture = null;
        if (this.uploadCanvas) {
            this.uploadCanvas.width = 0;
            this.uploadCanvas.height = 0;
            this.uploadCanvas = null;
        }
        this.transferCache?.dispose();
        this.transferCache = null;
        this.gl.deleteTexture(this.opticalTexture);
        this.gl.deleteBuffer(this.vertexBuffer);
        this.gl.deleteProgram(this.program);
    }
}
