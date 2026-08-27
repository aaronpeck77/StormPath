/**
 * Fetch WeatherKit weather alerts at the user's current location.
 * Works internationally — fills the advisory gap for non-US users where NWS has no coverage.
 * In the US the NWS alerts are the primary source; WeatherKit alerts are supplementary and
 * deduplicated by event+area on the display side.
 */
import { useEffect, useRef, useState } from "react";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";
import { fetchWeatherKitAlerts } from "../services/weatherKit";
import { weatherKitAlertPollKey } from "../services/weatherKitClient";
import type { LngLat } from "./types";

const POLL_INTERVAL_MS = 15 * 60 * 1000; // county-scale; NWS is still the US primary

export function useWeatherKitAlerts(opts: {
  enabled: boolean;
  userLngLat: LngLat | null;
  appForeground: boolean;
}): NormalizedWeatherAlert[] {
  const { enabled, userLngLat, appForeground } = opts;
  const [alerts, setAlerts] = useState<NormalizedWeatherAlert[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const userLngLatRef = useRef(userLngLat);
  userLngLatRef.current = userLngLat;
  const pollKey =
    userLngLat && Number.isFinite(userLngLat[0]) && Number.isFinite(userLngLat[1])
      ? weatherKitAlertPollKey(userLngLat[1], userLngLat[0])
      : null;

  useEffect(() => {
    if (!enabled || !appForeground || !pollKey) {
      setAlerts([]);
      return;
    }

    let cancelled = false;

    const run = async () => {
      const pos = userLngLatRef.current;
      if (!pos) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const [lng, lat] = pos;
        const result = await fetchWeatherKitAlerts(lat, lng, ac.signal);
        if (!cancelled) setAlerts(result);
      } catch {
        // Silently swallow — NWS is primary; WK alerts are supplementary
      }
    };

    void run();
    const id = window.setInterval(() => void run(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [enabled, appForeground, pollKey]);

  return alerts;
}
