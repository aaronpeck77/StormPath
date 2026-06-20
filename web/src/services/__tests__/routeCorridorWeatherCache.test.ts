import { describe, expect, it, beforeEach } from "vitest";
import {
  corridorDirectedSig,
  corridorRouteSig,
  forecastCorridorMatchesDirection,
  readRouteForecastCache,
  writeRouteForecastCache,
} from "../routeCorridorWeatherCache";
import { safeStorage } from "../../storage/safeStorage";

function sampleForecast(
  start: [number, number],
  end: [number, number],
  tempF = 68
) {
  return {
    fetchedAt: Date.now(),
    intervals: [
      {
        etaMinutes: 0,
        lat: start[1],
        lng: start[0],
        tempF,
        precipIntensityMmh: 0,
        precipProbability: 0,
        windSpeedMph: 4,
        windGustMph: 6,
        weatherCode: 1000,
        wetRoadMm: 0,
      },
      {
        etaMinutes: 60,
        lat: end[1],
        lng: end[0],
        tempF: tempF - 4,
        precipIntensityMmh: 0,
        precipProbability: 0.2,
        windSpeedMph: 6,
        windGustMph: 9,
        weatherCode: 1100,
        wetRoadMm: 0,
      },
    ],
  };
}

describe("routeCorridorWeatherCache", () => {
  beforeEach(() => {
    safeStorage.remove("stormpath-route-corridor-forecast-v1");
  });

  it("round-trips forecast by exact route signature", () => {
    const geom: [number, number][] = [
      [-75.1, 40.1],
      [-75.2, 40.2],
      [-75.5, 40.5],
    ];
    const sig = corridorRouteSig(geom);
    const forecast = sampleForecast(geom[0]!, geom[geom.length - 1]!, 72);
    writeRouteForecastCache(sig, forecast, geom);
    expect(readRouteForecastCache(sig, geom)).toEqual(forecast);
  });

  it("falls back to same direction when vertex count changes", () => {
    const a: [number, number][] = [
      [-75.1, 40.1],
      [-75.5, 40.5],
    ];
    const b: [number, number][] = [
      [-75.1, 40.1],
      [-75.3, 40.3],
      [-75.5, 40.5],
    ];
    const sigA = corridorRouteSig(a);
    const sigB = corridorRouteSig(b);
    expect(corridorDirectedSig(a)).toBe(corridorDirectedSig(b));
    writeRouteForecastCache(sigA, sampleForecast(a[0]!, a[1]!, 68), a);
    expect(readRouteForecastCache(sigB, b)?.intervals[0]?.tempF).toBe(68);
  });

  it("does not reuse cache for the opposite direction", () => {
    const forward: [number, number][] = [
      [-75.1, 40.1],
      [-75.5, 40.5],
    ];
    const reverse: [number, number][] = [
      [-75.5, 40.5],
      [-75.1, 40.1],
    ];
    writeRouteForecastCache(
      corridorRouteSig(forward),
      sampleForecast(forward[0]!, forward[1]!, 70),
      forward
    );
    expect(readRouteForecastCache(corridorRouteSig(reverse), reverse)).toBeNull();
  });

  it("rejects forecasts whose samples sit on the wrong end of the route", () => {
    const route: [number, number][] = [
      [-75.1, 40.1],
      [-75.5, 40.5],
    ];
    const reversedSamples = sampleForecast(route[1]!, route[0]!, 55);
    expect(forecastCorridorMatchesDirection(reversedSamples, route)).toBe(false);
    expect(forecastCorridorMatchesDirection(sampleForecast(route[0]!, route[1]!, 55), route)).toBe(
      true
    );
  });
});
