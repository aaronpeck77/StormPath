import type { MinutePrecipForecast, RouteForecast, RouteHourlyInterval } from "../services/tomorrowIo";
import {
  routeForecastCorridorStress,
  routeForecastHasSignificantWeather,
  weatherCodeSeverity,
} from "../services/tomorrowIo";
import type { RouteImpactSeverity } from "../nav/routeImpacts";
import { formatEtaDuration } from "../ui/formatEta";
import {
  RADAR_HEAVY_THRESHOLD,
  RADAR_REROUTE_THRESHOLD,
} from "../nav/constants";
import {
  corridorColdestInterval,
  corridorFreezingInterval,
  corridorLowVisibilityInterval,
  corridorWeatherHeadline,
  formatCorridorIntervalDetail,
} from "./corridorIntervalDisplay";

export type AlongRouteSegment = {
  etaMinutes: number;
  label: string;
  detail: string;
  severity: RouteImpactSeverity;
  precipMmh: number;
  windGustMph: number;
};

export type ArrivalSnapshot = {
  etaMinutes: number;
  headline: string;
  detail: string;
  severity: RouteImpactSeverity;
};

export type LeaveWindowHint = {
  kind: "go_now" | "wait" | "neutral";
  headline: string;
  detail: string;
};

export type LegCompareRow = {
  routeId: string;
  letter: string;
  routeLabel: string;
  etaMinutes: number;
  wetScore: number;
  maxPrecipMmh: number;
  maxGustMph: number;
  summary: string;
};

export type LegCompareResult = {
  rows: LegCompareRow[];
  bestRouteId: string;
  narrative: string;
};

const PRECIP_WEATHER_CODES = new Set([
  4000, 4001, 4200, 4201, 5000, 5001, 5100, 5101, 6000, 6001, 6200, 6201, 8000,
]);

function intervalIsWet(iv: RouteHourlyInterval): boolean {
  return (
    iv.precipIntensityMmh > 0.02 ||
    iv.precipProbability >= 0.2 ||
    PRECIP_WEATHER_CODES.has(iv.weatherCode)
  );
}

function intervalWetScore(iv: RouteHourlyInterval): number {
  if (!intervalIsWet(iv)) return 0;
  let score = iv.precipIntensityMmh * 12 + iv.precipProbability * 2.5;
  if (PRECIP_WEATHER_CODES.has(iv.weatherCode)) score = Math.max(score, 0.35);
  if (iv.precipProbability >= 0.2) score = Math.max(score, 0.22);
  if (iv.precipIntensityMmh > 0.02) score = Math.max(score, 0.18);
  return score;
}

function wetCorridorInterval(
  forecast: RouteForecast
): { etaMinutes: number; headline: string; detail: string; weatherCode: number } | null {
  let best = forecast.intervals[0]!;
  let bestScore = intervalWetScore(best);
  for (const iv of forecast.intervals) {
    const score = intervalWetScore(iv);
    if (score > bestScore) {
      bestScore = score;
      best = iv;
    }
  }
  if (bestScore <= 0 || !intervalIsWet(best)) return null;
  return {
    etaMinutes: Math.round(best.etaMinutes),
    headline: corridorWeatherHeadline(best.weatherCode),
    detail: formatCorridorIntervalDetail(best),
    weatherCode: best.weatherCode,
  };
}

function wetCorridorHeadline(forecast: RouteForecast): string | null {
  const wet = wetCorridorInterval(forecast);
  if (!wet) return null;
  const along =
    wet.etaMinutes > 0 ? ` — ~${formatEtaDuration(wet.etaMinutes)} into drive` : "";
  const label = wet.headline.trim();
  if (label && label !== "Clear" && label !== "Unknown" && PRECIP_WEATHER_CODES.has(wet.weatherCode)) {
    return `${label} along route${along}`;
  }
  return `Rain possible along route${along}`;
}

/** One-line corridor headline for fuse / progress copy. */
export function corridorForecastHeadline(forecast: RouteForecast | null | undefined): string {
  if (!forecast?.intervals.length) return "";
  const worst = worstCorridorInterval(forecast);
  if (worst) {
    return worst.etaMinutes > 0
      ? `${worst.headline} — ~${formatEtaDuration(worst.etaMinutes)} into drive`
      : worst.headline;
  }
  const stress = routeForecastCorridorStress(forecast);
  if (stress >= 0.55) return "Storm stress along route";
  if (stress >= 0.25) return "Showers possible along route";
  const wetLine = wetCorridorHeadline(forecast);
  if (wetLine) return wetLine;
  if (routeForecastHasSignificantWeather(forecast)) return "Rain possible along route";
  return "Dry along route";
}

/** Mid-route wet interval for route-info detail (includes light rain). */
export function corridorWetIntervalLine(
  forecast: RouteForecast | null | undefined
): string | null {
  if (!forecast?.intervals.length) return null;
  const wet = wetCorridorInterval(forecast);
  if (!wet) return null;
  const etaLabel = wet.etaMinutes > 0 ? ` in ~${wet.etaMinutes} min` : "";
  return `${wet.headline}${etaLabel} on route · ${wet.detail}`;
}

