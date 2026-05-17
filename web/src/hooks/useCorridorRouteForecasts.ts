import { useEffect, useMemo, useRef, useState } from "react";
import type { LngLat } from "../nav/types";
import { polylineLengthMeters } from "../nav/routeGeometry";
import {
  buildTimelinesWaypointsForGeometry,
  fetchRouteForecast,
  type RouteForecast,
} from "../services/tomorrowIo";

export type CorridorForecastLeg = {
  routeId: string;
  geometry: LngLat[];
  etaMinutes: number;
};

/**
 * Fetches Tomorrow.io corridor forecasts for every plan leg while the sheet is open (V2 leg compare).
 */
export function useCorridorRouteForecasts(
  apiKey: string,
  legs: CorridorForecastLeg[],
  speedMps: number,
  enabled: boolean
): { forecastsByLegId: Record<string, RouteForecast | null>; loading: boolean } {
  const [forecastsByLegId, setForecastsByLegId] = useState<Record<string, RouteForecast | null>>({});
  const [loading, setLoading] = useState(false);
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

  useEffect(() => {
    if (!enabled || !apiKey || !legs.length) {
      setForecastsByLegId({});
      setLoading(false);
      return;
    }

    let cancelled = false;
    const ac = new AbortController();
    setLoading(true);

    void (async () => {
      const next: Record<string, RouteForecast | null> = {};
      await Promise.all(
        legsRef.current.map(async (leg) => {
          if (cancelled) return;
          if (leg.geometry.length < 2 || polylineLengthMeters(leg.geometry) < 1000) {
            next[leg.routeId] = null;
            return;
          }
          const wps = buildTimelinesWaypointsForGeometry(leg.geometry, speedMps);
          if (!wps?.length) {
            next[leg.routeId] = null;
            return;
          }
          try {
            next[leg.routeId] = await fetchRouteForecast(apiKey, wps, ac.signal);
          } catch {
            next[leg.routeId] = null;
          }
        })
      );
      if (!cancelled) {
        setForecastsByLegId(next);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [apiKey, enabled, legsKey, speedMps]);

  return { forecastsByLegId, loading };
}
