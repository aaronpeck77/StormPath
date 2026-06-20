import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { LngLat, TripPlan } from "../nav/types";
import {
  isOpenWeatherRateLimited,
  weatherForecastAlongRoute,
  weatherHintSamplesAlongPolyline,
  weatherSamplesFromRoutePoints,
} from "../services/openWeatherClient";
import type { WeatherOverlay } from "../situation/fusedSnapshot";
import {
  readRouteOwOverlayCache,
  writeRouteOwOverlayCache,
} from "../services/routeCorridorWeatherCache";

const OW_OVERLAY_MIN_MS = 20 * 60 * 1000;

export type UseWeatherOverlayFetchDeps = {
  planRef: MutableRefObject<TripPlan>;
  routingRef: MutableRefObject<boolean>;
  navigationStarted: boolean;
  destLngLat: LngLat | null;
  isPlus: boolean;
  isOnline: boolean;
  openWeatherApiKey: string;
  settingWeatherHintsEnabled: boolean;
  settingStormEnabled: boolean;
  dataSaverMode: boolean;
  progressCalloutsOpen: boolean;
  weatherOverlayLegId: string;
  weatherOverlayGeomKey: string;
  setWeatherOverlay: (v: WeatherOverlay | undefined) => void;
};

export type WeatherOverlayRefreshControls = {
  weatherRefreshRef: MutableRefObject<number>;
  bumpWeatherRefresh: () => void;
  resetWeatherOverlayThrottle: () => void;
  weatherOverlayRefreshing: boolean;
};

export function useWeatherOverlayFetch(
  deps: UseWeatherOverlayFetchDeps
): WeatherOverlayRefreshControls {
  const {
    planRef,
    routingRef,
    navigationStarted,
    destLngLat,
    isPlus,
    isOnline,
    openWeatherApiKey,
    settingWeatherHintsEnabled,
    settingStormEnabled,
    dataSaverMode,
    progressCalloutsOpen,
    weatherOverlayLegId,
    weatherOverlayGeomKey,
    setWeatherOverlay,
  } = deps;

  const lastOwOverlayGeomKeyRef = useRef("");
  const lastOwOverlayAtRef = useRef(0);
  const weatherRefreshRef = useRef(0);
  const forceWeatherRefreshRef = useRef(false);
  const [weatherRefreshKey, setWeatherRefreshKey] = useState(0);
  const [weatherOverlayRefreshing, setWeatherOverlayRefreshing] = useState(false);

  const bumpWeatherRefresh = useCallback(() => {
    forceWeatherRefreshRef.current = true;
    weatherRefreshRef.current += 1;
    setWeatherRefreshKey(weatherRefreshRef.current);
    setWeatherOverlayRefreshing(true);
  }, []);

  const resetWeatherOverlayThrottle = useCallback(() => {
    lastOwOverlayGeomKeyRef.current = "";
    lastOwOverlayAtRef.current = 0;
  }, []);

  useEffect(() => {
    const force = forceWeatherRefreshRef.current;
    if (force) forceWeatherRefreshRef.current = false;

    const finish = () => {
      if (force) setWeatherOverlayRefreshing(false);
    };

    const applyOwCache = () => {
      const cached = readRouteOwOverlayCache(weatherOverlayGeomKey);
      if (!cached) return false;
      setWeatherOverlay({
        [cached.legId]: {
          headline: cached.headline,
          precipHint: cached.precipHint,
          samples: cached.samples,
        },
      });
      return true;
    };

    if (!force && routingRef.current) {
      finish();
      return;
    }
    const hasPlannedRoute = Boolean(
      destLngLat && planRef.current.routes.some((r) => r.geometry && r.geometry.length >= 2)
    );
    if (!navigationStarted && !hasPlannedRoute) {
      setWeatherOverlay(undefined);
      lastOwOverlayGeomKeyRef.current = "";
      lastOwOverlayAtRef.current = 0;
      finish();
      return;
    }

    const owKey = openWeatherApiKey;
    const wantOpenWeather =
      Boolean(owKey) &&
      (settingWeatherHintsEnabled || settingStormEnabled || progressCalloutsOpen);
    if (!isPlus || !isOnline || !weatherOverlayLegId || !weatherOverlayGeomKey || !wantOpenWeather) {
      if (force || progressCalloutsOpen) {
        applyOwCache();
      } else {
        setWeatherOverlay(undefined);
      }
      finish();
      return;
    }
    if (isOpenWeatherRateLimited()) {
      applyOwCache();
      finish();
      return;
    }

    const geomUnchanged = weatherOverlayGeomKey === lastOwOverlayGeomKeyRef.current;
    if (!force && geomUnchanged && Date.now() - lastOwOverlayAtRef.current < OW_OVERLAY_MIN_MS) {
      applyOwCache();
      finish();
      return;
    }

    const routes = planRef.current.routes;
    const r = routes.find((x) => x.id === weatherOverlayLegId) ?? routes[0];
    if (!r?.geometry?.length) {
      if (force || progressCalloutsOpen) {
        applyOwCache();
      } else {
        setWeatherOverlay(undefined);
      }
      finish();
      return;
    }

    let cancelled = false;
    if (force) setWeatherOverlayRefreshing(true);

    void (async () => {
      let headline = "";
      let precipHint = 0;
      let samples: NonNullable<WeatherOverlay[string]>["samples"] | undefined;

      const eta = r.baseEtaMinutes ?? 30;

      if (wantOpenWeather && owKey) {
        try {
          if (!cancelled && !isOpenWeatherRateLimited()) {
            const fc = await weatherForecastAlongRoute(owKey, r.geometry, eta);
            if (!cancelled && fc.points.length) {
              headline = fc.headline;
              precipHint = fc.precipHint ?? 0;
              samples = weatherSamplesFromRoutePoints(fc.points);
            }
          }
          if (!cancelled && !samples?.length && !isOpenWeatherRateLimited()) {
            const hint = await weatherHintSamplesAlongPolyline(owKey, r.geometry);
            if (!cancelled) {
              headline = hint.headline;
              precipHint = hint.precipHint ?? 0;
              samples = hint.samples;
            }
          }
        } catch {
          /* keep previous overlay on failure */
        }
      }

      if (cancelled) return;
      lastOwOverlayGeomKeyRef.current = weatherOverlayGeomKey;
      lastOwOverlayAtRef.current = Date.now();

      if (precipHint > 0 || headline.trim() || samples?.length) {
        const payload = {
          headline: headline.trim() || "Conditions along route",
          precipHint,
          samples,
        };
        setWeatherOverlay({ [r.id]: payload });
        writeRouteOwOverlayCache(weatherOverlayGeomKey, r.id, payload);
      } else if (!force) {
        setWeatherOverlay(undefined);
      }
    })().finally(() => {
      if (!cancelled) setWeatherOverlayRefreshing(false);
    });

    return () => {
      cancelled = true;
    };
  }, [
    weatherOverlayGeomKey,
    weatherOverlayLegId,
    weatherRefreshKey,
    openWeatherApiKey,
    settingWeatherHintsEnabled,
    settingStormEnabled,
    dataSaverMode,
    isOnline,
    navigationStarted,
    destLngLat,
    isPlus,
    progressCalloutsOpen,
    planRef,
    routingRef,
    setWeatherOverlay,
  ]);

  return {
    weatherRefreshRef,
    bumpWeatherRefresh,
    resetWeatherOverlayThrottle,
    weatherOverlayRefreshing,
  };
}
