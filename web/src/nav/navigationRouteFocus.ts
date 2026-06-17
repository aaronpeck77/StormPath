import type { MapViewMode } from "../ui/driveMapTypes";

/**
 * While navigating, turn-by-turn follows the route locked at Go. Rt / Mp may preview other legs
 * without changing guidance until the driver explicitly promotes a leg.
 */
export function resolveNavigationRouteIds(input: {
  navigationStarted: boolean;
  lockedRouteId: string | null;
  /** Temporary B/C leg for auto local rejoin — does not change the locked route. */
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
  const tempGuide = input.temporaryGuidanceRouteId?.trim() || null;
  if (input.viewMode === "drive") {
    const guide = tempGuide && tempGuide !== locked ? tempGuide : locked;
    return { guidanceRouteId: guide, lineFocusId: guide };
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
