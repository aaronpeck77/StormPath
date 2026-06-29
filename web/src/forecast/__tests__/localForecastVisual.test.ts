import { describe, expect, it } from "vitest";
import {
  feelsLikeCellColor,
  heatIndexNotable,
  heatStressLabel,
  hourComfortCallout,
  dailyPrecipLabel,
  dailyPrecipBadge,
  precipDisplayLabel,
  precipIsActive,
  precipTypeColor,
  precipTypeShortLabel,
  estimateHeatIndexF,
  resolveHourFeelsLikeF,
  uvIndexLabel,
  windChillNotable,
  windChillStressLabel,
  windGustBarHeight,
} from "../localForecastVisual";

describe("localForecastVisual", () => {
  it("colors precip by type and intensity", () => {
    expect(precipTypeColor(0, 0, 0)).toContain("148");
    expect(precipTypeColor(0, 0, 0.2)).toContain("148");
    expect(precipTypeColor(2, 2, 0.5)).toBe("#e0f2fe");
    expect(precipTypeColor(3, 0.5, 0.2)).toBe("#c084fc");
  });

  it("ignores low model noise on clear hours", () => {
    expect(precipIsActive(0.03, 0.18, 0)).toBe(false);
    expect(precipDisplayLabel(0, 0.03, 0.18)).toBeNull();
    expect(precipIsActive(0.2, 0.1, 1)).toBe(true);
  });

  it("labels daily outlook with consistent rain badges", () => {
    expect(dailyPrecipLabel({ precipChance: 0.28, precipType: 0 })).toBe("Rain · 28% chance");
    expect(dailyPrecipLabel({ precipChance: 0.28, precipType: 1 })).toBe("Rain · 28% chance");
    expect(dailyPrecipBadge({ precipChance: 0.28, precipType: 0 })?.type).toBe(1);
    expect(dailyPrecipLabel({ precipChance: 0.08, precipType: 0 })).toBeNull();
  });

  it("labels active hourly precip with percent chance", () => {
    expect(precipDisplayLabel(1, 0.2, 0.52)).toBe("Rain · 52% chance");
    expect(precipDisplayLabel(0, 0.03, 0.18)).toBeNull();
  });

  it("escalates heat stress labels", () => {
    expect(heatStressLabel(70)).toBeNull();
    expect(heatStressLabel(88)).toBe("Hot — stay hydrated");
    expect(heatStressLabel(98)).toBe("High heat index");
    expect(heatIndexNotable(84)).toBe(false);
    expect(heatIndexNotable(85)).toBe(true);
  });

  it("escalates wind chill labels", () => {
    expect(windChillNotable(50, 50, 10)).toBe(false);
    expect(windChillNotable(28, 34, 12)).toBe(true);
    expect(windChillStressLabel(28)).toBe("Wind chill — bundle up");
    expect(hourComfortCallout(28, 34, 12)).toEqual({
      kind: "cold",
      label: "Wind chill — bundle up",
    });
    expect(hourComfortCallout(90, 86, 5)).toEqual({
      kind: "heat",
      label: "Heat index 90° · Hot — stay hydrated",
    });
  });

  it("estimates heat index from humidity when feels-like is missing", () => {
    expect(estimateHeatIndexF(78, 70)).toBeNull();
    const hi = estimateHeatIndexF(88, 75);
    expect(hi).not.toBeNull();
    expect(hi!).toBeGreaterThan(88);
    expect(resolveHourFeelsLikeF({ tempF: 88, humidityPct: 75 })).toBeGreaterThan(88);
    expect(resolveHourFeelsLikeF({ tempF: 88, feelsLikeF: 96 })).toBe(96);
  });

  it("maps feels-like to warm/cool colors", () => {
    expect(feelsLikeCellColor(20)).toContain("59, 130, 246");
    expect(feelsLikeCellColor(100)).toContain("234, 88, 12");
  });

  it("scales wind gust bars", () => {
    expect(windGustBarHeight(0)).toBe("12%");
    expect(parseInt(windGustBarHeight(45), 10)).toBeGreaterThan(90);
  });

  it("labels precip and UV tiers", () => {
    expect(precipTypeShortLabel(4)).toBe("Sleet / ice");
    expect(uvIndexLabel(7)).toBe("High UV");
  });
});
