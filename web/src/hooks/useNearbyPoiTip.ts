import { useEffect, useRef, useState } from "react";
import type { LngLat } from "../nav/types";
import {
  fetchNearbyPoiTip,
  shouldFetchNearbyPoiTip,
  type NearbyPoiTip,
} from "../nav/nearbyPoiTip";

type Args = {
  enabled: boolean;
  mapboxToken: string;
  userLngLat: LngLat | null;
  speedMps: number | null;
  navigationStarted: boolean;
  /** Skip when a severe/warn hazard line is already on the banner. */
  hazardBannerActive: boolean;
  isOnline: boolean;
  appForeground: boolean;
};

/** Rare nearby POI one-liner for the advisory rotator. */
export function useNearbyPoiTip(args: Args): string | null {
  const {
    enabled,
    mapboxToken,
    userLngLat,
    speedMps,
    navigationStarted,
    hazardBannerActive,
    isOnline,
    appForeground,
  } = args;

  const [tip, setTip] = useState<NearbyPoiTip | null>(null);
  const lastFetchMsRef = useRef<number | null>(null);
  const lastLngLatRef = useRef<LngLat | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled || !navigationStarted || !isOnline || !appForeground || !userLngLat) {
      return;
    }
    if (
      !shouldFetchNearbyPoiTip({
        nowMs: Date.now(),
        lastFetchMs: lastFetchMsRef.current,
        lastFetchLngLat: lastLngLatRef.current,
        userLngLat,
        speedMps,
        navigationStarted,
        hazardBannerActive,
      })
    ) {
      return;
    }
    if (inFlightRef.current || !mapboxToken.trim()) return;

    let cancelled = false;
    inFlightRef.current = true;
    void fetchNearbyPoiTip({ mapboxToken, userLngLat })
      .then((next) => {
        if (cancelled || !next) return;
        lastFetchMsRef.current = next.fetchedAtMs;
        lastLngLatRef.current = next.lngLat;
        setTip(next);
      })
      .finally(() => {
        inFlightRef.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    mapboxToken,
    userLngLat?.[0],
    userLngLat?.[1],
    speedMps,
    navigationStarted,
    hazardBannerActive,
    isOnline,
    appForeground,
  ]);

  useEffect(() => {
    if (!navigationStarted) setTip(null);
  }, [navigationStarted]);

  return tip?.text ?? null;
}
