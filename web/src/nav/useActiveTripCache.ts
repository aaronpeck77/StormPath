import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import type { SearchSuggestion } from "../ui/SearchBar";
import type { MapViewMode } from "../ui/driveMapTypes";
import type { LngLat, TripPlan } from "./types";
import {
  isFullSlotPermutation,
  reconcileSlotOrderWithPlan,
} from "./routeSlotOrder";
import {
  clearActiveTripCache,
  loadActiveTripFromCache,
  MAX_TRIP_CACHE_AGE_MS,
  saveActiveTripToCache,
  isRestorableActiveTripEntry,
} from "../tripCache";

/** Best-effort cap for IndexedDB writes while still capturing route refreshes. */
export const TRIP_CACHE_MIN_SAVE_INTERVAL_MS = 20_000;

export type UseActiveTripCacheDeps = {
  isPlus: boolean;
  plan: TripPlan;
  planRoutesKey: string;
  routeSlotOrder: string[];
  routeSlotOrderKey: string;
  previewLegIndex: number;
  destLngLat: LngLat | null;
  destinationLabel: string;
  navigationStarted: boolean;
  viewMode: MapViewMode;
  fitTrigger: number;
  lockedNavigationRouteIdRef: MutableRefObject<string | null> | RefObject<string | null>;
  setPlan: (plan: TripPlan | ((prev: TripPlan) => TripPlan)) => void;
  setDestLngLat: (v: LngLat | null) => void;
  setDestinationLabel: (v: string) => void;
  setSearchText: (v: string) => void;
  setNavigationStarted: (v: boolean) => void;
  setViewMode: (v: MapViewMode) => void;
  setRouteSlotOrder: (v: string[] | ((prev: string[]) => string[])) => void;
  setPreviewLegIndex: (v: number | ((prev: number) => number)) => void;
  setSearchExpanded: (v: boolean) => void;
  setAllowAutocomplete: (v: boolean) => void;
  setRouteError: (v: string | null) => void;
  setSuggestLoading: (v: boolean) => void;
  setSuggestions: (v: SearchSuggestion[]) => void;
  setFitTrigger: (v: number | ((n: number) => number)) => void;
};

/** One-shot restore + throttled persist of the active trip across reloads / offline. */
export function useActiveTripCache(deps: UseActiveTripCacheDeps): void {
  const {
    isPlus,
    plan,
    planRoutesKey,
    routeSlotOrder,
    routeSlotOrderKey,
    previewLegIndex,
    destLngLat,
    destinationLabel,
    navigationStarted,
    viewMode,
    fitTrigger,
    lockedNavigationRouteIdRef,
    setPlan,
    setDestLngLat,
    setDestinationLabel,
    setSearchText,
    setNavigationStarted,
    setViewMode,
    setRouteSlotOrder,
    setPreviewLegIndex,
    setSearchExpanded,
    setAllowAutocomplete,
    setRouteError,
    setSuggestLoading,
    setSuggestions,
    setFitTrigger,
  } = deps;

  const lastTripCacheSaveMsRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const entry = await loadActiveTripFromCache();
      if (cancelled || !entry) return;
      if (!isRestorableActiveTripEntry(entry)) {
        void clearActiveTripCache();
        return;
      }
      const ageMs = Date.now() - entry.savedAtMs;
      if (!Number.isFinite(ageMs) || ageMs > MAX_TRIP_CACHE_AGE_MS || ageMs < -60_000) {
        void clearActiveTripCache();
        return;
      }
      let planNext = entry.plan;
      const maxCachedRoutes = isPlus ? 2 : 1;
      if (planNext.routes.length > maxCachedRoutes) {
        planNext = { ...planNext, routes: planNext.routes.slice(0, maxCachedRoutes) };
      }
      const planIds = planNext.routes.map((r) => r.id);
      const slotNext = isFullSlotPermutation(entry.routeSlotOrder, planIds)
        ? entry.routeSlotOrder
        : reconcileSlotOrderWithPlan(entry.routeSlotOrder, planIds);
      const nRoutes = planNext.routes.length;
      const previewNext =
        nRoutes > 0 ? Math.min(Math.max(0, entry.previewLegIndex), nRoutes - 1) : 0;
      let viewNext = entry.viewMode;
      if (!entry.navigationStarted && viewNext === "drive") {
        viewNext = "route";
      }
      setPlan(planNext);
      setDestLngLat(entry.destLngLat);
      setDestinationLabel(entry.destinationLabel);
      setSearchText(entry.destinationLabel);
      setNavigationStarted(entry.navigationStarted);
      if (entry.navigationStarted) {
        (lockedNavigationRouteIdRef as MutableRefObject<string | null>).current =
          slotNext[0] ?? planIds[0] ?? null;
      }
      setViewMode(viewNext);
      setRouteSlotOrder(slotNext);
      setPreviewLegIndex(previewNext);
      setSearchExpanded(false);
      setAllowAutocomplete(false);
      setRouteError(null);
      setSuggestLoading(false);
      setSuggestions([]);
      setFitTrigger((n) => n + 1);
      lastTripCacheSaveMsRef.current = Date.now();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore once at boot
  }, []);

  useEffect(() => {
    if (!destLngLat) return;
    if (!plan.routes.length) return;
    if (!destinationLabel.trim()) return;
    if (!fitTrigger) return;

    const now = Date.now();
    if (now - lastTripCacheSaveMsRef.current < TRIP_CACHE_MIN_SAVE_INTERVAL_MS) return;
    lastTripCacheSaveMsRef.current = now;

    const entry: Parameters<typeof saveActiveTripToCache>[0] = {
      version: 1,
      savedAtMs: now,
      destLngLat,
      destinationLabel: destinationLabel.trim(),
      navigationStarted,
      viewMode,
      routeSlotOrder,
      previewLegIndex,
      plan,
    };
    const schedule =
      typeof requestIdleCallback !== "undefined"
        ? (cb: () => void) => {
            const id = requestIdleCallback(() => cb(), { timeout: 4_000 });
            return () => cancelIdleCallback(id);
          }
        : (cb: () => void) => {
            const t = window.setTimeout(cb, 0);
            return () => clearTimeout(t);
          };
    const clear = schedule(() => {
      void saveActiveTripToCache(entry);
    });
    return clear;
  }, [
    fitTrigger,
    routeSlotOrderKey,
    previewLegIndex,
    destLngLat,
    destinationLabel,
    navigationStarted,
    viewMode,
    planRoutesKey,
    plan,
    routeSlotOrder,
  ]);
}
