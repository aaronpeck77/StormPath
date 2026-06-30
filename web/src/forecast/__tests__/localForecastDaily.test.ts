import { describe, expect, it } from "vitest";
import { enrichDailyWithHourlyApparent } from "../localForecastDaily";
import type { PointDailyDay, PointHourlyInterval } from "../../services/tomorrowIo";

describe("enrichDailyWithHourlyApparent", () => {
  it("raises daily heat index peak from humid hourly slots", () => {
    const days: PointDailyDay[] = [
      {
        dateIso: "2026-06-26T12:00:00Z",
        dayLabel: "Thu",
        highF: 91,
        lowF: 72,
        precipChance: 0.1,
        conditions: "Humid",
        maxFeelsLikeF: 91,
      },
    ];
    const hours: PointHourlyInterval[] = [
      {
        timeIso: "2026-06-26T18:00:00Z",
        offsetHours: 2,
        tempF: 91,
        feelsLikeF: 91,
        humidityPct: 60,
        precipIntensityMmh: 0,
        precipProbability: 0,
        windMph: 6,
        conditions: "Humid",
      },
    ];
    const enriched = enrichDailyWithHourlyApparent(days, hours);
    expect(enriched[0]?.maxFeelsLikeF).toBeGreaterThanOrEqual(100);
  });

  it("assigns humid afternoon peak to the daily period even when calendar keys differ", () => {
    const days: PointDailyDay[] = [
      {
        dateIso: "2026-06-28T00:00:00Z",
        dayLabel: "Sat",
        highF: 95,
        lowF: 75,
        precipChance: 0.1,
        conditions: "Humid",
        maxFeelsLikeF: 95,
      },
      {
        dateIso: "2026-06-29T00:00:00Z",
        dayLabel: "Sun",
        highF: 96,
        lowF: 76,
        precipChance: 0.1,
        conditions: "Humid",
      },
    ];
    const hours: PointHourlyInterval[] = [
      {
        timeIso: "2026-06-28T19:00:00Z",
        offsetHours: 20,
        tempF: 95,
        feelsLikeF: 95,
        humidityPct: 68,
        precipIntensityMmh: 0,
        precipProbability: 0,
        windMph: 6,
        conditions: "Humid",
      },
    ];
    const enriched = enrichDailyWithHourlyApparent(days, hours);
    expect(enriched[0]?.maxFeelsLikeF).toBeGreaterThanOrEqual(105);
  });

  it("tracks daily wind chill low from cold windy hourly slots", () => {
    const days: PointDailyDay[] = [
      {
        dateIso: "2026-01-15T00:00:00Z",
        dayLabel: "Thu",
        highF: 34,
        lowF: 28,
        precipChance: 0,
        conditions: "Windy",
      },
    ];
    const hours: PointHourlyInterval[] = [
      {
        timeIso: "2026-01-15T06:00:00Z",
        offsetHours: 1,
        tempF: 28,
        feelsLikeF: 28,
        precipIntensityMmh: 0,
        precipProbability: 0,
        windMph: 18,
        conditions: "Windy",
      },
    ];
    const enriched = enrichDailyWithHourlyApparent(days, hours);
    expect(enriched[0]?.minFeelsLikeF).toBeLessThan(28);
  });
});
