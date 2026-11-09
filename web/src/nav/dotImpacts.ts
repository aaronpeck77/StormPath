/**
 * Convert normalized DOT/WZDx events into RouteImpact[] so they ride the same
 * pipeline as weather/traffic/incidents: progress rail, hazard card, advisory,
 * map bands, and off-route logic all pick them up automatically.
 *
 * Performance: event↔route matching is position-independent, so it runs ONCE
 * per (events, geometry) pair via matchDotEventsToRoute — never per GPS tick.
 * A transcontinental route can have thousands of corridor events; doing
 * closestPointOnPolyline per event-vertex per frame froze the UI thread.
 */
import type { LngLat } from "./types";
import type { DotRoadEvent } from "../services/dotRoadEvents";
import type { RouteImpact, RouteImpactSeverity } from "./routeImpacts";
import { closestPointOnPolyline, subsamplePolylineVertexBudget } from "./routeGeometry";

/** How close an event must sit to the route centerline to count as "on route". */
const CORRIDOR_HALF_WIDTH_M = 260;
/** Stage-1 centroid prefilter margin — catches events whose centroid sits off
 *  the line but whose geometry still crosses the corridor. */
const CENTROID_PREFILTER_M = 900;
/** Route vertices used for matching — full geometries can be 10k+ points. */
const MATCH_ROUTE_VERTICES = 1_200;
/** Event geometry points evaluated per event (band extent). */
const MAX_EVENT_SAMPLE_POINTS = 8;
/** Hard cap on corridor matches — bounds every downstream memo. */
const MAX_MATCHES = 800;

export type DotEventMatch = {
  id: string;
  lngLat: LngLat;
  alongMeters: number;
  startMeters: number;
  endMeters: number;
  category: RouteImpact["category"];
  severity: RouteImpactSeverity;
  driverAction: RouteImpact["driverAction"];
  driverHeadline: string;
  roadEffect: string;
  detail: string;
  numericSeverity: number;
  hazardOnsetIso: string | null;
  hazardExpiresIso: string | null;
};

function geomToLngLats(geom: GeoJSON.Geometry | null, cap = MAX_EVENT_SAMPLE_POINTS): LngLat[] {
  if (!geom) return [];
  const coords = (geom as { coordinates?: unknown }).coordinates;
  const out: LngLat[] = [];
  const walk = (c: unknown, depth: number) => {
    if (depth > 4 || !Array.isArray(c) || out.length >= cap) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      out.push([c[0], c[1]]);
      return;
    }
    /* Stride long coordinate lists so one event can't dominate the budget. */
    if (typeof c[0]?.[0] === "number") {
      const stride = Math.max(1, Math.floor(c.length / cap));
      for (let i = 0; i < c.length && out.length < cap; i += stride) {
        const p = c[i];
        if (Array.isArray(p)) out.push([p[0] as number, p[1] as number]);
      }
      return;
    }
    for (const sub of c) walk(sub, depth + 1);
  };
  walk(coords, 0);
  return out;
}

function severityFor(ev: DotRoadEvent): RouteImpactSeverity {
  const impact = (ev.vehicleImpact ?? "").toLowerCase();
  const closedAll = impact.includes("all-lanes-closed");
  const closedSome = impact.includes("some-lanes-closed") || ev.lanesClosed > 0;
  /* Truck-relevant size/weight limits deserve a bump — a car can squeeze, a truck can't. */
  const sizeLimit = /length|width|weight|load/i.test(ev.restrictionsText ?? "");
  if (ev.kind === "closure" || closedAll) return "avoid";
  if (closedSome || sizeLimit) return "serious";
  return ev.kind === "construction" ? "caution" : "info";
}

const SEVERITY_NUMERIC: Record<RouteImpactSeverity, number> = {
  info: 10,
  caution: 35,
  serious: 65,
  avoid: 90,
};

const HEADLINE_PREFIX: Record<DotRoadEvent["kind"], string> = {
  construction: "Work zone",
  closure: "Closure",
  incident: "Incident",
  other: "Road event",
};

const ROAD_EFFECT: Record<DotRoadEvent["kind"], string> = {
  construction: "Lane closures or work zone ahead — expect delays",
  closure: "Road closed ahead — check for a detour",
  incident: "Incident reported ahead — traffic may be slow",
  other: "Road condition reported ahead",
};

function fmtWindow(ev: DotRoadEvent): string {
  if (!ev.startIso && !ev.endIso) return "";
  const fmt = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : "";
  if (ev.startIso && ev.endIso)
    return ` (${fmt(ev.startIso)} – ${fmt(ev.endIso)})`;
  return ev.startIso ? ` (from ${fmt(ev.startIso)})` : ` (until ${fmt(ev.endIso)})`;
}

function categoryFor(ev: DotRoadEvent): RouteImpact["category"] {
  return ev.kind === "closure" ? "closure" : ev.kind === "incident" ? "incident" : "construction";
}

function actionFor(sev: RouteImpactSeverity): RouteImpact["driverAction"] {
  return sev === "avoid"
    ? "rerouteRecommended"
    : sev === "serious"
      ? "prepare"
      : sev === "caution"
        ? "slow"
        : "watch";
}

