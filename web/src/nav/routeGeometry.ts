import { FALLBACK_LNGLAT } from "./constants";
import type { LngLat } from "./types";
import { isExtremeTripRoute, isUltraLongTripRoute } from "../utils/dataSaver";

const EARTH_M = 6_371_000;

/** Initial (forward) bearing from `a` to `b`, degrees clockwise from north (0–360). */
export function initialBearingDegrees(a: LngLat, b: LngLat): number {
  const φ1 = (a[1] * Math.PI) / 180;
  const φ2 = (b[1] * Math.PI) / 180;
  const Δλ = ((b[0] - a[0]) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

/** Great-circle distance between two WGS84 points (meters). */
export function haversineMeters(a: LngLat, b: LngLat): number {
  const φ1 = (a[1] * Math.PI) / 180;
  const φ2 = (b[1] * Math.PI) / 180;
  const Δφ = ((b[1] - a[1]) * Math.PI) / 180;
  const Δλ = ((b[0] - a[0]) * Math.PI) / 180;
  const s =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Total polyline length in meters (segment sum). */
export function polylineLengthMeters(geometry: LngLat[]): number {
  if (geometry.length < 2) return 0;
  let s = 0;
  for (let i = 0; i < geometry.length - 1; i++) {
    s += haversineMeters(geometry[i]!, geometry[i + 1]!);
  }
  return s;
}

/** Cumulative distance along the polyline from the start to vertex index `vertexIndex` (meters). */
export function cumulativeLengthToVertex(geometry: LngLat[], vertexIndex: number): number {
  if (geometry.length < 2) return 0;
  const lastSeg = Math.min(Math.max(0, vertexIndex), geometry.length - 1);
  let d = 0;
  for (let i = 0; i < lastSeg; i++) {
    d += haversineMeters(geometry[i]!, geometry[i + 1]!);
  }
  return d;
}

/**
 * Distance along the polyline from the start to the point that matches `pointAlongPolyline`-style
 * chord-length fraction (degree-space), expressed in meters.
 */
export function chordFractionToAlongMeters(geometry: LngLat[], fraction: number): number {
  if (geometry.length < 2) return 0;
  const t = Math.max(0, Math.min(1, fraction));
  let totalDeg = 0;
  const segDeg: number[] = [];
  for (let i = 0; i < geometry.length - 1; i++) {
    const [lng1, lat1] = geometry[i]!;
    const [lng2, lat2] = geometry[i + 1]!;
    const d = Math.hypot(lng2 - lng1, lat2 - lat1);
    segDeg.push(d);
    totalDeg += d;
  }
  if (totalDeg <= 0) return 0;
  let target = totalDeg * t;
  let cumDeg = 0;
  let cumM = 0;
  for (let i = 0; i < segDeg.length; i++) {
    const sl = segDeg[i]!;
    const sm = haversineMeters(geometry[i]!, geometry[i + 1]!);
    if (target <= cumDeg + sl) {
      const u = sl > 0 ? (target - cumDeg) / sl : 0;
      return cumM + u * sm;
    }
    cumDeg += sl;
    cumM += sm;
  }
  return cumM;
}

/**
 * Closest point on the polyline to `user` and distance along the line from the start (meters).
 * Uses equirectangular projection per segment (fine for short segments).
 */
export function closestAlongRouteMeters(user: LngLat, geometry: LngLat[]): {
  alongMeters: number;
  lateralMetersApprox: number;
} {
  if (geometry.length === 0) return { alongMeters: 0, lateralMetersApprox: 1e12 };
  if (geometry.length === 1) {
    return { alongMeters: 0, lateralMetersApprox: haversineMeters(user, geometry[0]!) };
  }

  let bestAlong = 0;
  let bestLat = 1e12;
  let cum = 0;

  for (let i = 0; i < geometry.length - 1; i++) {
    const A = geometry[i]!;
    const B = geometry[i + 1]!;
    const segLen = haversineMeters(A, B);
    const midLat = ((A[1] + B[1]) / 2) * (Math.PI / 180);
    const cos = Math.cos(midLat) * 111_320;
    const mLat = 111_320;
    const ax = A[0] * cos;
    const ay = A[1] * mLat;
    const bx = B[0] * cos;
    const by = B[1] * mLat;
    const px = user[0] * cos;
    const py = user[1] * mLat;
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const ab2 = abx * abx + aby * aby;
    const tt = ab2 < 1e-12 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
    const qx = ax + tt * abx;
    const qy = ay + tt * aby;
    const dist = Math.hypot(px - qx, py - qy);
    const along = cum + tt * segLen;
    if (dist < bestLat) {
      bestLat = dist;
      bestAlong = along;
    }
    cum += segLen;
  }

  return { alongMeters: bestAlong, lateralMetersApprox: bestLat };
}

/** Closest point on the polyline to `user` (same projection as {@link closestAlongRouteMeters}). */
export function closestPointOnPolyline(
  user: LngLat,
  geometry: LngLat[]
): { lngLat: LngLat; alongMeters: number; lateralMetersApprox: number } {
  if (geometry.length === 0) {
    return { lngLat: user, alongMeters: 0, lateralMetersApprox: 1e12 };
  }
  if (geometry.length === 1) {
    return {
      lngLat: geometry[0]!,
      alongMeters: 0,
      lateralMetersApprox: haversineMeters(user, geometry[0]!),
    };
  }

  let bestAlong = 0;
  let bestLngLat: LngLat = geometry[0]!;
  let bestLat = 1e12;
  let cum = 0;

  for (let i = 0; i < geometry.length - 1; i++) {
    const A = geometry[i]!;
    const B = geometry[i + 1]!;
    const segLen = haversineMeters(A, B);
    const midLat = ((A[1] + B[1]) / 2) * (Math.PI / 180);
    const cos = Math.cos(midLat) * 111_320;
    const mLat = 111_320;
    const ax = A[0]! * cos;
    const ay = A[1]! * mLat;
    const bx = B[0]! * cos;
    const by = B[1]! * mLat;
    const px = user[0]! * cos;
    const py = user[1]! * mLat;
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const ab2 = abx * abx + aby * aby;
    const tt = ab2 < 1e-12 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
    const qx = ax + tt * abx;
    const qy = ay + tt * aby;
    const dist = Math.hypot(px - qx, py - qy);
    const along = cum + tt * segLen;
    if (dist < bestLat) {
      bestLat = dist;
      bestAlong = along;
      bestLngLat = [qx / cos, qy / mLat];
    }
    cum += segLen;
  }

  return { lngLat: bestLngLat, alongMeters: bestAlong, lateralMetersApprox: bestLat };
}

/**
 * Pre-computed cumulative distances for fast windowed closest-point searches.
 * cum[i] = total distance from point 0 to point i (meters).
 * Build once per geometry, then pass to closestPointOnPolylineWindowed.
 */
export function buildCumulativeDistances(geometry: LngLat[]): Float64Array {
  const cum = new Float64Array(geometry.length);
  for (let i = 1; i < geometry.length; i++) {
    cum[i] = cum[i - 1]! + haversineMeters(geometry[i - 1]!, geometry[i]!);
  }
  return cum;
}

/**
 * Like `closestPointOnPolyline` but only searches segments within
 * [centerM - backM, centerM + aheadM], using the pre-built cumulative distance
 * array to binary-search for the segment range.  Orders of magnitude faster on
 * long routes because only O(window / avg_segment_len) segments are checked
 * instead of the entire polyline.
 *
 * The window should be wide enough to cover the maximum distance the user can
 * travel between calls (backM ≥ 300 m, aheadM ≥ 2000 m is typical for drive).
 */
export function closestPointOnPolylineWindowed(
  user: LngLat,
  geometry: LngLat[],
  cumDist: Float64Array,
  centerM: number,
  backM: number,
  aheadM: number,
): { lngLat: LngLat; alongMeters: number; lateralMetersApprox: number } {
  const n = geometry.length;
  if (n < 2) return closestPointOnPolyline(user, geometry);

  const fromM = Math.max(0, centerM - backM);
  const toM = Math.min(cumDist[n - 1]!, centerM + aheadM);

  // Binary search: last vertex index where cumDist <= fromM (= segment start).
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cumDist[mid]! <= fromM) lo = mid; else hi = mid - 1;
  }
  const startIdx = Math.max(0, lo);

  // Binary search: first vertex index where cumDist >= toM (= segment end).
  lo = 0; hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumDist[mid]! < toM) lo = mid + 1; else hi = mid;
  }
  const endIdx = Math.min(n - 2, lo);

  if (startIdx > endIdx) return closestPointOnPolyline(user, geometry);

  let bestAlong = cumDist[startIdx]!;
  let bestLngLat: LngLat = geometry[startIdx]!;
  let bestLat = 1e12;

  for (let i = startIdx; i <= endIdx; i++) {
    const A = geometry[i]!;
    const B = geometry[i + 1]!;
    const segLen = cumDist[i + 1]! - cumDist[i]!;
    const midLat = ((A[1] + B[1]) / 2) * (Math.PI / 180);
    const cos = Math.cos(midLat) * 111_320;
    const mLat = 111_320;
    const ax = A[0]! * cos;
    const ay = A[1]! * mLat;
    const bx = B[0]! * cos;
    const by = B[1]! * mLat;
    const px = user[0]! * cos;
    const py = user[1]! * mLat;
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const ab2 = abx * abx + aby * aby;
    const tt = ab2 < 1e-12 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
    const qx = ax + tt * abx;
    const qy = ay + tt * aby;
    const dist = Math.hypot(px - qx, py - qy);
    const along = cumDist[i]! + tt * segLen;
    if (dist < bestLat) {
      bestLat = dist;
      bestAlong = along;
      bestLngLat = [qx / cos, qy / mLat];
    }
  }

  return { lngLat: bestLngLat, alongMeters: bestAlong, lateralMetersApprox: bestLat };
}

