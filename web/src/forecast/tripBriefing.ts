/**
 * Pre-trip briefing model — pure assembly of everything the Trip Briefing
 * sheet shows for the focused (Go-bound) route: departure recommendation,
 * hazards, corridor weather, traffic, and route rationale.
 */

import type { NavRoute } from "../nav/types";
import type { ScoredRoute } from "../scoring/scoreRoutes";
import type { RouteSituationSlice } from "../situation/types";
import type { RouteImpact } from "../nav/routeImpacts";
import type { RouteForecast } from "../services/tomorrowIo";
import {
  corridorForecastHeadline,
  worstCorridorInterval,
} from "./corridorForecastModel";
import {
  formatOffsetClock,
  type DepartureAnalysis,
  type DepartureRecommendationKind,
} from "./departureScan";
import type { DepartureScanStatus } from "./useDepartureScan";
import { formatEtaDuration } from "../ui/formatEta";
import { formatRouteDistanceMi } from "../nav/routeSummary";
import { routeWhySummary } from "../nav/routeWhy";
import { sortImpactsByArrivalPriority } from "../nav/hazardArrivalVerdict";
import { fmtMin } from "../nav/routeAlertTiming";

export type TripBriefingHazard = {
  id: string;
  headline: string;
  /** Secondary line — road effect or arrival verdict. */
  sub: string | null;
  /** "~42 min into drive" / "in ~3 mi" style timing, when known. */
  when: string | null;
  tone: "serious" | "caution" | "info";
};

export type TripBriefingLeaveCard = {
  status: DepartureScanStatus;
  kind: DepartureRecommendationKind | null;
  headline: string;
  detail: string | null;
  /** "arrive ~5:40 PM" for the recommended departure, when known. */
  arriveLabel: string | null;
  /** "forecast covers first ~9 h" honesty note for partial scans. */
  coverageNote: string | null;
};

export type TripBriefing = {
  routeLetter: string;
  routeLabel: string;
  isSuggested: boolean;
  destinationLabel: string;
  originLabel: string;
  etaLabel: string;
  distanceLabel: string;
  leaveCard: TripBriefingLeaveCard;
  hazards: TripBriefingHazard[];
  weatherLines: string[];
  trafficLine: string | null;
  whyLine: string | null;
  /** "StormPath's pick is Route B" when the focused leg isn't the suggestion. */
  alternateNote: string | null;
  freshnessLine: string;
};

const MAX_HAZARDS = 5;
const MAX_WEATHER_LINES = 3;

function hazardWhen(impact: RouteImpact, useMiles: boolean): string | null {
  if (impact.etaAheadMinutes != null && impact.etaAheadMinutes > 0) {
    const eta = fmtMin(impact.etaAheadMinutes);
    return eta ? `~${eta} into drive` : null;
  }
  if (impact.distanceAheadMeters != null && impact.distanceAheadMeters > 0) {
    if (useMiles) {
      const mi = impact.distanceAheadMeters / 1609.344;
      return mi < 1 ? "under a mile ahead" : `~${Math.round(mi)} mi ahead`;
    }
    const km = impact.distanceAheadMeters / 1000;
    return km < 1 ? "under a km ahead" : `~${Math.round(km)} km ahead`;
  }
  return null;
}

function hazardTone(impact: RouteImpact): TripBriefingHazard["tone"] {
  if (impact.severity === "avoid" || impact.severity === "serious") return "serious";
  if (impact.severity === "caution") return "caution";
  return "info";
}

function buildLeaveCard(
  status: DepartureScanStatus,
  analysis: DepartureAnalysis | null,
  nowMs: number
): TripBriefingLeaveCard {
  if (status === "loading" || status === "idle") {
    return {
      status,
      kind: null,
      headline: "Checking departure times…",
      detail: null,
      arriveLabel: null,
      coverageNote: null,
    };
  }
  if (status === "unavailable" || !analysis?.recommendation) {
    return {
      status: "unavailable",
      kind: null,
      headline: "Departure timing unavailable",
      detail: "The hourly forecast didn't load — close and reopen to retry.",
      arriveLabel: null,
      coverageNote: null,
    };
  }
  const rec = analysis.recommendation;
  const arriveLabel =
    rec.arriveOffsetMin > 0
      ? `arrive ~${formatOffsetClock(rec.arriveOffsetMin, nowMs)}`
      : null;
  const coverageNote =
    analysis.status === "partial" && analysis.coverageMin > 0
      ? `forecast covers the first ~${Math.round(analysis.coverageMin / 60)} h — later windows are estimates`
      : null;
  return {
    status: analysis.status,
    kind: rec.kind,
    headline: rec.headline,
    detail: rec.detail || null,
    arriveLabel,
    coverageNote,
  };
}

