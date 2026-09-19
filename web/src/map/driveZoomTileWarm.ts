/**
 * Drive-zoom tile warm — the cheap half of offline.
 *
 * The regional corridor warm (`routeCorridorPreload`) fills z10–13 across a 25 mi
 * box. Drive sits at **z16.6**, so none of those tiles are what the follow camera
 * needs: the park dead-zone dumps showed the picture stalling even though the
 * regional warm reported done. This window is small and high-zoom on purpose —
 * the next few miles of road at the zoom the driver is actually looking at.
 *
 * This is not Brain P2 (trip packs). It is a sliding ~8 mi window, dropped the
 * moment the radio holds.
 */

import { corridorWindowBounds, type CorridorBounds } from "./routeCorridorPreload";
import type { LngLat } from "../nav/types";

/** ~8 mi of road ahead. About 6–8 minutes at highway speed. */
export const DRIVE_WARM_WINDOW_M = 12_875;
/** Overlap so the next window is warm before the driver reaches this one's edge. */
export const DRIVE_WARM_OVERLAP_M = 3_200;
/**
 * Tight lateral pad. At z16 the Drive viewport is only a few hundred meters wide,
 * so a wide pad buys nothing and multiplies tiles by the square of the padding.
 */
export const DRIVE_WARM_PAD_M = 500;
/** Start the next window this far before the current one runs out (~2 mi). */
export const DRIVE_WARM_TRIGGER_M = 3_200;
/** The zooms Drive actually renders from (16.6 draws z16, and z15 on its parents). */
export const DRIVE_WARM_ZOOMS = [15, 16] as const;
/**
 * Cap per pass. An 8 mi × 1 km strip is roughly 30 tiles at z15 and 110 at z16;
 * the cap keeps a wandering route from turning into a download.
 */
export const DRIVE_WARM_MAX_TILES = 220;

/** Bounds for the Drive-zoom window starting at `alongM`. */
export function driveZoomWindowBounds(
  geometry: LngLat[],
  alongM: number
): CorridorBounds | null {
  return corridorWindowBounds(geometry, alongM, {
    windowM: DRIVE_WARM_WINDOW_M,
    padM: DRIVE_WARM_PAD_M,
  });
}

export function nextDriveZoomWindowStartM(windowStartM: number): number {
  return windowStartM + Math.max(1_000, DRIVE_WARM_WINDOW_M - DRIVE_WARM_OVERLAP_M);
}

export function shouldWarmNextDriveZoomWindow(
  alongM: number,
  windowStartM: number
): boolean {
  return alongM >= windowStartM + DRIVE_WARM_WINDOW_M - DRIVE_WARM_TRIGGER_M;
}

/**
 * Warm only while the link is actually usable. On a held radio the fetches fail,
 * burn battery, and count against the fail diagnostics for no gain.
 */
export function shouldRunDriveZoomWarm(input: {
  navigationStarted: boolean;
  isOnline: boolean;
  holdLastGoodMap: boolean;
  inFlight: boolean;
}): boolean {
  if (!input.navigationStarted) return false;
  if (!input.isOnline || input.holdLastGoodMap) return false;
  return !input.inFlight;
}
