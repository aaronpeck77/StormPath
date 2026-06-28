import { describe, expect, it } from "vitest";
import type { RouteHourlyInterval } from "../../services/tomorrowIo";
import {
  corridorMayFreezeOnRoad,
  corridorWeatherHeadline,
  formatCorridorIntervalDetail,
  formatCorridorTempLine,
} from "../corridorIntervalDisplay";

function interval(partial: Partial<RouteHourlyInterval>): RouteHourlyInterval {
  return {
    etaMinutes: 20,
    lat: 41,
    lng: -87,
    tempF: 30,
    precipIntensityMmh: 0,
    precipProbability: 0,
    windSpeedMph: 10,
    windGustMph: 15,
    weatherCode: 1000,
    wetRoadMm: 0,
    ...partial,
  };
}

describe("corridorWeatherHeadline", () => {
  it("uses stronger copy for freezing rain", () => {
    expect(corridorWeatherHeadline(6001)).toContain("icy");
    expect(corridorWeatherHeadline(6201)).toContain("dangerous");
  });
});

describe("formatCorridorTempLine", () => {
  it("shows feels-like when meaningfully colder", () => {
    expect(formatCorridorTempLine(interval({ tempF: 28, feelsLikeF: 18 }))).toBe(
      "28°F · Feels 18°F"
    );
    expect(formatCorridorTempLine(interval({ tempF: 40, feelsLikeF: 39 }))).toBe("40°F");
  });
});

describe("corridorMayFreezeOnRoad", () => {
  it("flags wet pavement at or below freezing", () => {
    expect(corridorMayFreezeOnRoad(interval({ tempF: 31, wetRoadMm: 1.2 }))).toBe(true);
    expect(corridorMayFreezeOnRoad(interval({ tempF: 31, wetRoadMm: 0.1 }))).toBe(false);
    expect(corridorMayFreezeOnRoad(interval({ tempF: 33, wetRoadMm: 2 }))).toBe(false);
  });
});

describe("formatCorridorIntervalDetail", () => {
  it("includes refreeze note and visibility", () => {
    const detail = formatCorridorIntervalDetail(
      interval({
        tempF: 30,
        wetRoadMm: 1.5,
        visibilityM: 300,
        feelsLikeF: 22,
      })
    );
    expect(detail).toContain("may freeze");
    expect(detail).toContain("Very low visibility");
    expect(detail).toContain("Feels 22°F");
  });
});