/** Point on the polyline at `alongMeters` from the start (clamped to ends). */
export function pointAtAlongMeters(
  geometry: LngLat[],
  alongMeters: number,
  cumDist?: Float64Array
): LngLat {
  if (geometry.length === 0) return FALLBACK_LNGLAT;
  if (geometry.length === 1) return geometry[0]!;
  const target = Math.max(0, alongMeters);
  if (cumDist && cumDist.length === geometry.length) {
    const total = cumDist[geometry.length - 1]!;
    if (target >= total) return geometry[geometry.length - 1]!;
    let lo = 0;
    let hi = geometry.length - 2;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumDist[mid + 1]! < target) lo = mid + 1;
      else hi = mid;
    }
    const i = lo;
    const A = geometry[i]!;
    const B = geometry[i + 1]!;
    const s0 = cumDist[i]!;
    const segLen = cumDist[i + 1]! - s0;
    const t = segLen > 0 ? (target - s0) / segLen : 0;
    const u = Math.max(0, Math.min(1, t));
    return [A[0]! + (B[0]! - A[0]!) * u, A[1]! + (B[1]! - A[1]!) * u];
  }
  let cum = 0;
  for (let i = 0; i < geometry.length - 1; i++) {
    const A = geometry[i]!;
    const B = geometry[i + 1]!;
    const segLen = haversineMeters(A, B);
    if (cum + segLen >= target) {
      const t = segLen > 0 ? (target - cum) / segLen : 0;
      const u = Math.max(0, Math.min(1, t));
      return [A[0]! + (B[0]! - A[0]!) * u, A[1]! + (B[1]! - A[1]!) * u];
    }
    cum += segLen;
  }
  return geometry[geometry.length - 1]!;
}

