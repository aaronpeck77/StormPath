import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LngLat } from "../nav/types";
import {
  buildTimelinesWaypointsForGeometry,
  fetchRouteDepartureScan,
  isTomorrowIoRateLimited,
} from "../services/tomorrowIo";
import {
  fetchWeatherKitDepartureScan,
  isWeatherKitTokenBlocked,
} from "../services/weatherKit";
import { corridorDirectedSig } from "../services/routeCorridorWeatherCache";
import type {
  DepartureScanLocation,
  DepartureScanWaypoint,
} from "../services/departureScanTypes";
import {
  analyzeDepartureTiming,
  type DepartureAnalysis,
} from "./departureScan";

/** Hourly data moves slowly — 30 min in-memory reuse is plenty for a sheet. */
const SCAN_CACHE_TTL_MS = 30 * 60 * 1000;

type CacheEntry = { at: number; locations: DepartureScanLocation[] };
const scanCache = new Map<string, CacheEntry>();

export type DepartureScanStatus = "idle" | "loading" | "ready" | "partial" | "unavailable";

export type UseDepartureScanResult = {
  status: DepartureScanStatus;
  analysis: DepartureAnalysis | null;
  refresh: () => void;
};

type Phase = "idle" | "loading" | "resolved";

/**
 * Fetches raw hourly corridor weather (per location) and scores departure-time
 * shifts. Fetch-on-open only — callers enable it while the briefing sheet is
 * open; nothing prefetches for users who never look.
 */
export function useDepartureScan(opts: {
  enabled: boolean;
  geometry: LngLat[] | null | undefined;
  planEtaMinutes: number | null;
  speedMps: number;
  apiKey: string;
  weatherKitEnabled: boolean;
}): UseDepartureScanResult {
  const { enabled, geometry, planEtaMinutes, speedMps, apiKey, weatherKitEnabled } = opts;
  const [locations, setLocations] = useState<DepartureScanLocation[] | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [refreshKey, setRefreshKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const waypoints = useMemo(() => {
    if (!geometry?.length) return null;
    const wps = buildTimelinesWaypointsForGeometry(geometry, speedMps, planEtaMinutes);
    if (!wps?.length) return null;
    return wps.map(
      (w): DepartureScanWaypoint => ({
        lat: w.lat,
        lng: w.lng,
        travelMin: Math.max(0, w.etaMinutes),
      })
    );
  }, [geometry, speedMps, planEtaMinutes]);

  const sig = useMemo(() => {
    if (!geometry?.length) return "";
    const etaBucket =
      planEtaMinutes != null && planEtaMinutes > 0
        ? Math.round(planEtaMinutes / 20)
        : 0;
    return `${corridorDirectedSig(geometry)}|e${etaBucket}`;
  }, [geometry, planEtaMinutes]);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !sig || !geometry?.length || !waypoints?.length) {
      abortRef.current?.abort();
      setLocations(null);
      setPhase("idle");
      return;
    }

    const cached = scanCache.get(sig);
    if (cached && Date.now() - cached.at < SCAN_CACHE_TTL_MS) {
      setLocations(cached.locations);
      setPhase("resolved");
      return;
    }

    const rateLimited = weatherKitEnabled
      ? isWeatherKitTokenBlocked()
      : isTomorrowIoRateLimited() || !apiKey;
    if (rateLimited) {
      setLocations(cached?.locations ?? null);
      setPhase("resolved");
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase("loading");

    const rawWaypoints = waypoints.map((w) => ({
      lat: w.lat,
      lng: w.lng,
      etaMinutes: w.travelMin,
    }));

    void (async () => {
      try {
        const result = weatherKitEnabled
          ? await fetchWeatherKitDepartureScan(rawWaypoints, ac.signal)
          : await fetchRouteDepartureScan(apiKey, rawWaypoints, ac.signal, {
              geometry,
            });
        if (ac.signal.aborted) return;
        const usable = result.filter((l) => l.hours.length > 0);
        scanCache.set(sig, { at: Date.now(), locations: usable });
        setLocations(usable);
      } catch {
        if (!ac.signal.aborted) {
          /* Keep stale cache rather than blanking the card. */
          setLocations(cached?.locations ?? null);
        }
      } finally {
        if (!ac.signal.aborted) setPhase("resolved");
      }
    })();

    return () => {
      ac.abort();
    };
  }, [enabled, sig, geometry, waypoints, apiKey, weatherKitEnabled, refreshKey]);

  const analysis = useMemo(() => {
    if (!locations?.length || !waypoints?.length) return null;
    return analyzeDepartureTiming({
      locations,
      waypoints,
      tripEtaMin: planEtaMinutes ?? waypoints[waypoints.length - 1]?.travelMin ?? 60,
    });
  }, [locations, waypoints, planEtaMinutes]);

  const status: DepartureScanStatus =
    phase === "idle"
      ? "idle"
      : phase === "loading"
        ? "loading"
        : analysis != null
          ? analysis.status
          : "unavailable";

  return { status, analysis, refresh };
}
