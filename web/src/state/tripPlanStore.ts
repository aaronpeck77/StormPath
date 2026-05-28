import { create } from "zustand";
import { EMPTY_TRIP } from "../nav/emptyTrip";
import type { LngLat, TripPlan } from "../nav/types";
import type { MapViewMode } from "../ui/driveMapTypes";

/**
 * Trip-plan + view-mode store (Zustand).
 *
 * **Why:** before Phase 4b these 7 fields lived as `useState` inside `App.tsx` and were the
 * single most-touched cluster in that file (~30 setter call sites, ~120 read sites). Moving
 * them into a store doesn't change runtime behavior; the win is that the next phase's
 * extracted components (e.g. `<RouteCompareLayer />`, `<TollFlowSheets />`) can subscribe
 * to the same fields without prop-drilling and without `App.tsx` having to forward setters.
 *
 * **API parity with `useState`:** every setter accepts either a value **or** a `(prev) => next`
 * functional updater, so existing call sites like
 * `setPlan((prev) => mergePlanPreservingPrimary(prev, primaryId, fresh))` keep working
 * untouched. The `Updater<T>` alias below mirrors React's `SetStateAction<T>`.
 *
 * **Side-effects stay in `App.tsx`.** Cross-state actions (e.g. starting navigation also
 * changes `viewMode`, `clearRoute()` resets several fields) live in the components that
 * already orchestrate them; they just call multiple store setters in sequence the same way
 * they used to call multiple `useState` setters.
 *
 * **Not persisted.** Trip plans are session-scoped — a fresh app launch starts with an empty
 * trip just like the previous behavior. Navigation never resumed across cold starts.
 */

type Updater<T> = T | ((prev: T) => T);

function applyUpdater<T>(prev: T, next: Updater<T>): T {
  return typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
}

export interface TripPlanState {
  /** Active trip plan — A/B/C polylines + ETA. `EMPTY_TRIP` when nothing planned. */
  plan: TripPlan;
  /** Display order of `plan.routes[].id` — permutes when the user promotes a leg (Go / hazard / bypass). */
  routeSlotOrder: string[];
  /** Which slot (0..n-1) is highlighted in route view. Separate from slot 0 so the cycle can reach all legs. */
  previewLegIndex: number;
  /** Selected destination coordinates (null when planning hasn't started). */
  destLngLat: LngLat | null;
  /** Human-readable destination label shown in the search bar / header. */
  destinationLabel: string;
  /** UI mode: `"route"` (planning), `"topdown"` (overview), `"drive"` (turn-by-turn). */
  viewMode: MapViewMode;
  /** True after the driver hits Go and the route engine confirmed the trip. */
  navigationStarted: boolean;

  setPlan: (next: Updater<TripPlan>) => void;
  setRouteSlotOrder: (next: Updater<string[]>) => void;
  setPreviewLegIndex: (next: Updater<number>) => void;
  setDestLngLat: (next: Updater<LngLat | null>) => void;
  setDestinationLabel: (next: Updater<string>) => void;
  setViewMode: (next: Updater<MapViewMode>) => void;
  setNavigationStarted: (next: Updater<boolean>) => void;
}

export const useTripPlanStore = create<TripPlanState>((set) => ({
  plan: EMPTY_TRIP,
  routeSlotOrder: [],
  previewLegIndex: 0,
  destLngLat: null,
  destinationLabel: "",
  viewMode: "route",
  navigationStarted: false,

  setPlan: (next) => set((state) => ({ plan: applyUpdater(state.plan, next) })),
  setRouteSlotOrder: (next) =>
    set((state) => ({ routeSlotOrder: applyUpdater(state.routeSlotOrder, next) })),
  setPreviewLegIndex: (next) =>
    set((state) => ({ previewLegIndex: applyUpdater(state.previewLegIndex, next) })),
  setDestLngLat: (next) => set((state) => ({ destLngLat: applyUpdater(state.destLngLat, next) })),
  setDestinationLabel: (next) =>
    set((state) => ({ destinationLabel: applyUpdater(state.destinationLabel, next) })),
  setViewMode: (next) => set((state) => ({ viewMode: applyUpdater(state.viewMode, next) })),
  setNavigationStarted: (next) =>
    set((state) => ({ navigationStarted: applyUpdater(state.navigationStarted, next) })),
}));
