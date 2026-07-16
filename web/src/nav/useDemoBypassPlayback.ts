import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { closestAlongRouteMeters, polylineLengthMeters } from "./routeGeometry";
import type { LngLat, NavRoute } from "./types";

export type UseDemoBypassPlaybackDeps = {
  demoBypassTrafficJamPlus: boolean;
  navigationStarted: boolean;
  guidanceRoute: NavRoute | null | undefined;
  guidanceRouteId: string;
  postedMph: number | null;
  userLngLatRef: MutableRefObject<LngLat | null>;
  demoPlaybackAlongM: number | null;
  setDemoPlaybackAlongM: Dispatch<SetStateAction<number | null>>;
  demoPlaybackPlaying: boolean;
  setDemoPlaybackPlaying: Dispatch<SetStateAction<boolean>>;
};

/**
 * `?demo=bypass` puck glide. State stays in App (needed early for effectiveUserLngLat);
 * this hook owns the RAF loop + play/reset controls.
 */
export function useDemoBypassPlayback(deps: UseDemoBypassPlaybackDeps) {
  const {
    demoBypassTrafficJamPlus,
    navigationStarted,
    guidanceRoute,
    guidanceRouteId,
    postedMph,
    userLngLatRef,
    demoPlaybackAlongM,
    setDemoPlaybackAlongM,
    demoPlaybackPlaying,
    setDemoPlaybackPlaying,
  } = deps;

  const demoPlaybackAlongRef = useRef<number | null>(null);
  demoPlaybackAlongRef.current = demoPlaybackAlongM;

  useEffect(() => {
    if (!demoPlaybackPlaying || !demoBypassTrafficJamPlus || !navigationStarted) return;
    const g = guidanceRoute?.geometry;
    if (!g?.length) {
      setDemoPlaybackPlaying(false);
      return;
    }
    const totalM = polylineLengthMeters(g);
    if (totalM < 2) {
      setDemoPlaybackPlaying(false);
      return;
    }
    const mph = postedMph ?? 55;
    const mPerSec = (mph * 1609.344) / 3600;
    let last = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const dtSec = Math.min(0.28, Math.max(0, (now - last) / 1000));
      last = now;
      const prev = demoPlaybackAlongRef.current;
      const cur =
        prev ??
        (userLngLatRef.current
          ? closestAlongRouteMeters(userLngLatRef.current, g).alongMeters
          : totalM * 0.12);
      const next = Math.min(totalM - 0.5, cur + mPerSec * dtSec);
      demoPlaybackAlongRef.current = next;
      setDemoPlaybackAlongM(next);
      if (next >= totalM - 0.55) {
        setDemoPlaybackPlaying(false);
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [
    demoPlaybackPlaying,
    demoBypassTrafficJamPlus,
    navigationStarted,
    guidanceRoute?.geometry,
    guidanceRouteId,
    postedMph,
    userLngLatRef,
    setDemoPlaybackAlongM,
    setDemoPlaybackPlaying,
  ]);

  const toggleDemoPlaybackPlaying = useCallback(() => {
    if (!demoBypassTrafficJamPlus || !guidanceRoute?.geometry?.length) return;
    if (polylineLengthMeters(guidanceRoute.geometry) < 2) return;
    setDemoPlaybackPlaying((p) => !p);
  }, [demoBypassTrafficJamPlus, guidanceRoute, setDemoPlaybackPlaying]);

  const resetDemoPlaybackAlongRoute = useCallback(() => {
    setDemoPlaybackPlaying(false);
    setDemoPlaybackAlongM(null);
  }, [setDemoPlaybackPlaying, setDemoPlaybackAlongM]);

  return {
    toggleDemoPlaybackPlaying,
    resetDemoPlaybackAlongRoute,
  };
}
