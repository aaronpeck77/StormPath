import { useEffect, useRef, type MutableRefObject } from "react";
import { NWS_REQUEST_USER_AGENT } from "../config/nwsUserAgent";
import {
  fetchNwsAlertsForBrowseViewport,
  fetchNwsAlertsForRouteCorridorsMerged,
  nwsBrowseBoundsAroundLngLat,
} from "../weatherAlerts/nwsUsProvider";
import { computeRouteOverlapWithAlerts, pointInAnyPolygonGeometry } from "../weatherAlerts/geometryOverlap";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";
import type { LngLat, TripPlan } from "./types";

export interface UseStormCorridorPollingDeps {
  appForeground: boolean;
  isPlus: boolean;
  stormAdvisoryEnabled: boolean;
  advisoryLifeSafetyOn: boolean;
  settingStormEnabled: boolean;
  nwsEffectStableKey: string;
  nwsPollIntervalMs: number;
  nwsBrowseLocationReady: boolean;
  planRoutesLength: number;
  stormMapGeoJson: GeoJSON.FeatureCollection | null;
  stormCorridorAlerts: NormalizedWeatherAlert[];
  stormCorridorAlertsRef: MutableRefObject<NormalizedWeatherAlert[]>;
  stormMapHasDisplayableRef: MutableRefObject<boolean>;
  effectiveUserLngLatRef: MutableRefObject<LngLat | null>;
  nwsRouteGeomsForFetchRef: MutableRefObject<LngLat[][]>;
  planRef: MutableRefObject<TripPlan>;
  routingRef: MutableRefObject<boolean>;
  setStormCorridorAlerts: (alerts: NormalizedWeatherAlert[]) => void;
  setStormMapGeoJson: (geo: GeoJSON.FeatureCollection | null) => void;
  setStormOverlapping: (alerts: NormalizedWeatherAlert[]) => void;
  setStormLoading: (loading: boolean) => void;
  setStormError: (msg: string | null) => void;
  setStormBarExpanded: (expanded: boolean) => void;
}

/**
 * US NWS corridor polling + storm-disabled cleanup. Extracted from App.tsx so the shell stays
 * focused on trip/navigation wiring.
 */
