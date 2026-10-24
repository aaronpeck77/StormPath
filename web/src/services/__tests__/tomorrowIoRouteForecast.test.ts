import { describe, expect, it } from "vitest";
import {
  pickRouteForecastFetchLocations,
  routeForecastLocationKey,
  buildTimelinesWaypointsForGeometry,
  routeForecastEtasAlignWithPlan,
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

describe("buildTimelinesWaypointsForGeometry", () => {
  const geom: [number, number][] = [
    [-88.0, 41.8],
    [-89.5, 43.0],
    [-91.5, 44.8],
  ];

  it("stamps ETA from Mapbox plan duration, not parked speed fallback", () => {
    const planMin = 390; // ~6.5 hr Eau Claire–scale
    const wps = buildTimelinesWaypointsForGeometry(geom, 0, planMin);
    expect(wps?.length).toBeGreaterThan(3);
    expect(wps![0]!.etaMinutes).toBeCloseTo(0, 5);
    expect(wps![wps!.length - 1]!.etaMinutes).toBeCloseTo(planMin, 5);
    const mid = wps![Math.floor(wps!.length / 2)]!;
    expect(mid.etaMinutes).toBeGreaterThan(planMin * 0.3);
    expect(mid.etaMinutes).toBeLessThan(planMin * 0.7);
  });

  it("rejects cached forecasts whose ETAs do not match the plan", () => {
    expect(
      routeForecastEtasAlignWithPlan(
        {
          fetchedAt: 1,
          intervals: [
            {
              etaMinutes: 0,
              lat: 41.8,
              lng: -88,
              tempF: 70,
              precipIntensityMmh: 0,
              precipProbability: 0,
              windSpeedMph: 5,
              windGustMph: 8,
              weatherCode: 1000,
              wetRoadMm: 0,
            },
            {
              etaMinutes: 620,
              lat: 44.8,
              lng: -91.5,
              tempF: 65,
              precipIntensityMmh: 0,
              precipProbability: 0,
              windSpeedMph: 5,
              windGustMph: 8,
              weatherCode: 1000,
              wetRoadMm: 0,
            },
          ],
        },
        390
      )
    ).toBe(false);
    expect(
      routeForecastEtasAlignWithPlan(
        {
          fetchedAt: 1,
          intervals: [
            {
              etaMinutes: 0,
              lat: 41.8,
              lng: -88,
              tempF: 70,
              precipIntensityMmh: 0,
              precipProbability: 0,
              windSpeedMph: 5,
              windGustMph: 8,
              weatherCode: 1000,
              wetRoadMm: 0,
            },
            {
              etaMinutes: 390,
              lat: 44.8,
              lng: -91.5,
              tempF: 65,
              precipIntensityMmh: 5,
              precipProbability: 1,
              windSpeedMph: 20,
              windGustMph: 35,
              weatherCode: 8000,
              wetRoadMm: 2,
            },
          ],
        },
        390
      )
    ).toBe(true);
  });
});
