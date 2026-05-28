import { create } from "zustand";
import type { FrequentRouteCluster } from "../frequentRoutes/types";
import type { RouteAlert } from "../nav/routeAlerts";
import type { LngLat, RouteTurnStep } from "../nav/types";
import type { MapFocusRequest, MapViewMode } from "../ui/driveMapTypes";

/**
 * Ephemeral UI overlay store (Zustand) — Phase 4e5a.
 *
 * Owns the 11 transient fields that drive sheets, drawers, search, demo flags, and map focus.
 * Before this phase they were `useState` declarations scattered across `App.tsx` and the
 * `dismissOverlaysForRouteCompare` helper had to call 11 individual setters in sequence to
 * close them when route compare opened. This store collapses that into a single
 * `dismissAllOverlays()` action — 11 setters → 1 batched store update.
 *
 * **Why pull these out of App.tsx now:** the route-compare dismiss helper still has
 * `setTollRoutePrompt(null)` (route-compare store) and `collapseStormBarTransient()` (weather
 * store) plus this store's `dismissAllOverlays()` — only **3** cross-store calls instead of
 * the prior 13. That makes `useRouteCompareActions` (Phase 4e5b) extractable as a clean hook
 * with no config bag — it just subscribes to all four stores directly.
 *
 * **What's NOT in this store:** persisted user-settings (`useSettingsStore`), trip-plan
 * state (`useTripPlanStore`), route-compare panel state (`useRouteCompareStore`), and
 * weather/storm state (`useWeatherStore`). This store is strictly for transient, dismiss-on-
 * compare, never-persisted overlay flags.
 *
 * **`viewModeBeforeTrafficBypass`** lives here as a module-level imperative variable + thin
 * get/set helpers (mirrors the `tollCompareContext` pattern from Phase 4c). The route-compare
 * cancel handler reads it once to restore the prior view mode; nothing reactively subscribes,
 * so we keep it out of the React state graph entirely.
 */

type Updater<T> = T | ((prev: T) => T);

function applyUpdater<T>(prev: T, next: Updater<T>): T {
  return typeof next === "function" ? (next as (p: T) => T)(prev) : next;
}

/** Pending save sheet variant. Three kinds = three subtly-different `<NameConfirmSheet>` flows. */
export type PendingSave =
  | null
  | {
      kind: "route";
      geometry: LngLat[];
      turnSteps?: RouteTurnStep[];
      destinationLngLat: LngLat;
      destinationLabel: string;
    }
  | {
      kind: "recorded";
      geometry: LngLat[];
      destinationLngLat: LngLat;
    }
  | { kind: "learned"; cluster: FrequentRouteCluster };

export type RouteHazardSheetState = {
  routeId: string;
  alerts: RouteAlert[];
} | null;

export interface UiState {
  routeHazardSheet: RouteHazardSheetState;
  savedDrawerOpen: boolean;
  aboutOpen: boolean;
  corridorForecastOpen: boolean;
  pendingSave: PendingSave;
  searchExpanded: boolean;
  searchEditing: boolean;
  mapFocus: MapFocusRequest | null;
  progressCalloutsOpen: boolean;
  demoApproachBannerOn: boolean;
  demoCloseHazardOn: boolean;

  setRouteHazardSheet: (next: Updater<RouteHazardSheetState>) => void;
  setSavedDrawerOpen: (next: Updater<boolean>) => void;
  setAboutOpen: (next: Updater<boolean>) => void;
  setCorridorForecastOpen: (next: Updater<boolean>) => void;
  setPendingSave: (next: Updater<PendingSave>) => void;
  setSearchExpanded: (next: Updater<boolean>) => void;
  setSearchEditing: (next: Updater<boolean>) => void;
  setMapFocus: (next: Updater<MapFocusRequest | null>) => void;
  setProgressCalloutsOpen: (next: Updater<boolean>) => void;
  setDemoApproachBannerOn: (next: Updater<boolean>) => void;
  setDemoCloseHazardOn: (next: Updater<boolean>) => void;

  /**
   * Reset every overlay to its closed/empty state in a single batched store update.
   * Used by route-compare entry to give the panel a clean map. Intentionally does NOT touch
   * the route-compare store's `tollRoutePrompt` or the weather store's storm-bar — those are
   * dismissed by their owning stores via cross-store calls in the route-compare hook.
   */
  dismissAllOverlays: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  routeHazardSheet: null,
  savedDrawerOpen: false,
  aboutOpen: false,
  corridorForecastOpen: false,
  pendingSave: null,
  /** Initial state opens the search bar so first-launch users see the input field. */
  searchExpanded: true,
  searchEditing: false,
  mapFocus: null,
  progressCalloutsOpen: false,
  demoApproachBannerOn: false,
  demoCloseHazardOn: false,

  setRouteHazardSheet: (next) =>
    set((s) => ({ routeHazardSheet: applyUpdater(s.routeHazardSheet, next) })),
  setSavedDrawerOpen: (next) =>
    set((s) => ({ savedDrawerOpen: applyUpdater(s.savedDrawerOpen, next) })),
  setAboutOpen: (next) => set((s) => ({ aboutOpen: applyUpdater(s.aboutOpen, next) })),
  setCorridorForecastOpen: (next) =>
    set((s) => ({ corridorForecastOpen: applyUpdater(s.corridorForecastOpen, next) })),
  setPendingSave: (next) => set((s) => ({ pendingSave: applyUpdater(s.pendingSave, next) })),
  setSearchExpanded: (next) =>
    set((s) => ({ searchExpanded: applyUpdater(s.searchExpanded, next) })),
  setSearchEditing: (next) =>
    set((s) => ({ searchEditing: applyUpdater(s.searchEditing, next) })),
  setMapFocus: (next) => set((s) => ({ mapFocus: applyUpdater(s.mapFocus, next) })),
  setProgressCalloutsOpen: (next) =>
    set((s) => ({ progressCalloutsOpen: applyUpdater(s.progressCalloutsOpen, next) })),
  setDemoApproachBannerOn: (next) =>
    set((s) => ({ demoApproachBannerOn: applyUpdater(s.demoApproachBannerOn, next) })),
  setDemoCloseHazardOn: (next) =>
    set((s) => ({ demoCloseHazardOn: applyUpdater(s.demoCloseHazardOn, next) })),

  dismissAllOverlays: () =>
    set({
      routeHazardSheet: null,
      savedDrawerOpen: false,
      aboutOpen: false,
      corridorForecastOpen: false,
      pendingSave: null,
      searchExpanded: false,
      searchEditing: false,
      mapFocus: null,
      progressCalloutsOpen: false,
      demoApproachBannerOn: false,
      demoCloseHazardOn: false,
    }),
}));

/* `viewModeBeforeTrafficBypass` is the imperative ref the route-compare cancel handler reads
 * to decide which view mode to restore. Kept module-local (not in the Zustand state graph)
 * because nothing reactively subscribes — only the cancel/confirm handlers read it once and
 * then clear it. Mirrors the `tollCompareContext` pattern in `routeCompareStore.ts`. */
let viewModeBeforeTrafficBypass: MapViewMode | null = null;

export function getViewModeBeforeTrafficBypass(): MapViewMode | null {
  return viewModeBeforeTrafficBypass;
}

export function setViewModeBeforeTrafficBypass(value: MapViewMode | null): void {
  viewModeBeforeTrafficBypass = value;
}
