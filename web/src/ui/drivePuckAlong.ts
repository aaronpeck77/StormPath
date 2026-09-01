import { pointAtAlongMeters, polylineLengthMeters } from "../nav/routeGeometry";
import type { LngLat } from "../nav/types";

/**
 * Along-route puck: nav apps pin the puck to corridor progress, not raw GPS lerp.
 * High-rate GPS / Core alongM chatter otherwise races the puck up and down the road.
 */

/** Ignore reverse along jumps larger than this while rolling (meters). */
export const ON_ROUTE_REVERSE_IGNORE_M = 8;
/** Blend time-constant toward nav along (seconds). */
export const ON_ROUTE_ALONG_TC_S = 0.28;

export function tickOnRoutePuckAlong(input: {
  prevAlongM: number;
  navAlongM: number;
  dtS: number;
  speedMps: number | null;
  routeTotalM: number;
}): number {
  const total = Math.max(0, input.routeTotalM);
  const dt = Math.max(0.008, Math.min(0.12, input.dtS));
  const prev = Math.max(0, Math.min(total, input.prevAlongM));
  let target = Number.isFinite(input.navAlongM)
    ? Math.max(0, Math.min(total, input.navAlongM))
    : prev;
  const speed =
    input.speedMps != null && Number.isFinite(input.speedMps) ? Math.max(0, input.speedMps) : 0;

  if (speed > 1.5 && target < prev - ON_ROUTE_REVERSE_IGNORE_M) {
    target = prev;
  }

  const alpha = 1 - Math.exp(-dt / ON_ROUTE_ALONG_TC_S);
  let next = prev + (target - prev) * alpha;
  if (speed > 0.7 && target >= prev - 1) {
    const coast = prev + speed * dt;
    next = Math.max(next, Math.min(target + 4, coast));
  }

  const cap = Math.max(2.4, Math.max(speed, 8) * dt * 2.5);
  if (next > prev + cap) next = prev + cap;
  if (next < prev - cap) next = prev - cap;
  return Math.max(0, Math.min(total, next));
}

export function lngLatOnRouteAlong(geometry: LngLat[], alongM: number): LngLat {
  return pointAtAlongMeters(geometry, alongM);
}

export function routeTotalMeters(geometry: LngLat[]): number {
  return geometry.length >= 2 ? polylineLengthMeters(geometry) : 0;
}
