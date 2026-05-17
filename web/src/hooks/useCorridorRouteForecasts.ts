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
 * Fetches Tomorrow.io corridor forecasts for every plan leg while the sheet is open (V2 leg compare).
 */
export function useCorridorRouteForecasts(
  apiKey: string,
  legs: CorridorForecastLeg[],
  speedMps: number,
  enabled: boolean,
  /** Reuse an existing forecast for this leg (avoids a duplicate Tomorrow.io call). */
  reuseForecast?: { routeId: string; forecast: RouteForecast | null } | null
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
      if (isTomorrowIoRateLimited()) {
        if (!cancelled) {
          setForecastsByLegId({});
          setLoading(false);
        }
        return;
      }

      const next: Record<string, RouteForecast | null> = {};
      for (const leg of legsRef.current) {
        if (cancelled || ac.signal.aborted) break;
        if (isTomorrowIoRateLimited()) break;
        if (
          reuseForecast?.routeId === leg.routeId &&
          reuseForecast.forecast != null
        ) {
          next[leg.routeId] = reuseForecast.forecast;
          continue;
        }
        if (leg.geometry.length < 2 || polylineLengthMeters(leg.geometry) < 1000) {
          next[leg.routeId] = null;
          continue;
        }
        const wps = buildTimelinesWaypointsForGeometry(leg.geometry, speedMps);
        if (!wps?.length) {
          next[leg.routeId] = null;
          continue;
        }
        try {
          next[leg.routeId] = await fetchRouteForecast(apiKey, wps, ac.signal);
        } catch {
          next[leg.routeId] = null;
        }
      }
      if (!cancelled) {
        setForecastsByLegId(next);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [apiKey, enabled, legsKey, speedMps, reuseForecast?.routeId, reuseForecast?.forecast]);

  return { forecastsByLegId, loading };
}
