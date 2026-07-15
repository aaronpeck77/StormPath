import type { MapViewMode } from "../ui/driveMapTypes";
import {
  driveGuidanceUsesRejoinOverlay,
  mayAutoRejoinOverlay,
} from "./navigationContract";
import { REJOIN_OVERLAY_ROUTE_ID } from "./mergePlanRoutes";

/**
 * While navigating, turn-by-turn follows the route locked at Go.
 * Off-route: a temporary forward rejoin stub may guide until the puck rejoins the lock.
 */
export function resolveNavigationRouteIds(input: {
  navigationStarted: boolean;
  lockedRouteId: string | null;
  /** Temporary forward rejoin stub (B/C slot) while off the locked corridor. */
  temporaryGuidanceRouteId?: string | null;
  viewMode: MapViewMode;
  previewLegIndex: number;
  orderedRouteIds: string[];
  primaryRouteId: string;
}): { guidanceRouteId: string; lineFocusId: string } {
  const fallback = input.orderedRouteIds[0] ?? input.primaryRouteId;
  const previewId =
    input.orderedRouteIds[input.previewLegIndex] ?? input.orderedRouteIds[0] ?? input.primaryRouteId;

  if (!input.navigationStarted) {
    const id = previewId || fallback;
    return { guidanceRouteId: id, lineFocusId: id };
  }

  const locked = input.lockedRouteId ?? fallback;
  const temp = input.temporaryGuidanceRouteId ?? null;
  /* Prefer ordered slots; still follow synthetic overlay before slot reconcile catches up. */
  const tempKnown =
    Boolean(temp) &&
    (input.orderedRouteIds.includes(temp!) || temp === REJOIN_OVERLAY_ROUTE_ID);
  const followRejoin =
    mayAutoRejoinOverlay("navigating") &&
    driveGuidanceUsesRejoinOverlay(temp, locked) &&
    tempKnown;

  if (input.viewMode === "drive") {
    if (followRejoin) {
      return { guidanceRouteId: temp!, lineFocusId: temp! };
    }
    return { guidanceRouteId: locked, lineFocusId: locked };
  }

  /* Route / topdown: compare A/B/C on the map without changing turn-by-turn guidance.
   * Guidance still follows the rejoin stub when active so banner/ETA stay consistent. */
  if (followRejoin) {
    return { guidanceRouteId: temp!, lineFocusId: previewId || temp! };
  }
  return { guidanceRouteId: locked, lineFocusId: previewId || locked };
}

/** Primary leg id for mergePlanPreservingPrimary — locked route wins over slot order. */
export function navigationPrimaryRouteIdForMerge(
  lockedRouteId: string | null,
  orderedRouteIds: string[]
): string | undefined {
  return lockedRouteId ?? orderedRouteIds[0];
}
