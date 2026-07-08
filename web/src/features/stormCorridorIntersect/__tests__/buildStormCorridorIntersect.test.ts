import { describe, expect, it } from "vitest";
import { buildStormCorridorIntersect } from "../buildStormCorridorIntersect";
import { isStormCorridorIntersectEnabled } from "../flag";
import { radarIntensityAtFraction } from "../interpolateRadar";
import type { LngLat } from "../../../nav/types";

describe("isStormCorridorIntersectEnabled", () => {
  it("is on by default in tests", () => {
    expect(isStormCorridorIntersectEnabled()).toBe(true);
  });
});

describe("radarIntensityAtFraction", () => {
  it("interpolates between samples", () => {
    const samples = [
      { t: 0, intensity: 0 },
      { t: 0.5, intensity: 1 },
      { t: 1, intensity: 0 },
    ];
    expect(radarIntensityAtFraction(samples, 0.25)).toBeCloseTo(0.5, 2);
  });
});

describe("buildStormCorridorIntersect", () => {
  const geometry: LngLat[] = [
    [-87.63, 41.88],
    [-90, 40],
    [-95, 38],
  ];

  it("finds enter/exit heavy rain along route", () => {
    const samples = [
      { t: 0.03, intensity: 0.05 },
      { t: 0.18, intensity: 0.08 },
      { t: 0.33, intensity: 0.55 },
      { t: 0.48, intensity: 0.62 },
      { t: 0.63, intensity: 0.5 },
      { t: 0.78, intensity: 0.1 },
      { t: 0.92, intensity: 0.05 },
    ];
    const result = buildStormCorridorIntersect({
      geometry,
      totalMeters: 500_000,
      userAlongMeters: 0,
      planEtaMinutes: 300,
      radarSamples: samples,
      nowMs: Date.now(),
    });
    expect(result).not.toBeNull();
    expect(result!.events.some((e) => e.kind === "enter_heavy")).toBe(true);
    expect(result!.events.some((e) => e.kind === "exit_heavy")).toBe(true);
    expect(result!.bands.some((b) => b.level === "heavy")).toBe(true);
    expect(result!.advisoryLine).toMatch(/Heavy rain|rain/i);
  });

  it("returns null when radar samples are sparse", () => {
    const result = buildStormCorridorIntersect({
      geometry,
      totalMeters: 100_000,
      userAlongMeters: 0,
      planEtaMinutes: 60,
      radarSamples: [{ t: 0, intensity: 0.1 }],
    });
    expect(result).toBeNull();
  });
});
