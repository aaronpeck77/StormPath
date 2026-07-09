import { describe, expect, it } from "vitest";
import {
  RADAR_ANIMATION_FRAME_MS_MAX,
  RADAR_ANIMATION_FRAME_MS_MIN,
  RADAR_ANIMATION_LOOP_MS,
  radarAnimationCrossfadeMs,
  radarCrossfadeProgress,
} from "../mapRadarLayer";

describe("radarAnimationCrossfadeMs", () => {
  it("targets ~3.6s for a typical 12-frame pack", () => {
    const ms = radarAnimationCrossfadeMs(12);
    expect(ms).toBe(Math.round(RADAR_ANIMATION_LOOP_MS / 12));
    expect(ms * 12).toBe(RADAR_ANIMATION_LOOP_MS);
  });

  it("clamps sparse and dense packs", () => {
    expect(radarAnimationCrossfadeMs(2)).toBe(RADAR_ANIMATION_FRAME_MS_MAX);
    expect(radarAnimationCrossfadeMs(40)).toBe(RADAR_ANIMATION_FRAME_MS_MIN);
  });
});

describe("radarCrossfadeProgress", () => {
  it("eases gently at the ends", () => {
    expect(radarCrossfadeProgress(0)).toBe(0);
    expect(radarCrossfadeProgress(1)).toBe(1);
    expect(radarCrossfadeProgress(0.5)).toBeCloseTo(0.5, 5);
    /* Early progress slower than linear; late progress catches up. */
    expect(radarCrossfadeProgress(0.25)).toBeLessThan(0.25);
    expect(radarCrossfadeProgress(0.75)).toBeGreaterThan(0.75);
  });
});