/** Default meters ahead on the polyline to sample direction (stable turn-to-turn). */
const ROUTE_BEARING_LOOKAHEAD_M = 52;

/**
 * Bearing along the route in the direction of travel: from the closest point on the line
 * toward a point `lookAheadM` ahead. Use for drive camera (not device compass).
 */
export function bearingAlongRouteAhead(
  user: LngLat,
  geometry: LngLat[],
  lookAheadM: number = ROUTE_BEARING_LOOKAHEAD_M
): number | null {
  if (geometry.length < 2) return null;
  const la = Math.max(8, Math.min(280, lookAheadM));
  const { alongMeters } = closestPointOnPolyline(user, geometry);
  const total = polylineLengthMeters(geometry);
  if (total < 1) return null;
  const targetAlong = Math.min(alongMeters + la, total);
  const fromPt = pointAtAlongMeters(geometry, alongMeters);
  const toPt = pointAtAlongMeters(geometry, Math.max(targetAlong, alongMeters + 0.5));
  if (haversineMeters(fromPt, toPt) < 2.5) {
    const a = geometry[geometry.length - 2]!;
    const b = geometry[geometry.length - 1]!;
    return initialBearingDegrees(a, b);
  }
  return initialBearingDegrees(fromPt, toPt);
}

/**
 * Uniform vertex subsample for heavy geometric checks (NWS overlap, etc.) on cross-country polylines.
 * Keeps first/last; does not change true road shape much at map scale.
 */
