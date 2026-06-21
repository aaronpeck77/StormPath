/**
 * Tomorrow.io weather hooks.
 *
 * useTomorrowMinutePrecip – 60-minute precipitation outlook at the user's position.
 * useTomorrowRouteForecast – hourly conditions along the active route.
 *
 * Both hooks are no-ops when apiKey is falsy, so they degrade gracefully
 * in dev/CI environments without a Tomorrow.io key.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  fetchWeatherKitMinutePrecip,
  fetchWeatherKitPointHourly,
  fetchWeatherKitRouteForecast,
  isWeatherKitTokenBlocked,
} from "../services/weatherKit";
import {
  QUOTA_NO_ROUTE_FORECAST_NOTE,
  corridorRouteSig,
  readRouteForecastCache,
  STALE_ROUTE_FORECAST_NOTE,
  writeRouteForecastCache,
} from "../services/routeCorridorWeatherCache";

// ── Minute precip ─────────────────────────────────────────────────────────────

/** How often to re-fetch the minute precip (5 min idle; shorter while navigating so
 *  rapidly-developing storms register quickly). */
const MINUTE_PRECIP_POLL_MS = 5 * 60 * 1000;
const MINUTE_PRECIP_POLL_NAV_MS = 8 * 60 * 1000;
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
  slowPollWhileNavigating = false,
  weatherKitEnabled = false
): MinutePrecipForecast | null {
  const pollMs = slowPollWhileNavigating ? MINUTE_PRECIP_POLL_NAV_MS : MINUTE_PRECIP_POLL_MS;
  const [forecast, setForecast] = useState<MinutePrecipForecast | null>(null);
  const lastFetchLngLat = useRef<LngLat | null>(null);
  const lastFetchTime = useRef<number>(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const hasProvider = weatherKitEnabled || Boolean(apiKey);
    if (!enabled || !hasProvider || !userLngLat) return;
    if (!weatherKitEnabled && isTomorrowIoRateLimited()) return;
    if (weatherKitEnabled && isWeatherKitTokenBlocked()) return;

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

    const fetcher = weatherKitEnabled
      ? fetchWeatherKitMinutePrecip(lat, lng, ac.signal)
      : fetchMinutePrecip(apiKey, lat, lng, ac.signal);

    fetcher
      .then((f) => { if (!ac.signal.aborted) setForecast(f); })
      .catch((e) => {
        if (!ac.signal.aborted && import.meta.env.DEV) {
          console.warn("[Weather] minute precip fetch failed:", e);
        }
      });

    return () => { ac.abort(); };
  }, [
    enabled,
    apiKey,
    weatherKitEnabled,
    // Quantise position to ~3 km grid to avoid re-firing on every GPS tick.
    userLngLat ? Math.round(userLngLat[0] * 33) : null,
    userLngLat ? Math.round(userLngLat[1] * 33) : null,
    pollMs,
  ]);

  // Set up a timer to re-fetch on poll interval regardless of movement.
  useEffect(() => {
    const hasProvider = weatherKitEnabled || Boolean(apiKey);
    if (!enabled || !hasProvider || !userLngLat) return;
    const id = setInterval(() => {
      lastFetchTime.current = 0; // force refresh on next position update
    }, pollMs);
    return () => clearInterval(id);
  }, [enabled, apiKey, weatherKitEnabled, !!userLngLat, pollMs]);

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
  openWeatherEnabled = true,
  weatherKitEnabled = false
): PointHourlyForecast | null {
  const [forecast, setForecast] = useState<PointHourlyForecast | null>(null);
  const lastFetchLngLat = useRef<LngLat | null>(null);
  const lastFetchTime = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || !userLngLat) return;
    if (!weatherKitEnabled && !tioApiKey && !openWeatherApiKey) return;

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
      if (weatherKitEnabled && !isWeatherKitTokenBlocked() && !ac.signal.aborted) {
        try {
          const f = await fetchWeatherKitPointHourly(lat, lng, ac.signal);
          if (!ac.signal.aborted) {
            setForecast(f);
            return;
          }
        } catch (e) {
          if (!ac.signal.aborted && import.meta.env.DEV) {
            console.warn("[WeatherKit] point hourly failed:", e);
          }
        }
      }
      if (tioApiKey && !weatherKitEnabled && !isTomorrowIoRateLimited() && !ac.signal.aborted) {
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
        !weatherKitEnabled &&
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
    weatherKitEnabled,
    tioApiKey,
    openWeatherApiKey,
    openWeatherEnabled,
    userLngLat ? Math.round(userLngLat[0] * 20) : null,
    userLngLat ? Math.round(userLngLat[1] * 20) : null,
  ]);

  useEffect(() => {
    if (!enabled || !userLngLat) return;
    if (!weatherKitEnabled && !tioApiKey && !openWeatherApiKey) return;
    const id = setInterval(() => {
      lastFetchTime.current = 0;
    }, HOURLY_POINT_POLL_MS);
    return () => clearInterval(id);
  }, [enabled, openWeatherEnabled, weatherKitEnabled, tioApiKey, openWeatherApiKey, !!userLngLat]);

  return forecast;
}

// ── Route forecast ────────────────────────────────────────────────────────────

/** Re-fetch when route changes or every 15 min — severe weather can develop fast. */
const ROUTE_FORECAST_POLL_MS = 15 * 60 * 1000;

export type RouteForecastHookResult = {
  forecast: RouteForecast | null;
  bumpRouteForecastRefresh: () => void;
  routeForecastRefreshing: boolean;
  routeForecastRefreshBlocked: string | null;
  routeForecastUsingCache: boolean;
};

