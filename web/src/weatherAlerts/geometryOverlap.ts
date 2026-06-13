import type { LngLat } from "../nav/types";
import {
  buildCumulativeDistances,
  pointAtAlongMeters,
  polylineLengthMeters,
  slicePolylineBetweenAlongForDisplay,
  subsamplePolylineVertexBudget,
} from "../nav/routeGeometry";
import { isLongTripRoute } from "../utils/dataSaver";
import { nwsMapKindFromEvent, nwsMapKindHex, type NwsMapKind } from "./nwsMapKind";
import type { NormalizedWeatherAlert, RouteOverlapResult } from "./types";

/** Expand a W/S/E/N bbox by `padDeg` on each side. */
export function expandBbox(
  west: number,
  south: number,
  east: number,
  north: number,
  padDeg: number
): [number, number, number, number] {
  return [west - padDeg, south - padDeg, east + padDeg, north + padDeg];
}

export function polylineBbox(geometry: LngLat[]): { west: number; south: number; east: number; north: number } | null {
  if (!geometry.length) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of geometry) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return { west, south, east, north };
}

export function bboxIntersects(
  a: { west: number; south: number; east: number; north: number },
  b: { west: number; south: number; east: number; north: number }
): boolean {
  return !(a.east < b.west || a.west > b.east || a.north < b.south || a.south > b.north);
}

function ringBbox(ring: GeoJSON.Position[]): { west: number; south: number; east: number; north: number } | null {
  if (ring.length < 3) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const p of ring) {
    const lng = p[0]!;
    const lat = p[1]!;
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return { west, south, east, north };
}

