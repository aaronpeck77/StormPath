import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import type { LngLat } from "../nav/types";
import { safeStorage } from "../storage/safeStorage";
import { fetchWithTimeout } from "../utils/fetchResilient";

/**
 * Dev escape hatch: pin a known lng/lat for dev / testing when the browser can't get a real GPS fix.
 *
 * Sources (highest priority first):
 *   1. URL hash:    `#devloc=LAT,LNG`  (also accepts `?devloc=LAT,LNG`)
 *   2. localStorage `stormpath-dev-location` set to `"LAT,LNG"`
 *
 * When set, the hook publishes that position immediately and skips browser geolocation entirely.
 * Only consulted in `import.meta.env.DEV`. To disable, clear the URL param / LS key.
 */
const DEV_LOCATION_LS_KEY = "stormpath-dev-location";

function parseLatLngString(s: string | null | undefined): LngLat | null {
  if (!s) return null;
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lng, lat];
}

function readDevLocationOverride(): LngLat | null {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const fromHash = window.location.hash.startsWith("#")
      ? new URLSearchParams(window.location.hash.slice(1))
      : null;
    const raw = fromHash?.get("devloc") ?? params.get("devloc");
    const fromUrl = parseLatLngString(raw);
    if (fromUrl) {
      safeStorage.set(DEV_LOCATION_LS_KEY, `${fromUrl[1]},${fromUrl[0]}`);
      return fromUrl;
    }
  } catch {
    /* ignore URL parsing */
  }
  return parseLatLngString(safeStorage.get(DEV_LOCATION_LS_KEY));
}

/** DEV only: pinned coords from `#devloc=` / `?devloc=` / `stormpath-dev-location` (browser GPS skipped). */
export function getDevLocationOverrideLngLat(): LngLat | null {
  if (!import.meta.env.DEV) return null;
  return readDevLocationOverride();
}

/** DEV: drop pinned coords so the browser can supply real GPS again. */
export function clearDevLocationOverride(): void {
  safeStorage.remove(DEV_LOCATION_LS_KEY);
}

export type LocationFixSource =
  | "native"
  | "browser"
  | "dev-pin"
  | "dev-ip"
  | null;

export type LocationDetail = {
  lngLat: LngLat | null;
  /** degrees, 0 = north, clockwise; null if unknown */
  heading: number | null;
  /** meters per second; null if unknown */
  speedMps: number | null;
  error: string | null;
  /** How the current fix was obtained (dev diagnostics). */
  fixSource: LocationFixSource;
  /** Last reported horizontal accuracy (m), when the browser provides it. */
  accuracyM: number | null;
};

export type UserLocationOptions = {
  /** Prefer fresher fixes (more battery). Off = allow up to ~2s cached positions. */
  highRefresh?: boolean;
};

/** Cap React state updates to avoid effect pile-up on older phones. */
const THROTTLE_MS = 400;

/**
 * Dev-only: approximate lat/lng from the client’s public IP (HTTPS JSON, no API key).
 * Used only when the page is **not** a secure context (e.g. `http://192.168.x.x:5173`) — browsers
 * block `navigator.geolocation` there entirely. Never used on `http://localhost` or https:// where
 * real GPS must win (an earlier secure-context timer here caused a stable wrong-city dot).
 */
async function fetchDevApproximateLngLatFromPublicLookup(): Promise<LngLat | null> {
  try {
    const res = await fetchWithTimeout({
      input: "https://ipapi.co/json/",
      init: { method: "GET", credentials: "omit" },
      timeoutMs: 12_000,
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { latitude?: unknown; longitude?: unknown };
    const lat = typeof j.latitude === "number" ? j.latitude : Number(j.latitude);
    const lng = typeof j.longitude === "number" ? j.longitude : Number(j.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return [lng, lat];
  } catch {
    return null;
  }
}

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
  const [fixSource, setFixSource] = useState<LocationFixSource>(null);
  const [accuracyM, setAccuracyM] = useState<number | null>(null);

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
          setFixSource("native");
          setAccuracyM(null);
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
    const secure = typeof window !== "undefined" && window.isSecureContext;

    // Dev-only static override (URL param / localStorage). Bypass the browser provider entirely so
    // an IP-geocoded "Chicago" guess can't sneak in over the held coords.
    if (import.meta.env.DEV) {
      const override = readDevLocationOverride();
      if (override) {
        setError(null);
        setFixSource("dev-pin");
        setAccuracyM(null);
        setLngLat(override);
        setHeading(null);
        setSpeedMps(null);
        return;
      }
    }

    /* `http://192.168.x.x:5173` is NOT a secure context — Chromium never exposes Geolocation. */
    if (!secure) {
      if (!import.meta.env.DEV) {
        setError(
          "GPS needs a secure page: use https://… or http://localhost:5173 — not a plain http://192.168… address (the browser blocks geolocation there)."
        );
        return;
      }
      let cancelledInsecure = false;
      const t = window.setTimeout(() => {
        void (async () => {
          if (cancelledInsecure) return;
          const p = await fetchDevApproximateLngLatFromPublicLookup();
          if (cancelledInsecure) return;
          if (p) {
            console.info(
              "[useUserLocation] dev: non-secure origin — using approximate network center for map testing (not GPS)."
            );
            setError(null);
            setFixSource("dev-ip");
            setAccuracyM(null);
            setLngLat(p);
            setHeading(null);
            setSpeedMps(null);
          } else {
            setError(
              "This dev URL is not a secure context, so the browser blocks GPS. Open http://localhost:5173 on this PC (not the 192.168… link), or use HTTPS. Dev network-location fallback also failed — check connectivity."
            );
          }
        })();
      }, 400);
      return () => {
        cancelledInsecure = true;
        window.clearTimeout(t);
      };
    }

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
      setFixSource("browser");
      const acc = pos.coords.accuracy;
      setAccuracyM(Number.isFinite(acc) && acc > 0 ? acc : null);
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
        const base =
          "Location blocked: tap the lock icon in the address bar (or Site settings) and allow Location for this site.";
        const devHint = import.meta.env.DEV
          ? " If you’re in Cursor’s Simple Browser or another embedded preview, open the same URL in Chrome or Edge — those often block geolocation."
          : "";
        setError(base + devHint);
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

    /* Start watch first, then prime on the next microtask. Two simultaneous getCurrentPosition +
     * watchPosition calls can confuse some Chromium builds (permission / first-fix ordering). */
    startWatch();
    const runPrime = () => {
      if (cancelled) return;
      navigator.geolocation.getCurrentPosition(onOk, onErr, GEO_PRIME_OPTS);
    };
    if (typeof queueMicrotask === "function") queueMicrotask(runPrime);
    else window.setTimeout(runPrime, 0);

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

  return { lngLat, heading, speedMps, error: error || null, fixSource, accuracyM };
}
