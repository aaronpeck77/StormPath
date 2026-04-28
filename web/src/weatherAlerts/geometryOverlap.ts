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
