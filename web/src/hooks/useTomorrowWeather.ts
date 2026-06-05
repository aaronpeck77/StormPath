/**
 * Tomorrow.io weather hooks.
 *
 * useTomorrowMinutePrecip – 60-minute precipitation outlook at the user's position.
 * useTomorrowRouteForecast – hourly conditions along the active route.
 *
 * Both hooks are no-ops when apiKey is falsy, so they degrade gracefully
 * in dev/CI environments without a Tomorrow.io key.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { LngLat } from "../nav/types";
import {
  fetchOpenWeatherPointHourly24h,
  isOpenWeatherRateLimited,
} from "../services/openWeatherClient";
import {
  buildTimelinesWaypointsForGeometry,
  fetchMinutePrecip,
  fetchPointHourlyForecast,
  fetchRouteForecast,
  isTomorrowIoRateLimited,
  type MinutePrecipForecast,
  type PointHourlyForecast,
  type RouteForecast,
} from "../services/tomorrowIo";

// ── Minute precip ─────────────────────────────────────────────────────────────

/** How often to re-fetch the minute precip (5 min idle; slower while navigating). */
const MINUTE_PRECIP_POLL_MS = 5 * 60 * 1000;
const MINUTE_PRECIP_POLL_NAV_MS = 20 * 60 * 1000;
/** How many meters the user must move before a fresh fetch is triggered. */
const MINUTE_PRECIP_MOVE_THRESHOLD_M = 3000;

function haversineM(a: LngLat, b: LngLat): number {
  const R = 6_371_000;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[1] * Math.PI) / 180) *
      Math.cos((b[1] * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/**
 * Fetches and caches a 60-minute minute-by-minute precipitation outlook.
 * Re-fetches every 5 minutes or when the user moves > 3 km.
 */
export function useTomorrowMinutePrecip(
  apiKey: string,
  userLngLat: LngLat | null,
  /** When false, no network calls (saves Tomorrow.io hourly quota until user opens weather UI). */
  enabled = false,
  /** Slower refresh while navigating — corridor route forecast covers the leg. */
  slowPollWhileNavigating = false
): MinutePrecipForecast | null {
  const pollMs = slowPollWhileNavigating ? MINUTE_PRECIP_POLL_NAV_MS : MINUTE_PRECIP_POLL_MS;
  const [forecast, setForecast] = useState<MinutePrecipForecast | null>(null);
  const lastFetchLngLat = useRef<LngLat | null>(null);
  const lastFetchTime = useRef<number>(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || !apiKey || !userLngLat || isTomorrowIoRateLimited()) return;

    const now = Date.now();
    const lastLng = lastFetchLngLat.current;
    const tooSoon = now - lastFetchTime.current < pollMs;
    const tooClose =
      lastLng != null && haversineM(lastLng, userLngLat) < MINUTE_PRECIP_MOVE_THRESHOLD_M;

    if (tooSoon && tooClose) return;

    // Abort any in-flight request.
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const [lng, lat] = userLngLat;
    lastFetchTime.current = now;
    lastFetchLngLat.current = userLngLat;

    fetchMinutePrecip(apiKey, lat, lng, ac.signal)
      .then((f) => { if (!ac.signal.aborted) setForecast(f); })
      .catch((e) => {
        if (!ac.signal.aborted && !isTomorrowIoRateLimited()) {
          if (import.meta.env.DEV) console.warn("[TomorrowIO] minute precip fetch failed:", e);
        }
      });

    return () => { ac.abort(); };
  }, [
    enabled,
    apiKey,
    // Quantise position to ~3 km grid to avoid re-firing on every GPS tick.
    userLngLat ? Math.round(userLngLat[0] * 33) : null,
    userLngLat ? Math.round(userLngLat[1] * 33) : null,
    pollMs,
  ]);

  // Set up a timer to re-fetch on poll interval regardless of movement.
  useEffect(() => {
    if (!enabled || !apiKey || !userLngLat) return;
    const id = setInterval(() => {
      lastFetchTime.current = 0; // force refresh on next position update
    }, pollMs);
    return () => clearInterval(id);
  }, [enabled, apiKey, !!userLngLat, pollMs]);

  return forecast;
}

// ── Local 24-hour hourly ──────────────────────────────────────────────────────

const HOURLY_POINT_POLL_MS = 30 * 60 * 1000;
const HOURLY_POINT_MOVE_THRESHOLD_M = 5000;

/**
 * 24-hour hourly outlook at the user's position.
 * Tomorrow.io (1 h steps) when available; otherwise OpenWeather (3 h steps).
 */
