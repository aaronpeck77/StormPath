import { describe, expect, it } from "vitest";
import {
  classifyRadarEcho,
  radarDisplayIntensity,
  radarEchoTierLabel,
} from "../radarReflectivityScale";

describe("radarReflectivityScale", () => {
  it("dampens mid-range echo vs raw peak", () => {
    expect(radarDisplayIntensity(0.72)).toBeLessThan(0.72);
    expect(radarDisplayIntensity(0.72)).toBeGreaterThan(0.5);
  });

  it("does not classify light fringe as heavy", () => {
    expect(classifyRadarEcho(0.72)?.severity).not.toBe("serious");
    expect(classifyRadarEcho(0.72)?.severity).not.toBe("avoid");
  });

  it("requires higher echo for heavy tier than before", () => {
    // display(0.5) ≈ 0.47 — below RADAR_HEAVY_THRESHOLD(0.55), not serious
    expect(classifyRadarEcho(0.5)?.severity).not.toBe("serious");
    // display(0.96) ≈ 0.96 — above RADAR_VERY_HEAVY_THRESHOLD(0.75), serious
    expect(classifyRadarEcho(0.96)?.severity).toBe("serious");
  });

  it("returns null below soft threshold", () => {
    // display(0.1) ≈ 0.08 — below RADAR_SOFT_THRESHOLD(0.16)
    expect(classifyRadarEcho(0.1)).toBeNull();
  });

  it("maps tiers for callout copy", () => {
    // display(0.28) ≈ 0.25 → trace  (0.16–0.38)
    expect(radarEchoTierLabel(0.28)).toBe("trace");
    // display(0.65) ≈ 0.61 → moderate (0.55–0.75)
    expect(radarEchoTierLabel(0.65)).toBe("moderate");
    // display(0.96) ≈ 0.96 → heavy   (≥0.75)
    expect(radarEchoTierLabel(0.96)).toBe("heavy");
  });
});
