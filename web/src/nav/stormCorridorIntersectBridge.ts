/**
 * Thin adapter — the only nav-layer import from the experimental feature folder.
 * Delete this file when removing storm corridor intersect.
 */
import type { LngLat } from "./types";
import {
  buildStormCorridorIntersect,
  isStormCorridorIntersectEnabled,
  type StormCorridorIntersectResult,
} from "../features/stormCorridorIntersect";

export type StormCorridorIntersectInput = {
  geometry: LngLat[] | undefined;
  totalMeters: number;
  userAlongMeters: number;
  planEtaMinutes: number | null;
  driveEtaMinutes?: number | null;
  radarSamples: { t: number; intensity: number }[];
};

export function resolveStormCorridorIntersect(
  input: StormCorridorIntersectInput
): StormCorridorIntersectResult | null {
  if (!isStormCorridorIntersectEnabled()) return null;
  const { geometry, totalMeters, userAlongMeters, planEtaMinutes, driveEtaMinutes, radarSamples } =
    input;
  if (!geometry || geometry.length < 2 || totalMeters <= 0 || radarSamples.length < 3) {
    return null;
  }
  return buildStormCorridorIntersect({
    geometry,
    totalMeters,
    userAlongMeters,
    planEtaMinutes,
    driveEtaMinutes,
    radarSamples,
  });
}

/** Prefer storm intersect advisory when enabled; otherwise keep existing hazard line. */
export function mergeStormCorridorAdvisoryLine(
  intersect: StormCorridorIntersectResult | null,
  fallbackLine: string | null
): string | null {
  if (!intersect?.advisoryLine) return fallbackLine;
  return intersect.advisoryLine;
}
