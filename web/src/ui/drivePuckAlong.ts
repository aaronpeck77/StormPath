import { pointAtAlongMeters, polylineLengthMeters } from "../nav/routeGeometry";
import type { LngLat } from "../nav/types";

/**
 * Along-route puck: pin to corridor progress, not raw GPS lerp.
 * Must not coast while the vehicle is sitting still (Go in the driveway).
 */

/** Ignore reverse along jumps larger than this while rolling (meters). */
export const ON_ROUTE_REVERSE_IGNORE_M = 8;
/** Blend time-constant toward nav along (seconds). */
export const ON_ROUTE_ALONG_TC_S = 0.28;
/** Below this, treat as parked — do not dead-reckon along the blue line. */
export const ON_ROUTE_PARKED_SPEED_MPS = 1.4;
/** While parked, ignore nav along jumps bigger than this (GPS projected down the road). */
export const ON_ROUTE_PARKED_ALONG_HOLD_M = 12;

export function tickOnRoutePuckAlong(input: {
  prevAlongM: number;
  navAlongM: number;
  dtS: number;
  speedMps: number | null;
  routeTotalM: number;
  /** True when GPS/speed says the vehicle is not moving. */
  parked?: boolean;
}): number {
  const total = Math.max(0, input.routeTotalM);
  const dt = Math.max(0.008, Math.min(0.12, input.dtS));
  const prev = Math.max(0, Math.min(total, input.prevAlongM));
  let target = Number.isFinite(input.navAlongM)
    ? Math.max(0, Math.min(total, input.navAlongM))
    : prev;
  const speed =
    input.speedMps != null && Number.isFinite(input.speedMps) ? Math.max(0, input.speedMps) : 0;
  const parked = Boolean(input.parked) || speed < ON_ROUTE_PARKED_SPEED_MPS;

  if (parked) {
    if (Math.abs(target - prev) > ON_ROUTE_PARKED_ALONG_HOLD_M) return prev;
    const alphaPark = 1 - Math.exp(-dt / 0.2);
    return prev + (target - prev) * alphaPark;
  }

  if (target < prev - ON_ROUTE_REVERSE_IGNORE_M) {
    target = prev;
  }

  const alpha = 1 - Math.exp(-dt / ON_ROUTE_ALONG_TC_S);
  let next = prev + (target - prev) * alpha;
  /* Coast only toward nav along that is already ahead — never invent motion past it. */
  if (target > prev + 1) {
    const coast = prev + speed * dt;
    next = Math.min(target, Math.max(next, coast));
  }

  const cap = Math.max(2.4, Math.max(speed, 8) * dt * 2.5);
  if (next > prev + cap) next = prev + cap;
  if (next < prev - cap) next = prev - cap;
  if (next > target) next = target;
  return Math.max(0, Math.min(total, next));
}

export function lngLatOnRouteAlong(geometry: LngLat[], alongM: number): LngLat {
  return pointAtAlongMeters(geometry, alongM);
}

export function routeTotalMeters(geometry: LngLat[]): number {
  return geometry.length >= 2 ? polylineLengthMeters(geometry) : 0;
}
