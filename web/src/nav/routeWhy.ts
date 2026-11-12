import type { NavRoute } from "./types";
import type { ScoredRoute } from "../scoring/scoreRoutes";
import { routeConsiderationSummary } from "./routeSummary";
import { formatDelayVersusBaseline } from "../ui/formatEta";

/**
 * One-line "why this route exists" for the A/B/C picker — the reason a driver
 * would pick this leg over the fastest one. Derived from the fused score slice
 * (traffic delay, corridor precip weight, road hazards) plus Mapbox incidents
 * and the route's character (interstate vs backroads). Falls back to the
 * generic consideration blurb when there is no fused data to compare.
 *
 * Weather avoidance outranks traffic: it is StormPath's differentiator and the
 * thing no other navigator explains.
 */

/** Precip-weight gap vs the fastest leg that counts as "clearer". */
const PRECIP_AVOID_DELTA = 0.15;
/** Minutes of live-traffic delay saved vs the fastest leg that counts. */
const TRAFFIC_AVOID_MIN = 4;
/** Live-traffic delay on the fastest leg worth flagging honestly. */
const FASTEST_TRAFFIC_NOTE_MIN = 8;

function incidentCount(route: NavRoute): number {
  return route.mapboxIncidents?.length ?? 0;
}

function fastestScored(allScored: ScoredRoute[]): ScoredRoute | undefined {
  let best: ScoredRoute | undefined;
  for (const s of allScored) {
    if (!best || s.effectiveEtaMinutes < best.effectiveEtaMinutes) best = s;
  }
  return best;
}

export function routeWhySummary(
  scored: ScoredRoute | undefined,
  allScored: ScoredRoute[],
  route: NavRoute
): string {
  const baseline = fastestScored(allScored);
  const isFastest = route.role === "fastest" || (baseline != null && baseline.route.id === route.id);

  if (isFastest) {
    /* Honest caveat: "fastest" can still sit in a jam. Say so when live
     * traffic says the delay is real. */
    if (
      scored?.hasLiveTrafficEstimate &&
      scored.trafficDelayMinutes >= FASTEST_TRAFFIC_NOTE_MIN
    ) {
      const d = formatDelayVersusBaseline(scored.trafficDelayMinutes);
      if (d) return `Fastest · ${d} traffic`;
    }
    return "Fastest";
  }

  if (!scored || !baseline || baseline.route.id === route.id) {
    return routeConsiderationSummary(route);
  }

  /* Incident avoidance — Mapbox-flagged closures/construction on the legs. */
  const incidentDiff = incidentCount(baseline.route) - incidentCount(route);
  if (incidentDiff >= 1) {
    return incidentDiff === 1 ? "Avoids a road incident" : `Avoids ${incidentDiff} road incidents`;
  }

  /* Fused road hazards (feed reserved — fires automatically once wired). */
  const hazardDiff = (baseline.roadHazardCount ?? 0) - (scored.roadHazardCount ?? 0);
  if (hazardDiff >= 1) {
    return hazardDiff === 1 ? "Avoids a route hazard" : `Avoids ${hazardDiff} route hazards`;
  }

  /* Corridor precip weight — the StormPath differentiator. */
  const radarDiff =
    (baseline.radarIntensity ?? 0) - (scored.radarIntensity ?? 0);
  if (radarDiff >= PRECIP_AVOID_DELTA) return "Clearer skies";

  /* Live-traffic delay saved vs the fastest leg. */
  if (
    scored.hasLiveTrafficEstimate &&
    baseline.hasLiveTrafficEstimate &&
    baseline.trafficDelayMinutes - scored.trafficDelayMinutes >= TRAFFIC_AVOID_MIN
  ) {
    return "Lighter traffic";
  }

  /* Character fallbacks — why this leg exists even with no fused edge. */
  if (route.role === "hazardSmart") return "Stays off interstate";
  if (route.label.toLowerCase().includes("straightest")) return "Shortest distinct route";
  if (route.role === "balanced") return "Backroads";
  const L = route.label.toLowerCase();
  if (L.includes("scenic") || L.includes("country")) return "Scenic backroads";
  return routeConsiderationSummary(route);
}
