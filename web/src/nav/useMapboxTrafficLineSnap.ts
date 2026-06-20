import { useEffect, useRef, type MutableRefObject } from "react";
import type { LngLat, NavRoute, TripPlan } from "./types";
import { fetchMapboxDrivingTrafficRoute } from "../services/mapboxRouteAlternatives";
import type { TrafficOverlay } from "../situation/fusedSnapshot";

export const MB_TRAFFIC_LINE_SNAP_NOTICE = "Mapbox traffic-aware line";
const MAPBOX_LINE_SNAP_DELAY_MIN = 10;
const MAPBOX_LINE_SNAP_COOLDOWN_MS = 45_000;

export interface UseMapboxTrafficLineSnapDeps {
  navigationStarted: boolean;
  mapboxToken: string;
  destLngLat: LngLat | null;
  guidanceRoute: NavRoute | null | undefined;
  trafficFetchDone: boolean;
  routing: boolean;
  trafficOverlay: TrafficOverlay | undefined;
  lineFocusId: string;
  userLngLatRef: MutableRefObject<LngLat | null>;
  routeGraphEpochRef: MutableRefObject<number>;
  setPlan: (updater: TripPlan | ((prev: TripPlan) => TripPlan)) => void;
  setFitTrigger: (updater: (prev: number) => number) => void;
  setTapHint: (msg: string | null) => void;
}

/**
 * Planning only: when traffic is broken or extremely delayed, refresh the focused leg geometry
 * from Mapbox driving-traffic. Disabled during active navigation.
 */
export function useMapboxTrafficLineSnap(deps: UseMapboxTrafficLineSnapDeps): void {
  const {
    navigationStarted,
    mapboxToken,
    destLngLat,
    guidanceRoute,
    trafficFetchDone,
    routing,
    trafficOverlay,
    lineFocusId,
    userLngLatRef,
    routeGraphEpochRef,
    setPlan,
    setFitTrigger,
    setTapHint,
  } = deps;

  const lastMbLineSnapMsRef = useRef(0);

  useEffect(() => {
    if (navigationStarted) return;
    if (!mapboxToken || !destLngLat || !guidanceRoute) return;
    if (!trafficFetchDone || routing) return;

    const leg = trafficOverlay?.[lineFocusId];
    if (leg === undefined) return;

    const alreadyMb =
      guidanceRoute.routeNotices?.some(
        (n) =>
          n.includes(MB_TRAFFIC_LINE_SNAP_NOTICE) ||
          n.includes("Traffic-aware path from current position (Mapbox)")
      ) ?? false;
    if (alreadyMb) return;

    const broken = leg === null;
    const heavy = leg != null && leg.delayVsTypicalMinutes >= MAPBOX_LINE_SNAP_DELAY_MIN;
    if (!broken && !heavy) return;

    const now = Date.now();
    if (now - lastMbLineSnapMsRef.current < MAPBOX_LINE_SNAP_COOLDOWN_MS) return;

    let cancelled = false;
    lastMbLineSnapMsRef.current = now;
    const epochAtStart = routeGraphEpochRef.current;

    void (async () => {
      const pos = userLngLatRef.current;
      if (!pos || cancelled) return;
      const mb = await fetchMapboxDrivingTrafficRoute(mapboxToken, pos, destLngLat);
      if (cancelled || !mb) return;
      if (epochAtStart !== routeGraphEpochRef.current) return;
      setPlan((prev) => ({
        ...prev,
        routes: prev.routes.map((r) =>
          r.id === lineFocusId
            ? {
                ...r,
                geometry: mb.geometry,
                baseEtaMinutes: Math.max(1, Math.round(mb.durationMinutes)),
                turnSteps: mb.turnSteps,
                routeNotices: [
                  ...(r.routeNotices ?? []),
                  `${MB_TRAFFIC_LINE_SNAP_NOTICE} — follows live road network when stored geometry no longer matches closures/congestion.`,
                ],
              }
            : r
        ),
      }));
      setFitTrigger((n) => n + 1);
      setTapHint(
        broken
          ? "Route line switched to Mapbox roads — the old line may cross a closure or bad segment."
          : "Route line updated to match heavy traffic on the map."
      );
      window.setTimeout(() => setTapHint(null), 6500);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    navigationStarted,
    mapboxToken,
    destLngLat,
    guidanceRoute,
    trafficFetchDone,
    trafficOverlay,
    lineFocusId,
    routing,
    routeGraphEpochRef,
    setPlan,
    setFitTrigger,
    setTapHint,
    userLngLatRef,
  ]);
}