function buildWeatherLines(
  forecast: RouteForecast | null,
  slice: RouteSituationSlice | undefined
): string[] {
  const lines: string[] = [];
  const headline =
    corridorForecastHeadline(forecast) || slice?.forecastHeadline?.trim() || "";
  if (headline) lines.push(headline);
  const worst = worstCorridorInterval(forecast);
  if (worst) {
    const eta = worst.etaMinutes > 0 ? ` — ~${formatEtaDuration(worst.etaMinutes)} into drive` : "";
    lines.push(`${worst.headline}${eta}`);
    if (worst.detail && lines.length < MAX_WEATHER_LINES) lines.push(worst.detail);
  }
  return lines.slice(0, MAX_WEATHER_LINES);
}

function buildTrafficLine(slice: RouteSituationSlice | undefined): string | null {
  if (!slice) return null;
  if (!slice.hasLiveTrafficEstimate) {
    return "Drive times are static estimates — live traffic wasn't available.";
  }
  const delay = Math.max(0, Math.round(slice.trafficDelayMinutes));
  return delay > 0
    ? `Live traffic adds ~${formatEtaDuration(delay)} vs the clear-road estimate.`
    : "Live traffic looks clear along this route.";
}

function freshnessLine(
  forecast: RouteForecast | null,
  provider: "tomorrowIo" | "weatherKit" | null
): string {
  const name = provider === "weatherKit" ? "WeatherKit" : "Tomorrow.io";
  if (forecast?.fetchedAt) {
    const t = new Date(forecast.fetchedAt).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    return `Weather forecast · ${name} · updated ${t}`;
  }
  return "Weather forecast unavailable — hazards and traffic still shown.";
}

export function buildTripBriefing(input: {
  route: NavRoute;
  routeLetter: string;
  routeLabel: string;
  isSuggested: boolean;
  destinationLabel: string;
  originLabel: string;
  scored: ScoredRoute | undefined;
  allScored: ScoredRoute[];
  slice: RouteSituationSlice | undefined;
  impacts: RouteImpact[];
  forecast: RouteForecast | null;
  forecastProvider: "tomorrowIo" | "weatherKit" | null;
  departureStatus: DepartureScanStatus;
  departureAnalysis: DepartureAnalysis | null;
  /** routeId → picker letter, for the "StormPath's pick" note. */
  letterFor: (routeId: string) => string;
  suggestedRouteId: string | null;
  useMiles: boolean;
  nowMs?: number;
}): TripBriefing {
  const {
    route,
    routeLetter,
    routeLabel,
    isSuggested,
    destinationLabel,
    originLabel,
    scored,
    allScored,
    slice,
    impacts,
    forecast,
    forecastProvider,
    departureStatus,
    departureAnalysis,
    letterFor,
    suggestedRouteId,
    useMiles,
  } = input;
  const nowMs = input.nowMs ?? Date.now();

  const etaMinutes = scored?.effectiveEtaMinutes ?? route.baseEtaMinutes;
  const hazards = sortImpactsByArrivalPriority(impacts)
    .filter((i) => i.severity !== "info" || i.category === "closure")
    .slice(0, MAX_HAZARDS)
    .map((i): TripBriefingHazard => {
      const verdict = i.arrivalVerdictLine?.trim();
      const sub =
        verdict && !i.driverHeadline.toLowerCase().startsWith(verdict.toLowerCase())
          ? verdict
          : i.roadEffect?.trim() || null;
      return {
        id: i.id,
        headline: i.driverHeadline.replace(/\s+/g, " ").trim(),
        sub: sub || null,
        when: hazardWhen(i, useMiles),
        tone: hazardTone(i),
      };
    });

  /* Route notices (closures/construction from Mapbox) backstop when the
   * impact pipeline has nothing for this leg yet. */
  if (hazards.length === 0) {
    for (const notice of (route.routeNotices ?? []).slice(0, 3)) {
      hazards.push({
        id: `notice-${hazards.length}`,
        headline: notice.replace(/\s+/g, " ").trim(),
        sub: null,
        when: null,
        tone: "caution",
      });
    }
  }

  let alternateNote: string | null = null;
  if (suggestedRouteId && suggestedRouteId !== route.id) {
    const pick = allScored.find((s) => s.route.id === suggestedRouteId);
    if (pick) {
      const letter = letterFor(suggestedRouteId);
      const why = routeWhySummary(pick, allScored, pick.route);
      alternateNote = `StormPath's pick is Route ${letter}${why ? ` — ${why}` : ""}. Tap the route chip to switch.`;
    }
  }

  return {
    routeLetter,
    routeLabel,
    isSuggested,
    destinationLabel,
    originLabel,
    etaLabel: `~${formatEtaDuration(Math.max(1, Math.round(etaMinutes)))}`,
    distanceLabel: formatRouteDistanceMi(route.geometry),
    leaveCard: buildLeaveCard(departureStatus, departureAnalysis, nowMs),
    hazards,
    weatherLines: buildWeatherLines(forecast, slice),
    trafficLine: buildTrafficLine(slice),
    whyLine: routeWhySummary(scored, allScored, route) || null,
    alternateNote,
    freshnessLine: freshnessLine(forecast, forecastProvider),
  };
}
