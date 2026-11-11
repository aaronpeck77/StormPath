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
import {
  closestPointOnPolyline,
  haversineMeters,
  pointAtAlongMeters,
  subsamplePolylineVertexBudget,
} from "./routeGeometry";

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
/** Merge matches this close on the route (direction splits, feed dupes, zone segments). */
const CLUSTER_GAP_M = 2_500;
/** Never let a cluster grow past this along-route span. */
const CLUSTER_MAX_SPAN_M = 12_000;
/** Cross-source (Mapbox incident vs DOT) merge window. */
export const DOT_MAPBOX_MERGE_ALONG_M = 2_500;
export const DOT_MAPBOX_MERGE_GEO_M = 4_000;

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
  /** Back-reference for cluster merging. */
  event: DotRoadEvent;
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
  /* Per-lane detail beats the coarse count: a closed shoulder is not a lane
   * closure for a car. Falls back to legacy counting when the feed (or an
   * older worker snapshot) doesn't publish travelLanesClosed. */
  const closedSome =
    ev.travelLanesClosed != null
      ? ev.travelLanesClosed > 0
      : impact.includes("some-lanes-closed") || ev.lanesClosed > 0;
  /* Truck-relevant size/weight limits deserve a bump — a car can squeeze, a truck can't. */
  const sizeLimit = /length|width|weight|load/i.test(ev.restrictionsText ?? "");
  if (ev.kind === "closure" || closedAll) return "avoid";
  if (closedSome || sizeLimit) return "serious";
  /* DOT condition reports (IL/IA winter road conditions) — vehicleImpact carries
   * the condition slug ("completely-covered", "ice", "partially-covered",
   * "travel-not-advised", "impassable"). Impassable is avoid; ice/full
   * coverage and no-travel advisories are serious; partial coverage is caution. */
  if (ev.kind === "condition") {
    if (/impassable/.test(impact)) return "avoid";
    if (/not-advised/.test(impact)) return "serious";
    return /ice|completely|full|packed|snow-?pack/i.test(impact) ? "serious" : "caution";
  }
  return ev.kind === "construction" ? "caution" : "info";
}

export const DOT_SEVERITY_NUMERIC: Record<RouteImpactSeverity, number> = {
  info: 10,
  caution: 35,
  serious: 65,
  avoid: 90,
};

const HEADLINE_PREFIX: Record<DotRoadEvent["kind"], string> = {
  construction: "Work zone",
  closure: "Closure",
  incident: "Incident",
  condition: "Winter condition",
  other: "Road event",
};

const ROAD_EFFECT: Record<DotRoadEvent["kind"], string> = {
  construction: "Lane closures or work zone ahead — expect delays",
  closure: "Road closed ahead — check for a detour",
  incident: "Incident reported ahead — traffic may be slow",
  condition: "Winter road condition ahead — drive for conditions",
  other: "Road condition reported ahead",
};

/**
 * Glanceable row text — effect clause plus the work type when the feed
 * publishes one ("Intersection improvements", "New pavement"). This is the
 * ONLY DOT text list surfaces show; the long publisher/date/lane blob stays
 * in `detail` for the tapped hazard sheet (Bill, 585: rows must be
 * absolutely short — what it is when I get there, not feed metadata).
 */
function roadEffectFor(ev: DotRoadEvent): string {
  const base = ROAD_EFFECT[ev.kind];
  const wt = (ev.workType ?? "").trim();
  return wt ? `${base} · ${wt}` : base;
}

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
  /* DOT condition reports (winter ice/snow coverage) share the "winter"
   * category NWS winter warnings already use — same driver meaning. */
  if (ev.kind === "condition") return "winter";
  return ev.kind === "closure" ? "closure" : ev.kind === "incident" ? "incident" : "construction";
}

function actionFor(sev: RouteImpactSeverity, kind?: DotRoadEvent["kind"]): RouteImpact["driverAction"] {
  if (sev === "avoid") return "rerouteRecommended";
  /* Serious road events (lane closures, size limits, closures) get a bypass
   * offer — pickTrafficBypassAnchorImpact needs rerouteAvailable+. */
  if (sev === "serious") return kind === "closure" ? "rerouteRecommended" : "rerouteAvailable";
  return sev === "caution" ? "slow" : "watch";
}