export function useStormCorridorPolling(deps: UseStormCorridorPollingDeps): void {
  const {
    appForeground,
    isPlus,
    stormAdvisoryEnabled,
    advisoryLifeSafetyOn,
    settingStormEnabled,
    nwsEffectStableKey,
    nwsPollIntervalMs,
    nwsBrowseLocationReady,
    planRoutesLength,
    stormMapGeoJson,
    stormCorridorAlerts,
    stormCorridorAlertsRef,
    stormMapHasDisplayableRef,
    effectiveUserLngLatRef,
    nwsRouteGeomsForFetchRef,
    planRef,
    routingRef,
    setStormCorridorAlerts,
    setStormMapGeoJson,
    setStormOverlapping,
    setStormLoading,
    setStormError,
    setStormBarExpanded,
  } = deps;

  const nwsFetchGenRef = useRef(0);
  const nwsFetchInFlightRef = useRef(false);

  useEffect(() => {
    if (!settingStormEnabled) {
      stormMapHasDisplayableRef.current = false;
      setStormLoading(false);
      setStormError(null);
      setStormMapGeoJson(null);
      setStormCorridorAlerts([]);
      setStormOverlapping([]);
      setStormBarExpanded(false);
    }
  }, [
    settingStormEnabled,
    setStormBarExpanded,
    setStormCorridorAlerts,
    setStormError,
    setStormLoading,
    setStormMapGeoJson,
    setStormOverlapping,
    stormMapHasDisplayableRef,
  ]);

  useEffect(() => {
    stormMapHasDisplayableRef.current =
      Boolean(stormMapGeoJson?.features?.length) || stormCorridorAlerts.length > 0;
  }, [stormCorridorAlerts.length, stormMapGeoJson, stormMapHasDisplayableRef]);

  useEffect(() => {
    if (!appForeground) return;
    if (!isPlus) {
      stormMapHasDisplayableRef.current = false;
      setStormMapGeoJson(null);
      setStormCorridorAlerts([]);
      setStormOverlapping([]);
      setStormError(null);
      setStormLoading(false);
      return;
    }
    if (!stormAdvisoryEnabled || !advisoryLifeSafetyOn) {
      if (import.meta.env.DEV) {
        console.error(
          "[NWS] BLOCKED gate1 stormAdvisoryEnabled=",
          stormAdvisoryEnabled,
          "lifeSafetyOn=",
          advisoryLifeSafetyOn
        );
      }
      stormMapHasDisplayableRef.current = false;
      setStormMapGeoJson(null);
      setStormCorridorAlerts([]);
      setStormOverlapping([]);
      setStormError(null);
      setStormLoading(false);
      return;
    }
    if (!settingStormEnabled) {
      if (import.meta.env.DEV) console.error("[NWS] BLOCKED gate2 settingStormEnabled=false");
      setStormLoading(false);
      return;
    }

    const routeGeoms = nwsRouteGeomsForFetchRef.current;
    const hasRouteCorridors = routeGeoms.length > 0;
    const canBrowseWithoutRoutes = !hasRouteCorridors && Boolean(effectiveUserLngLatRef.current);

    if (import.meta.env.DEV) {
      console.log(
        "[NWS] effect:",
        "stableKey=",
        nwsEffectStableKey,
        "withGeom=",
        routeGeoms.length,
        "hasCorridors=",
        hasRouteCorridors
      );
    }

    if (!hasRouteCorridors && !canBrowseWithoutRoutes) {
      if (import.meta.env.DEV) console.debug("[NWS] skipped: no route yet and no GPS fix");
      if (planRef.current.routes.length === 0) {
        stormMapHasDisplayableRef.current = false;
        setStormMapGeoJson(null);
        setStormCorridorAlerts([]);
        setStormOverlapping([]);
        setStormError(null);
      }
      setStormLoading(false);
      return;
    }

    const genAtStart = ++nwsFetchGenRef.current;
    let cancelled = false;
    let routingRetryTimer: number | null = null;

    const run = async () => {
      if (nwsFetchGenRef.current !== genAtStart) {
        if (import.meta.env.DEV) console.log("[NWS run] stale gen");
        return;
      }
      if (nwsFetchInFlightRef.current) {
        if (routingRetryTimer == null) {
          routingRetryTimer = window.setTimeout(() => {
            routingRetryTimer = null;
            if (!cancelled && nwsFetchGenRef.current === genAtStart) void run();
          }, 600);
        }
        return;
      }
      const geomsForRun = nwsRouteGeomsForFetchRef.current;
      if (routingRef.current && geomsForRun.length === 0) {
        if (import.meta.env.DEV) console.log("[NWS run] primary routing in progress, retry 1.2s");
        routingRetryTimer = window.setTimeout(() => {
          routingRetryTimer = null;
          if (!cancelled && nwsFetchGenRef.current === genAtStart) void run();
        }, 1200);
        return;
      }
      if (import.meta.env.DEV) console.log("[NWS run] fetching...");
      nwsFetchInFlightRef.current = true;
      const hasPriorNws =
        stormMapHasDisplayableRef.current || stormCorridorAlertsRef.current.length > 0;
      if (!hasPriorNws) setStormLoading(true);
      setStormError(null);

      try {
        const geoms = geomsForRun;

        if (geoms.length > 0) {
          const { result: merged, partialErrors } = await fetchNwsAlertsForRouteCorridorsMerged(
            geoms,
            NWS_REQUEST_USER_AGENT,
            {
              onBeforeUgc: (partial) => {
                if (cancelled || nwsFetchGenRef.current !== genAtStart) return;
                if (!partial.alerts.length && !partial.mapGeoJson.features.length) return;
                setStormCorridorAlerts(partial.alerts);
                setStormMapGeoJson(partial.mapGeoJson);
              },
            }
          );
          if (import.meta.env.DEV && partialErrors?.length) {
            console.warn("[StormPath NWS] Some route legs failed (others merged):", partialErrors);
          }
          if (cancelled || nwsFetchGenRef.current !== genAtStart) return;
          setStormCorridorAlerts(merged.alerts);
          setStormMapGeoJson(merged.mapGeoJson);
          if (import.meta.env.DEV) {
            console.log(
              "[NWS fetch] alerts:",
              merged.alerts.length,
              "mapFeatures:",
              merged.mapGeoJson.features.length,
              merged.alerts.map((a) => `${a.event} (geom:${Boolean(a.geometry)})`).join(", ")
            );
          }
          const overlappingIds = new Set<string>();
          for (const g of geoms) {
            const o = computeRouteOverlapWithAlerts(g, merged.alerts);
            for (const id of o.overlappingIds) overlappingIds.add(id);
          }
          setStormOverlapping(merged.alerts.filter((a) => overlappingIds.has(a.id)));
        } else {
          const p = effectiveUserLngLatRef.current;
          if (!p) {
            if (!cancelled && nwsFetchGenRef.current === genAtStart) {
              setStormCorridorAlerts([]);
              setStormMapGeoJson(null);
              setStormOverlapping([]);
              setStormError(null);
            }
            return;
          }
          const [lng, lat] = p;
          const bounds = nwsBrowseBoundsAroundLngLat(lng, lat);
          const corridor = await fetchNwsAlertsForBrowseViewport(bounds, NWS_REQUEST_USER_AGENT);
          if (cancelled || nwsFetchGenRef.current !== genAtStart) return;
          setStormCorridorAlerts(corridor.alerts);
          setStormMapGeoJson(corridor.mapGeoJson);
          const atUser = corridor.alerts.filter(
            (a) => a.geometry && pointInAnyPolygonGeometry(lng, lat, a.geometry)
          );
          setStormOverlapping(atUser);
        }
      } catch (e) {
        if (!cancelled && nwsFetchGenRef.current === genAtStart) {
          setStormError(e instanceof Error ? e.message : String(e));
          if (!stormCorridorAlertsRef.current.length) {
            setStormMapGeoJson(null);
            setStormCorridorAlerts([]);
            setStormOverlapping([]);
          }
        }
      } finally {
        nwsFetchInFlightRef.current = false;
        setStormLoading(false);
      }
    };
    void run();
    const id = window.setInterval(run, nwsPollIntervalMs);
    return () => {
      cancelled = true;
      if (routingRetryTimer != null) window.clearTimeout(routingRetryTimer);
      nwsFetchGenRef.current += 1;
      window.clearInterval(id);
      setStormLoading(false);
    };
  }, [
    appForeground,
    stormAdvisoryEnabled,
    nwsEffectStableKey,
    nwsPollIntervalMs,
    advisoryLifeSafetyOn,
    settingStormEnabled,
    isPlus,
    planRoutesLength,
    nwsBrowseLocationReady,
    effectiveUserLngLatRef,
    nwsRouteGeomsForFetchRef,
    planRef,
    routingRef,
    stormCorridorAlertsRef,
    stormMapHasDisplayableRef,
    setStormCorridorAlerts,
    setStormMapGeoJson,
    setStormOverlapping,
    setStormLoading,
    setStormError,
  ]);
}
