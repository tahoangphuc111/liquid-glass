import { afterEach, describe, expect, it } from "vitest";
import {
    applyQualityTier,
    downgradeLiquidGlass,
    isGlassDowngraded,
    qualityDowngrades,
    qualityTier,
    qualityUpgrades,
    recordJankFrame,
    resetTelemetryForTesting,
    setTierChangeCallback,
} from "../src/core/telemetry.js";

describe("Frame telemetry and quality tiers", () => {
    afterEach(() => {
        setTierChangeCallback(null);
        resetTelemetryForTesting();
    });

    it("counts upgrades and downgrades when tier changes", () => {
        const transitions: Array<[number, number]> = [];
        setTierChangeCallback((nextTier, prevTier) => {
            transitions.push([nextTier, prevTier]);
        });

        applyQualityTier(1);
        applyQualityTier(2);
        applyQualityTier(0);

        expect(qualityTier).toBe(0);
        expect(qualityDowngrades).toBe(2);
        expect(qualityUpgrades).toBe(1);
        expect(transitions).toEqual([
            [1, 0],
            [2, 1],
            [0, 2],
        ]);
    });

    it("steps down quality when 3 jank frames hit within 1000ms", () => {
        expect(qualityTier).toBe(0);

        recordJankFrame(1000);
        recordJankFrame(1200);
        expect(qualityTier).toBe(0);

        recordJankFrame(1500);
        expect(qualityTier).toBe(1);
    });

    it("locks to CSS fallback after a permanent downgrade", () => {
        expect(isGlassDowngraded).toBe(false);
        downgradeLiquidGlass();
        expect(isGlassDowngraded).toBe(true);
    });
});
