import { useEffect, useRef, type MutableRefObject } from "react";
import type { LngLat } from "../nav/types";
import type { MapViewMode } from "../ui/driveMapTypes";
import { getNavAltRefreshMs } from "../utils/dataSaver";

export type RefreshAlternateRoutesFn = (opts?: { allowDuringDrive?: boolean }) => Promise<void>;

export type UseNavAlternateRouteRefreshDeps = {
  appForeground: boolean;
  navigationStarted: boolean;
  viewMode: MapViewMode;
  destLngLat: LngLat | null;
  dataSaverMode: boolean;
  planRoutesLength: number;
  routingRef: MutableRefObject<boolean>;
  altRoutesRefreshInFlightRef: MutableRefObject<boolean>;
  refreshAlternateRoutesOnly: RefreshAlternateRoutesFn;
};

/** While navigating in Rt/Mp, refresh B/C legs on an interval and when switching views. */
export function useNavAlternateRouteRefresh(deps: UseNavAlternateRouteRefreshDeps): void {
  const {
    appForeground,
    navigationStarted,
    viewMode,
    destLngLat,
    dataSaverMode,
    planRoutesLength,
    routingRef,
    altRoutesRefreshInFlightRef,
    refreshAlternateRoutesOnly,
  } = deps;

  const refreshAltRef = useRef(refreshAlternateRoutesOnly);
  refreshAltRef.current = refreshAlternateRoutesOnly;

  useEffect(() => {
    if (!appForeground) return;
    if (!navigationStarted) return;
    if (viewMode !== "route" && viewMode !== "topdown") return;
    if (!destLngLat) return;
    const altMs = getNavAltRefreshMs(dataSaverMode);
    if (altMs == null) return;
    const id = window.setInterval(() => {
      if (routingRef.current || altRoutesRefreshInFlightRef.current) return;
      void refreshAltRef.current();
    }, altMs);
    return () => window.clearInterval(id);
  }, [
    appForeground,
    navigationStarted,
    viewMode,
    destLngLat,
    dataSaverMode,
    routingRef,
    altRoutesRefreshInFlightRef,
  ]);

  useEffect(() => {
    if (!navigationStarted) return;
    if (viewMode !== "route" && viewMode !== "topdown") return;
    if (planRoutesLength < 2) return;
    if (routingRef.current || altRoutesRefreshInFlightRef.current) return;
    void refreshAltRef.current();
  }, [navigationStarted, viewMode, planRoutesLength, routingRef, altRoutesRefreshInFlightRef]);
}
