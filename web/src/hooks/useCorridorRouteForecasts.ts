import { useEffect, useMemo, useRef, useState } from "react";
import type { LngLat } from "../nav/types";
import { polylineLengthMeters } from "../nav/routeGeometry";
import {
  buildTimelinesWaypointsForGeometry,
  fetchRouteForecast,
  isTomorrowIoRateLimited,
  type RouteForecast,
} from "../services/tomorrowIo";

export type CorridorForecastLeg = {
  routeId: string;
  geometry: LngLat[];
  etaMinutes: number;
};

/**
 * Fetches Tomorrow.io corridor forecast for the active leg only (V2 leg compare).
 * Previously viewed legs stay cached in memory so switching A/B/C does not re-hit the API.
 */
export function useCorridorRouteForecasts(
  apiKey: string,
  legs: CorridorForecastLeg[],
  speedMps: number,
  enabled: boolean,
  /** Reuse an existing forecast for this leg (avoids a duplicate Tomorrow.io call). */
  reuseForecast?: { routeId: string; forecast: RouteForecast | null } | null,
  /** Only fetch this leg while the sheet is open — saves 2 calls vs loading A/B/C at once. */
  activeLegId?: string
): { forecastsByLegId: Record<string, RouteForecast | null>; loading: boolean } {
  const [forecastsByLegId, setForecastsByLegId] = useState<Record<string, RouteForecast | null>>({});
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef<Record<string, RouteForecast | null>>({});

  const legsKey = useMemo(
    () =>
      legs
        .map((l) => {
          const g = l.geometry;
          const end = g[g.length - 1];
          return `${l.routeId}:${l.etaMinutes}:${g.length}:${end?.[0]?.toFixed(3)}`;
        })
        .join("|"),
    [legs]
  );

  const legsRef = useRef(legs);
  legsRef.current = legs;

  const targetLegId = activeLegId || legs[0]?.routeId || "";

  useEffect(() => {
    if (!enabled || !apiKey || !legs.length || !targetLegId) {
      if (!enabled) {
        setForecastsByLegId({});
        cacheRef.current = {};
      }
      setLoading(false);
      return;
    }

    const leg = legsRef.current.find((l) => l.routeId === targetLegId);
    if (!leg) {
      setLoading(false);
      return;
    }

    if (
      reuseForecast?.routeId === leg.routeId &&
      reuseForecast.forecast != null
    ) {
      cacheRef.current[leg.routeId] = reuseForecast.forecast;
      setForecastsByLegId((prev) => ({ ...prev, [leg.routeId]: reuseForecast.forecast }));
      setLoading(false);
      return;
    }

    const cached = cacheRef.current[leg.routeId];
    if (cached != null) {
      setForecastsByLegId((prev) => ({ ...prev, [leg.routeId]: cached }));
      setLoading(false);
      return;
    }

    let cancelled = false;
    const ac = new AbortController();
    setLoading(true);

    void (async () => {
      if (isTomorrowIoRateLimited()) {
        if (!cancelled) setLoading(false);
        return;
      }

      if (leg.geometry.length < 2 || polylineLengthMeters(leg.geometry) < 1000) {
        cacheRef.current[leg.routeId] = null;
        if (!cancelled) {
          setForecastsByLegId((prev) => ({ ...prev, [leg.routeId]: null }));
          setLoading(false);
        }
        return;
      }

      const wps = buildTimelinesWaypointsForGeometry(leg.geometry, speedMps);
      if (!wps?.length) {
        cacheRef.current[leg.routeId] = null;
        if (!cancelled) {
          setForecastsByLegId((prev) => ({ ...prev, [leg.routeId]: null }));
          setLoading(false);
        }
        return;
      }

      try {
        const forecast = await fetchRouteForecast(apiKey, wps, ac.signal, {
          geometry: leg.geometry,
        });
        cacheRef.current[leg.routeId] = forecast;
        if (!cancelled) {
          setForecastsByLegId((prev) => ({ ...prev, [leg.routeId]: forecast }));
        }
      } catch {
        cacheRef.current[leg.routeId] = null;
        if (!cancelled) {
          setForecastsByLegId((prev) => ({ ...prev, [leg.routeId]: null }));
        }
      }
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [
    apiKey,
    enabled,
    legsKey,
    speedMps,
    targetLegId,
    reuseForecast?.routeId,
    reuseForecast?.forecast,
  ]);

  return { forecastsByLegId, loading };
}