/**
 * Fetches hourly weather conditions along the active route, sampled at regular
 * intervals. Returns null forecast when no route or no API key.
 *
 * @param speedMps - Current/estimated driving speed in m/s (used to estimate
 *   ETA at each waypoint).
 */
export function useTomorrowRouteForecast(
  apiKey: string,
  routeGeometry: LngLat[] | null,
  speedMps: number,
  enabled = false,
  weatherKitEnabled = false
): RouteForecastHookResult {
  const [forecast, setForecast] = useState<RouteForecast | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshBlocked, setRefreshBlocked] = useState<string | null>(null);
  const [usingCache, setUsingCache] = useState(false);
  const lastRouteSig = useRef("");
  const lastFetchTime = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const forceRefreshRef = useRef(false);

  const applyCachedForecast = useCallback(
    (sig: string, geometry: LngLat[] | null): RouteForecast | null => {
      const cached = readRouteForecastCache(sig, geometry);
      if (!cached?.intervals.length) return null;
      setForecast(cached);
      setUsingCache(true);
      return cached;
    },
    []
  );

  const bumpRouteForecastRefresh = useCallback(() => {
    lastRouteSig.current = "";
    lastFetchTime.current = 0;
    forceRefreshRef.current = true;
    setRefreshBlocked(null);
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
  }, []);

  const waypoints = useMemo(
    () => (routeGeometry ? buildTimelinesWaypointsForGeometry(routeGeometry, speedMps) : null),
    [routeGeometry, speedMps]
  );

  const routeSig = useMemo(
    () => (routeGeometry?.length ? corridorRouteSig(routeGeometry) : ""),
    [routeGeometry]
  );

  useEffect(() => {
    if (!routeSig || !routeGeometry?.length) {
      setForecast(null);
      setUsingCache(false);
      setRefreshBlocked(null);
      lastRouteSig.current = "";
      return;
    }
    const cached = readRouteForecastCache(routeSig, routeGeometry);
    if (cached?.intervals.length) {
      setForecast(cached);
      setUsingCache(true);
    } else {
      setForecast(null);
      setUsingCache(false);
    }
  }, [routeSig, routeGeometry]);

  useEffect(() => {
    const force = forceRefreshRef.current;
    if (force) forceRefreshRef.current = false;

    if (!routeSig) {
      setRefreshing(false);
      return;
    }

    const hasProvider = weatherKitEnabled || Boolean(apiKey);
    if (!hasProvider || !waypoints) {
      if (force) {
        setRefreshBlocked("Route weather unavailable — no API key or route shape.");
      }
      setRefreshing(false);
      return;
    }

    const rateLimited = weatherKitEnabled
      ? isWeatherKitTokenBlocked()
      : isTomorrowIoRateLimited();
    const showCachedOnly = (note: string) => {
      if (routeGeometry && applyCachedForecast(routeSig, routeGeometry)) {
        setRefreshBlocked(note);
      } else {
        setRefreshBlocked(QUOTA_NO_ROUTE_FORECAST_NOTE);
      }
      setRefreshing(false);
    };

    // Track whether the route itself changed so we can bypass the per-location
    // in-memory cache.  A brand-new route must never serve 12-min-old data.
    const isNewRoute = routeSig !== lastRouteSig.current;

    if (!force) {
      if (!enabled) {
        if (!forecast && routeGeometry) applyCachedForecast(routeSig, routeGeometry);
        setRefreshing(false);
        return;
      }
      if (rateLimited) {
        showCachedOnly(STALE_ROUTE_FORECAST_NOTE);
        return;
      }

      const now = Date.now();
      const stale = now - lastFetchTime.current > ROUTE_FORECAST_POLL_MS;

      if (!isNewRoute && !stale) return;
    } else if (rateLimited) {
      showCachedOnly(STALE_ROUTE_FORECAST_NOTE);
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setRefreshing(true);
    setRefreshBlocked(null);

    // Bypass the per-location cache whenever the route changes or a manual
    // refresh was requested — stale location data is the most common reason
    // the app shows "light rain" when driving into a severe storm.
    const fetcher = weatherKitEnabled
      ? fetchWeatherKitRouteForecast(waypoints, ac.signal, (force || isNewRoute) ? { bypassCache: true } : undefined)
      : fetchRouteForecast(apiKey, waypoints, ac.signal, (force || isNewRoute) ? { bypassCache: true } : undefined);

    fetcher
      .then((f) => {
        if (!ac.signal.aborted) {
          lastRouteSig.current = routeSig;
          lastFetchTime.current = Date.now();
          writeRouteForecastCache(routeSig, f, routeGeometry);
          setForecast(f);
          setUsingCache(false);
          setRefreshBlocked(null);
        }
      })
      .catch((e) => {
        if (!ac.signal.aborted) {
          const limited = weatherKitEnabled
            ? isWeatherKitTokenBlocked() || String(e).includes("token")
            : isTomorrowIoRateLimited() || String(e).includes("rate limited");
          if (limited) {
            showCachedOnly(STALE_ROUTE_FORECAST_NOTE);
          } else if (import.meta.env.DEV) {
            console.warn("[Weather] route forecast fetch failed:", e);
          }
        }
      })
      .finally(() => {
        if (!ac.signal.aborted) setRefreshing(false);
      });

    return () => {
      ac.abort();
    };
  }, [enabled, apiKey, weatherKitEnabled, routeSig, routeGeometry, waypoints, refreshKey, applyCachedForecast, forecast]);

  return {
    forecast,
    bumpRouteForecastRefresh,
    routeForecastRefreshing: refreshing,
    routeForecastRefreshBlocked: refreshBlocked,
    routeForecastUsingCache: usingCache,
  };
}
