import type { CurrentNowcast } from "../services/openWeatherClient";
import type { MinutePrecipForecast, PointHourlyInterval } from "../services/tomorrowIo";
import {
  feelsLikeCellColor,
  heatIndexNotable,
  precipIsActive,
  precipTypeColor,
  resolveHourFeelsLikeF,
  type PrecipTypeCode,
  windChillNotable,
  windGustBarColor,
  windGustBarHeight,
} from "./localForecastVisual";

export const NEXT_HOUR_MINUTES = 60;

export type NextHourLaneCell = {
  heatColor: string;
  precipColor: string;
  windColor: string;
  windHeightPct: string;
};

/** Clock label for an hourly slot — only the active hour reads "Now". */
export function formatHourlySlotTimeLabel(timeIso: string, nowMs = Date.now()): string {
  const slotStart = new Date(timeIso).getTime();
  if (!Number.isFinite(slotStart)) return "—";
  const slotEnd = slotStart + 3_600_000;
  if (nowMs >= slotStart && nowMs < slotEnd) return "Now";
  return new Date(timeIso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Drop hours that ended before `nowMs`. */
export function upcomingHourlySlots(
  hours: PointHourlyInterval[],
  limit = 24,
  nowMs = Date.now()
): PointHourlyInterval[] {
  const byTimeIso = hours.filter((h) => {
    const start = new Date(h.timeIso).getTime();
    return Number.isFinite(start) && start + 3_600_000 > nowMs;
  });
  if (byTimeIso.length >= Math.min(limit, 6)) {
    return byTimeIso.slice(0, limit);
  }
  /* Fallback when the stored list starts at day boundary but offsetHours is still valid. */
  const byOffset = hours.filter((h) => h.offsetHours >= -0.5);
  const picked = byOffset.length > byTimeIso.length ? byOffset : byTimeIso;
  return picked.slice(0, limit);
}

/** Sample upcoming hours for a readable phone strip (every `step` hours). */
export function sampleUpcomingHours(
  hours: PointHourlyInterval[],
  step = 2,
  maxSlots = 13
): { h: PointHourlyInterval; index: number }[] {
  const upcoming = upcomingHourlySlots(hours);
  if (!upcoming.length) return [];
  if (upcoming.length <= maxSlots) {
    return upcoming.map((h, index) => ({ h, index }));
  }
  const out: { h: PointHourlyInterval; index: number }[] = [];
  for (let i = 0; i < upcoming.length && out.length < maxSlots; i += step) {
    out.push({ h: upcoming[i]!, index: i });
  }
  const last = upcoming[upcoming.length - 1]!;
  if (out[out.length - 1]?.h.timeIso !== last.timeIso) {
    out.push({ h: last, index: upcoming.length - 1 });
  }
  return out;
}

function feelsAtMinute(
  minuteIndex: number,
  startFeels: number,
  endFeels: number,
  totalMinutes = NEXT_HOUR_MINUTES
): number {
  const t = minuteIndex / Math.max(1, totalMinutes - 1);
  return startFeels + (endFeels - startFeels) * t;
}

/** Build 60 colored cells for heat, precipitation, and wind in the next hour. */
export function buildNextHourLanes(opts: {
  nowcast?: CurrentNowcast | null;
  minutePrecip?: MinutePrecipForecast | null;
  hours: PointHourlyInterval[];
}): NextHourLaneCell[] {
  const { nowcast, minutePrecip, hours } = opts;
  const upcoming = upcomingHourlySlots(hours, 2);
  const h0 = upcoming[0];
  const h1 = upcoming[1] ?? h0;
  const startFeels = Math.round(
    nowcast?.feelsLikeF ??
      (h0 ? resolveHourFeelsLikeF(h0) : undefined) ??
      minutePrecip?.now?.tempF ??
      70
  );
  const endFeels = Math.round(h1 ? resolveHourFeelsLikeF(h1) : startFeels);
  const windMph = nowcast?.windMph ?? h0?.windMph ?? minutePrecip?.now?.windMph ?? 0;
  const gustMph = nowcast?.windGustMph ?? h0?.windGustMph ?? windMph;
  const minutes = minutePrecip?.minutes.slice(0, NEXT_HOUR_MINUTES) ?? [];
  const nowPrecipMmh =
    nowcast?.precipInPerHr != null ? nowcast.precipInPerHr * 25.4 : null;
  const nowDry = nowPrecipMmh != null && nowPrecipMmh < 0.05;

  const cells: NextHourLaneCell[] = [];
  for (let i = 0; i < NEXT_HOUR_MINUTES; i++) {
    const feels = feelsAtMinute(i, startFeels, endFeels);
    const m = minutes[i];
    let precipType = (m?.precipType ?? h0?.precipType ?? 0) as PrecipTypeCode;
    let precipIntensity = m?.precipIntensityMmh ?? h0?.precipIntensityMmh ?? 0;
    let precipProb = m?.precipProbability ?? h0?.precipProbability ?? 0;
    if (!m && nowDry) {
      precipType = 0;
      precipIntensity = 0;
      precipProb = 0;
    }
    cells.push({
      heatColor: feelsLikeCellColor(feels),
      precipColor: precipTypeColor(precipType, precipIntensity, precipProb),
      windColor: windGustBarColor(gustMph),
      windHeightPct: windGustBarHeight(gustMph),
    });
  }
  return cells;
}

export function nextHourPeakFeels(opts: {
  nowcast?: CurrentNowcast | null;
  hours: PointHourlyInterval[];
}): number {
  const upcoming = upcomingHourlySlots(opts.hours, 2);
  const h0 = upcoming[0];
  const h1 = upcoming[1] ?? h0;
  const startFeels = Math.round(
    opts.nowcast?.feelsLikeF ??
      (h0 ? resolveHourFeelsLikeF(h0) : undefined) ??
      0
  );
  const endFeels = Math.round(h1 ? resolveHourFeelsLikeF(h1) : startFeels);
  let peak = Math.max(startFeels, endFeels);
  for (let i = 0; i < NEXT_HOUR_MINUTES; i++) {
    peak = Math.max(peak, Math.round(feelsAtMinute(i, startFeels, endFeels)));
  }
  return peak;
}

export function nextHourHeadline(opts: {
  nowcast?: CurrentNowcast | null;
  minutePrecip?: MinutePrecipForecast | null;
  hours: PointHourlyInterval[];
}): string {
  const { nowcast, minutePrecip, hours } = opts;
  const upcoming = upcomingHourlySlots(hours, 2);
  const h0 = upcoming[0];
  const peakFeels = nextHourPeakFeels({ nowcast, hours });
  const minutes = minutePrecip?.minutes.slice(0, NEXT_HOUR_MINUTES) ?? [];
  const hasPrecip =
    minutes.some((m) =>
      precipIsActive(m.precipIntensityMmh, m.precipProbability, m.precipType as PrecipTypeCode)
    ) ||
    (minutes.length === 0 &&
      h0 != null &&
      !(
        nowcast?.precipInPerHr != null &&
        nowcast.precipInPerHr * 25.4 < 0.05
      ) &&
      precipIsActive(h0.precipIntensityMmh, h0.precipProbability, h0.precipType as PrecipTypeCode));
  const gust = nowcast?.windGustMph ?? h0?.windGustMph ?? 0;

  const parts: string[] = [];
  if (!heatIndexNotable(peakFeels) && peakFeels > 0) {
    parts.push(`Feels like ${peakFeels}°`);
  }
  if (hasPrecip) {
    const firstWet = minutes.findIndex((m) =>
      precipIsActive(m.precipIntensityMmh, m.precipProbability, m.precipType as PrecipTypeCode)
    );
    if (firstWet <= 0) parts.push("Rain or snow now");
    else parts.push(`Wet weather in about ${firstWet} min`);
  } else {
    parts.push("No rain expected");
  }
  if (gust >= 28) parts.push(`Gusts to ${Math.round(gust)} mph`);
  return parts.join(" · ");
}

export function hourlyStripHeadline(hours: PointHourlyInterval[]): string {
  const upcoming = upcomingHourlySlots(hours);
  if (!upcoming.length) return "Hourly forecast";
  let coldestHour: PointHourlyInterval | null = null;
  let minFeels = Infinity;
  let wetHours = 0;
  let maxGust = 0;
  for (const h of upcoming) {
    const feels = resolveHourFeelsLikeF(h);
    if (feels < minFeels) {
      minFeels = feels;
      coldestHour = h;
    }
    if (precipIsActive(h.precipIntensityMmh, h.precipProbability, h.precipType as PrecipTypeCode)) {
      wetHours += 1;
    }
    maxGust = Math.max(maxGust, h.windGustMph ?? h.windMph ?? 0);
  }
  const parts: string[] = [];
  if (
    coldestHour &&
    Number.isFinite(minFeels) &&
    windChillNotable(
      minFeels,
      coldestHour.tempF,
      coldestHour.windGustMph ?? coldestHour.windMph ?? 0
    )
  ) {
    parts.push(`Lowest wind chill ${Math.round(minFeels)}°`);
  }
  if (wetHours > 0) parts.push(wetHours >= 6 ? "Rain likely today" : `Rain in ${wetHours} hours`);
  else parts.push("Mostly dry");
  if (maxGust >= 28) parts.push(`Wind gusts to ${Math.round(maxGust)} mph`);
  return parts.join(" · ");
}

export function hourHasPrecip(h: PointHourlyInterval): boolean {
  return precipIsActive(h.precipIntensityMmh, h.precipProbability, h.precipType as PrecipTypeCode);
}

/** Trust live conditions for the current clock hour when they disagree with stale hourly noise. */
export function hourlyPrecipForDisplay(
  h: PointHourlyInterval,
  opts?: {
    isNowSlot?: boolean;
    nowPrecipMmh?: number | null;
    minutePrecipActive?: boolean;
  }
): { active: boolean; intensityMmh: number; probability: number; type: PrecipTypeCode } {
  const type = (h.precipType ?? 0) as PrecipTypeCode;
  let intensityMmh = h.precipIntensityMmh;
  let probability = h.precipProbability;

  if (opts?.isNowSlot) {
    if (opts.nowPrecipMmh != null && opts.nowPrecipMmh < 0.05) {
      intensityMmh = 0;
      probability = 0;
    } else if (opts.minutePrecipActive === false) {
      intensityMmh = 0;
      probability = Math.min(probability, 0.12);
    }
  }

  return {
    active: precipIsActive(intensityMmh, probability, type),
    intensityMmh,
    probability,
    type,
  };
}