function detailFor(ev: DotRoadEvent): string {
  const sizeNote = ev.restrictionsText ? ` ${ev.restrictionsText}.` : "";
  const laneNote =
    ev.lanesClosed > 0 ? ` ${ev.lanesClosed} lane${ev.lanesClosed > 1 ? "s" : ""} affected.` : "";
  return (
    `${ev.publisher}: ${ev.description || ev.title}.` + sizeNote + laneNote + fmtWindow(ev)
  );
}

/**
 * Match feed events to the route corridor — run once per (events, geometry).
 * Two-stage: cheap centroid prefilter, then refine survivors against a few
 * event points for along-route position and band extent.
 */
export function matchDotEventsToRoute(
  events: DotRoadEvent[],
  routeGeometry: LngLat[]
): DotEventMatch[] {
  if (!events.length || routeGeometry.length < 2) return [];
  const matchGeom = subsamplePolylineVertexBudget(routeGeometry, MATCH_ROUTE_VERTICES);
  const matches: DotEventMatch[] = [];

  for (const ev of events) {
    /* Stage 1 — centroid vs route. */
    const centroid = closestPointOnPolyline(ev.point as LngLat, matchGeom);
    if (centroid.lateralMetersApprox > CENTROID_PREFILTER_M) continue;

    /* Stage 2 — refine with up to MAX_EVENT_SAMPLE_POINTS event vertices. */
    const pts = geomToLngLats(ev.geometry);
    const samples = pts.length ? pts : [ev.point as LngLat];
    let bestAlong = -1;
    let bestLngLat: LngLat = ev.point;
    let bestLat = Infinity;
    let minAlong = Infinity;
    let maxAlong = -Infinity;

    for (const p of samples) {
      const c = closestPointOnPolyline(p, matchGeom);
      if (c.lateralMetersApprox < bestLat) {
        bestLat = c.lateralMetersApprox;
        bestAlong = c.alongMeters;
        bestLngLat = c.lngLat;
      }
      if (c.lateralMetersApprox <= CORRIDOR_HALF_WIDTH_M) {
        if (c.alongMeters < minAlong) minAlong = c.alongMeters;
        if (c.alongMeters > maxAlong) maxAlong = c.alongMeters;
      }
    }
    if (bestLat > CORRIDOR_HALF_WIDTH_M || bestAlong < 0) continue;

    const sev = severityFor(ev);
    const banded = minAlong !== Infinity && maxAlong > minAlong;
    matches.push({
      id: `dot:${ev.id}`,
      lngLat: bestLngLat,
      alongMeters: bestAlong,
      startMeters: banded ? minAlong : bestAlong,
      endMeters: banded ? maxAlong : bestAlong,
      category: categoryFor(ev),
      severity: sev,
      driverAction: actionFor(sev),
      driverHeadline: `${HEADLINE_PREFIX[ev.kind]}${ev.status === "scheduled" ? " (scheduled)" : ""}`,
      roadEffect: ROAD_EFFECT[ev.kind],
      detail: detailFor(ev),
      numericSeverity: SEVERITY_NUMERIC[sev],
      hazardOnsetIso: ev.startIso,
      hazardExpiresIso: ev.endIso,
    });
  }

  if (matches.length > MAX_MATCHES) {
    /* Evenly thin across the route rather than dropping whole regions. */
    matches.sort((a, b) => a.alongMeters - b.alongMeters);
    const stride = matches.length / MAX_MATCHES;
    const thinned: DotEventMatch[] = [];
    for (let i = 0; i < MAX_MATCHES; i++) thinned.push(matches[Math.floor(i * stride)]!);
    return thinned;
  }
  return matches;
}

/** Position-dependent fields only — cheap enough to run per GPS tick. */
export function dotMatchesToImpacts(matches: DotEventMatch[], userAlongM: number): RouteImpact[] {
  return matches.map((m) => ({
    id: m.id,
    category: m.category,
    severity: m.severity,
    confidence: "high" as const,
    source: "dot511" as const,
    lngLat: m.lngLat,
    alongMeters: m.alongMeters,
    startMeters: m.startMeters,
    endMeters: m.endMeters,
    distanceAheadMeters: m.alongMeters - userAlongM > 0 ? m.alongMeters - userAlongM : 0,
    etaAheadMinutes: null,
    driverHeadline: m.driverHeadline,
    driverAction: m.driverAction,
    roadEffect: m.roadEffect,
    detail: m.detail,
    numericSeverity: m.numericSeverity,
    hazardOnsetIso: m.hazardOnsetIso,
    hazardExpiresIso: m.hazardExpiresIso,
    crossesRoute: true,
  }));
}

/** Convenience wrapper — tests + one-shot callers. */
export function buildDotImpacts(
  events: DotRoadEvent[],
  routeGeometry: LngLat[],
  userAlongM: number
): RouteImpact[] {
  return dotMatchesToImpacts(matchDotEventsToRoute(events, routeGeometry), userAlongM);
}
