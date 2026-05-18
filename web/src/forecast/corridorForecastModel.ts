import type { MinutePrecipForecast, RouteForecast, RouteHourlyInterval } from "../services/tomorrowIo";
import { routeForecastCorridorStress, weatherCodeLabel, weatherCodeSeverity } from "../services/tomorrowIo";
import type { RouteImpactSeverity } from "../nav/routeImpacts";
import { formatEtaDuration } from "../ui/formatEta";

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

export function alongRouteSegments(
  forecast: RouteForecast | null,
  tripEtaMinutes: number
): AlongRouteSegment[] {
  if (!forecast?.intervals.length || tripEtaMinutes <= 0) return [];
  return forecast.intervals.map((iv) => {
    const sev = weatherCodeSeverity(iv.weatherCode, iv.precipIntensityMmh, iv.windGustMph);
    return {
      etaMinutes: Math.round(iv.etaMinutes),
      label: weatherCodeLabel(iv.weatherCode),
      detail: formatIntervalDetail(iv),
      severity: sev,
      precipMmh: iv.precipIntensityMmh,
      windGustMph: iv.windGustMph,
    };
  });
}

function formatIntervalDetail(iv: RouteHourlyInterval): string {
  const parts: string[] = [];
  if (iv.precipIntensityMmh >= 0.4) parts.push(`${iv.precipIntensityMmh.toFixed(1)} mm/hr rain`);
  if (iv.windGustMph >= 22) parts.push(`gusts ${Math.round(iv.windGustMph)} mph`);
  if (iv.wetRoadMm >= 1.5) parts.push("wet roads");
  parts.push(`${Math.round(iv.tempF)}°F`);
  return parts.join(" · ");
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
    headline: weatherCodeLabel(best.weatherCode),
    detail: formatIntervalDetail(best),
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
