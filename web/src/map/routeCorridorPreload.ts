import { haversineMeters, pointAtAlongMeters } from "../nav/routeGeometry";
import type { LngLat } from "../nav/types";

/** ~25 mi of corridor ahead of the driver (or trip start). */
export const CORRIDOR_WINDOW_M = 40_000;
/** Overlap so the next window is warm before the current edge. */
export const CORRIDOR_OVERLAP_M = 12_000;
/** Lateral pad around the polyline (~2.5 mi each side). */
export const CORRIDOR_PAD_M = 4_000;
/** Start warming the next window when this close to the end of the current one (~3 mi). */
export const CORRIDOR_AHEAD_TRIGGER_M = 4_800;

export type CorridorBounds = [[number, number], [number, number]]; // SW, NE

function metersToLatDeg(m: number): number {
  return m / 111_320;
}

function metersToLngDeg(m: number, atLat: number): number {
  const cos = Math.cos((atLat * Math.PI) / 180);
  const denom = 111_320 * Math.max(0.2, Math.abs(cos));
  return m / denom;
}

/**
 * Bounding box covering the route from `alongM` for `windowM` meters, plus lateral pad.
 * Used for tile cache warming (sliding regional windows — not whole-state packs).
 */
export function corridorWindowBounds(
  geometry: LngLat[],
  alongM: number,
  opts?: { windowM?: number; padM?: number }
): CorridorBounds | null {
  if (!geometry || geometry.length < 2) return null;
  const windowM = opts?.windowM ?? CORRIDOR_WINDOW_M;
  const padM = opts?.padM ?? CORRIDOR_PAD_M;
  const startM = Math.max(0, alongM);
  const endM = startM + Math.max(1_000, windowM);

  const samples: LngLat[] = [];
  const step = Math.max(400, windowM / 24);
  for (let m = startM; m <= endM + 1; m += step) {
    samples.push(pointAtAlongMeters(geometry, m));
  }
  samples.push(pointAtAlongMeters(geometry, endM));

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of samples) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null;

  const midLat = (minLat + maxLat) / 2;
  const dLat = metersToLatDeg(padM);
  const dLng = metersToLngDeg(padM, midLat);
  return [
    [minLng - dLng, minLat - dLat],
    [maxLng + dLng, maxLat + dLat],
  ];
}

/** Start meter of the next overlapping window after `windowStartM`. */
export function nextCorridorWindowStartM(
  windowStartM: number,
  opts?: { windowM?: number; overlapM?: number }
): number {
  const windowM = opts?.windowM ?? CORRIDOR_WINDOW_M;
  const overlapM = opts?.overlapM ?? CORRIDOR_OVERLAP_M;
  return windowStartM + Math.max(1_000, windowM - overlapM);
}

/** True when the driver is close enough to the end of the warm window to prefetch the next. */
export function shouldPrefetchNextCorridorWindow(
  alongM: number,
  windowStartM: number,
  opts?: { windowM?: number; triggerM?: number }
): boolean {
  const windowM = opts?.windowM ?? CORRIDOR_WINDOW_M;
  const triggerM = opts?.triggerM ?? CORRIDOR_AHEAD_TRIGGER_M;
  const windowEnd = windowStartM + windowM;
  return alongM >= windowEnd - triggerM;
}

/** Approximate path length for gating (cheap vs full cumdist). */
export function approxRouteLengthM(geometry: LngLat[]): number {
  if (!geometry || geometry.length < 2) return 0;
  let m = 0;
  for (let i = 1; i < geometry.length; i++) {
    m += haversineMeters(geometry[i - 1]!, geometry[i]!);
  }
  return m;
}