export function subsamplePolylineVertexBudget(route: LngLat[], maxVertices: number): LngLat[] {
  if (route.length <= maxVertices) return route;
  const last = route.length - 1;
  const out: LngLat[] = [];
  for (let i = 0; i < maxVertices; i++) {
    const t = maxVertices === 1 ? 0 : i / (maxVertices - 1);
    const idx = Math.min(last, Math.round(t * last));
    out.push(route[idx]!);
  }
  const deduped: LngLat[] = [];
  for (const p of out) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev[0] === p[0] && prev[1] === p[1]) continue;
    deduped.push(p);
  }
  return deduped.length >= 2 ? deduped : route;
}

/**
 * Subsample by distance along the polyline (not array index) — keeps bends on long interstate routes.
 * Used when storing Mapbox overview geometry so drive-mode lines follow roads when zoomed in.
 */
export function subsamplePolylineAlongDistance(route: LngLat[], maxVertices: number): LngLat[] {
  if (route.length <= maxVertices) return route;
  const total = polylineLengthMeters(route);
  if (total < 1) return route;
  const out: LngLat[] = [route[0]!];
  const stepM = total / Math.max(1, maxVertices - 1);
  for (let i = 1; i < maxVertices - 1; i++) {
    out.push(pointAtAlongMeters(route, i * stepM));
  }
  out.push(route[route.length - 1]!);
  return out;
}

/** Rough road distance before Directions returns (crow-flies × factor). */
export function estimateRoadDistanceM(
  start: LngLat,
  end: LngLat,
  via: LngLat[] = []
): number {
  let sum = 0;
  let prev = start;
  for (const p of [...via, end]) {
    sum += haversineMeters(prev, p);
    prev = p;
  }
  return sum * 1.28;
}

/** Stored in React state — cap vertices so cross-country legs do not freeze the UI thread. */
export const ROUTE_GEOMETRY_STORAGE_VERTICES_ULTRA = 5_000;
export const ROUTE_GEOMETRY_STORAGE_VERTICES_EXTREME = 2_800;
/** Planning map overview line — sparse is fine at continent zoom. */
export const MAP_PLANNING_OVERVIEW_VERTICES = 1_200;

export function normalizeStoredRouteGeometry(geometry: LngLat[]): LngLat[] {
  if (geometry.length < 2) return geometry;
  const totalM = polylineLengthMeters(geometry);
  if (!isUltraLongTripRoute(totalM)) return geometry;
  const cap = isExtremeTripRoute(totalM)
    ? ROUTE_GEOMETRY_STORAGE_VERTICES_EXTREME
    : ROUTE_GEOMETRY_STORAGE_VERTICES_ULTRA;
  if (geometry.length <= cap) return geometry;
  return subsamplePolylineVertexBudget(geometry, cap);
}

