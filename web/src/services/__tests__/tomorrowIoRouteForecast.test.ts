import { describe, expect, it } from "vitest";
import {
  pickRouteForecastFetchLocations,
  routeForecastLocationKey,
} from "../tomorrowIo";

describe("tomorrowIo route forecast locations", () => {
  it("dedupes identical coordinates", () => {
    const wps = [
      { lat: 40.1, lng: -75.1, etaMinutes: 0 },
      { lat: 40.1, lng: -75.1, etaMinutes: 30 },
      { lat: 40.5, lng: -75.5, etaMinutes: 60 },
    ];
    const locs = pickRouteForecastFetchLocations(wps, 6);
    expect(locs).toHaveLength(2);
  });

  it("spreads fetch points when waypoints exceed the cap", () => {
    const wps = Array.from({ length: 12 }, (_, i) => ({
      lat: 40 + i * 0.2,
      lng: -75 - i * 0.2,
      etaMinutes: i * 10,
    }));
    const locs = pickRouteForecastFetchLocations(wps, 6);
    expect(locs).toHaveLength(6);
    expect(routeForecastLocationKey(locs[0]!.lat, locs[0]!.lng)).not.toBe(
      routeForecastLocationKey(locs[5]!.lat, locs[5]!.lng)
    );
  });
});
