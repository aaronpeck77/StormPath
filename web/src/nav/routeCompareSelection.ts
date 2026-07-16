import type { MapViewMode } from "../ui/driveMapTypes";

/** Pre-select the active leg when opening A/B/C compare so Go works without an extra tap. */
export function defaultRouteCompareSelection(guidanceRouteId: string): "r-a" | "r-b" | "r-c" {
  if (guidanceRouteId === "r-a" || guidanceRouteId === "r-b" || guidanceRouteId === "r-c") {
    return guidanceRouteId;
  }
  return "r-a";
}

/** Cancel route compare — flat map view, not tilted drive camera. */
export function viewModeAfterCompareCancel(
  restore: MapViewMode | null | undefined,
  navigationStarted: boolean
): MapViewMode {
  if (navigationStarted && restore === "drive") return "topdown";
  if (restore) return restore;
  return navigationStarted ? "topdown" : "route";
}