export function geometryForPlanningMapDisplay(geometry: LngLat[]): LngLat[] {
  if (geometry.length < 2) return geometry;
  const totalM = polylineLengthMeters(geometry);
  if (!isUltraLongTripRoute(totalM)) return geometry;
  const cap = isExtremeTripRoute(totalM) ? 800 : MAP_PLANNING_OVERVIEW_VERTICES;
  if (geometry.length <= cap) return geometry;
  return subsamplePolylineVertexBudget(geometry, cap);
}

/** Weather/hazard halo segments — dense enough to follow roads on long legs. */
const HIGHLIGHT_GEOMETRY_VERTEX_BUDGET = 8000;

/** Drive map line: short tail behind puck, full detail ahead (cap only when remaining leg is huge). */
export const DRIVE_LINE_BEHIND_M = 1500;
const DRIVE_LINE_MAX_VERTICES = 24_000;
const DRIVE_LINE_MAX_VERTICES_ULTRA = 6_000;
const DRIVE_LINE_MAX_VERTICES_EXTREME = 3_500;

export type RouteHighlightFrame = {
  geometry: LngLat[];
  /** Meters along the full-route polyline where `geometry[0]` sits. */
  alongOffsetM: number;
  totalM: number;
  fullDetail: boolean;
};

/** Match hazard halos to the same road slice as the active drive route line. */
export function routeHighlightFrameForMap(
  geometry: LngLat[],
  clipBehindAlongM: number | null | undefined
): RouteHighlightFrame {
  if (geometry.length < 2) {
    return { geometry, alongOffsetM: 0, totalM: 0, fullDetail: false };
  }
  if (clipBehindAlongM != null && Number.isFinite(clipBehindAlongM)) {
    const slice = routeLineGeometryForDriveDisplay(geometry, clipBehindAlongM);
    const alongOffsetM = Math.max(0, clipBehindAlongM - DRIVE_LINE_BEHIND_M);
    return {
      geometry: slice,
      alongOffsetM,
      totalM: polylineLengthMeters(slice),
      fullDetail: true,
    };
  }
  return {
    geometry,
    alongOffsetM: 0,
    totalM: polylineLengthMeters(geometry),
    fullDetail: false,
  };
}

/**
 * Active route polyline for drive-mode map rendering — full-resolution slice from just behind the puck
 * to the destination. Only subsamples when the remaining leg is extremely dense (cross-country).
 */
export function routeLineGeometryForDriveDisplay(
  geometry: LngLat[],
  userAlongM: number | null | undefined
): LngLat[] {
  if (geometry.length < 2) return geometry;
  if (userAlongM == null || !Number.isFinite(userAlongM) || userAlongM < 0) return geometry;

  const total = polylineLengthMeters(geometry);
  const startM = Math.max(0, userAlongM - DRIVE_LINE_BEHIND_M);
  if (total - startM < 2) return geometry;

  let slice = slicePolylineBetweenAlong(geometry, startM, total);
  if (slice.length < 2) {
    slice = [pointAtAlongMeters(geometry, startM), pointAtAlongMeters(geometry, total)];
  }
  const maxVerts = isExtremeTripRoute(total)
    ? DRIVE_LINE_MAX_VERTICES_EXTREME
    : isUltraLongTripRoute(total)
      ? DRIVE_LINE_MAX_VERTICES_ULTRA
      : DRIVE_LINE_MAX_VERTICES;
  if (slice.length > maxVerts) {
    slice = subsamplePolylineAlongDistance(slice, maxVerts);
  }
  return slice.length >= 2 ? slice : geometry;
}

/**
 * Map highlight slicing — slice on full road geometry first, then subsample only the segment
 * being drawn. Avoids chord shortcuts on long routes and keeps work proportional to band length.
 */
export function slicePolylineBetweenAlongForDisplay(
  geometry: LngLat[],
  startM: number,
  endM: number,
  _totalRouteM?: number,
  opts?: { fullDetail?: boolean }
): LngLat[] {
  if (geometry.length < 2) return [];
  let slice = slicePolylineBetweenAlong(geometry, startM, endM);
  if (slice.length < 2) return slice;
  if (opts?.fullDetail) return slice;
  if (slice.length > HIGHLIGHT_GEOMETRY_VERTEX_BUDGET) {
    slice = subsamplePolylineAlongDistance(slice, HIGHLIGHT_GEOMETRY_VERTEX_BUDGET);
  }
  return slice;
}

