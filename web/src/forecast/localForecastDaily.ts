import type { PointDailyDay, PointHourlyInterval } from "../services/tomorrowIo";
import { resolveIntervalFeelsLikeF } from "./localForecastVisual";

export type DailyPeriodBounds = { startMs: number; endMs: number };

export type DailyApparentExtremes = {
  maxFeelsLikeF?: number;
  minFeelsLikeF?: number;
};

/** WeatherKit daily `forecastStart` … next day start — not browser calendar dates. */
export function dailyPeriodBoundsFromDays(
  days: { dateIso: string }[]
): DailyPeriodBounds[] {
  if (!days.length) return [];
  const starts = days
    .map((d) => new Date(d.dateIso).getTime())
    .filter((ms) => Number.isFinite(ms));
  return starts.map((startMs, i) => ({
    startMs,
    endMs: i + 1 < starts.length ? starts[i + 1]! : startMs + 86_400_000,
  }));
}

export function dayIndexForHourMs(
  hourMs: number,
  bounds: DailyPeriodBounds[]
): number {
  for (let i = 0; i < bounds.length; i++) {
    const b = bounds[i]!;
    if (hourMs >= b.startMs && hourMs < b.endMs) return i;
  }
  return -1;
}

export function accumulateFeelsIntoDailyPeriods(
  bounds: DailyPeriodBounds[],
  extremes: DailyApparentExtremes[],
  hourMs: number,
  feels: number
): void {
  const idx = dayIndexForHourMs(hourMs, bounds);
  if (idx < 0) return;
  const cur = extremes[idx]!;
  cur.maxFeelsLikeF =
    cur.maxFeelsLikeF == null ? feels : Math.max(cur.maxFeelsLikeF, feels);
  cur.minFeelsLikeF =
    cur.minFeelsLikeF == null ? feels : Math.min(cur.minFeelsLikeF, feels);
}

/** Peak/low apparent temp per daily outlook period from hourly slots. */
export function computeDailyApparentExtremes(
  days: PointDailyDay[],
  hours: PointHourlyInterval[]
): DailyApparentExtremes[] {
  const bounds = dailyPeriodBoundsFromDays(days);
  const out: DailyApparentExtremes[] = days.map(() => ({}));
  for (const h of hours) {
    const hourMs = new Date(h.timeIso).getTime();
    if (!Number.isFinite(hourMs)) continue;
    accumulateFeelsIntoDailyPeriods(
      bounds,
      out,
      hourMs,
      resolveIntervalFeelsLikeF(h)
    );
  }
  return out;
}

function mergeMax(a?: number, b?: number): number | undefined {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

function mergeMin(a?: number, b?: number): number | undefined {
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
}

/** Merge hourly apparent-temp peaks/lows into the daily outlook (heat index + wind chill). */
export function enrichDailyWithHourlyApparent(
  days: PointDailyDay[],
  hours: PointHourlyInterval[]
): PointDailyDay[] {
  if (!days.length) return days;
  const fromHours = computeDailyApparentExtremes(days, hours);
  return days.map((d, i) => {
    const ext = fromHours[i]!;
    return {
      ...d,
      maxFeelsLikeF: mergeMax(d.maxFeelsLikeF, ext.maxFeelsLikeF),
      minFeelsLikeF: mergeMin(d.minFeelsLikeF, ext.minFeelsLikeF),
    };
  });
}
