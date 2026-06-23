import type { MapViewMode } from "../ui/driveMapTypes";

/**
 * While navigating, turn-by-turn follows the route locked at Go. Rt / Mp show the locked route;
 * Drive may briefly follow a temporary rejoin leg until back on the locked line.
 */
export function resolveNavigationRouteIds(input: {
  navigationStarted: boolean;
  lockedRouteId: string | null;
  /** Temporary rejoin leg for auto return-to-route — does not change the locked route id. */
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
  if (input.viewMode === "drive") {
    const tempGuide = input.temporaryGuidanceRouteId?.trim() || null;
    const guide = tempGuide && tempGuide !== locked ? tempGuide : locked;
    return { guidanceRouteId: guide, lineFocusId: guide };
  }
  return { guidanceRouteId: locked, lineFocusId: locked };
}

/** Primary leg id for mergePlanPreservingPrimary — locked route wins over slot order. */
export function navigationPrimaryRouteIdForMerge(
  lockedRouteId: string | null,
  orderedRouteIds: string[]
): string | undefined {
  return lockedRouteId ?? orderedRouteIds[0];
}