export function corridorWetHeadline(forecast: RouteForecast | null | undefined): string | null {
  if (!forecast?.intervals.length) return null;
  return wetCorridorHeadline(forecast);
}

function corridorSupplementLine(
  forecast: RouteForecast,
  pick: (
    fc: RouteForecast
  ) => { etaMinutes: number; headline: string; detail: string } | null
): string | null {
  const hit = pick(forecast);
  if (!hit) return null;
  const etaLabel = hit.etaMinutes > 0 ? ` in ~${hit.etaMinutes} min` : "";
  return `${hit.headline}${etaLabel} on route · ${hit.detail}`;
}

/** Black-ice / refreeze risk when wet pavement is at or below freezing. */
export function corridorFreezingLine(
  forecast: RouteForecast | null | undefined
): string | null {
  if (!forecast?.intervals.length) return null;
  return corridorSupplementLine(forecast, corridorFreezingInterval);
}

/** Coldest feels-like sampled along the corridor (winter wind chill). */
export function corridorColdLine(forecast: RouteForecast | null | undefined): string | null {
  if (!forecast?.intervals.length) return null;
  const cold = corridorColdestInterval(forecast);
  if (!cold) return null;
  const etaLabel = cold.etaMinutes > 0 ? ` ~${cold.etaMinutes} min ahead` : "";
  const feelsPart =
    cold.feelsLikeF < cold.tempF - 3
      ? `Feels ${cold.feelsLikeF}°F (${cold.tempF}°F air)${etaLabel}`
      : `Coldest ${cold.feelsLikeF}°F${etaLabel} on route`;
  return feelsPart;
}

/** Fog / low visibility when WeatherKit visibility is below ~1 mi. */
export function corridorLowVisibilityLine(
  forecast: RouteForecast | null | undefined
): string | null {
  if (!forecast?.intervals.length) return null;
  return corridorSupplementLine(forecast, corridorLowVisibilityInterval);
}

export function alongRouteSegments(
  forecast: RouteForecast | null,
  tripEtaMinutes: number
): AlongRouteSegment[] {
  if (!forecast?.intervals.length || tripEtaMinutes <= 0) return [];
  return forecast.intervals.map((iv) => {
    const sev = weatherCodeSeverity(iv.weatherCode, iv.precipIntensityMmh, iv.windGustMph);
    return {
      etaMinutes: Math.round(iv.etaMinutes),
      label: corridorWeatherHeadline(iv.weatherCode),
      detail: formatCorridorIntervalDetail(iv),
      severity: sev,
      precipMmh: iv.precipIntensityMmh,
      windGustMph: iv.windGustMph,
    };
  });
}

export function arrivalSnapshot(
  forecast: RouteForecast | null,
  tripEtaMinutes: number,
  liveEtaMinutes: number | null
): ArrivalSnapshot | null {
  if (!forecast?.intervals.length) return null;
  const eta = Math.max(1, Math.round(liveEtaMinutes ?? tripEtaMinutes));
  let best = forecast.intervals[0]!;
  let bestDelta = Math.abs(best.etaMinutes - eta);
  for (const iv of forecast.intervals) {
    const d = Math.abs(iv.etaMinutes - eta);
    if (d < bestDelta) {
      bestDelta = d;
      best = iv;
    }
  }
  const sev = weatherCodeSeverity(best.weatherCode, best.precipIntensityMmh, best.windGustMph);
  return {
    etaMinutes: eta,
    headline: corridorWeatherHeadline(best.weatherCode),
    detail: formatCorridorIntervalDetail(best),
    severity: sev,
  };
}

export function computeLeaveWindowHint(
  minutePrecip: MinutePrecipForecast | null,
  routeForecast: RouteForecast | null,
  tripEtaMinutes: number
): LeaveWindowHint | null {
  const minutes = minutePrecip?.minutes ?? [];
  const firstWet = minutes.findIndex((m) => m.precipIntensityMmh > 0.15);
  const dryMins = firstWet < 0 ? 60 : firstWet;

  let heaviestEta = -1;
  let heaviestPrecip = 0;
  if (routeForecast?.intervals.length && tripEtaMinutes > 0) {
    for (const iv of routeForecast.intervals) {
      if (iv.precipIntensityMmh > heaviestPrecip) {
        heaviestPrecip = iv.precipIntensityMmh;
        heaviestEta = iv.etaMinutes;
      }
    }
  }

  if (dryMins >= 45 && heaviestPrecip < 2) {
    return {
      kind: "neutral",
      headline: "Good window to leave",
      detail: "Dry at your location for most of the next hour; corridor stays relatively light.",
    };
  }

  if (dryMins >= 20 && heaviestEta >= 0 && heaviestEta > dryMins + 15) {
    return {
      kind: "go_now",
      headline: `Leave within ~${formatEtaDuration(dryMins)} if you can`,
      detail: `Heaviest rain on your corridor is expected ~${formatEtaDuration(heaviestEta)} into the drive — leaving soon keeps you ahead of it.`,
    };
  }

  if (firstWet >= 0 && firstWet <= 12 && heaviestPrecip >= 4) {
    return {
      kind: "wait",
      headline: `Rain starting at you in ~${formatEtaDuration(firstWet)}`,
      detail: "Wait for a break or pick a drier leg below before Go if timing is flexible.",
    };
  }

  const stress = routeForecast ? routeForecastCorridorStress(routeForecast) : 0;
  if (stress >= 0.55) {
    return {
      kind: "go_now",
      headline: "Storm stress along corridor",
      detail: "Compare route legs — one option may stay drier after the first hour.",
    };
  }

  return null;
}

