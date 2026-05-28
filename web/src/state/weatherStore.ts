import { create } from "zustand";
import { safeStorage } from "../storage/safeStorage";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";

/**
 * Weather / NWS storm state (Zustand) — Phase 4d.
 *
 * Owns the 6 storm-bar + storm-map fields that were spread across `useState` in `App.tsx`:
 *
 *   • `stormCorridorAlerts` — NWS alerts intersecting the active route corridor (drives storm bar + map).
 *   • `stormOverlapping` — subset whose polygon overlaps the active leg right now.
 *   • `stormMapGeoJson` — GeoJSON for the storm polygons we draw on the map. `null` while fresh-loading.
 *   • `stormLoading` — true while a fresh NWS fetch is in flight (drives the "Loading NWS" spinner).
 *   • `stormError` — user-facing error message for the latest failed fetch (`null` when clear).
 *   • `stormBarExpanded` — persisted UI state for the advisory bar.
 *
 * Setters mirror React's `SetStateAction<T>` so the ~40 reads / setters in `App.tsx` are
 * untouched. `setStormBarExpanded` always persists through `safeStorage` (matches the prior
 * dual-write pattern at the user-toggle + storm-OFF sites) so persistence and React state
 * can never drift.
 *
 * **Transient collapse:** `collapseStormBarTransient` exists for `dismissOverlaysForRouteCompare`,
 * which hides the bar so the route-compare panel can use the screen but should **not** be remembered
 * across launches (the user didn't toggle anything). Without this we'd flip the persisted bit on
 * every compare entry, which would leave the bar collapsed on next cold start even though the user
 * never intended that.
 *
 * **Why move it here now:** Phase 4c (`routeCompareStore`) noted that the `dismissOverlaysForRouteCompare`
 * helper reaches into ~13 cross-feature setters. Pulling storm-bar state out of `App.tsx` shrinks
 * that dependency by one and brings us closer to being able to extract the helper as a hook in 4e.
 */

const STORM_BAR_EXPANDED_KEY = "stormpath-storm-advisory-bar-expanded";
const LEGACY_STORM_BAR_EXPANDED_KEY = "stormpath-storm-drawer-expanded";

/** Same threshold App.tsx uses for the search bar — duplicated here to avoid pulling App into the store. */
function isNarrowPhoneViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 520px)").matches;
}

function readStormBarExpanded(): boolean {
  const v = safeStorage.get(STORM_BAR_EXPANDED_KEY);
  if (v === "0") return false;
  if (v === "1") return true;
  /* Pre-Phase-4d builds wrote `stormpath-storm-drawer-expanded`; migrate on read so existing
   * TestFlight testers keep their setting on first launch of the new build. */
  const legacy = safeStorage.get(LEGACY_STORM_BAR_EXPANDED_KEY);
  if (legacy === "0") return false;
  if (legacy === "1") return true;
  return !isNarrowPhoneViewport();
}

type Updater<T> = T | ((prev: T) => T);

function applyUpdater<T>(prev: T, next: Updater<T>): T {
  return typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
}

export interface WeatherState {
  stormCorridorAlerts: NormalizedWeatherAlert[];
  stormOverlapping: NormalizedWeatherAlert[];
  stormMapGeoJson: GeoJSON.FeatureCollection | null;
  stormLoading: boolean;
  stormError: string | null;
  stormBarExpanded: boolean;

  setStormCorridorAlerts: (next: Updater<NormalizedWeatherAlert[]>) => void;
  setStormOverlapping: (next: Updater<NormalizedWeatherAlert[]>) => void;
  setStormMapGeoJson: (next: Updater<GeoJSON.FeatureCollection | null>) => void;
  setStormLoading: (next: Updater<boolean>) => void;
  setStormError: (next: Updater<string | null>) => void;
  /** Persists through `safeStorage`. Use for user-driven toggles and storm-OFF reset. */
  setStormBarExpanded: (next: Updater<boolean>) => void;
  /** Hide the bar for the duration of the session without persisting. Used by route-compare dismiss. */
  collapseStormBarTransient: () => void;
}

export const useWeatherStore = create<WeatherState>((set) => ({
  stormCorridorAlerts: [],
  stormOverlapping: [],
  stormMapGeoJson: null,
  stormLoading: false,
  stormError: null,
  stormBarExpanded: readStormBarExpanded(),

  setStormCorridorAlerts: (next) =>
    set((state) => ({ stormCorridorAlerts: applyUpdater(state.stormCorridorAlerts, next) })),
  setStormOverlapping: (next) =>
    set((state) => ({ stormOverlapping: applyUpdater(state.stormOverlapping, next) })),
  setStormMapGeoJson: (next) =>
    set((state) => ({ stormMapGeoJson: applyUpdater(state.stormMapGeoJson, next) })),
  setStormLoading: (next) => set((state) => ({ stormLoading: applyUpdater(state.stormLoading, next) })),
  setStormError: (next) => set((state) => ({ stormError: applyUpdater(state.stormError, next) })),
  setStormBarExpanded: (next) =>
    set((state) => {
      const v = applyUpdater(state.stormBarExpanded, next);
      safeStorage.set(STORM_BAR_EXPANDED_KEY, v ? "1" : "0");
      return { stormBarExpanded: v };
    }),
  collapseStormBarTransient: () => set({ stormBarExpanded: false }),
}));
