import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { LngLat } from "../nav/types";
import { haversineMeters } from "../nav/routeGeometry";
import {
  fetchCurrentNowcast,
  isOpenWeatherRateLimited,
  type CurrentNowcast,
} from "../services/openWeatherClient";
import { fetchWeatherKitCurrentNowcast, isWeatherKitTokenBlocked } from "../services/weatherKit";

export type UseOpenWeatherNowcastDeps = {
  isPlus: boolean;
  isOnline: boolean;
  openWeatherApiKey: string;
  weatherKitEnabled?: boolean;
  userLngLat: LngLat | null;
  userLngLatRef: MutableRefObject<LngLat | null>;
};

export function useOpenWeatherNowcast(deps: UseOpenWeatherNowcastDeps): CurrentNowcast | null {
  const { isPlus, isOnline, openWeatherApiKey, weatherKitEnabled = false, userLngLat, userLngLatRef } = deps;

  const [currentNowcast, setCurrentNowcast] = useState<CurrentNowcast | null>(null);
  const lastNowcastFixRef = useRef<{ lng: number; lat: number; tMs: number } | null>(null);
  const lastNowcastFailureRef = useRef<{ lng: number; lat: number; tMs: number } | null>(null);
  const nowcastFetchInFlightRef = useRef(false);
  const nowcastMountedRef = useRef(true);

  useEffect(() => {
    nowcastMountedRef.current = true;
    return () => {
      nowcastMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isPlus) {
      setCurrentNowcast(null);
      return;
    }
    if (!isOnline) return;
    const hasProvider = weatherKitEnabled || Boolean(openWeatherApiKey);
    if (!hasProvider) return;
    if (!weatherKitEnabled && isOpenWeatherRateLimited()) return;
    if (weatherKitEnabled && isWeatherKitTokenBlocked()) return;
    if (!userLngLat) return;
    const [lng, lat] = userLngLat;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

    const NOW_REFRESH_MS = 10 * 60 * 1000;
    const NOW_FAR_M = 25_000;
    const NOW_FAIL_RETRY_MS = 90 * 1000;
    const NOW_FAIL_RETRY_MOVE_M = 5_000;
    const NOW_RATE_LIMIT_RETRY_MS = 60 * 60 * 1000;
    const last = lastNowcastFixRef.current;
    const now = Date.now();
    if (last) {
      const farEnough = haversineMeters([last.lng, last.lat], [lng, lat]) >= NOW_FAR_M;
      const ageMs = now - last.tMs;
      if (!farEnough && ageMs < NOW_REFRESH_MS) return;
    }
    const lastFailure = lastNowcastFailureRef.current;
    if (lastFailure) {
      const movedEnough =
        haversineMeters([lastFailure.lng, lastFailure.lat], [lng, lat]) >= NOW_FAIL_RETRY_MOVE_M;
      const ageMs = now - lastFailure.tMs;
      const retryMs = weatherKitEnabled
        ? 2 * 60 * 1000
        : isOpenWeatherRateLimited()
          ? NOW_RATE_LIMIT_RETRY_MS
          : NOW_FAIL_RETRY_MS;
      if (!movedEnough && ageMs < retryMs) return;
    }
    if (nowcastFetchInFlightRef.current) return;

    void (async () => {
      nowcastFetchInFlightRef.current = true;
      try {
        const nc = weatherKitEnabled
          ? await fetchWeatherKitCurrentNowcast(lat, lng)
          : await fetchCurrentNowcast(openWeatherApiKey, lat, lng);
        lastNowcastFixRef.current = { lng, lat, tMs: nc.fetchedAtMs };
        lastNowcastFailureRef.current = null;
        if (nowcastMountedRef.current) setCurrentNowcast(nc);
      } catch {
        lastNowcastFailureRef.current = { lng, lat, tMs: Date.now() };
      } finally {
        nowcastFetchInFlightRef.current = false;
      }
    })();
  }, [isPlus, userLngLat, isOnline, openWeatherApiKey, weatherKitEnabled]);

  useEffect(() => {
    if (!isPlus) return;
    if (!isOnline) return;
    if (!weatherKitEnabled && !openWeatherApiKey) return;
    const id = window.setInterval(() => {
      if (!weatherKitEnabled && isOpenWeatherRateLimited()) return;
      if (weatherKitEnabled && isWeatherKitTokenBlocked()) return;
      const cur = userLngLatRef.current;
      if (!cur) return;
      const [lng, lat] = cur;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
      if (nowcastFetchInFlightRef.current) return;
      void (async () => {
        nowcastFetchInFlightRef.current = true;
        try {
          const nc = weatherKitEnabled
            ? await fetchWeatherKitCurrentNowcast(lat, lng)
            : await fetchCurrentNowcast(openWeatherApiKey, lat, lng);
          lastNowcastFixRef.current = { lng, lat, tMs: nc.fetchedAtMs };
          lastNowcastFailureRef.current = null;
          if (nowcastMountedRef.current) setCurrentNowcast(nc);
        } catch {
          lastNowcastFailureRef.current = { lng, lat, tMs: Date.now() };
        } finally {
          nowcastFetchInFlightRef.current = false;
        }
      })();
    }, 10 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [isPlus, isOnline, openWeatherApiKey, weatherKitEnabled, userLngLatRef]);

  return currentNowcast;
}
