import { FALLBACK_LNGLAT } from "./constants";
import type { LngLat } from "./types";

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

/** Point on the polyline at `alongMeters` from the start (clamped to ends). */
export function pointAtAlongMeters(geometry: LngLat[], alongMeters: number): LngLat {
  if (geometry.length === 0) return FALLBACK_LNGLAT;
  if (geometry.length === 1) return geometry[0]!;
  const target = Math.max(0, alongMeters);
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

/** Meters ahead on the polyline to sample direction (stable turn-to-turn). */
const ROUTE_BEARING_LOOKAHEAD_M = 52;

/**
 * Bearing along the route in the direction of travel: from the closest point on the line
 * toward a point ~{@link ROUTE_BEARING_LOOKAHEAD_M} ahead. Use for drive camera (not device compass).
 */
export function bearingAlongRouteAhead(user: LngLat, geometry: LngLat[]): number | null {
  if (geometry.length < 2) return null;
  const { alongMeters } = closestPointOnPolyline(user, geometry);
  const total = polylineLengthMeters(geometry);
  if (total < 1) return null;
  const targetAlong = Math.min(alongMeters + ROUTE_BEARING_LOOKAHEAD_M, total);
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
