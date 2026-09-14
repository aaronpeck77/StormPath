import { describe, expect, it } from "vitest";
import { RADAR_SOFT_THRESHOLD } from "../constants";
import { outlookChartScale } from "../routeForecastTimeline";
import { radarGraphNorm } from "../../ui/RouteRadarWindStrip";

describe("outlookChartScale precip axis", () => {
  it("tightens the rain Y-axis around corridor data", () => {
    const scale = outlookChartScale([
      { fraction: 0, tempF: 70, precipPct: 8, windGustMph: null },
      { fraction: 0.5, tempF: 68, precipPct: 22, windGustMph: null },
      { fraction: 1, tempF: 66, precipPct: 12, windGustMph: null },
    ]);
    expect(scale.precipMax).toBeLessThanOrEqual(30);
    expect(scale.precipMax).toBeGreaterThanOrEqual(22);
  });
});

describe("radarGraphNorm", () => {
  it("stretches light corridor echo for Route Info strata", () => {
    const light = RADAR_SOFT_THRESHOLD * 0.6;
    expect(radarGraphNorm(light, light)).toBeGreaterThan(0.5);
    expect(radarGraphNorm(0.8, 0.8)).toBeLessThanOrEqual(1);
  });
});
