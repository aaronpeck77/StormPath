import { describe, expect, it } from "vitest";
import {
  buildRouteChartNightBands,
  findNightTransitions,
} from "../chartNightBands";
import { isDaylightAt, isNightAt, sunTimesAt } from "../solarDayNight";
import { currentMapPhase } from "../../ui/mapBasemapStyle";

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

describe("isDaylightAt", () => {
  it("is daylight at noon local Chicago summer", () => {
    const date = new Date("2026-07-07T17:00:00Z");
    expect(isDaylightAt(41.88, -87.63, date.getTime())).toBe(true);
  });

  it("is not daylight at 11pm local Chicago summer", () => {
    const date = new Date("2026-07-07T04:00:00Z");
    expect(isDaylightAt(41.88, -87.63, date.getTime())).toBe(false);
  });
});

describe("currentMapPhase", () => {
  it("stays day through civil twilight after geometric sunset", () => {
    const chicago: [number, number] = [-87.63, 41.88];
    const times = sunTimesAt(41.88, -87.63, new Date("2026-07-07T12:00:00"))!;
    expect(currentMapPhase(chicago, times.sunriseMs + 60_000)).toBe("day");
    /* Just after sunset outdoors is still bright — keep day basemap. */
    expect(currentMapPhase(chicago, times.sunsetMs + 60_000)).toBe("day");
    /* A few minutes after civil dusk — night basemap. */
    expect(currentMapPhase(chicago, times.duskMs + 5 * 60_000)).toBe("night");
    expect(currentMapPhase(chicago, times.dawnMs - 5 * 60_000)).toBe("night");
    expect(currentMapPhase(chicago, times.dawnMs + 60_000)).toBe("day");
  });

  it("is still day at 7pm Chicago midsummer", () => {
    const chicago: [number, number] = [-87.63, 41.88];
    /* 2026-07-07 19:00 CDT = 2026-07-08 00:00 UTC — previously misclassified via UTC day-anchored dusk. */
    expect(currentMapPhase(chicago, new Date("2026-07-08T00:00:00Z").getTime())).toBe("day");
  });
});

describe("findNightTransitions", () => {
  it("marks sunset and sunrise at sample boundaries", () => {
    const transitions = findNightTransitions([
      { start: 0, end: 0.5, night: false },
      { start: 0.5, end: 0.75, night: true },
      { start: 0.75, end: 1, night: false },
    ]);
    expect(transitions).toEqual([
      { fraction: 0.5, kind: "sunset" },
      { fraction: 0.75, kind: "sunrise" },
    ]);
  });
});

describe("Midwest summer sun times", () => {
  const CHI_LAT = 41.88;
  const CHI_LNG = -87.63;
  const TZ = "America/Chicago";

  function localClockMinutes(ms: number): number {
    const d = new Date(ms);
    const hour = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: false }).format(d)
    );
    const minute = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: TZ, minute: "numeric" }).format(d)
    );
    return hour * 60 + minute;
  }

  it("Chicago midsummer sunset is near 8:30 PM and sunrise near 5:30 AM", () => {
    const times = sunTimesAt(CHI_LAT, CHI_LNG, new Date("2026-07-07T12:00:00"))!;
    const sunset = localClockMinutes(times.sunsetMs);
    const sunrise = localClockMinutes(times.sunriseMs);
    expect(sunset).toBeGreaterThanOrEqual(20 * 60 + 15);
    expect(sunset).toBeLessThanOrEqual(20 * 60 + 45);
    expect(sunrise).toBeGreaterThanOrEqual(5 * 60 + 15);
    expect(sunrise).toBeLessThanOrEqual(5 * 60 + 45);
  });
});

describe("buildRouteChartNightBands", () => {
  const geometry: [number, number][] = [
    [-87.63, 41.88],
    [-87.0, 41.5],
    [-86.3, 41.1],
  ];

  it("returns night band when evening drive crosses sunset", () => {
    const times = sunTimesAt(41.88, -87.63, new Date("2026-07-07T12:00:00"))!;
    const bands = buildRouteChartNightBands({
      geometry,
      totalMeters: 120_000,
      userAlongMeters: 0,
      planEtaMinutes: 180,
      nowMs: times.sunsetMs - 30 * 60_000,
    });
    expect(bands.some((b) => b.end > 0.5)).toBe(true);
  });

  it("estimates night bands when plan ETA is missing", () => {
    const bands = buildRouteChartNightBands({
      geometry,
      totalMeters: 120_000,
      userAlongMeters: 0,
      planEtaMinutes: null,
      nowMs: new Date("2026-07-07T04:00:00Z").getTime(),
    });
    expect(bands.length).toBeGreaterThan(0);
  });
});
