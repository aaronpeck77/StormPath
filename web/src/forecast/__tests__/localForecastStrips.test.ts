import { describe, expect, it } from "vitest";
import {
  formatHourlySlotTimeLabel,
  nextHourHeadline,
  nextHourPeakFeels,
  sampleUpcomingHours,
  upcomingHourlySlots,
} from "../localForecastStrips";
import type { PointHourlyInterval } from "../../services/tomorrowIo";

function hour(
  iso: string,
  offsetHours: number,
  tempF = 80,
  feelsLikeF = tempF
): PointHourlyInterval {
  return {
    timeIso: iso,
    offsetHours,
    tempF,
    feelsLikeF,
    precipIntensityMmh: 0,
    precipProbability: 0,
    windMph: 5,
    conditions: "Clear",
  };
}

describe("localForecastStrips", () => {
  it("labels only the active clock hour as Now", () => {
    const nowDate = new Date(2026, 5, 26, 14, 30, 0);
    const now = nowDate.getTime();
    const currentHour = new Date(2026, 5, 26, 14, 0, 0).toISOString();
    const previousHour = new Date(2026, 5, 26, 13, 0, 0).toISOString();
    const laterHour = new Date(2026, 5, 26, 16, 0, 0).toISOString();
    expect(formatHourlySlotTimeLabel(currentHour, now)).toBe("Now");
    expect(formatHourlySlotTimeLabel(previousHour, now)).not.toBe("Now");
    expect(formatHourlySlotTimeLabel(laterHour, now)).not.toBe("Now");
  });

  it("drops past hourly slots", () => {
    const now = new Date(2026, 5, 26, 15, 30, 0).getTime();
    const hours = [
      hour(new Date(2026, 5, 26, 13, 0, 0).toISOString(), -2),
      hour(new Date(2026, 5, 26, 14, 0, 0).toISOString(), -1),
      hour(new Date(2026, 5, 26, 15, 0, 0).toISOString(), 0),
      hour(new Date(2026, 5, 26, 16, 0, 0).toISOString(), 1),
    ];
    const upcoming = upcomingHourlySlots(hours, 24, now);
    expect(upcoming.map((h) => h.offsetHours)).toEqual([0, 1]);
  });

  it("falls back to offsetHours when many day-boundary slots look expired", () => {
    const now = new Date(2026, 5, 26, 22, 30, 0).getTime();
    const hours = Array.from({ length: 24 }, (_, i) =>
      hour(new Date(2026, 5, 26, i, 0, 0).toISOString(), i - 22)
    );
    const upcoming = upcomingHourlySlots(hours, 24, now);
    expect(upcoming.length).toBeGreaterThanOrEqual(2);
    expect(upcoming.every((h) => h.offsetHours >= -0.5)).toBe(true);
  });

  it("samples upcoming hours without repeating past Now labels", () => {
    const now = new Date("2026-06-26T15:30:00").getTime();
    const hours = Array.from({ length: 24 }, (_, i) =>
      hour(new Date(now + i * 3_600_000).toISOString(), i)
    );
    const samples = sampleUpcomingHours(hours, 2, 8);
    const labels = samples.map(({ h }) => formatHourlySlotTimeLabel(h.timeIso, now));
    expect(labels.filter((l) => l === "Now").length).toBeLessThanOrEqual(1);
  });

  it("uses upcoming hours for next-hour heat peak without duplicating callout text", () => {
    const now = Date.now();
    const current = hour(new Date(now + 15 * 60_000).toISOString(), 0, 88, 88);
    const next = hour(new Date(now + 75 * 60_000).toISOString(), 1, 92, 98);
    const headline = nextHourHeadline({ hours: [current, next] });
    expect(headline).not.toContain("Heat index");
    expect(headline).toContain("No rain expected");
    expect(nextHourPeakFeels({ hours: [current, next] })).toBe(98);
  });
});
