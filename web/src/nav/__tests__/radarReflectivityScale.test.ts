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
    expect(classifyRadarEcho(0.8)?.severity).not.toBe("serious");
    expect(classifyRadarEcho(0.96)?.severity).toBe("serious");
  });

  it("returns null below soft threshold", () => {
    expect(classifyRadarEcho(0.38)).toBeNull();
  });

  it("maps tiers for callout copy", () => {
    expect(radarEchoTierLabel(0.5)).toBe("trace");
    expect(radarEchoTierLabel(0.88)).toBe("moderate");
    expect(radarEchoTierLabel(0.96)).toBe("heavy");
  });
});
