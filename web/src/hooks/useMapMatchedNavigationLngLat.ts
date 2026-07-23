import { useEffect, useRef, useState } from "react";
import { haversineMeters } from "../nav/routeGeometry";
import type { LngLat } from "../nav/types";
import { mapMatchingBuildAllowed, matchGpsTraceToRoad, acceptMapMatchSnap } from "../services/mapboxMapMatching";

const TRACE_MAX_POINTS = 6;
const TRACE_MIN_SPACING_M = 8;
/** Map Matching is billed per request — stay sparse; route-snap covers most DIY nav. */
const MATCH_INTERVAL_MS = 25_000;
const MATCH_INTERVAL_FAST_MS = 18_000;
const MATCH_INTERVAL_IDLE_MS = 60_000;
const FAST_SPEED_MPS = 14;
const MIN_MATCH_CONFIDENCE = 0.35;
/** Reject snaps that jump implausibly far from the raw fix (parallel road / bad match). */
const MAX_SNAP_DRIFT_M = 90;
const IDLE_SPEED_MPS = 1.2;
/** Reuse last snap without a new API call while GPS stays near it. */
const REUSE_SNAP_WITHIN_M = 35;

export type MapMatchState = {
  lngLat: LngLat | null;
  confidence: number | null;
};

export type MapMatchedNavigationOptions = {
  rawLngLat: LngLat | null;
  navigationStarted: boolean;
  mapboxToken: string;
  isOnline: boolean;
  speedMps: number | null;
  appForeground: boolean;
  /** User setting + tier/token gates from App. */
  enabled: boolean;
  /** Dev pin / demo playback — keep raw GPS. */
  disabled?: boolean;
  /** Locked route — reject road snaps that land off the chosen corridor. */
  routeGeometry?: LngLat[] | null;
};

/**
 * While navigating, optionally snap GPS to the road graph via Mapbox Map Matching.
 * Returns the latest trusted snap, or null to fall back to raw {@link rawLngLat}.
 */
export function useMapMatchedNavigationLngLat(opts: MapMatchedNavigationOptions): MapMatchState {
  const {
    rawLngLat,
    navigationStarted,
    mapboxToken,
    isOnline,
    speedMps,
    appForeground,
    enabled,
    disabled = false,
    routeGeometry,
  } = opts;

  const [matched, setMatched] = useState<MapMatchState>({ lngLat: null, confidence: null });
  const matchedRef = useRef(matched);
  matchedRef.current = matched;
  const traceRef = useRef<LngLat[]>([]);
  const lastMatchMsRef = useRef(0);
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const rawRef = useRef(rawLngLat);
  const routeGeomRef = useRef(routeGeometry);
  rawRef.current = rawLngLat;
  routeGeomRef.current = routeGeometry;

  const active =
    enabled &&
    mapMatchingBuildAllowed() &&
    Boolean(mapboxToken) &&
    navigationStarted &&
    isOnline &&
    appForeground &&
    !disabled;

  useEffect(() => {
    if (!active) {
      traceRef.current = [];
      lastMatchMsRef.current = 0;
      inFlightRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
      setMatched({ lngLat: null, confidence: null });
    }
  }, [active]);

  useEffect(() => {
    if (!active || !rawLngLat) return;

    const trace = traceRef.current;
    const last = trace[trace.length - 1];
    if (!last || haversineMeters(last, rawLngLat) >= TRACE_MIN_SPACING_M) {
      trace.push(rawLngLat);
      if (trace.length > TRACE_MAX_POINTS) trace.shift();
    } else {
      trace[trace.length - 1] = rawLngLat;
    }
  }, [active, rawLngLat?.[0], rawLngLat?.[1]]);

  useEffect(() => {
    if (!active || !rawLngLat) return;

    const intervalMs =
      speedMps != null && speedMps >= FAST_SPEED_MPS
        ? MATCH_INTERVAL_FAST_MS
        : speedMps != null && speedMps >= IDLE_SPEED_MPS
          ? MATCH_INTERVAL_MS
          : MATCH_INTERVAL_IDLE_MS;

    const tick = () => {
      const now = Date.now();
      if (inFlightRef.current) return;
      if (now - lastMatchMsRef.current < intervalMs) return;

      const prevSnap = matchedRef.current.lngLat;
      const raw = rawRef.current;
      if (prevSnap && raw && haversineMeters(prevSnap, raw) <= REUSE_SNAP_WITHIN_M) {
        lastMatchMsRef.current = now;
        return;
      }

      const trace = traceRef.current;
      if (trace.length < 2) return;

      inFlightRef.current = true;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      void matchGpsTraceToRoad(mapboxToken, trace, { signal: ac.signal })
        .then(({ lngLat, confidence }) => {
          if (ac.signal.aborted) return;
          lastMatchMsRef.current = Date.now();
          const raw = rawRef.current;
          if (!lngLat || !raw) return;
          const route = routeGeomRef.current;
          if (
            !acceptMapMatchSnap(raw, lngLat, confidence, {
              minConfidence: MIN_MATCH_CONFIDENCE,
              maxDriftM: MAX_SNAP_DRIFT_M,
              routeGeometry: route && route.length >= 2 ? route : undefined,
            })
          ) {
            return;
          }
          setMatched({ lngLat, confidence });
        })
        .catch(() => {
          /* timeout / offline — keep last snap */
        })
        .finally(() => {
          if (abortRef.current === ac) abortRef.current = null;
          inFlightRef.current = false;
        });
    };

    tick();
    const id = window.setInterval(tick, 2_000);
    return () => {
      window.clearInterval(id);
      abortRef.current?.abort();
      abortRef.current = null;
      inFlightRef.current = false;
    };
  }, [active, mapboxToken, rawLngLat?.[0], rawLngLat?.[1], speedMps]);

  if (!active) return { lngLat: null, confidence: null };
  return matched;
}
