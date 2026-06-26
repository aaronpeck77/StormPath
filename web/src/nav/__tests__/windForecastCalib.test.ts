import { describe, expect, it } from "vitest";
import {
  buildRouteWindGraphPoints,
  calibratedWindGustMph,
  gustSpikeSeverity,
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
});