function detailFor(ev: DotRoadEvent): string {
  const dirNote = ev.direction ? ` · ${ev.direction.replace(/-/g, " ")}` : "";
  const sizeNote = ev.restrictionsText ? ` ${ev.restrictionsText}.` : "";
  const laneNote = ev.laneSummary
    ? ` ${ev.laneSummary}.`
    : ev.lanesClosed > 0
      ? ` ${ev.lanesClosed} lane${ev.lanesClosed > 1 ? "s" : ""} affected.`
      : "";
  const workNote = ev.workType ? ` ${ev.workType}.` : "";
  /* "Reported <date>" — the feed's own last-updated stamp. A months-old
   * report or not-yet-started window reads honestly instead of looking live. */
  const reportedMs = ev.updatedIso ? Date.parse(ev.updatedIso) : NaN;
  const reportedNote = Number.isFinite(reportedMs)
    ? ` Reported ${new Date(reportedMs).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })}.`
    : "";
  return (
    `${ev.publisher}${dirNote}: ${ev.description || ev.title}.` +
    sizeNote +
    laneNote +
    workNote +
    fmtWindow(ev) +
    reportedNote
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
      driverAction: actionFor(sev, ev.kind),
      driverHeadline: `${HEADLINE_PREFIX[ev.kind]}${ev.status === "scheduled" ? " (scheduled)" : ""}`,
      roadEffect: roadEffectFor(ev),
      detail: detailFor(ev),
      numericSeverity: DOT_SEVERITY_NUMERIC[sev],
      hazardOnsetIso: ev.startIso,
      hazardExpiresIso: ev.endIso,
      event: ev,
    });
  }

  const clustered = clusterDotMatches(matches, matchGeom);
  if (clustered.length <= MAX_MATCHES) return clustered;
  /* Evenly thin across the route rather than dropping whole regions. */
  const sorted = [...clustered].sort((a, b) => a.alongMeters - b.alongMeters);
  const stride = sorted.length / MAX_MATCHES;
  const thinned: DotEventMatch[] = [];
  for (let i = 0; i < MAX_MATCHES; i++) thinned.push(sorted[Math.floor(i * stride)]!);
  return thinned;
}

/* ── Cluster merging ────────────────────────────────────────────────────────
 * WZDx splits one physical work zone into per-direction features, multiple
 * state/county feeds overlap, and long zones arrive as segments — all become
 * separate timeline rows ("332 mi … 334 mi … 335 mi"). Merge matches that sit
 * on the same road reach: same category, compatible road key, near each other
 * along the route, bounded total span.
 */

/** "I-80" / "I 80" / "I80" / "Interstate 80" → "I-80"; falls back to cleaned name. */
function roadKeyOf(name: string): string {
  const n = name.toUpperCase();
  const ref = n.match(
    /\b(?:I|US|SR|CR|STATE\s+ROAD|STATE\s+ROUTE|COUNTY\s+ROAD|FM|RM|RT|HIGHWAY|HWY)\s*[- ]?\s*(\d+[A-Z]?)\b/
  );
  if (ref) {
    const prefix = /\bI\b/.test(n.slice(0, ref.index)) ? "I" : ref[0].match(/^[A-Z]+/)![0];
    return `${prefix}-${ref[1]}`;
  }
  return n.replace(/\s+/g, " ").trim();
}

function roadKeysCompatible(a: string, b: string): boolean {
  if (!a || !b) return true; /* unnamed roads merge on proximity alone */
  return a === b;
}

const KIND_RANK: Record<DotRoadEvent["kind"], number> = {
  other: 0,
  condition: 1,
  construction: 1,
  incident: 2,
  closure: 3,
};

