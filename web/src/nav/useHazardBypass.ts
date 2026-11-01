import { useCallback, useEffect, useRef, useState } from "react";
import { useTripPlanStore } from "../state/tripPlanStore";
import type { MapViewMode } from "../ui/driveMapTypes";
import type { ComputeRoutesResult } from "./tollAvoidanceCopy";
import type { LngLat } from "./types";
import {
  HAZARD_BYPASS_MAX_PULLS,
  activeIndexAfterPullRemoved,
  activeIndexWithoutBends,
  baselineWithoutBends,
  hazardBendCount,
  isHazardBendLabel,
  viasWithPull,
  viasWithoutPull,
} from "./hazardBypass";

type ComputeRoutesFn = (
  end: LngLat,
  label: string,
  opts?: { preserveNavigation?: boolean; singleRoute?: boolean }
) => Promise<ComputeRoutesResult>;

/**
 * Drive button opens Route overview. A pull on the line becomes a must-visit
 * point, Mapbox redraws the roads, Undo drops one pull, Cancel restores the
 * stops from before the bends and returns to Drive.
 */
export function useHazardBypass(opts: {
  computeRoutes: ComputeRoutesFn;
  setFitTrigger: (next: number | ((n: number) => number)) => void;
  setTapHint: (hint: string | null) => void;
  getRouteLine: () => LngLat[];
}) {
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pullCount, setPullCount] = useState(0);
  const activeRef = useRef(false);
  const busyRef = useRef(false);
  const baselineViasRef = useRef(baselineWithoutBends([]));
  const baselineIndexRef = useRef(0);
  const pullStackRef = useRef<string[]>([]);
  const leaveViewRef = useRef<MapViewMode | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const syncCount = () => {
    setPullCount(hazardBendCount(useTripPlanStore.getState().viaStops));
  };

  const navigationStarted = useTripPlanStore((s) => s.navigationStarted);
  useEffect(() => {
    if (navigationStarted || !activeRef.current) return;
    activeRef.current = false;
    setActive(false);
    pullStackRef.current = [];
    setPullCount(0);
  }, [navigationStarted]);

  const remeasure = useCallback(async (apply: () => void, failHint: string): Promise<boolean> => {
    const dest = useTripPlanStore.getState().destLngLat;
    const label = useTripPlanStore.getState().destinationLabel.trim() || "Destination";
    if (!dest) return false;
    const prevVias = useTripPlanStore.getState().viaStops.map((stop) => ({
      label: stop.label,
      lngLat: [stop.lngLat[0], stop.lngLat[1]] as LngLat,
    }));
    const prevIndex = useTripPlanStore.getState().activeViaIndex;
    apply();
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await optsRef.current.computeRoutes(dest, label, {
        preserveNavigation: true,
        singleRoute: true,
      });
      if (!result.ok) {
        useTripPlanStore.getState().setViaStops(prevVias);
        useTripPlanStore.getState().setActiveViaIndex(prevIndex);
        if (result.reason) optsRef.current.setTapHint(failHint);
        return false;
      }
      if (!activeRef.current && leaveViewRef.current) {
        useTripPlanStore.getState().setViewMode(leaveViewRef.current);
      }
      return true;
    } finally {
      busyRef.current = false;
      setBusy(false);
      syncCount();
    }
  }, []);

  const enter = useCallback(() => {
    const state = useTripPlanStore.getState();
    if (!state.navigationStarted || !state.destLngLat || busyRef.current) return;
    baselineViasRef.current = baselineWithoutBends(state.viaStops);
    baselineIndexRef.current = activeIndexWithoutBends(state.viaStops, state.activeViaIndex);
    pullStackRef.current = state.viaStops.filter((stop) => isHazardBendLabel(stop.label)).map((stop) => stop.label);
    leaveViewRef.current = null;
    activeRef.current = true;
    setActive(true);
    syncCount();
    state.setViewMode("route");
    optsRef.current.setFitTrigger((n) => n + 1);
    optsRef.current.setTapHint(null);
  }, []);

  const noteViewChange = useCallback((next: MapViewMode) => {
    if (next === "route" || !activeRef.current) return;
    leaveViewRef.current = next;
    activeRef.current = false;
    setActive(false);
  }, []);

  const pull = useCallback(async (grab: LngLat, release: LngLat) => {
    if (!activeRef.current || busyRef.current) return;
    const state = useTripPlanStore.getState();
    if (hazardBendCount(state.viaStops) >= HAZARD_BYPASS_MAX_PULLS) {
      optsRef.current.setTapHint("Two bends already. Undo one to pull again.");
      return;
    }
    const next = viasWithPull(
      state.viaStops,
      state.activeViaIndex,
      optsRef.current.getRouteLine(),
      grab,
      release
    );
    if (!next) {
      optsRef.current.setTapHint("Two bends already. Undo one to pull again.");
      return;
    }
    const added = next.find((stop) => !state.viaStops.some((prev) => prev.label === stop.label));
    const ok = await remeasure(() => {
      useTripPlanStore.getState().setViaStops(next);
    }, "The roads can't follow that pull.");
    if (ok && added) pullStackRef.current.push(added.label);
  }, [remeasure]);

  const undo = useCallback(async () => {
    if (!activeRef.current || busyRef.current) return;
    const label = pullStackRef.current[pullStackRef.current.length - 1];
    if (!label) return;
    const state = useTripPlanStore.getState();
    const removed = viasWithoutPull(state.viaStops, label);
    if (!removed) {
      pullStackRef.current.pop();
      syncCount();
      return;
    }
    const nextIndex = activeIndexAfterPullRemoved(state.activeViaIndex, removed.removedIndex);
    const ok = await remeasure(() => {
      const store = useTripPlanStore.getState();
      store.setViaStops(removed.vias);
      store.setActiveViaIndex(nextIndex);
    }, "Couldn't redraw the route. Try Undo again.");
    if (ok) pullStackRef.current.pop();
  }, [remeasure]);

  const cancel = useCallback(async () => {
    if (busyRef.current) return;
    const baseline = baselineViasRef.current.map((stop) => ({
      label: stop.label,
      lngLat: [stop.lngLat[0], stop.lngLat[1]] as LngLat,
    }));
    const index = baselineIndexRef.current;
    leaveViewRef.current = "drive";
    activeRef.current = false;
    setActive(false);
    const ok = await remeasure(() => {
      const store = useTripPlanStore.getState();
      store.setViaStops(baseline);
      store.setActiveViaIndex(index);
    }, "Couldn't restore the original line. Try Cancel again.");
    if (ok) {
      pullStackRef.current = [];
      useTripPlanStore.getState().setViewMode("drive");
    }
    else {
      activeRef.current = true;
      setActive(true);
      leaveViewRef.current = null;
    }
  }, [remeasure]);

  return {
    active,
    busy,
    pullCount,
    atLimit: pullCount >= HAZARD_BYPASS_MAX_PULLS,
    canUndo: pullCount > 0,
    enter,
    pull,
    undo,
    cancel,
    noteViewChange,
  };
}
