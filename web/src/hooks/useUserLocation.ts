import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
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

/** Cap React state updates to avoid effect pile-up on older phones. */
const THROTTLE_MS = 400;

// ─── Native (Capacitor iOS) ───────────────────────────────────────────────────

async function startNativeWatch(
  highRefresh: boolean,
  onFix: (lng: number, lat: number, heading: number | null, speed: number | null) => void,
  onErr: (msg: string) => void
): Promise<() => void> {
  try {
    const perm = await Geolocation.requestPermissions();
    if (perm.location !== "granted") {
      onErr("Location permission denied. Open Settings → Privacy → Location Services → StormPath and set to 'While Using'.");
      return () => undefined;
    }
  } catch {
    /* permissions API not available on all platforms — continue anyway */
  }

  let watchCallId: string | undefined;
  let cancelled = false;

  const id = await Geolocation.watchPosition(
    { enableHighAccuracy: true, timeout: 20_000, maximumAge: highRefresh ? 0 : 2_000 },
    (pos, err) => {
      if (cancelled) return;
      if (err || !pos) {
        onErr("GPS signal lost — check that Location Services are enabled for StormPath.");
        return;
      }
      onFix(
        pos.coords.longitude,
        pos.coords.latitude,
        pos.coords.heading != null && !Number.isNaN(pos.coords.heading) ? pos.coords.heading : null,
        pos.coords.speed != null && pos.coords.speed >= 0 ? pos.coords.speed : null
      );
    }
  );

  watchCallId = id;

  return () => {
    cancelled = true;
    if (watchCallId != null) {
      void Geolocation.clearWatch({ id: watchCallId });
    }
  };
}

// ─── Web (browser geolocation) ────────────────────────────────────────────────

/** Fast first fix (Wi‑Fi / coarse / cache ok). Often returns **network / IP** position with huge
 * `accuracy` (10–80+ km) — e.g. a regional POP that geocodes to “Chicago” even when you’re elsewhere.
 * The watch path uses high accuracy next; {@link LOCATION_DEFER_MS} hides that wrong first blink. */
const GEO_PRIME_OPTS: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 300_000,
  timeout: 90_000,
};

/** Accuracy worse than ~12 km ⇒ treat as non-GPS coarse (IP / stale cell estimate). Prefer waiting for {@link watchOpts}. */
const MAX_FIRST_FIX_ACCURACY_M = 12_000;
/** If the first readings are vague only, publish the least-bad coarse fix after this long so the puck still moves. */
const LOCATION_DEFER_MS = 12_000;

function watchOpts(highRefresh: boolean): PositionOptions {
  return {
    enableHighAccuracy: true,
    maximumAge: highRefresh ? 0 : 2_000,
    timeout: highRefresh ? 22_000 : 30_000,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

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

    // ── Native path (iOS app via Capacitor) ──────────────────────────────────
    if (Capacitor.isNativePlatform()) {
      let cleanup: (() => void) | undefined;
      let cancelled = false;

      void startNativeWatch(
        highRefresh,
        (lng, lat, hdg, spd) => {
          if (cancelled) return;
          setError(null);
          setLngLat([lng, lat]);
          setHeading(hdg);
          setSpeedMps(spd);
        },
        (msg) => {
          if (!cancelled) setError(msg);
        }
      ).then((stop) => {
        if (cancelled) {
          stop();
        } else {
          cleanup = stop;
        }
      });

      return () => {
        cancelled = true;
        cleanup?.();
      };
    }

    // ── Web / PWA path (browser geolocation) ─────────────────────────────────
    if (!navigator.geolocation) {
      setError("This browser does not support location.");
      return;
    }

    let cancelled = false;
    let watchId = 0;
    let fixReceived = false;
    let rearmTimer = 0;
    let deferFirstTimer = 0;
    let vagueFallbackPos: GeolocationPosition | null = null;

    const isTooVagueForInstantShow = (pos: GeolocationPosition): boolean => {
      const acc = pos.coords.accuracy;
      return !Number.isFinite(acc) || acc <= 0 || acc > MAX_FIRST_FIX_ACCURACY_M;
    };

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

    const publishFirstFix = (pos: GeolocationPosition) => {
      fixReceived = true;
      vagueFallbackPos = null;
      if (deferFirstTimer) {
        window.clearTimeout(deferFirstTimer);
        deferFirstTimer = 0;
      }
      flush(pos);
    };

    const onOk = (pos: GeolocationPosition) => {
      if (cancelled) return;
      if (!fixReceived) {
        if (isTooVagueForInstantShow(pos)) {
          /* Keep coarse / IP guesses off the puck until GPS or Wi‑Fi triangulation narrows —
           * otherwise the dot “teleports” to a random metro (often ~right state, wrong city). */
          const prev = vagueFallbackPos;
          if (
            !prev ||
            prev.coords.accuracy > pos.coords.accuracy ||
            (!Number.isFinite(prev.coords.accuracy) && Number.isFinite(pos.coords.accuracy))
          ) {
            vagueFallbackPos = pos;
          }
          if (!deferFirstTimer) {
            deferFirstTimer = window.setTimeout(() => {
              deferFirstTimer = 0;
              if (cancelled || fixReceived) return;
              publishFirstFix(vagueFallbackPos ?? pos);
            }, LOCATION_DEFER_MS);
          }
          return;
        }
        publishFirstFix(pos);
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

    const startWatch = () => {
      try {
        watchId = navigator.geolocation.watchPosition(onOk, onErr, watchOpts(highRefresh));
      } catch {
        /* ignore — onErr will surface user-visible error path */
      }
    };

    const onErr = (e: GeolocationPositionError) => {
      if (cancelled) return;
      if (e.code === e.PERMISSION_DENIED) {
        if (deferFirstTimer) {
          window.clearTimeout(deferFirstTimer);
          deferFirstTimer = 0;
        }
        vagueFallbackPos = null;
        setError(
          "Location blocked: tap the lock icon in the address bar (or Site settings) and allow Location for this site."
        );
        return;
      }
      if (!fixReceived) {
        const msg =
          e.code === e.POSITION_UNAVAILABLE
            ? "Location unavailable — try stepping outside or turning off Low Power Mode."
            : "Location timed out — try again with a clearer sky view or Wi‑Fi on.";
        setError(msg);
      }
      if (watchId) {
        try { navigator.geolocation.clearWatch(watchId); } catch { /* ignore */ }
        watchId = 0;
      }
      window.clearTimeout(rearmTimer);
      rearmTimer = window.setTimeout(() => {
        rearmTimer = 0;
        if (!cancelled) startWatch();
      }, 30_000);
    };

    navigator.geolocation.getCurrentPosition(onOk, onErr, GEO_PRIME_OPTS);
    startWatch();

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
      window.clearTimeout(deferFirstTimer);
      deferFirstTimer = 0;
      window.clearTimeout(rafRef.current);
      window.clearTimeout(rearmTimer);
      rafRef.current = 0;
      if (watchId) {
        try { navigator.geolocation.clearWatch(watchId); } catch { /* ignore */ }
      }
    };
  }, [enabled, highRefresh]);

  return { lngLat, heading, speedMps, error: error || null };
}
