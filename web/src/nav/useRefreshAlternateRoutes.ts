import { useCallback, type MutableRefObject } from "react";
import { navigationPrimaryRouteIdForMerge } from "./navigationRouteFocus";
import { mergePlanPreservingPrimary } from "./mergePlanRoutes";
import { buildMockTripBetween } from "./emptyTrip";
import { collectMapboxRouteVariants } from "../services/mapboxDirectionsRouter";
import { filterForwardRejoinRoutes } from "./detourRejoin";
import { pointAtAlongMeters, polylineLengthMeters } from "./routeGeometry";
import type { LngLat, NavRoute, TripPlan } from "./types";
import type { MapViewMode } from "../ui/driveMapTypes";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";
import type { RefreshAlternateRoutesFn } from "./useNavAlternateRouteRefresh";

export type UseRefreshAlternateRoutesDeps = {
  navigationStarted: boolean;
  viewMode: MapViewMode;
  userLngLat: LngLat | null;
  destLngLat: LngLat | null;
  mapboxToken: string;
  isOnline: boolean;
  destinationLabel: string;
  stormAlertsForRouting: NormalizedWeatherAlert[] | undefined;
  isPlus: boolean;
  settingStormEnabled: boolean;
  learnEnabled: boolean;
  /** Travel heading — drop U-turn / behind-puck B/C stubs from refresh. */
  headingDeg?: number | null;
  orderedRouteIds: string[];
  planRoutesLength: number;
  lockedNavigationRouteIdRef: MutableRefObject<string | null>;
  routeGraphEpochRef: MutableRefObject<number>;
  altRoutesRefreshInFlightRef: MutableRefObject<boolean>;
  altRoutesFetchAbortRef: MutableRefObject<AbortController | null>;
  /** Live plan routes — read for "another way" corridor excludes. */
  planRoutesRef: MutableRefObject<NavRoute[]>;
  setPlan: (updater: (prev: TripPlan) => TripPlan) => void;
};

/** Route view while navigating: refresh B/C from current GPS; keep primary (slot A) geometry unchanged. */
export function useRefreshAlternateRoutes(
  deps: UseRefreshAlternateRoutesDeps
): RefreshAlternateRoutesFn {
  const {
    navigationStarted,
    viewMode,
    userLngLat,
    destLngLat,
    mapboxToken,
    isOnline,
    destinationLabel,
    stormAlertsForRouting,
    isPlus,
    settingStormEnabled,
    learnEnabled,
    headingDeg,
    orderedRouteIds,
    planRoutesLength,
    lockedNavigationRouteIdRef,
    routeGraphEpochRef,
    altRoutesRefreshInFlightRef,
    altRoutesFetchAbortRef,
    planRoutesRef,
    setPlan,
  } = deps;

  return useCallback(
    async (opts?: { allowDuringDrive?: boolean; anotherWay?: boolean }) => {
      if (!navigationStarted) return;
      if (!opts?.allowDuringDrive && viewMode !== "route") return;
      if (!userLngLat || !destLngLat) return;
      if (mapboxToken && !isOnline) return;
      const primaryId = navigationPrimaryRouteIdForMerge(
        lockedNavigationRouteIdRef.current,
        orderedRouteIds
      );
      if (!primaryId || planRoutesLength < 2) return;
      const epochAtStart = routeGraphEpochRef.current;
      if (altRoutesRefreshInFlightRef.current) return;
      altRoutesFetchAbortRef.current?.abort();
      const altFetch = new AbortController();
      altRoutesFetchAbortRef.current = altFetch;
      altRoutesRefreshInFlightRef.current = true;
      /* "Another way" — midpoints of the current alternates become Mapbox
       * exclude points, so the next B must use a corridor we haven't shown. */
      const anotherWay = opts?.anotherWay === true;
      let excludePoints: LngLat[] | undefined;
      if (anotherWay) {
        excludePoints = planRoutesRef.current
          .filter((r) => r.id !== primaryId && r.geometry?.length >= 2)
          .slice(0, 2)
          .map((r) => {
            const total = polylineLengthMeters(r.geometry);
            return pointAtAlongMeters(r.geometry, total / 2);
          })
          .filter((p): p is LngLat => Boolean(p));
        if (!excludePoints.length) excludePoints = undefined;
      }
      try {
        if (mapboxToken) {
          const fresh = await collectMapboxRouteVariants(mapboxToken, userLngLat, destLngLat, {
            signal: altFetch.signal,
            maxRoutes: isPlus ? 2 : 1,
            allowLocalTripThirdRoute: false,
            preferThreeRoutes: false,
            forwardFirst: true,
            excludePoints,
            bearingDeg:
              headingDeg != null && Number.isFinite(headingDeg) ? headingDeg : undefined,
            stormAlerts: stormAlertsForRouting,
            radarAvoidanceEnabled: isPlus && settingStormEnabled,
            trailRoutePersonalization: isPlus && learnEnabled,
          });
          /* Never offer U-turn / reverse stubs the driver already left behind. */
          const forward = filterForwardRejoinRoutes(fresh, userLngLat, headingDeg);
          if (forward.length === 0) return;
          if (epochAtStart !== routeGraphEpochRef.current) return;
          setPlan((prev) => mergePlanPreservingPrimary(prev, primaryId, forward));
        } else {
          const mock = buildMockTripBetween(
            userLngLat,
            destLngLat,
            destinationLabel.trim() || "Destination"
          );
          const forward = filterForwardRejoinRoutes(mock.routes, userLngLat, headingDeg);
          if (forward.length === 0) return;
          if (epochAtStart !== routeGraphEpochRef.current) return;
          setPlan((prev) => mergePlanPreservingPrimary(prev, primaryId, forward));
        }
      } catch {
        /* Offline / Mapbox errors — keep prior B/C */
      } finally {
        altRoutesRefreshInFlightRef.current = false;
      }
    },
    [
      navigationStarted,
      viewMode,
      userLngLat,
      destLngLat,
      orderedRouteIds,
      planRoutesLength,
      mapboxToken,
      isOnline,
      destinationLabel,
      stormAlertsForRouting,
      isPlus,
      settingStormEnabled,
      learnEnabled,
      headingDeg,
      lockedNavigationRouteIdRef,
      routeGraphEpochRef,
      altRoutesRefreshInFlightRef,
      altRoutesFetchAbortRef,
      planRoutesRef,
      setPlan,
    ]
  );
}
