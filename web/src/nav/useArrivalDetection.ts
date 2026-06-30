import { useEffect, useRef, type MutableRefObject } from "react";
import { ARRIVAL_BG_CLEAR_MIN_MS, ARRIVAL_BG_RESUME_GRACE_MS } from "./constants";
import {
  arrivalIdleClearMs,
  arrivalProximity,
  isStationaryForArrival,
  shouldResetArrivalIdleOnPointer,
} from "./arrivalDetect";
import type { LngLat } from "./types";
import type { TripStop } from "./routeWaypoints";
import type { ComputeRoutesFn } from "./useComputeRoutes";
import { useTripPlanStore } from "../state/tripPlanStore";

export interface UseArrivalDetectionDeps {
  demoBypassTrafficJamPlusRef: MutableRefObject<boolean>;
  navigationStartedRef: MutableRefObject<boolean>;
  navigationPositionLngLatRef: MutableRefObject<LngLat | null>;
  navTargetRef: MutableRefObject<LngLat | null>;
  guidanceRouteGeomRef: MutableRefObject<LngLat[] | null>;
  userAlongGuidanceMRef: MutableRefObject<number>;
  guidanceRouteLengthMRef: MutableRefObject<number>;
  speedMpsRef: MutableRefObject<number | null>;
  viaStopsRef: MutableRefObject<TripStop[]>;
  activeViaIndexRef: MutableRefObject<number>;
  destLngLatRef: MutableRefObject<LngLat | null>;
  destinationLabelRef: MutableRefObject<string>;
  computeRoutesRef: MutableRefObject<ComputeRoutesFn>;
  clearRouteRef: MutableRefObject<() => void>;
  setTapHint: (msg: string | null) => void;
}

/**
 * Near destination / via stop: after the driver stops moving, advance to the next leg or clear the trip.
 */
