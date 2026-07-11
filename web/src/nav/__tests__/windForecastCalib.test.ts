import { describe, expect, it } from "vitest";
import {
  buildRouteWindGraphPoints,
  calibratedWindGustMph,
  gustSpikeSeverity,
  routeWindGraphScaleMph,
  sustainedWindImpactSeverity,
  WIND_GUST_SPIKE_MIN_EXCESS_MPH,
  WIND_SUSTAINED_CAUTION_MPH,
  WIND_SUSTAINED_SERIOUS_MPH,
} from "../windForecastCalib";

describe("windForecastCalib", () => {
  it("returns sustained wind when gust is missing or trivial", () => {
    expect(calibratedWindGustMph(18, 0)).toBe(18);
    expect(calibratedWindGustMph(22, 24)).toBe(22);
  });

  it("caps model gust spikes above sustained wind", () => {
    expect(calibratedWindGustMph(20, 45)).toBe(35);
    expect(calibratedWindGustMph(30, 58)).toBe(45);
  });

  it("treats light prairie breeze as clear on sustained thresholds", () => {
    expect(sustainedWindImpactSeverity(12)).toBeNull();
    expect(sustainedWindImpactSeverity(18)).toBeNull();
    expect(sustainedWindImpactSeverity(24)).toBeNull();
  });

  it("warns on sustained wind only when genuinely windy to drive", () => {
    expect(sustainedWindImpactSeverity(WIND_SUSTAINED_CAUTION_MPH)).toBe("caution");
    expect(sustainedWindImpactSeverity(WIND_SUSTAINED_SERIOUS_MPH)).toBe("serious");
    expect(sustainedWindImpactSeverity(55)).toBe("avoid");
  });

  it("flags gust spikes only when well above sustained wind", () => {
    expect(gustSpikeSeverity(20, 38)).toBeNull();
    expect(gustSpikeSeverity(29, 42)).toBeNull();
    expect(gustSpikeSeverity(18, 44)).toBe("caution");
    expect(gustSpikeSeverity(28, 28 + WIND_GUST_SPIKE_MIN_EXCESS_MPH)).toBe("caution");
  });

  it("pads sparse corridor samples so the wind line can render", () => {
    const { windPoints } = buildRouteWindGraphPoints(
      [{ etaMinutes: 30, windSpeedMph: 14, windGustMph: 16 }],
      60
    );
    expect(windPoints.length).toBeGreaterThanOrEqual(2);
    expect(windPoints[0]!.t).toBe(0);
    expect(windPoints[windPoints.length - 1]!.t).toBe(1);
  });

  it("scales the wind chart to everyday breezes instead of a forced 30 mph floor", () => {
    expect(routeWindGraphScaleMph([10, 12, 14])).toBe(20);
    expect(routeWindGraphScaleMph([8, 9])).toBe(15);
    expect(routeWindGraphScaleMph([42, 48])).toBe(60);
  });

  it("builds a gust envelope alongside sustained wind for varying corridors", () => {
    const { windPoints, gustLinePoints } = buildRouteWindGraphPoints(
      [
        { etaMinutes: 0, windSpeedMph: 10, windGustMph: 14 },
        { etaMinutes: 30, windSpeedMph: 18, windGustMph: 24 },
        { etaMinutes: 60, windSpeedMph: 12, windGustMph: 16 },
      ],
      60
    );
    expect(windPoints.map((p) => p.mph)).toEqual(expect.arrayContaining([10, 18, 12]));
    expect(gustLinePoints.map((p) => p.mph)).toEqual(expect.arrayContaining([14, 24, 16]));
    const mphSpan =
      Math.max(...windPoints.map((p) => p.mph)) - Math.min(...windPoints.map((p) => p.mph));
    expect(mphSpan).toBeGreaterThanOrEqual(6);
  });
});
