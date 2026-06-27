import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { geometryForRemainingTrafficFetch } from "../nav/routeRemaining";
import type { LngLat, TripPlan } from "../nav/types";
import { fetchMapboxTrafficAlongPolyline } from "../services/mapboxDirectionsTraffic";
import { getTrafficPollIntervalMs } from "../utils/dataSaver";
import type { TrafficOverlay } from "../situation/fusedSnapshot";

export type UseTrafficOverlayFetchDeps = {
  planRef: MutableRefObject<TripPlan>;
  guidanceRouteIdRef: MutableRefObject<string>;
  routingRef: MutableRefObject<boolean>;
  navRouteLengthMRef: MutableRefObject<number>;
  planRoutesKeyStable: string;
  /** Bumps when locked navigation geometry is replaced (reroute / rejoin). */
  guidanceGeometryEpoch: number;
  navigationStarted: boolean;
  isPlus: boolean;
  isOnline: boolean;
  settingTrafficEnabled: boolean;
  mapboxToken: string;
  dataSaverMode: boolean;
  appForeground: boolean;
  userAlongGuidanceMRef: MutableRefObject<number>;
  userLngLatRef: MutableRefObject<LngLat | null>;
  guidanceRouteGeomRef: MutableRefObject<LngLat[] | null>;
  setTrafficOverlay: (v: TrafficOverlay | undefined) => void;
  setTrafficFetchDone: (v: boolean) => void;
};

export type TrafficOverlayRefreshControls = {
  trafficRefreshRef: MutableRefObject<number>;
  bumpTrafficRefresh: () => void;
};

export function useTrafficOverlayFetch(
  deps: UseTrafficOverlayFetchDeps
): TrafficOverlayRefreshControls {
  const {
    planRef,
    guidanceRouteIdRef,
    routingRef,
    navRouteLengthMRef,
    planRoutesKeyStable,
    guidanceGeometryEpoch,
    navigationStarted,
    isPlus,
    isOnline,
    settingTrafficEnabled,
    mapboxToken,
    dataSaverMode,
    appForeground,
    userAlongGuidanceMRef,
    userLngLatRef,
    guidanceRouteGeomRef,
    setTrafficOverlay,
    setTrafficFetchDone,
  } = deps;

  const trafficRefreshRef = useRef(0);
  const [trafficRefreshKey, setTrafficRefreshKey] = useState(0);
  const bumpTrafficRefresh = useCallback(() => {
    trafficRefreshRef.current += 1;
    setTrafficRefreshKey(trafficRefreshRef.current);
  }, []);

  useEffect(() => {
    const allRoutes = planRef.current.routes;
    const activeId = guidanceRouteIdRef.current;
    const routes =
      navigationStarted && activeId
        ? allRoutes.filter((r) => r.id === activeId)
        : allRoutes;
    const toFetch = routes.length ? routes : allRoutes;
    if (routingRef.current) {
      return;
    }
    if (!navigationStarted) {
      setTrafficOverlay(undefined);
      setTrafficFetchDone(true);
      return;
    }
    if (!isPlus || !isOnline || !settingTrafficEnabled || !mapboxToken || !toFetch.length) {
      if (import.meta.env.DEV) {
        console.info(
          "[traffic] skipping fetch —",
          !isPlus
            ? "basic tier"
            : !isOnline
              ? "offline"
              : !settingTrafficEnabled
                ? "setting OFF"
                : !mapboxToken
                  ? "no token"
                  : "no routes"
        );
      }
      setTrafficOverlay(undefined);
      setTrafficFetchDone(true);
      return;
    }
    let cancelled = false;
    setTrafficFetchDone(false);
    if (import.meta.env.DEV) {
      console.info("[traffic v2] fetching for", toFetch.length, "route(s)…");
    }
    void (async () => {
      const next: TrafficOverlay = {};
      await Promise.all(
        toFetch.map(async (r) => {
          if (cancelled) return;
          try {
            const navGeom = guidanceRouteGeomRef.current;
            const baseGeom =
              navGeom && navGeom.length >= 2 && r.id === guidanceRouteIdRef.current
                ? navGeom
                : r.geometry;
            const fetchGeom =
              navigationStarted && baseGeom.length >= 2
                ? geometryForRemainingTrafficFetch(
                    baseGeom,
                    userAlongGuidanceMRef.current,
                    userLngLatRef.current
                  )
                : baseGeom;
            const leg = await fetchMapboxTrafficAlongPolyline(mapboxToken, fetchGeom);
            if (import.meta.env.DEV) {
              console.info(
                "[traffic v2] route",
                r.id,
                "→",
                leg
                  ? `live ${leg.mapboxDurationMinutes.toFixed(1)} min, typical ${leg.typicalDurationMinutes.toFixed(1)}, delay ${leg.delayVsTypicalMinutes.toFixed(1)}, congestion: ${leg.congestionSummary}`
                  : "null (API returned no data)"
              );
            }
            if (!cancelled) next[r.id] = leg;
          } catch (err) {
            console.warn("[traffic v2] route", r.id, "fetch error:", err);
            if (!cancelled) next[r.id] = null;
          }
        })
      );
      if (!cancelled) {
        setTrafficOverlay(next);
        setTrafficFetchDone(true);
        const live = Object.values(next).filter(Boolean).length;
        if (import.meta.env.DEV) {
          console.info("[traffic v2] overlay set, routes with live data:", live);
          if (live === 0) {
            console.warn(
              "[traffic v2] WARNING: all routes returned null — check Mapbox token and API access"
            );
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    planRoutesKeyStable,
    guidanceGeometryEpoch,
    mapboxToken,
    settingTrafficEnabled,
    isOnline,
    trafficRefreshKey,
    navigationStarted,
    isPlus,
    planRef,
    guidanceRouteIdRef,
    routingRef,
    userAlongGuidanceMRef,
    userLngLatRef,
    guidanceRouteGeomRef,
    setTrafficOverlay,
    setTrafficFetchDone,
  ]);

  useEffect(() => {
    if (!appForeground) return;
    if (!planRoutesKeyStable || !settingTrafficEnabled || !navigationStarted || !isPlus) return;
    const id = window.setInterval(() => {
      bumpTrafficRefresh();
    }, getTrafficPollIntervalMs(dataSaverMode, navigationStarted, navRouteLengthMRef.current));
    return () => window.clearInterval(id);
  }, [
    appForeground,
    planRoutesKeyStable,
    settingTrafficEnabled,
    navigationStarted,
    isPlus,
    dataSaverMode,
    navRouteLengthMRef,
  ]);

  return { trafficRefreshRef, bumpTrafficRefresh };
}
