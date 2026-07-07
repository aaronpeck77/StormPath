import { describe, expect, it } from "vitest";
import { buildRouteChartNightBands } from "../chartNightBands";
import { isNightAt, sunTimesAt } from "../solarDayNight";

describe("sunTimesAt", () => {
  it("returns ordered dawn/sunrise/sunset/dusk for Chicago midsummer", () => {
    const date = new Date("2026-07-07T12:00:00Z");
    const times = sunTimesAt(41.88, -87.63, date);
    expect(times).not.toBeNull();
    expect(times!.dawnMs).toBeLessThan(times!.sunriseMs);
    expect(times!.sunriseMs).toBeLessThan(times!.sunsetMs);
    expect(times!.sunsetMs).toBeLessThan(times!.duskMs);
  });
});

describe("isNightAt", () => {
  it("is night at 11pm local Chicago summer", () => {
    const date = new Date("2026-07-07T04:00:00Z"); // ~11pm CDT Jul 6
    expect(isNightAt(41.88, -87.63, date.getTime())).toBe(true);
  });

  it("is day at noon local Chicago summer", () => {
    const date = new Date("2026-07-07T17:00:00Z"); // ~noon CDT
    expect(isNightAt(41.88, -87.63, date.getTime())).toBe(false);
  });
});

describe("buildRouteChartNightBands", () => {
  const geometry: [number, number][] = [
    [-87.63, 41.88],
    [-87.0, 41.5],
    [-86.3, 41.1],
  ];

  it("returns night band when evening drive crosses dusk", () => {
    const dusk = new Date("2026-07-07T01:30:00Z"); // ~8:30pm CDT
    const bands = buildRouteChartNightBands({
      geometry,
      totalMeters: 120_000,
      userAlongMeters: 0,
      planEtaMinutes: 180,
      nowMs: dusk.getTime(),
    });
    expect(bands.some((b) => b.end > 0.5)).toBe(true);
  });
});