export function useArrivalDetection(deps: UseArrivalDetectionDeps): void {
  const {
    demoBypassTrafficJamPlusRef,
    navigationStartedRef,
    navigationPositionLngLatRef,
    navTargetRef,
    guidanceRouteGeomRef,
    userAlongGuidanceMRef,
    guidanceRouteLengthMRef,
    speedMpsRef,
    viaStopsRef,
    activeViaIndexRef,
    destLngLatRef,
    destinationLabelRef,
    computeRoutesRef,
    clearRouteRef,
    setTapHint,
  } = deps;

  const arrivalIdleStartMsRef = useRef<number | null>(null);
  const arrivalHintShownRef = useRef(false);
  const lastUserInteractionMsRef = useRef<number>(Date.now());
  const tabHiddenAtMsRef = useRef<number | null>(null);
  /** After long background, wait for fresh GPS before auto end-trip (avoids clearing mid-route). */
  const arrivalResumeGraceUntilMsRef = useRef(0);

  useEffect(() => {
    const bump = (e: Event) => {
      if (!shouldResetArrivalIdleOnPointer(e.target)) return;
      lastUserInteractionMsRef.current = Date.now();
      arrivalIdleStartMsRef.current = null;
      arrivalHintShownRef.current = false;
    };
    const opts: AddEventListenerOptions = { capture: true };
    window.addEventListener("pointerdown", bump, opts);
    window.addEventListener("keydown", bump, opts);
    window.addEventListener("touchstart", bump, opts);
    return () => {
      window.removeEventListener("pointerdown", bump, opts);
      window.removeEventListener("keydown", bump, opts);
      window.removeEventListener("touchstart", bump, opts);
    };
  }, []);

  useEffect(() => {
    const ARRIVAL_TICK_MS = 4000;
    const runArrivalClear = () => {
      if (demoBypassTrafficJamPlusRef.current) return;
      arrivalIdleStartMsRef.current = null;
      arrivalHintShownRef.current = false;
      tabHiddenAtMsRef.current = null;

      const vias = viaStopsRef.current;
      const viaIdx = activeViaIndexRef.current;
      const finalDest = destLngLatRef.current;
      if (viaIdx < vias.length && finalDest) {
        const nextIdx = viaIdx + 1;
        useTripPlanStore.getState().setActiveViaIndex(nextIdx);
        const nextLabel =
          nextIdx < vias.length
            ? vias[nextIdx]!.label
            : destinationLabelRef.current.trim() || "destination";
        setTapHint(`Stop reached — continuing to ${nextLabel}.`);
        window.setTimeout(() => setTapHint(null), 6500);
        void computeRoutesRef.current(finalDest, destinationLabelRef.current.trim() || "Destination", {
          preserveNavigation: true,
        });
        return;
      }

      clearRouteRef.current();
      setTapHint("You've arrived — trip cleared.");
      window.setTimeout(() => setTapHint(null), 5000);
    };

    const tick = () => {
      if (demoBypassTrafficJamPlusRef.current) return;
      if (Date.now() < arrivalResumeGraceUntilMsRef.current) return;
      if (!navigationStartedRef.current) {
        arrivalIdleStartMsRef.current = null;
        arrivalHintShownRef.current = false;
        return;
      }
      const pos = navigationPositionLngLatRef.current;
      const dest = navTargetRef.current;
      if (!pos || !dest) {
        arrivalIdleStartMsRef.current = null;
        arrivalHintShownRef.current = false;
        return;
      }
      const prox = arrivalProximity({
        pos,
        dest,
        routeGeometry: guidanceRouteGeomRef.current,
        alongRouteM: userAlongGuidanceMRef.current,
        routeLengthM: guidanceRouteLengthMRef.current,
      });
      if (!prox.near) {
        arrivalIdleStartMsRef.current = null;
        arrivalHintShownRef.current = false;
        return;
      }
      if (!isStationaryForArrival(speedMpsRef.current, prox.remainingAlongM)) {
        arrivalIdleStartMsRef.current = null;
        return;
      }
      const now = Date.now();
      if (now - lastUserInteractionMsRef.current < 2500) {
        arrivalIdleStartMsRef.current = null;
        return;
      }
      const idleMs = arrivalIdleClearMs(prox.remainingAlongM);
      if (arrivalIdleStartMsRef.current == null) {
        arrivalIdleStartMsRef.current = now;
        if (!arrivalHintShownRef.current) {
          arrivalHintShownRef.current = true;
          setTapHint(
            activeViaIndexRef.current < viaStopsRef.current.length
              ? "Near this stop — continuing to next leg when you stop."
              : "Near destination — trip clears shortly when you stop."
          );
          window.setTimeout(() => setTapHint(null), 6500);
        }
        return;
      }
      if (now - arrivalIdleStartMsRef.current >= idleMs) {
        runArrivalClear();
      }
    };

    const id = window.setInterval(tick, ARRIVAL_TICK_MS);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        tabHiddenAtMsRef.current = Date.now();
        return;
      }
      if (demoBypassTrafficJamPlusRef.current) return;
      const hiddenAt = tabHiddenAtMsRef.current;
      if (hiddenAt == null) return;
      const bgMs = Date.now() - hiddenAt;
      tabHiddenAtMsRef.current = null;
      if (bgMs < ARRIVAL_BG_CLEAR_MIN_MS) return;
      if (!navigationStartedRef.current) return;
      // Do not clear on resume — wait for fresh GPS/speed; foreground idle timer still applies.
      arrivalResumeGraceUntilMsRef.current = Date.now() + ARRIVAL_BG_RESUME_GRACE_MS;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [
    activeViaIndexRef,
    clearRouteRef,
    computeRoutesRef,
    demoBypassTrafficJamPlusRef,
    destLngLatRef,
    destinationLabelRef,
    guidanceRouteGeomRef,
    guidanceRouteLengthMRef,
    navTargetRef,
    navigationPositionLngLatRef,
    navigationStartedRef,
    setTapHint,
    speedMpsRef,
    userAlongGuidanceMRef,
    viaStopsRef,
  ]);
}