function worstVehicleImpact(values: (string | null)[]): string | null {
  const rank = (v: string | null) => {
    const s = (v ?? "").toLowerCase();
    if (s.includes("all-lanes-closed")) return 3;
    if (s.includes("some-lanes-closed")) return 2;
    if (s.includes("reduced")) return 1;
    return 0;
  };
  let best: string | null = null;
  let bestRank = -1;
  for (const v of values) {
    const r = rank(v);
    if (r > bestRank) {
      bestRank = r;
      best = v;
    }
  }
  return bestRank > 0 ? best : values.find((v) => v) ?? null;
}

/** Merge several feed events into one synthetic event for detail/severity. */
function mergeDotEvents(events: DotRoadEvent[]): DotRoadEvent {
  const sorted = [...events].sort((a, b) => KIND_RANK[b.kind] - KIND_RANK[a.kind]);
  const first = sorted[0]!;
  const publishers = [...new Set(events.map((e) => e.publisher).filter(Boolean))];
  const directions = [...new Set(events.map((e) => e.direction).filter((d): d is string => Boolean(d)))];
  const restrictions = [
    ...new Set(
      events
        .flatMap((e) => (e.restrictionsText ?? "").split(";").map((s) => s.trim()).filter(Boolean))
    ),
  ];
  const descriptions = events
    .map((e) => e.description)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const starts = events.map((e) => e.startIso).filter((s): s is string => Boolean(s)).sort();
  const ends = events.map((e) => e.endIso).filter((s): s is string => Boolean(s)).sort();

  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const points: [number, number][] = [];
  for (const ev of events) {
    const [bw, bs, be, bn] = ev.bbox;
    if (bw < w) w = bw;
    if (bs < s) s = bs;
    if (be > e) e = be;
    if (bn > n) n = bn;
    points.push(ev.point);
  }
  const cx = points.reduce((a, p) => a + p[0], 0) / points.length;
  const cy = points.reduce((a, p) => a + p[1], 0) / points.length;

  const travelClosedVals = events
    .map((e) => e.travelLanesClosed)
    .filter((v): v is number => v != null);
  const laneSummaries = [
    ...new Set(events.map((e) => e.laneSummary).filter((s): s is string => Boolean(s))),
  ].slice(0, 2);
  const workType = events.map((e) => e.workType).find((w): w is string => Boolean(w)) ?? null;

  return {
    ...first,
    id: first.id,
    publisher: publishers.join(" + ") || first.publisher,
    kind: first.kind,
    status: events.some((ev) => ev.status === "active") ? "active" : "scheduled",
    direction: directions.length ? directions.join(" / ") : first.direction,
    description: descriptions[0] ?? first.description,
    restrictionsText: restrictions.length ? restrictions.join("; ") : null,
    lanesClosed: Math.max(...events.map((ev) => ev.lanesClosed)),
    travelLanesClosed: travelClosedVals.length
      ? Math.max(...travelClosedVals)
      : first.travelLanesClosed,
    laneSummary: laneSummaries.length
      ? laneSummaries.join("; ")
      : (first.laneSummary ?? null),
    workType: workType ?? first.workType ?? null,
    vehicleImpact: worstVehicleImpact(events.map((ev) => ev.vehicleImpact)),
    startIso: starts[0] ?? first.startIso,
    endIso: ends[ends.length - 1] ?? first.endIso,
    updatedIso:
      events
        .map((e) => e.updatedIso)
        .filter((s): s is string => Boolean(s))
        .sort()
        .at(-1) ?? first.updatedIso ?? null,
    point: [cx, cy],
    bbox: [w, s, e, n],
    geometry: null,
  };
}

function matchFromEvent(
  ev: DotRoadEvent,
  alongM: number,
  lngLat: LngLat,
  spanStart: number,
  spanEnd: number
): DotEventMatch {
  const sev = severityFor(ev);
  return {
    id: `dot:${ev.id}`,
    lngLat,
    alongMeters: alongM,
    startMeters: spanStart,
    endMeters: spanEnd,
    category: categoryFor(ev),
    severity: sev,
    driverAction: actionFor(sev, ev.kind),
    driverHeadline: `${HEADLINE_PREFIX[ev.kind]}${ev.status === "scheduled" ? " (scheduled)" : ""}`,
    roadEffect: roadEffectFor(ev),
    detail: detailFor(ev),
    numericSeverity: DOT_SEVERITY_NUMERIC[sev],
    hazardOnsetIso: ev.startIso,
    hazardExpiresIso: ev.endIso,
    event: ev,
  };
}

