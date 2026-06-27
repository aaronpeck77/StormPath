import { describe, expect, it } from "vitest";
import type { RouteForecast } from "../../services/tomorrowIo";
import {
  corridorForecastHeadline,
  corridorWetHeadline,
  corridorWetIntervalLine,
} from "../corridorForecastModel";

function forecast(intervals: RouteForecast["intervals"]): RouteForecast {
  return { fetchedAt: Date.now(), intervals };
}

describe("corridorForecastHeadline", () => {
  it("does not say dry when light rain is sampled along the corridor", () => {
    const headline = corridorForecastHeadline(
      forecast([
        {
          etaMinutes: 0,
          lat: 35,
          lng: -97,
          tempF: 68,
          precipIntensityMmh: 0.08,
          precipProbability: 0.55,
          windSpeedMph: 8,
          windGustMph: 12,
          weatherCode: 4200,
          wetRoadMm: 0.2,
        },
        {
          etaMinutes: 25,
          lat: 35.2,
          lng: -97.1,
          tempF: 67,
          precipIntensityMmh: 0.12,
          precipProbability: 0.62,
          windSpeedMph: 9,
          windGustMph: 14,
          weatherCode: 4200,
          wetRoadMm: 0.4,
        },
      ])
    );
    expect(headline.toLowerCase()).not.toContain("dry");
    expect(headline.toLowerCase()).toMatch(/rain/);
  });

  it("still says dry when corridor samples are clear with no precip signal", () => {
    const headline = corridorForecastHeadline(
      forecast([
        {
          etaMinutes: 0,
          lat: 35,
          lng: -97,
          tempF: 72,
          precipIntensityMmh: 0,
          precipProbability: 0.05,
          windSpeedMph: 6,
          windGustMph: 10,
          weatherCode: 1000,
          wetRoadMm: 0,
        },
        {
          etaMinutes: 30,
          lat: 35.2,
          lng: -97.1,
          tempF: 71,
          precipIntensityMmh: 0,
          precipProbability: 0.08,
          windSpeedMph: 7,
          windGustMph: 11,
          weatherCode: 1100,
          wetRoadMm: 0,
        },
      ])
    );
    expect(headline).toBe("Dry along route");
  });

  it("surfaces wet interval detail for route info copy", () => {
    const fc = forecast([
      {
        etaMinutes: 18,
        lat: 35,
        lng: -97,
        tempF: 66,
        precipIntensityMmh: 0.15,
        precipProbability: 0.48,
        windSpeedMph: 10,
        windGustMph: 15,
        weatherCode: 4200,
        wetRoadMm: 0.5,
      },
    ]);
    expect(corridorWetHeadline(fc)).toMatch(/light rain along route/i);
    expect(corridorWetIntervalLine(fc)).toMatch(/light rain in ~18 min on route/i);
  });

  it("does not say dry when precip probability alone is elevated", () => {
    const headline = corridorForecastHeadline(
      forecast([
        {
          etaMinutes: 10,
          lat: 35,
          lng: -97,
          tempF: 70,
          precipIntensityMmh: 0,
          precipProbability: 0.38,
          windSpeedMph: 8,
          windGustMph: 12,
          weatherCode: 1001,
          wetRoadMm: 0,
        },
      ])
    );
    expect(headline.toLowerCase()).not.toContain("dry");
  });
});
