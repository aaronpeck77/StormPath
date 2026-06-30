import { describe, expect, it } from "vitest";
import {
  classifyRadarEcho,
  radarDisplayIntensity,
  radarEchoTierLabel,
} from "../radarReflectivityScale";

describe("radarReflectivityScale", () => {
  it("dampens mid-range echo vs raw peak", () => {
    expect(radarDisplayIntensity(0.72)).toBeLessThan(0.65);
    expect(radarDisplayIntensity(0.72)).toBeGreaterThan(0.45);
  });

  it("does not classify light fringe as heavy", () => {
    expect(classifyRadarEcho(0.72)?.severity).not.toBe("serious");
    expect(classifyRadarEcho(0.72)?.severity).not.toBe("avoid");
  });

  it("requires higher echo for heavy tier than before", () => {
    expect(classifyRadarEcho(0.5)?.severity).not.toBe("serious");
    expect(classifyRadarEcho(0.96)?.severity).toBe("serious");
  });

  it("returns null below soft threshold", () => {
    expect(classifyRadarEcho(0.1)).toBeNull();
  });

  it("maps tiers for callout copy", () => {
    expect(radarEchoTierLabel(0.38)).toBe("trace");
    expect(radarEchoTierLabel(0.72)).toBe("moderate");
    expect(radarEchoTierLabel(0.96)).toBe("heavy");
  });
});