/** Merge adjacent compatible matches into single corridor entries. */
export function clusterDotMatches(matches: DotEventMatch[], routeGeom: LngLat[]): DotEventMatch[] {
  if (matches.length <= 1) return matches;
  const sorted = [...matches].sort((a, b) => a.startMeters - b.startMeters);
  const out: DotEventMatch[] = [];
  let cluster: DotEventMatch[] = [sorted[0]!];

  const flush = () => {
    if (cluster.length === 1) {
      out.push(cluster[0]!);
    } else {
      const merged = mergeDotEvents(cluster.map((m) => m.event));
      const spanStart = Math.min(...cluster.map((m) => m.startMeters));
      const spanEnd = Math.max(...cluster.map((m) => m.endMeters));
      const mid = (spanStart + spanEnd) / 2;
      out.push(
        matchFromEvent(merged, mid, pointAtAlongMeters(routeGeom, mid), spanStart, spanEnd)
      );
    }
    cluster = [];
  };

  for (let i = 1; i < sorted.length; i++) {
    const prev = cluster[cluster.length - 1]!;
    const cur = sorted[i]!;
    const prevKey = roadKeyOf(prev.event.roadName || prev.event.title);
    const curKey = roadKeyOf(cur.event.roadName || cur.event.title);
    const gap = cur.startMeters - prev.endMeters;
    const span = Math.max(prev.endMeters, cur.endMeters) - Math.min(cluster[0]!.startMeters, cur.startMeters);
    const sameKind = prev.event.kind === cur.event.kind || prev.category === cur.category;
    if (
      sameKind &&
      roadKeysCompatible(prevKey, curKey) &&
      gap <= CLUSTER_GAP_M &&
      span <= CLUSTER_MAX_SPAN_M
    ) {
      cluster.push(cur);
    } else {
      flush();
      cluster = [cur];
    }
  }
  flush();
  return out;
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

/* ── Cross-source dedup: Mapbox incident vs official DOT event ──────────────
 * The same work zone arrives twice: once as a Mapbox Directions incident
 * (red band, vague "Construction zone") and once as a WZDx event (orange,
 * rich detail). When they sit on the same spot, keep the DOT row and fold
 * the Mapbox text into its detail — one message instead of two warnings.
 */

function categoriesMergeable(a: RouteImpact["category"], b: RouteImpact["category"]): boolean {
  if (a === b) return true;
  const pair = new Set([a, b]);
  return pair.has("construction") && pair.has("closure");
}

function firstSentence(text: string): string {
  return (text.split(/(?<=[.!?])\s+/)[0] ?? text).replace(/[.]+$/, "").trim();
}

/**
 * Remove Mapbox-incident impacts that duplicate a DOT impact on the route.
 * Mutates the surviving DOT impact's detail; returns the filtered list.
 */
export function reconcileDotMapboxImpacts(impacts: RouteImpact[]): RouteImpact[] {
  const dots = impacts.filter((i) => i.source === "dot511");
  if (!dots.length) return impacts;
  const drop = new Set<string>();
  for (const imp of impacts) {
    if (imp.source !== "mapboxIncident") continue;
    const twin = dots.find(
      (d) =>
        categoriesMergeable(d.category, imp.category) &&
        Math.abs(d.alongMeters - imp.alongMeters) <= DOT_MAPBOX_MERGE_ALONG_M &&
        haversineMeters(d.lngLat, imp.lngLat) <= DOT_MAPBOX_MERGE_GEO_M
    );
    if (!twin) continue;
    const extra = firstSentence(imp.detail || imp.driverHeadline);
    if (extra && !twin.detail.toLowerCase().includes(extra.toLowerCase().slice(0, 24))) {
      twin.detail = `${twin.detail} Also reported: ${extra}.`;
    }
    drop.add(imp.id);
  }
  return drop.size ? impacts.filter((i) => !drop.has(i.id)) : impacts;
}
