import { describe, expect, it } from "vitest";
import { weatherKitConditionToCode, WEATHERKIT_ROUTE_MAX_LOCATIONS } from "../weatherKit";
import { pickRouteForecastFetchLocations } from "../tomorrowIo";

/** WeatherKit wind fields are km/h — ~16 km/h is a light breeze (~10 mph), not 36 mph. */
function kphToMph(kph: number): number {
  return kph * 0.621371;
}

describe("weatherKitConditionToCode", () => {
  it("maps severe conditions to Tomorrow.io-style codes", () => {
    expect(weatherKitConditionToCode("Thunderstorms")).toBe(8000);
    expect(weatherKitConditionToCode("HeavyRain")).toBe(4201);
    expect(weatherKitConditionToCode("Clear")).toBe(1000);
    expect(weatherKitConditionToCode("PartlyCloudy")).toBe(1101);
  });

  it("maps winter condition codes used by WeatherKit", () => {
    expect(weatherKitConditionToCode("BlowingSnow")).toBe(5101);
    expect(weatherKitConditionToCode("WintryMix")).toBe(6001);
    expect(weatherKitConditionToCode("Hail")).toBe(8000);
    expect(weatherKitConditionToCode("FreezingDrizzle")).toBe(6000);
    expect(weatherKitConditionToCode("FreezingRain")).toBe(6001);
  });
});

describe("WeatherKit corridor sampling", () => {
  it("caps Apple corridor fetches at four points", () => {
    expect(WEATHERKIT_ROUTE_MAX_LOCATIONS).toBe(4);
    const wps = Array.from({ length: 12 }, (_, i) => ({
      lat: 40 + i * 0.2,
      lng: -75 - i * 0.2,
      etaMinutes: i * 10,
    }));
    expect(pickRouteForecastFetchLocations(wps, WEATHERKIT_ROUTE_MAX_LOCATIONS)).toHaveLength(4);
  });
});

describe("WeatherKit wind units", () => {
  it("converts km/h to mph (not m/s)", () => {
    expect(Math.round(kphToMph(16))).toBe(10);
    expect(Math.round(kphToMph(18))).toBe(11);
    expect(Math.round(kphToMph(32))).toBe(20);
  });
});
