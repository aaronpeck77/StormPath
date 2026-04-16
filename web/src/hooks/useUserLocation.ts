import { useEffect, useRef, useState } from "react";
import type { LngLat } from "../nav/types";

export type LocationDetail = {
  lngLat: LngLat | null;
  /** degrees, 0 = north, clockwise; null if unknown */
  heading: number | null;
  /** meters per second; null if unknown */
  speedMps: number | null;
  error: string | null;
};

export type UserLocationOptions = {
  /** Prefer fresher fixes (more battery). Off = allow up to ~2s cached positions. */
  highRefresh?: boolean;
};

/** Fast first fix (Wi‑Fi / coarse / cache ok). */
const GEO_PRIME_OPTS: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 300_000,
  timeout: 90_000,
};

/** Cap React state updates to avoid effect pile-up on older phones. */
const THROTTLE_MS = 400;

function watchOpts(highRefresh: boolean): PositionOptions {
  return {
    enableHighAccuracy: true,
    maximumAge: highRefresh ? 0 : 2_000,
    timeout: highRefresh ? 22_000 : 30_000,
  };
}

export function useUserLocation(enabled: boolean, opts?: UserLocationOptions): LocationDetail {
  const highRefresh = Boolean(opts?.highRefresh);
  const [lngLat, setLngLat] = useState<LngLat | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [speedMps, setSpeedMps] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lastFlushRef = useRef(0);
  const pendingRef = useRef<GeolocationPosition | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    if (!navigator.geolocation) {
      setError("This browser does not support location.");
      return;
    }

    let cancelled = false;
    let watchId = 0;
    let fixReceived = false;

    const flush = (pos: GeolocationPosition) => {
      lastFlushRef.current = Date.now();
      pendingRef.current = null;
      setError(null);
      setLngLat([pos.coords.longitude, pos.coords.latitude]);
      setHeading(
        pos.coords.heading != null && !Number.isNaN(pos.coords.heading)
          ? pos.coords.heading
          : null
      );
      setSpeedMps(
        pos.coords.speed != null && pos.coords.speed >= 0 ? pos.coords.speed : null
      );
    };

    const onOk = (pos: GeolocationPosition) => {
      if (cancelled) return;
      if (!fixReceived) {
        fixReceived = true;
        flush(pos);
        return;
      }
      const elapsed = Date.now() - lastFlushRef.current;
      if (elapsed >= THROTTLE_MS) {
        flush(pos);
      } else {
        pendingRef.current = pos;
        if (!rafRef.current) {
          rafRef.current = window.setTimeout(() => {
            rafRef.current = 0;
            if (!cancelled && pendingRef.current) flush(pendingRef.current);
          }, THROTTLE_MS - elapsed);
        }
      }
    };

    const onErr = (e: GeolocationPositionError) => {
      if (cancelled || fixReceived) return;
      const msg =
        e.code === e.PERMISSION_DENIED
          ? "Location blocked: tap the lock icon in the address bar (or Site settings) and allow Location for this site."
          : e.code === e.POSITION_UNAVAILABLE
            ? "Location unavailable — try stepping outside or turning off Low Power Mode."
            : "Location timed out — try again with a clearer sky view or Wi‑Fi on.";
      setError(msg);
    };

    navigator.geolocation.getCurrentPosition(onOk, onErr, GEO_PRIME_OPTS);
    watchId = navigator.geolocation.watchPosition(onOk, onErr, watchOpts(highRefresh));

    const failsafe = window.setTimeout(() => {
      if (cancelled || fixReceived) return;
      setError(
        (prev) =>
          prev ??
          "Still no GPS fix — confirm Location is allowed for this browser (not just system settings), use https://, and try outdoors."
      );
    }, 95_000);

    return () => {
      cancelled = true;
      window.clearTimeout(failsafe);
      window.clearTimeout(rafRef.current);
      rafRef.current = 0;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [enabled, highRefresh]);

  return { lngLat, heading, speedMps, error: error || null };
}
