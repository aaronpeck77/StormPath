import { useEffect, useRef, useState } from "react";
import { haversineMeters } from "../nav/routeGeometry";
import type { LngLat } from "../nav/types";
import { mapMatchingBuildAllowed, matchGpsTraceToRoad, acceptMapMatchSnap } from "../services/mapboxMapMatching";

const TRACE_MAX_POINTS = 6;
const TRACE_MIN_SPACING_M = 8;
const MATCH_INTERVAL_MS = 4_000;
const MATCH_INTERVAL_IDLE_MS = 8_000;
const MIN_MATCH_CONFIDENCE = 0.35;
/** Reject snaps that jump implausibly far from the raw fix (parallel road / bad match). */
const MAX_SNAP_DRIFT_M = 90;
const IDLE_SPEED_MPS = 1.2;

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
};

/**
 * While navigating, optionally snap GPS to the road graph via Mapbox Map Matching.
 * Returns the latest trusted snap, or null to fall back to raw {@link rawLngLat}.
 */
export function useMapMatchedNavigationLngLat(opts: MapMatchedNavigationOptions): LngLat | null {
  const {
    rawLngLat,
    navigationStarted,
    mapboxToken,
    isOnline,
    speedMps,
    appForeground,
    enabled,
    disabled = false,
  } = opts;

  const [matchedLngLat, setMatchedLngLat] = useState<LngLat | null>(null);
  const traceRef = useRef<LngLat[]>([]);
  const lastMatchMsRef = useRef(0);
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const rawRef = useRef(rawLngLat);
  rawRef.current = rawLngLat;

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
      setMatchedLngLat(null);
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
      speedMps != null && speedMps >= IDLE_SPEED_MPS ? MATCH_INTERVAL_MS : MATCH_INTERVAL_IDLE_MS;

    const tick = () => {
      const now = Date.now();
      if (inFlightRef.current) return;
      if (now - lastMatchMsRef.current < intervalMs) return;

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
          if (!acceptMapMatchSnap(raw, lngLat, confidence, {
            minConfidence: MIN_MATCH_CONFIDENCE,
            maxDriftM: MAX_SNAP_DRIFT_M,
          })) {
            return;
          }
          setMatchedLngLat(lngLat);
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
    const id = window.setInterval(tick, 1_000);
    return () => {
      window.clearInterval(id);
      abortRef.current?.abort();
      abortRef.current = null;
      inFlightRef.current = false;
    };
  }, [active, mapboxToken, rawLngLat?.[0], rawLngLat?.[1], speedMps]);

  if (!active) return null;
  return matchedLngLat;
}
