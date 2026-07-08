import { describe, expect, it } from "vitest";
import {
  buildRouteSunEvents,
  formatRouteSunEventLocation,
  routeSunEventAxisLabel,
} from "../routeSunEvents";
import { approximateUsTimeZone, formatSolarLocalTime, sunTimesAt } from "../solarDayNight";
import type { LngLat } from "../../nav/types";

function interpolateRoute(from: LngLat, to: LngLat, steps: number): LngLat[] {
  const geometry: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    geometry.push([from[0] + t * (to[0] - from[0]), from[1] + t * (to[1] - from[1])]);
  }
  return geometry;
}

describe("approximateUsTimeZone", () => {
  it("maps Illinois to Central and California to Pacific", () => {
    expect(approximateUsTimeZone(41.88, -87.63)).toBe("America/Chicago");
    expect(approximateUsTimeZone(34.05, -118.24)).toBe("America/Los_Angeles");
    expect(approximateUsTimeZone(39.74, -104.99)).toBe("America/Denver");
  });
});

describe("buildRouteSunEvents", () => {
  const chicago: LngLat = [-87.63, 41.88];
  const losAngeles: LngLat = [-118.24, 34.05];
  const ilToCa = interpolateRoute(chicago, losAngeles, 24);

  it("finds sunset and sunrise on a long westbound IL → CA drive", () => {
    const noon =
      sunTimesAt(41.88, -87.63, new Date("2026-07-07T12:00:00"))!.sunriseMs + 6 * 3_600_000;
    const events = buildRouteSunEvents({
      geometry: ilToCa,
      totalMeters: 4_000_000,
      userAlongMeters: 0,
      planEtaMinutes: 2_400,
      nowMs: noon,
    });
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.kind === "sunset")).toBe(true);
    expect(events.some((e) => e.kind === "sunrise")).toBe(true);
    for (const e of events) {
      expect(e.fraction).toBeGreaterThan(0);
      expect(e.fraction).toBeLessThan(1);
      expect(e.eventMs).toBeGreaterThan(0);
    }
  });

  it("labels sunset with local zone time and distance ahead", () => {
    const times = sunTimesAt(41.88, -87.63, new Date("2026-07-07T12:00:00"))!;
    const events = buildRouteSunEvents({
      geometry: ilToCa,
      totalMeters: 4_000_000,
      userAlongMeters: 0,
      planEtaMinutes: 2_400,
      nowMs: times.sunsetMs - 2 * 3_600_000,
    });
    const sunset = events.find((e) => e.kind === "sunset");
    expect(sunset).toBeDefined();
    const label = routeSunEventAxisLabel(sunset!, 0, true);
    expect(label.title).toBe("Sunset");
    expect(label.time).toMatch(/PM|AM/);
    expect(label.place.length).toBeGreaterThan(0);
    expect(formatRouteSunEventLocation(sunset!, 0, true)).toMatch(/mi ahead|°/);
  });

  it("formats solar local time in the event time zone", () => {
    const times = sunTimesAt(41.88, -87.63, new Date("2026-07-07T12:00:00"))!;
    const chi = formatSolarLocalTime(times.sunsetMs, 41.88, -87.63);
    const la = formatSolarLocalTime(times.sunsetMs, 34.05, -118.24);
    expect(chi).toMatch(/CDT|CST/);
    expect(la).toMatch(/PDT|PST/);
  });
});