/**
 * Radar intensity floor derived from a corridor forecast — ensures the advisory banner can't
 * say "light showers possible" when WeatherKit/Tomorrow.io predicts thunderstorms or high precip
 * probability along the route. Returns a value on the same 0..1 scale as radar echo intensity.
 */
export function routeForecastIntensityFloor(forecast: RouteForecast | null | undefined): number {
  if (!forecast?.intervals.length) return 0;
  let maxProb = 0;
  for (const iv of forecast.intervals) {
    if (iv.weatherCode === 8000) return RADAR_HEAVY_THRESHOLD; // thunderstorm → heavy floor
    maxProb = Math.max(maxProb, iv.precipProbability);
  }
  if (maxProb >= 0.70) return RADAR_REROUTE_THRESHOLD;
  return 0;
}

/**
 * Find the worst-severity corridor interval across all route samples, with its ETA.
 * Useful for surfacing "Thunderstorm in ~42 min" when the worst cell is mid-route, not at the destination.
 */
export function worstCorridorInterval(
  forecast: RouteForecast | null | undefined
): { etaMinutes: number; headline: string; detail: string; severity: RouteImpactSeverity } | null {
  if (!forecast?.intervals.length) return null;
  const RANK: Record<RouteImpactSeverity, number> = { info: 0, caution: 1, serious: 2, avoid: 3 };
  let best = forecast.intervals[0]!;
  let bestRank = RANK[weatherCodeSeverity(best.weatherCode, best.precipIntensityMmh, best.windGustMph)];
  for (const iv of forecast.intervals) {
    const r = RANK[weatherCodeSeverity(iv.weatherCode, iv.precipIntensityMmh, iv.windGustMph)];
    if (r > bestRank) {
      bestRank = r;
      best = iv;
    }
  }
  const sev = weatherCodeSeverity(best.weatherCode, best.precipIntensityMmh, best.windGustMph);
  if (sev === "info") return null;
  return {
    etaMinutes: Math.round(best.etaMinutes),
    headline: corridorWeatherHeadline(best.weatherCode),
    detail: formatCorridorIntervalDetail(best),
    severity: sev,
  };
}

export function compareRouteLegs(
  legs: {
    routeId: string;
    letter: string;
    routeLabel: string;
    etaMinutes: number;
    forecast: RouteForecast | null;
  }[]
): LegCompareResult | null {
  if (legs.length < 2) return null;

  const rows: LegCompareRow[] = legs.map((leg) => {
    const intervals = leg.forecast?.intervals ?? [];
    const maxPrecip = intervals.reduce((m, iv) => Math.max(m, iv.precipIntensityMmh), 0);
    const maxGust = intervals.reduce((m, iv) => Math.max(m, iv.windGustMph), 0);
    const wetScore = routeForecastCorridorStress(
      leg.forecast ?? { fetchedAt: 0, intervals: [] }
    );
    const summary =
      maxPrecip >= 5
        ? "Heavy rain on corridor"
        : maxPrecip >= 1.5
          ? "Rain likely"
          : maxGust >= 40
            ? "Strong wind"
            : "Lighter corridor";
    return {
      routeId: leg.routeId,
      letter: leg.letter,
      routeLabel: leg.routeLabel,
      etaMinutes: leg.etaMinutes,
      wetScore,
      maxPrecipMmh: maxPrecip,
      maxGustMph: maxGust,
      summary,
    };
  });

  const sorted = [...rows].sort((a, b) => a.wetScore - b.wetScore);
  const best = sorted[0]!;
  const worst = sorted[sorted.length - 1]!;
  const narrative =
    best.wetScore + 0.08 < worst.wetScore
      ? `Route ${best.letter} (${best.routeLabel}) looks driest overall — about ${Math.round((worst.wetScore - best.wetScore) * 100)}% less corridor stress than ${worst.letter}.`
      : "Legs look similar for weather — pick by time and road feel.";

  return { rows, bestRouteId: best.routeId, narrative };
}
