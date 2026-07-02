import type { MapViewMode } from "../ui/driveMapTypes";

/**
 * While navigating, turn-by-turn follows the route locked at Go.
 * Drive replans the locked leg in place — no temporary B/C detour guidance.
 */
export function resolveNavigationRouteIds(input: {
  navigationStarted: boolean;
  lockedRouteId: string | null;
  /** @deprecated Drive no longer follows temporary rejoin legs — locked geometry updates in place. */
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
  return { guidanceRouteId: locked, lineFocusId: locked };
}

/** Primary leg id for mergePlanPreservingPrimary — locked route wins over slot order. */
export function navigationPrimaryRouteIdForMerge(
  lockedRouteId: string | null,
  orderedRouteIds: string[]
): string | undefined {
  return lockedRouteId ?? orderedRouteIds[0];
}
