import { describe, expect, it } from "vitest";
import {
  mergeOpenMeteoIntoRouteForecast,
  routeForecastNeedsBackstop,
  wmoCodeToTio,
} from "../openMeteoRouteForecast";
import type { RouteForecast } from "../tomorrowIo";
import { weatherCodeLabel } from "../tomorrowIo";

function interval(over: Partial<RouteForecast["intervals"][number]>) {
  return {
    etaMinutes: 30,
    lat: 38.6,
    lng: -90.2,
    tempF: 41,
    precipIntensityMmh: 0,
    precipProbability: 0.1,
    windSpeedMph: 8,
    windGustMph: 14,
    weatherCode: 1000,
    wetRoadMm: 0,
    ...over,
  };
}

describe("wmoCodeToTio", () => {
  it("maps WMO codes into the TIO label space", () => {
    expect(weatherCodeLabel(wmoCodeToTio(0))).toBe("Clear");
    expect(weatherCodeLabel(wmoCodeToTio(63))).toBe("Rain");
    expect(weatherCodeLabel(wmoCodeToTio(75))).toBe("Heavy snow");
    expect(weatherCodeLabel(wmoCodeToTio(95))).toBe("Thunderstorm");
    expect(weatherCodeLabel(wmoCodeToTio(67))).toBe("Heavy freezing rain");
  });
});

describe("routeForecastNeedsBackstop", () => {
  it("flags empty and temp-dead forecasts, passes healthy ones", () => {
    expect(routeForecastNeedsBackstop(null)).toBe(true);
    expect(
      routeForecastNeedsBackstop({ fetchedAt: 0, intervals: [] })
    ).toBe(true);
    expect(
      routeForecastNeedsBackstop({
        fetchedAt: 0,
        intervals: [interval({ tempF: NaN }), interval({ tempF: NaN })],
      })
    ).toBe(true);
    expect(
      routeForecastNeedsBackstop({
        fetchedAt: 0,
        intervals: [interval({}), interval({ tempF: NaN }), interval({})],
      })
    ).toBe(false);
  });
});

describe("mergeOpenMeteoIntoRouteForecast", () => {
  const om: RouteForecast = {
    fetchedAt: 0,
    openMeteoIntervals: 2,
    intervals: [
      interval({ etaMinutes: 30, tempF: 44, precipProbability: 0.35, weatherCode: 4001 }),
      interval({ etaMinutes: 90, tempF: 39 }),
    ],
  };

  it("fills dead slots only — real primary values win", () => {
    const merged = mergeOpenMeteoIntoRouteForecast(
      {
        fetchedAt: 0,
        intervals: [
          interval({ tempF: 50, precipProbability: NaN }),
          interval({ etaMinutes: 92, tempF: NaN }),
        ],
      },
      om
    );
    expect(merged.intervals[0]!.tempF).toBe(50);
    expect(merged.intervals[0]!.precipProbability).toBeCloseTo(0.35);
    expect(merged.intervals[1]!.tempF).toBe(39);
    expect(merged.openMeteoIntervals).toBe(2);
  });
});
