/**
 * Convert normalized DOT/WZDx events into RouteImpact[] so they ride the same
 * pipeline as weather/traffic/incidents: progress rail, hazard card, advisory,
 * map bands, and off-route logic all pick them up automatically.
 */
import type { LngLat } from "./types";
import type { DotRoadEvent } from "../services/dotRoadEvents";
import type { RouteImpact, RouteImpactSeverity } from "./routeImpacts";
import { closestPointOnPolyline } from "./routeGeometry";

/** How close an event must sit to the route centerline to count as "on route". */
const CORRIDOR_HALF_WIDTH_M = 260;

function geomToLngLats(geom: GeoJSON.Geometry | null): LngLat[] {
  if (!geom) return [];
  const coords = (geom as { coordinates?: unknown }).coordinates;
  const out: LngLat[] = [];
  const walk = (c: unknown, depth: number) => {
    if (depth > 4 || !Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      out.push([c[0], c[1]]);
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

export function buildDotImpacts(
  events: DotRoadEvent[],
  routeGeometry: LngLat[],
  userAlongM: number,
  routeLengthM: number
): RouteImpact[] {
  if (!events.length || routeGeometry.length < 2 || routeLengthM <= 0) return [];
  const impacts: RouteImpact[] = [];

  for (const ev of events) {
    const pts = geomToLngLats(ev.geometry);
    /* Fall back to the centroid for feeds that send point-only geometry. */
    const samples = pts.length ? pts : [ev.point as LngLat];
    let bestAlong = -1;
    let bestLngLat: LngLat = ev.point;
    let bestLat = Infinity;
    let minAlong = Infinity;
    let maxAlong = -Infinity;

    for (const p of samples) {
      const c = closestPointOnPolyline(p, routeGeometry);
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

    /* Only band across-route extent when both ends sit inside the corridor. */
    const banded = minAlong !== Infinity && maxAlong > minAlong;
    const startM = banded ? minAlong : bestAlong;
    const endM = banded ? maxAlong : bestAlong;
    const aheadM = bestAlong - userAlongM;

    const sev = severityFor(ev);
    const sizeNote = ev.restrictionsText ? ` ${ev.restrictionsText}.` : "";
    const laneNote = ev.lanesClosed > 0 ? ` ${ev.lanesClosed} lane${ev.lanesClosed > 1 ? "s" : ""} affected.` : "";

    impacts.push({
      id: `dot:${ev.id}`,
      category: ev.kind === "closure" ? "closure" : ev.kind === "incident" ? "incident" : "construction",
      severity: sev,
      confidence: "high",
      source: "dot511",
      lngLat: bestLngLat,
      alongMeters: bestAlong,
      startMeters: startM,
      endMeters: endM,
      distanceAheadMeters: aheadM > 0 ? aheadM : 0,
      etaAheadMinutes: null,
      driverHeadline: `${HEADLINE_PREFIX[ev.kind]}${ev.status === "scheduled" ? " (scheduled)" : ""}`,
      driverAction:
        sev === "avoid" ? "rerouteRecommended" : sev === "serious" ? "prepare" : sev === "caution" ? "slow" : "watch",
      roadEffect: ROAD_EFFECT[ev.kind],
      detail:
        `${ev.publisher}: ${ev.description || ev.title}.` +
        sizeNote +
        laneNote +
        fmtWindow(ev),
      numericSeverity: SEVERITY_NUMERIC[sev],
      hazardOnsetIso: ev.startIso,
      hazardExpiresIso: ev.endIso,
      crossesRoute: true,
    });
  }

  return impacts;
}
