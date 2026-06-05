import type { LngLat } from "../nav/types";
import {
  pointAtAlongMeters,
  polylineLengthMeters,
  slicePolylineBetweenAlong,
  subsamplePolylineVertexBudget,
} from "../nav/routeGeometry";
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
    Math.ceil(total / POLYLINE_INTERSECT_MAX_SAMPLES)
  );
  for (let m = 0; m <= total; m += step) {
    const p = pointAtAlongMeters(route, Math.min(m, total - 0.01));
    if (pointInAnyPolygonGeometry(p[0], p[1], geometry)) return true;
  }
  const last = route[route.length - 1]!;
  return pointInAnyPolygonGeometry(last[0], last[1], geometry);
}

const OVERLAP_VERTEX_CAP = 160;

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
  const step = Math.max(
    POLYLINE_INTERSECT_MIN_STEP_M,
    Math.ceil(total / POLYLINE_INTERSECT_MAX_SAMPLES)
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
  return defaultM;
}

/** Alerts that touch the route or sit on the corridor ahead (not only strict polyline ∩ polygon). */
export function filterAlertsAffectingRoute(
  route: LngLat[],
  alerts: NormalizedWeatherAlert[],
  lateralBufferM = 45_000
): NormalizedWeatherAlert[] {
  if (!route.length || !alerts.length) return [];
  const overlap = computeRouteOverlapWithAlerts(route, alerts);
  const ids = new Set(overlap.overlappingIds);
  const out: NormalizedWeatherAlert[] = [];
  for (const a of alerts) {
    if (ids.has(a.id)) {
      out.push(a);
      continue;
    }
    if (
      a.geometry &&
      polylineNearPolygon(route, a.geometry, nearRouteBufferM(a, lateralBufferM))
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

  const routeForCheck =
    route.length > OVERLAP_VERTEX_CAP || polylineLengthMeters(route) > 750_000
      ? subsamplePolylineVertexBudget(route, OVERLAP_VERTEX_CAP)
      : route;

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

  const step = Math.max(STORM_ROUTE_SAMPLE_STEP_M, Math.ceil(total / STORM_ROUTE_MAX_SAMPLES));
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

  for (const f of collection.features) {
    const g = f.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
    const poly = g as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    const props = (f.properties ?? {}) as { kind?: string; event?: string; severity?: string };
    const hex = nwsAlertLineHexFromMapFeatureProps(props);
    for (const [lo, hi] of alongIntervalsInsidePolygon(route, poly)) {
      const coords = slicePolylineBetweenAlong(route, lo, hi);
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

  const step = Math.max(STORM_ROUTE_SAMPLE_STEP_M, Math.ceil(total / STORM_ROUTE_MAX_SAMPLES));
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
export function closestAlongMeters(route: LngLat[], lngLat: LngLat): number {
  const total = polylineLengthMeters(route);
  const step = Math.max(STORM_ROUTE_SAMPLE_STEP_M, Math.ceil(total / STORM_ROUTE_MAX_SAMPLES));
  let bestDist = Infinity;
  let bestM = total / 2;
  for (let m = 0; m <= total; m += step) {
    const mm = Math.min(m, total);
    const p = pointAtAlongMeters(route, mm);
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
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
): { startM: number; endM: number } | null {
  if (route.length < 2) return null;
  const total = polylineLengthMeters(route);
  if (total < 15) return null;

  const step = Math.max(STORM_ROUTE_SAMPLE_STEP_M, Math.ceil(total / STORM_ROUTE_MAX_SAMPLES));
  const samples: number[] = [];
  for (let m = 0; m <= total; m += step) samples.push(Math.min(m, total));
  if (samples[samples.length - 1]! < total) samples.push(total);

  let startM: number | null = null;
  let endM: number | null = null;

  for (const mm of samples) {
    const p = pointAtAlongMeters(route, mm);
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
  const midM = closestAlongMeters(route, centroid as LngLat);
  return {
    startM: Math.max(0, midM - FALLBACK_STRIP_HALF_M),
    endM: Math.min(total, midM + FALLBACK_STRIP_HALF_M),
  };
}