/**
 * Sub-polyline from `startM` to `endM` meters along the path (for hazard / weather highlights).
 */
export function slicePolylineBetweenAlong(
  geometry: LngLat[],
  startM: number,
  endM: number
): LngLat[] {
  if (geometry.length < 2) return [];
  const total = polylineLengthMeters(geometry);
  const lo = Math.max(0, Math.min(total, Math.min(startM, endM)));
  const hi = Math.max(0, Math.min(total, Math.max(startM, endM)));
  if (hi - lo < 0.5) {
    const p = pointAtAlongMeters(geometry, lo);
    return [p, p];
  }

  const out: LngLat[] = [];
  let cum = 0;

  for (let i = 0; i < geometry.length - 1; i++) {
    const A = geometry[i]!;
    const B = geometry[i + 1]!;
    const segLen = haversineMeters(A, B);
    const s0 = cum;
    const s1 = cum + segLen;

    if (s1 <= lo) {
      cum = s1;
      continue;
    }
    if (s0 >= hi) break;

    const clipStart = Math.max(lo, s0);
    const clipEnd = Math.min(hi, s1);
    if (clipStart >= clipEnd) {
      cum = s1;
      continue;
    }

    const t0 = segLen > 0 ? (clipStart - s0) / segLen : 0;
    const t1 = segLen > 0 ? (clipEnd - s0) / segLen : 0;
    const p0: LngLat = [
      A[0]! + (B[0]! - A[0]!) * t0,
      A[1]! + (B[1]! - A[1]!) * t0,
    ];
    const p1: LngLat = [
      A[0]! + (B[0]! - A[0]!) * t1,
      A[1]! + (B[1]! - A[1]!) * t1,
    ];

    if (out.length === 0 || haversineMeters(out[out.length - 1]!, p0) > 0.35) {
      out.push(p0);
    }
    if (haversineMeters(out[out.length - 1]!, p1) > 0.35) {
      out.push(p1);
    }
    cum = s1;
  }

  if (out.length < 2) {
    return [pointAtAlongMeters(geometry, lo), pointAtAlongMeters(geometry, hi)];
  }
  return out;
}

/** Samples on `route` within this lateral distance of `reference` count as shared corridor. */
export const ROUTE_CORRIDOR_OVERLAP_M = 140;
/** Spacing between overlap samples along `route`. */
export const ROUTE_OVERLAP_SAMPLE_STEP_M = 380;
/**
 * Fraction of `route` samples that lie on the same corridor as `reference` (0–1).
 * Used to tell “mostly the same drive” from “shares a leg but diverges when it can”.
 */
export function routeCorridorOverlapFraction(
  route: LngLat[],
  reference: LngLat[],
  opts?: { corridorM?: number; sampleStepM?: number }
): number {
  if (route.length < 2 || reference.length < 2) return 0;
  const corridorM = opts?.corridorM ?? ROUTE_CORRIDOR_OVERLAP_M;
  const sampleStepM = opts?.sampleStepM ?? ROUTE_OVERLAP_SAMPLE_STEP_M;
  const totalM = polylineLengthMeters(route);
  if (totalM < 80) return 0;

  const step = Math.max(sampleStepM, totalM / 48);
  let hits = 0;
  let checks = 0;
  for (let d = 0; d <= totalM; d += step) {
    const pt = pointAtAlongMeters(route, d);
    checks++;
    const { lateralMetersApprox } = closestAlongRouteMeters(pt, reference);
    if (lateralMetersApprox <= corridorM) hits++;
  }
  return checks > 0 ? hits / checks : 0;
}

/** True when two legs are effectively the same drive (high corridor overlap). */
export function routesEffectivelySame(
  a: LngLat[],
  b: LngLat[],
  minOverlap = 0.93
): boolean {
  if (a.length < 2 || b.length < 2) return false;
  return routeCorridorOverlapFraction(a, b) >= minOverlap;
}