/** Ray-cast point in polygon (first ring = outer boundary). */
export function pointInRing(lng: number, lat: number, ring: GeoJSON.Position[]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!;
    const yi = ring[i]![1]!;
    const xj = ring[j]![0]!;
    const yj = ring[j]![1]!;
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInPolygonCoords(lng: number, lat: number, coordinates: GeoJSON.Position[][]): boolean {
  if (!coordinates[0]?.length) return false;
  const outer = coordinates[0]!;
  if (!pointInRing(lng, lat, outer)) return false;
  /* Holes: if in a hole, not inside */
  for (let h = 1; h < coordinates.length; h++) {
    const hole = coordinates[h]!;
    if (hole.length >= 3 && pointInRing(lng, lat, hole)) return false;
  }
  return true;
}

export function pointInMultiPolygon(lng: number, lat: number, mp: GeoJSON.MultiPolygon): boolean {
  for (const poly of mp.coordinates) {
    if (pointInPolygonCoords(lng, lat, poly)) return true;
  }
  return false;
}

export function pointInAnyPolygonGeometry(
  lng: number,
  lat: number,
  g: GeoJSON.Polygon | GeoJSON.MultiPolygon
): boolean {
  if (g.type === "Polygon") {
    return pointInPolygonCoords(lng, lat, g.coordinates);
  }
  return pointInMultiPolygon(lng, lat, g);
}

/** Dense enough for long highway legs; capped so cross-country routes stay bounded. */
const POLYLINE_INTERSECT_MIN_STEP_M = 850;
const POLYLINE_INTERSECT_MAX_SAMPLES = 220;
const POLYLINE_INTERSECT_MAX_SAMPLES_LONG = 120;

function polylineIntersectMaxSamples(totalM: number): number {
  return isLongTripRoute(totalM) ? POLYLINE_INTERSECT_MAX_SAMPLES_LONG : POLYLINE_INTERSECT_MAX_SAMPLES;
}

/**
 * True if any sample along the polyline lies inside the polygon (after bbox precheck).
 */
export function polylineIntersectsPolygon(
  route: LngLat[],
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
): boolean {
  if (route.length < 2) return false;
  const outer =
    geometry.type === "Polygon" ? geometry.coordinates[0] : geometry.coordinates[0]?.[0];
  if (!outer?.length) return false;
  const pb = ringBbox(outer);
  const rb = polylineBbox(route);
  if (!pb || !rb || !bboxIntersects(rb, pb)) return false;

  const total = polylineLengthMeters(route);
  if (total < 50) {
    return pointInAnyPolygonGeometry(route[0]![0], route[0]![1], geometry);
  }
  const step = Math.max(
    POLYLINE_INTERSECT_MIN_STEP_M,
    Math.ceil(total / polylineIntersectMaxSamples(total))
  );
  for (let m = 0; m <= total; m += step) {
    const p = pointAtAlongMeters(route, Math.min(m, total - 0.01));
    if (pointInAnyPolygonGeometry(p[0], p[1], geometry)) return true;
  }
  const last = route[route.length - 1]!;
  return pointInAnyPolygonGeometry(last[0], last[1], geometry);
}

const OVERLAP_VERTEX_CAP = 160;
const OVERLAP_LONG_ROUTE_M = 200_000;

function routeForOverlapChecks(route: LngLat[]): LngLat[] {
  const totalM = polylineLengthMeters(route);
  if (route.length <= OVERLAP_VERTEX_CAP && totalM < OVERLAP_LONG_ROUTE_M) return route;
  return subsamplePolylineVertexBudget(route, OVERLAP_VERTEX_CAP);
}

function geometryBbox(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
): { west: number; south: number; east: number; north: number } | null {
  const outer =
    geometry.type === "Polygon" ? geometry.coordinates[0] : geometry.coordinates[0]?.[0];
  return outer?.length ? ringBbox(outer) : null;
}

/**
 * True when a point is inside the polygon or within ~`bufferM` of its outer bbox (warnings
 * “ahead” on the corridor often sit just beside a sparse route polyline).
 */
export function pointNearPolygonGeometry(
  lng: number,
  lat: number,
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  bufferM: number
): boolean {
  if (pointInAnyPolygonGeometry(lng, lat, geometry)) return true;
  const b = geometryBbox(geometry);
  if (!b) return false;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const latM = Math.max(0, b.south - lat, lat - b.north) * 111_000;
  const lngM = Math.max(0, b.west - lng, lng - b.east) * 111_000 * Math.max(0.25, cosLat);
  return Math.hypot(latM, lngM) <= bufferM;
}

/**
 * Route intersects the polygon, or passes within `lateralBufferM` (default ~28 mi) — captures
 * Severe Thunderstorm Warning areas you are entering before rain appears on radar.
 */
export function polylineNearPolygon(
  route: LngLat[],
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  lateralBufferM = 45_000
): boolean {
  if (route.length < 2) return false;
  if (polylineIntersectsPolygon(route, geometry)) return true;
  const pb = geometryBbox(geometry);
  const rb = polylineBbox(route);
  if (!pb || !rb) return false;
  const padDeg = lateralBufferM / 111_000;
  const [rw, rs, re, rn] = expandBbox(rb.west, rb.south, rb.east, rb.north, padDeg);
  if (!bboxIntersects({ west: rw, south: rs, east: re, north: rn }, pb)) return false;
  const total = polylineLengthMeters(route);
  const maxSamples = polylineIntersectMaxSamples(total);
  const step = Math.max(
    POLYLINE_INTERSECT_MIN_STEP_M,
    Math.ceil(total / maxSamples)
  );
  for (let m = 0; m <= total; m += step) {
    const p = pointAtAlongMeters(route, Math.min(m, total - 0.01));
    if (pointNearPolygonGeometry(p[0]!, p[1]!, geometry, lateralBufferM)) return true;
  }
  const last = route[route.length - 1]!;
  return pointNearPolygonGeometry(last[0], last[1], geometry, lateralBufferM);
}

/** Storm-based warnings can be small vs a long highway — use a wider “near path” band. */
const CONVECTIVE_NEAR_ROUTE_BUFFER_M = 85_000;

function nearRouteBufferM(a: NormalizedWeatherAlert, defaultM: number): number {
  const ev = a.event?.trim() ?? "";
  if (
    /tornado warning|tornado watch|severe thunderstorm warning|severe thunderstorm watch/i.test(ev)
  ) {
    return Math.max(defaultM, CONVECTIVE_NEAR_ROUTE_BUFFER_M);
  }
  if (/flood warning|flash flood warning|flash flood watch|flood watch/i.test(ev)) {
    return Math.max(defaultM, CONVECTIVE_NEAR_ROUTE_BUFFER_M);
  }
  return defaultM;
}

/** Alerts that touch the route or sit on the corridor ahead (not only strict polyline ∩ polygon). */
export function filterAlertsAffectingRoute(
  route: LngLat[],
  alerts: NormalizedWeatherAlert[],
  lateralBufferM = 45_000
): NormalizedWeatherAlert[] {
  if (!route.length || !alerts.length) return [];
  const routeForCheck = routeForOverlapChecks(route);
  const routeBox = polylineBbox(routeForCheck);
  const overlap = computeRouteOverlapWithAlerts(routeForCheck, alerts);
  const ids = new Set(overlap.overlappingIds);
  const out: NormalizedWeatherAlert[] = [];
  for (const a of alerts) {
    if (ids.has(a.id)) {
      out.push(a);
      continue;
    }
    if (!a.geometry) continue;
    if (routeBox) {
      const ab = geometryBbox(a.geometry);
      if (ab) {
        const padDeg = lateralBufferM / 111_000;
        const [rw, rs, re, rn] = expandBbox(routeBox.west, routeBox.south, routeBox.east, routeBox.north, padDeg);
        if (
          !bboxIntersects(
            { west: rw, south: rs, east: re, north: rn },
            ab
          )
        ) {
          continue;
        }
      }
    }
    if (
      polylineNearPolygon(routeForCheck, a.geometry, nearRouteBufferM(a, lateralBufferM))
    ) {
      ids.add(a.id);
      out.push(a);
    }
  }
  return out;
}

export function computeRouteOverlapWithAlerts(
  route: LngLat[],
  alerts: NormalizedWeatherAlert[]
): RouteOverlapResult {
  const overlappingIds: string[] = [];
  let overlapLngLat: LngLat | null = null;

  const routeForCheck = routeForOverlapChecks(route);

  for (const a of alerts) {
    if (!a.geometry) continue;
    if (polylineIntersectsPolygon(routeForCheck, a.geometry)) {
      overlappingIds.push(a.id);
      if (!overlapLngLat) {
        const total = polylineLengthMeters(routeForCheck);
        const mid = pointAtAlongMeters(routeForCheck, Math.min(total / 2, total - 0.01));
        if (pointInAnyPolygonGeometry(mid[0], mid[1], a.geometry)) overlapLngLat = mid;
        else overlapLngLat = routeForCheck[Math.floor(routeForCheck.length / 2)] ?? mid;
      }
    }
  }
  return { overlappingIds, overlapLngLat };
}

const STORM_ROUTE_SAMPLE_STEP_M = 110;
/** Avoid thousands of samples on long routes (strip + map overlap lines). */
const STORM_ROUTE_MAX_SAMPLES = 40;
const STORM_ROUTE_MAX_SAMPLES_LONG = 28;

function stormRouteMaxSamples(totalM: number): number {
  return isLongTripRoute(totalM) ? STORM_ROUTE_MAX_SAMPLES_LONG : STORM_ROUTE_MAX_SAMPLES;
}

const NWS_SEVERITY_RANK: Record<string, number> = {
  Unknown: 0,
  Minor: 1,
  Moderate: 2,
  Severe: 3,
  Extreme: 4,
};

/** Higher = more urgent (for ordering advisory UI). */
export function rankNwsSeverity(severity: string): number {
  return NWS_SEVERITY_RANK[severity] ?? 0;
}

/** Worst-first so the top of the list is what drivers should read first. */
export function sortWeatherAlertsBySeverity(alerts: NormalizedWeatherAlert[]): NormalizedWeatherAlert[] {
  return [...alerts].sort((a, b) => rankNwsSeverity(b.severity) - rankNwsSeverity(a.severity));
}

const NWS_MAP_KIND_SET = new Set<NwsMapKind>([
  "hydro",
  "winter",
  "fire",
  "convective",
  "marine",
  "wind",
  "heat",
  "vis",
  "other",
]);

/** Route overlap line / map tint — kind when known, else severity (see {@link mapWeatherAlertLayers}). */
export function nwsAlertLineHexFromMapFeatureProps(props: {
  kind?: string;
  event?: string;
  severity?: string;
}): string {
  const k = props.kind;
  if (k && NWS_MAP_KIND_SET.has(k as NwsMapKind) && k !== "other") {
    return nwsMapKindHex(k as NwsMapKind);
  }
  const fromEvent = nwsMapKindFromEvent(props.event ?? "");
  if (fromEvent !== "other") return nwsMapKindHex(fromEvent);
  return nwsAlertLineColorHex(props.severity ?? "Moderate");
}

/** Line color for route / strip — aligned with {@link mapWeatherAlertLayers} polygon outline. */
export function nwsAlertLineColorHex(severity: string): string {
  switch (severity) {
    case "Extreme":
      return "#991b1b";
    case "Severe":
      return "#ea580c";
    case "Moderate":
      return "#ca8a04";
    case "Minor":
      return "#64748b";
    default:
      return "#94a3b8";
  }
}

function worseNwsSeverity(a: string, b: string): string {
  const ra = NWS_SEVERITY_RANK[a] ?? 0;
  const rb = NWS_SEVERITY_RANK[b] ?? 0;
  return ra >= rb ? a : b;
}

function alongIntervalsInsidePolygon(
  route: LngLat[],
  poly: GeoJSON.Polygon | GeoJSON.MultiPolygon
): [number, number][] {
  const total = polylineLengthMeters(route);
  if (total < 15 || route.length < 2) return [];

  const outer =
    poly.type === "Polygon" ? poly.coordinates[0] : poly.coordinates[0]?.[0];
  if (!outer?.length) return [];
  const pb = ringBbox(outer);
  const rb = polylineBbox(route);
  if (!pb || !rb || !bboxIntersects(rb, pb)) return [];

  const step = Math.max(STORM_ROUTE_SAMPLE_STEP_M, Math.ceil(total / stormRouteMaxSamples(total)));
  const samples: number[] = [];
  for (let m = 0; m <= total; m += step) {
    samples.push(Math.min(m, total));
  }
  if (samples[samples.length - 1]! < total) samples.push(total);

  const inside = samples.map((mm) => {
    const p = pointAtAlongMeters(route, mm);
    return pointInAnyPolygonGeometry(p[0], p[1], poly);
  });

  const intervals: [number, number][] = [];
  let start: number | null = null;
  for (let i = 0; i < inside.length; i++) {
    if (inside[i]) {
      if (start === null) start = samples[i]!;
    } else if (start !== null) {
      const end = samples[i - 1]!;
      if (end - start > 8) intervals.push([start, end]);
      start = null;
    }
  }
  if (start !== null) {
    const end = samples[samples.length - 1]!;
    if (end - start > 8) intervals.push([start, end]);
  }
  return intervals;
}

/** GeoJSON lines where warning polygons intersect the route polyline. */
export function stormOverlapLineFeatures(
  route: LngLat[],
  collection: GeoJSON.FeatureCollection | null | undefined
): GeoJSON.Feature<GeoJSON.LineString>[] {
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  if (!collection?.features?.length || route.length < 2) return features;
  const total = polylineLengthMeters(route);

  for (const f of collection.features) {
    const g = f.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
    const poly = g as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    const props = (f.properties ?? {}) as { kind?: string; event?: string; severity?: string };
    const hex = nwsAlertLineHexFromMapFeatureProps(props);
    for (const [lo, hi] of alongIntervalsInsidePolygon(route, poly)) {
      const coords = slicePolylineBetweenAlongForDisplay(route, lo, hi, total);
      if (coords.length < 2) continue;
      features.push({
        type: "Feature",
        properties: { highlightKind: "nws", lineHex: hex },
        geometry: { type: "LineString", coordinates: coords },
      });
    }
  }
  return features;
}

/** Spans for the trip progress strip (same storm coverage as map lines). */
export function stormAlongBandsForProgressStrip(
  route: LngLat[],
  collection: GeoJSON.FeatureCollection | null | undefined
): { startM: number; endM: number; lineHex: string; severity: string }[] {
  if (!collection?.features?.length || route.length < 2) return [];
  const total = polylineLengthMeters(route);
  if (total < 15) return [];

  const step = Math.max(STORM_ROUTE_SAMPLE_STEP_M, Math.ceil(total / stormRouteMaxSamples(total)));
  const samples: number[] = [];
  for (let m = 0; m <= total; m += step) {
    samples.push(Math.min(m, total));
  }
  if (samples[samples.length - 1]! < total) samples.push(total);

  const sevAt = samples.map((mm) => {
    const p = pointAtAlongMeters(route, mm);
    let best = "";
    for (const f of collection.features) {
      const g = f.geometry;
      if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
      if (!pointInAnyPolygonGeometry(p[0], p[1], g as GeoJSON.Polygon | GeoJSON.MultiPolygon))
        continue;
      const s = String((f.properties as { severity?: string })?.severity ?? "Moderate");
      best = best ? worseNwsSeverity(best, s) : s;
    }
    return best;
  });

  const bands: { startM: number; endM: number; lineHex: string; severity: string }[] = [];
  let runStart: number | null = null;
  let runSev = "";

  const flush = (endM: number) => {
    if (runStart !== null && runSev && endM > runStart + 5) {
      bands.push({
        startM: runStart,
        endM,
        lineHex: nwsAlertLineColorHex(runSev),
        severity: runSev,
      });
    }
    runStart = null;
    runSev = "";
  };

  for (let i = 0; i < sevAt.length; i++) {
    const s = sevAt[i]!;
    const mm = samples[i]!;
    if (s) {
      if (runStart === null) {
        runStart = mm;
        runSev = s;
      } else {
        runSev = worseNwsSeverity(runSev, s);
      }
    } else if (runStart !== null) {
      flush(i > 0 ? samples[i - 1]! : mm);
    }
  }
  if (runStart !== null) flush(samples[samples.length - 1]!);

  return bands;
}

/** Average-coordinate centroid of the first ring of a Polygon/MultiPolygon. */
export function polygonApproxCentroid(g: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number] {
  const ring = g.type === "Polygon" ? g.coordinates[0] : g.coordinates[0]?.[0];
  if (!ring?.length) return [0, 0];
  let sumLng = 0, sumLat = 0;
  for (const [lng, lat] of ring) { sumLng += lng!; sumLat += lat!; }
  return [sumLng / ring.length, sumLat / ring.length];
}

/** Return the along-route distance (meters) of the sample point closest to `lngLat`. */
export function closestAlongMeters(route: LngLat[], lngLat: LngLat, cumDist?: Float64Array): number {
  const total = cumDist?.length
    ? cumDist[cumDist.length - 1]!
    : polylineLengthMeters(route);
  const step = Math.max(STORM_ROUTE_SAMPLE_STEP_M, Math.ceil(total / stormRouteMaxSamples(total)));
  let bestDist = Infinity;
  let bestM = total / 2;
  for (let m = 0; m <= total; m += step) {
    const mm = Math.min(m, total);
    const p = pointAtAlongMeters(route, mm, cumDist);
    const dlng = p[0] - lngLat[0], dlat = p[1] - lngLat[1];
    const d2 = dlng * dlng + dlat * dlat;
    if (d2 < bestDist) { bestDist = d2; bestM = mm; }
  }
  return bestM;
}

/** Minimum strip half-width (meters) used when the polygon clips the route so thinly that
 *  point sampling misses the intersection. Represents ~5 km on each side. */
const FALLBACK_STRIP_HALF_M = 5_000;

/**
 * Find where a single alert polygon intersects the route — returns `{ startM, endM }`.
 * Returns `null` only if the route truly doesn't pass through or near the polygon.
 *
 * Unlike {@link stormAlongBandsForProgressStrip} this is per-alert so multiple overlapping
 * alerts each get their own independent start/end meters for strip rendering.
 *
 * When point-sampling misses a thin polygon clip (route barely enters/exits within one
 * sample interval), falls back to a centroid-based estimate so every intersecting alert
 * still gets a visible strip.
 */
export function alertRouteIntersectionMeters(
  route: LngLat[],
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  cumDist?: Float64Array
): { startM: number; endM: number } | null {
  if (route.length < 2) return null;
  const total = cumDist?.length
    ? cumDist[cumDist.length - 1]!
    : polylineLengthMeters(route);
  if (total < 15) return null;

  const step = Math.max(STORM_ROUTE_SAMPLE_STEP_M, Math.ceil(total / stormRouteMaxSamples(total)));
  const samples: number[] = [];
  for (let m = 0; m <= total; m += step) samples.push(Math.min(m, total));
  if (samples[samples.length - 1]! < total) samples.push(total);

  let startM: number | null = null;
  let endM: number | null = null;

  for (const mm of samples) {
    const p = pointAtAlongMeters(route, mm, cumDist);
    if (pointInAnyPolygonGeometry(p[0], p[1], geometry)) {
      if (startM === null) startM = mm;
      endM = mm;
    }
  }

  if (startM !== null && endM !== null && endM > startM + 5) {
    return { startM, endM };
  }

  // Sampling missed the intersection (polygon clips route too thinly).
  // Fall back: place a strip centred on the route point closest to the polygon centroid.
  if (!polylineIntersectsPolygon(route, geometry)) return null;
  const centroid = polygonApproxCentroid(geometry);
  const midM = closestAlongMeters(route, centroid as LngLat, cumDist);
  return {
    startM: Math.max(0, midM - FALLBACK_STRIP_HALF_M),
    endM: Math.min(total, midM + FALLBACK_STRIP_HALF_M),
  };
}

/** Per-alert storm spans along a route — shared by advisory timeline, progress strip, and map highlights. */
export type RouteStormStripBand = {
  id: string;
  event: string;
  impactSeverity: "info" | "caution" | "serious" | "avoid";
  nwsSeverity: string;
  startMeters: number;
  endMeters: number;
  expiresIso: string | null;
  alertId: string | null;
  crossesRoute: boolean;
  /** Precise polyline intersection vs cheap centroid preview for distant ahead weather. */
  detailTier: "precise" | "coarse";
};

function impactSeverityFromNws(rawSev: string): RouteStormStripBand["impactSeverity"] {
  if (rawSev === "Extreme") return "avoid";
  if (rawSev === "Severe") return "serious";
  if (rawSev === "Moderate") return "caution";
  return "info";
}

const ROUTE_STORM_NEARBY_HALF_M = 8_000;
/** Narrow marker for distant weather preview on the timeline (cheap placement). */
const COARSE_WEATHER_PREVIEW_HALF_M = 4_000;

export type BuildRouteStormStripBandsOpts = {
  userAlongM?: number;
  navigationActive?: boolean;
  detailAheadM?: number;
  detailBehindM?: number;
  planningDetailAheadM?: number;
};

function bandIntersectsDetailWindow(
  startM: number,
  endM: number,
  userAlongM: number,
  aheadM: number,
  behindM: number
): boolean {
  const winLo = Math.max(0, userAlongM - behindM);
  const winHi = userAlongM + aheadM;
  return endM >= winLo - 1 && startM <= winHi + 1;
}

function coarseAlertBandOnRoute(
  alert: NormalizedWeatherAlert,
  routeGeom: LngLat[],
  totalM: number,
  cumDist?: Float64Array
): { startM: number; endM: number; crossesRoute: boolean } {
  if (!alert.geometry) {
    return { startM: 0, endM: totalM, crossesRoute: false };
  }
  const routeForCheck = routeForOverlapChecks(routeGeom);
  const centroid = polygonApproxCentroid(alert.geometry);
  const midM = closestAlongMeters(routeGeom, centroid as LngLat, cumDist);
  const crossesRoute = polylineIntersectsPolygon(routeForCheck, alert.geometry);
  return {
    startM: Math.max(0, midM - COARSE_WEATHER_PREVIEW_HALF_M),
    endM: Math.min(totalM, midM + COARSE_WEATHER_PREVIEW_HALF_M),
    crossesRoute,
  };
}

function needsPreciseWeatherBand(
  coarse: { startM: number; endM: number },
  opts: BuildRouteStormStripBandsOpts
): boolean {
  const aheadM = opts.detailAheadM ?? 0;
  const behindM = opts.detailBehindM ?? 0;
  const planningAheadM = opts.planningDetailAheadM ?? 0;
  if (opts.navigationActive) {
    return bandIntersectsDetailWindow(
      coarse.startM,
      coarse.endM,
      opts.userAlongM ?? 0,
      aheadM,
      behindM
    );
  }
  return coarse.startM <= planningAheadM;
}

/**
 * Project NWS alerts onto the active route polyline. Uses {@link alertRouteIntersectionMeters}
 * (with centroid fallback) so thin polygon clips still produce a visible band — the same logic
 * as the advisory Route Ahead timeline.
 */
export function buildRouteStormStripBands(
  routeGeom: LngLat[],
  totalM: number,
  alerts: NormalizedWeatherAlert[],
  opts?: BuildRouteStormStripBandsOpts
): RouteStormStripBand[] {
  if (totalM <= 0 || !alerts.length || routeGeom.length < 2) return [];

  const cumDist = routeGeom.length > 100 ? buildCumulativeDistances(routeGeom) : undefined;
  const sortedAlerts = sortWeatherAlertsBySeverity(alerts);

  const bands: RouteStormStripBand[] = [];
  for (const alert of sortedAlerts) {
    const nwsSeverity = alert.severity ?? "Moderate";
    const impactSeverity = impactSeverityFromNws(nwsSeverity);

    let startM: number;
    let endM: number;
    let crossesRoute: boolean;
    let detailTier: RouteStormStripBand["detailTier"] = "coarse";

    const coarse = coarseAlertBandOnRoute(alert, routeGeom, totalM, cumDist);
    const usePrecise = opts ? needsPreciseWeatherBand(coarse, opts) : true;

    if (alert.geometry && usePrecise) {
      const intersection = alertRouteIntersectionMeters(routeGeom, alert.geometry, cumDist);
      if (intersection) {
        startM = intersection.startM;
        endM = intersection.endM;
        crossesRoute = true;
        detailTier = "precise";
      } else {
        const centroid = polygonApproxCentroid(alert.geometry);
        const midM = closestAlongMeters(routeGeom, centroid as LngLat, cumDist);
        startM = Math.max(0, midM - ROUTE_STORM_NEARBY_HALF_M);
        endM = Math.min(totalM, midM + ROUTE_STORM_NEARBY_HALF_M);
        crossesRoute = false;
        detailTier = "precise";
      }
    } else if (alert.geometry) {
      startM = coarse.startM;
      endM = coarse.endM;
      crossesRoute = coarse.crossesRoute;
      detailTier = "coarse";
    } else {
      startM = 0;
      endM = totalM;
      crossesRoute = false;
      detailTier = usePrecise ? "precise" : "coarse";
    }

    bands.push({
      id: `nws-alert-${alert.id}`,
      event: alert.event ?? "Weather Alert",
      impactSeverity,
      nwsSeverity,
      startMeters: startM,
      endMeters: endM,
      expiresIso: alert.ends ?? null,
      alertId: alert.id ?? null,
      crossesRoute,
      detailTier,
    });
  }

  return bands;
}

export type StormProgressStripBand = {
  startM: number;
  endM: number;
  lineHex: string;
  severity: string;
};

export function routeStormStripBandsToProgressStrip(
  bands: readonly RouteStormStripBand[]
): StormProgressStripBand[] {
  return bands.map((b) => ({
    startM: b.startMeters,
    endM: b.endMeters,
    lineHex: nwsAlertLineColorHex(b.nwsSeverity),
    severity: b.nwsSeverity,
  }));
}

/** Colored route-line segments for map highlights (same spans as the progress strip storm bands). */
export function stormStripBandsToLineFeatures(
  route: LngLat[],
  bands: ReadonlyArray<{ startM: number; endM: number; lineHex: string }>,
  totalRouteM?: number
): GeoJSON.Feature<GeoJSON.LineString>[] {
  if (route.length < 2 || !bands.length) return [];
  const total = totalRouteM ?? polylineLengthMeters(route);
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  for (const b of bands) {
    const coords = slicePolylineBetweenAlongForDisplay(route, b.startM, b.endM, total);
    if (coords.length < 2) continue;
    features.push({
      type: "Feature",
      properties: { highlightKind: "nws", lineHex: b.lineHex },
      geometry: { type: "LineString", coordinates: coords },
    });
  }
  return features;
}

/** Merge NWS + radar + impact-derived spans for the progress strip and map route halo. */
export function mergeProgressStripWeatherBands(
  bands: readonly StormProgressStripBand[]
): StormProgressStripBand[] {
  if (!bands.length) return [];
  const sorted = [...bands].sort((a, b) => a.startM - b.startM || a.endM - b.endM);
  const out: StormProgressStripBand[] = [];
  for (const b of sorted) {
    if (b.endM - b.startM < 8) continue;
    const prev = out[out.length - 1];
    if (
      prev &&
      b.lineHex === prev.lineHex &&
      b.startM <= prev.endM + Math.max(500, (prev.endM - prev.startM) * 0.08)
    ) {
      prev.endM = Math.max(prev.endM, b.endM);
      continue;
    }
    out.push({ ...b });
  }
  return out;
}
