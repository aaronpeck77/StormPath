import { useEffect, type MutableRefObject } from "react";
import type { LngLat } from "./types";
import type { RouteImpact } from "./routeImpacts";
import type { MapViewMode } from "../ui/driveMapTypes";
import { DRIVE_AHEAD_WINDOW_M } from "./constants";

export interface UseSeriousHazardAutoFlyDeps {
  navigationStarted: boolean;
  viewMode: MapViewMode;
  guidanceRouteGeometry: LngLat[] | undefined;
  guidanceRouteId: string;
  userLngLat: LngLat | null;
  heavyAdvisoryAlongM: number | null;
  deferredRouteImpactsForUi: RouteImpact[];
  seriousHazardAutoFlewRef: MutableRefObject<Set<string>>;
  setMapFocus: (next: { kind: "hazardOverview"; hazardLng: number; hazardLat: number }) => void;
}

/**
 * Auto fly-to a serious upcoming impact (storm, closure, blocked crash) once per hazard id.
 * Reads from the unified impact list so weather is included alongside road incidents.
 */
export function useSeriousHazardAutoFly(deps: UseSeriousHazardAutoFlyDeps): void {
  const {
    navigationStarted,
    viewMode,
    guidanceRouteGeometry,
    guidanceRouteId,
    userLngLat,
    heavyAdvisoryAlongM,
    deferredRouteImpactsForUi,
    seriousHazardAutoFlewRef,
    setMapFocus,
  } = deps;

  useEffect(() => {
    seriousHazardAutoFlewRef.current.clear();
  }, [guidanceRouteId, seriousHazardAutoFlewRef]);

  useEffect(() => {
    if (!navigationStarted || viewMode !== "drive") return;
    if (!guidanceRouteGeometry?.length || !userLngLat) return;
    const candidate = deferredRouteImpactsForUi.find(
      (i) =>
        !i.suppressFromDriveMap &&
        (i.severity === "avoid" || i.severity === "serious") &&
        (i.driverAction === "rerouteRecommended" ||
          i.driverAction === "rerouteAvailable" ||
          i.driverAction === "prepare") &&
        i.distanceAheadMeters != null &&
        i.distanceAheadMeters > 0 &&
        i.distanceAheadMeters <= DRIVE_AHEAD_WINDOW_M
    );
    if (!candidate) return;
    if (seriousHazardAutoFlewRef.current.has(candidate.id)) return;
    seriousHazardAutoFlewRef.current.add(candidate.id);
    setMapFocus({
      kind: "hazardOverview",
      hazardLng: candidate.lngLat[0]!,
      hazardLat: candidate.lngLat[1]!,
    });
  }, [
    navigationStarted,
    viewMode,
    guidanceRouteGeometry,
    guidanceRouteId,
    heavyAdvisoryAlongM,
    deferredRouteImpactsForUi,
    seriousHazardAutoFlewRef,
    setMapFocus,
  ]);
}
