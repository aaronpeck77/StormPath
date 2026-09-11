import { haversineMeters } from "../nav/routeGeometry";
import type { LngLat } from "../nav/types";

/**
 * Drive follow-cam zoom block.
 *
 * Rt overview / regional planning use ~6.3–7.0 (“Canada”). If that zoom leaks
 * into Drive — pinch, fitBounds, style reload, mapFocus — the puck looks like
 * it is flying across the continent. Every Drive camera write must go through
 * these helpers so that cannot happen again.
 */

export const DRIVE_FOLLOW_ZOOM_DEFAULT = 16.35;
/** Below this is city / state / Canada — not a Drive follow picture. */
export const DRIVE_FOLLOW_ZOOM_MIN = 12.5;
export const DRIVE_FOLLOW_ZOOM_MAX = 18.5;
/** If a camera center is farther than this from the puck, snap center back. */
export const DRIVE_FOLLOW_CENTER_MAX_DRIFT_M = 2_500;

export function isDriveContinentZoom(zoom: number): boolean {
  return !Number.isFinite(zoom) || zoom < DRIVE_FOLLOW_ZOOM_MIN;
}

/** Street Drive zoom. Continent-scale values snap back to the default, not the floor. */
export function clampDriveFollowZoom(
  zoom: number | null | undefined,
  fallback: number = DRIVE_FOLLOW_ZOOM_DEFAULT
): number {
  const fb = Number.isFinite(fallback) ? fallback : DRIVE_FOLLOW_ZOOM_DEFAULT;
  if (zoom == null || !Number.isFinite(zoom) || zoom < DRIVE_FOLLOW_ZOOM_MIN) {
    return Math.min(DRIVE_FOLLOW_ZOOM_MAX, Math.max(DRIVE_FOLLOW_ZOOM_MIN, fb));
  }
  return Math.min(DRIVE_FOLLOW_ZOOM_MAX, zoom);
}

/** Repair a stored Drive zoom ref and return the value every camera write must use. */
export function repairStoredDriveFollowZoom(stored: { current: number }): number {
  stored.current = clampDriveFollowZoom(stored.current);
  return stored.current;
}

/** Pinch / zoomend: never remember a Canada-scale zoom as the Drive follow zoom. */
export function rememberDriveFollowZoom(nextZoom: number, previous: number): number {
  if (isDriveContinentZoom(nextZoom)) {
    return clampDriveFollowZoom(previous);
  }
  return clampDriveFollowZoom(nextZoom, previous);
}

export function guardDriveFollowCamera(input: {
  center: LngLat;
  zoom: number;
  puck: LngLat;
  maxCenterDriftM?: number;
}): { center: LngLat; zoom: number } {
  const zoom = clampDriveFollowZoom(input.zoom);
  const drift = haversineMeters(input.center, input.puck);
  const maxDrift = input.maxCenterDriftM ?? DRIVE_FOLLOW_CENTER_MAX_DRIFT_M;
  const center =
    Number.isFinite(drift) && drift > maxDrift ? input.puck : input.center;
  return { center, zoom };
}

/** Wide fit / regional fly / hazard overview must not run while Drive follow owns the camera. */
export function driveFollowBlocksWideFit(input: {
  navigationStarted: boolean;
  viewMode: string;
}): boolean {
  return input.navigationStarted && input.viewMode === "drive";
}
