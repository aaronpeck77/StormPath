import { useEffect, useRef } from "react";
import { resolveNavigationProgress } from "../nav/navigationProgress";
import { buildCumulativeDistances, buildCumulativeDistancesAsync } from "../nav/routeGeometryWorkerClient";
import type { LngLat } from "../nav/types";
import { useMapMatchedNavigationLngLat } from "./useMapMatchedNavigationLngLat";

export type UseNavigationPositionOptions = {
  rawLngLat: LngLat | null;
  navigationStarted: boolean;
  guidanceGeometry: LngLat[] | null | undefined;
  alongHoldResetKey: number;
  mapboxToken: string;
  isOnline: boolean;
  speedMps: number | null;
  appForeground: boolean;
  mapMatchingEnabled: boolean;
  disabled?: boolean;
};

export type NavigationPositionState = {
  /** Trusted position for guidance, off-route, camera, and map puck while navigating. */
  positionLngLat: LngLat | null;
  alongM: number;
  onRoute: boolean;
  source: "map_matched" | "route_snap" | "held" | "raw";
};

/**
 * Map matching + windowed route progress as one pipeline (industry-style snap-to-route).
 * Falls back to raw GPS when not navigating or geometry is missing.
 */
export function useNavigationPosition(opts: UseNavigationPositionOptions): NavigationPositionState {
  const {
    rawLngLat,
    navigationStarted,
    guidanceGeometry,
    alongHoldResetKey,
    mapboxToken,
    isOnline,
    speedMps,
    appForeground,
    mapMatchingEnabled,
    disabled = false,
  } = opts;

  const matched = useMapMatchedNavigationLngLat({
    rawLngLat,
    navigationStarted,
    mapboxToken,
    isOnline,
    speedMps,
    appForeground,
    enabled: mapMatchingEnabled,
    disabled,
    routeGeometry: guidanceGeometry,
  });

  const alongHoldRef = useRef(0);
  const resetKeyRef = useRef(alongHoldResetKey);
  const geomSigRef = useRef("");
  const cumDistRef = useRef<Float64Array | null>(null);

  const sig =
    guidanceGeometry && guidanceGeometry.length >= 2
      ? `${guidanceGeometry.length}:${guidanceGeometry[0]![0].toFixed(5)}:${guidanceGeometry[guidanceGeometry.length - 1]![0].toFixed(5)}`
      : "";

  if (alongHoldResetKey !== resetKeyRef.current) {
    resetKeyRef.current = alongHoldResetKey;
    alongHoldRef.current = 0;
  }

  if (sig !== geomSigRef.current) {
    geomSigRef.current = sig;
    alongHoldRef.current = 0;
  }

  useEffect(() => {
    if (!guidanceGeometry || guidanceGeometry.length < 2) {
      cumDistRef.current = null;
      return;
    }
    cumDistRef.current = buildCumulativeDistances(guidanceGeometry);
    let cancelled = false;
    void buildCumulativeDistancesAsync(guidanceGeometry).then((asyncCum) => {
      if (!cancelled && geomSigRef.current === sig) {
        cumDistRef.current = asyncCum;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sig, guidanceGeometry]);

  if (!navigationStarted || !rawLngLat) {
    return {
      positionLngLat: rawLngLat,
      alongM: 0,
      onRoute: true,
      source: "raw",
    };
  }

  const geometry = guidanceGeometry;
  if (!geometry?.length) {
    return {
      positionLngLat: matched.lngLat ?? rawLngLat,
      alongM: 0,
      onRoute: true,
      source: matched.lngLat ? "map_matched" : "raw",
    };
  }

  const resolved = resolveNavigationProgress({
    rawLngLat,
    matchedLngLat: matched.lngLat,
    matchedConfidence: matched.confidence,
    geometry,
    alongHoldM: alongHoldRef.current,
    cumDist: cumDistRef.current,
  });

  if (resolved.onRoute) {
    alongHoldRef.current = resolved.alongM;
  }

  return {
    positionLngLat: resolved.positionLngLat,
    alongM: resolved.alongM,
    onRoute: resolved.onRoute,
    source: resolved.source,
  };
}