export function useLocalHourlyForecast(
  tioApiKey: string,
  openWeatherApiKey: string,
  userLngLat: LngLat | null,
  enabled = false,
  /** When false, skip OpenWeather hourly even if a key is set (Tomorrow.io is primary). */
  openWeatherEnabled = true
): PointHourlyForecast | null {
  const [forecast, setForecast] = useState<PointHourlyForecast | null>(null);
  const lastFetchLngLat = useRef<LngLat | null>(null);
  const lastFetchTime = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || !userLngLat) return;
    if (!tioApiKey && !openWeatherApiKey) return;

    const now = Date.now();
    const lastLng = lastFetchLngLat.current;
    const tooSoon = now - lastFetchTime.current < HOURLY_POINT_POLL_MS;
    const tooClose =
      lastLng != null && haversineM(lastLng, userLngLat) < HOURLY_POINT_MOVE_THRESHOLD_M;
    if (tooSoon && tooClose) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const [lng, lat] = userLngLat;
    lastFetchTime.current = now;
    lastFetchLngLat.current = userLngLat;

    const run = async () => {
      if (tioApiKey && !isTomorrowIoRateLimited() && !ac.signal.aborted) {
        try {
          const f = await fetchPointHourlyForecast(tioApiKey, lat, lng, ac.signal);
          if (!ac.signal.aborted) {
            setForecast(f);
            return;
          }
        } catch (e) {
          if (!ac.signal.aborted && !isTomorrowIoRateLimited() && import.meta.env.DEV) {
            console.warn("[TomorrowIO] point hourly failed:", e);
          }
        }
      }
      if (
        openWeatherEnabled &&
        openWeatherApiKey &&
        !isOpenWeatherRateLimited() &&
        !ac.signal.aborted
      ) {
        try {
          const f = await fetchOpenWeatherPointHourly24h(openWeatherApiKey, lat, lng);
          if (!ac.signal.aborted) setForecast(f);
        } catch (e) {
          if (
            !ac.signal.aborted &&
            import.meta.env.DEV &&
            !isOpenWeatherRateLimited() &&
            !(e instanceof Error && e.message.includes("rate limited"))
          ) {
            console.warn("[OpenWeather] point hourly failed:", e);
          }
        }
      }
    };

    void run();
    return () => {
      ac.abort();
    };
  }, [
    enabled,
    tioApiKey,
    openWeatherApiKey,
    userLngLat ? Math.round(userLngLat[0] * 20) : null,
    userLngLat ? Math.round(userLngLat[1] * 20) : null,
  ]);

  useEffect(() => {
    if (!enabled || !userLngLat || (!tioApiKey && !openWeatherApiKey)) return;
    const id = setInterval(() => {
      lastFetchTime.current = 0;
    }, HOURLY_POINT_POLL_MS);
    return () => clearInterval(id);
  }, [enabled, openWeatherEnabled, tioApiKey, openWeatherApiKey, !!userLngLat]);

  return forecast;
}

// ── Route forecast ────────────────────────────────────────────────────────────

/** Re-fetch when route changes or every 45 min. */
const ROUTE_FORECAST_POLL_MS = 45 * 60 * 1000;

/**
 * Fetches hourly weather conditions along the active route, sampled at regular
 * intervals. Returns null when no route or no API key.
 *
 * @param speedMps - Current/estimated driving speed in m/s (used to estimate
 *   ETA at each waypoint).
 */
export function useTomorrowRouteForecast(
  apiKey: string,
  routeGeometry: LngLat[] | null,
  speedMps: number,
  enabled = false
): RouteForecast | null {
  const [forecast, setForecast] = useState<RouteForecast | null>(null);
  const lastRouteSig = useRef("");
  const lastFetchTime = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const waypoints = useMemo(
    () => (routeGeometry ? buildTimelinesWaypointsForGeometry(routeGeometry, speedMps) : null),
    [routeGeometry, speedMps]
  );

  const routeSig = useMemo(() => {
    if (!routeGeometry?.length) return "";
    const s = routeGeometry;
    return `${s[0]?.[0]?.toFixed(3)},${s[0]?.[1]?.toFixed(3)}_${s[s.length - 1]?.[0]?.toFixed(3)},${s[s.length - 1]?.[1]?.toFixed(3)}_${s.length}`;
  }, [routeGeometry]);

  useEffect(() => {
    if (!enabled || !apiKey || !waypoints) {
      if (!enabled) return;
      setForecast(null);
      return;
    }
    if (isTomorrowIoRateLimited()) return;

    const now = Date.now();
    const routeChanged = routeSig !== lastRouteSig.current;
    const stale = now - lastFetchTime.current > ROUTE_FORECAST_POLL_MS;

    if (!routeChanged && !stale) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    lastRouteSig.current = routeSig;
    lastFetchTime.current = now;

    fetchRouteForecast(apiKey, waypoints, ac.signal)
      .then((f) => { if (!ac.signal.aborted) setForecast(f); })
      .catch((e) => {
        if (!ac.signal.aborted && !isTomorrowIoRateLimited()) {
          if (import.meta.env.DEV) console.warn("[TomorrowIO] route forecast fetch failed:", e);
        }
      });

    return () => { ac.abort(); };
  }, [enabled, apiKey, routeSig, waypoints]);

  return forecast;
}
