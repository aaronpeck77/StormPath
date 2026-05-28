import { create } from "zustand";
import type { LngLat } from "../nav/types";
import type { TollRouteCompareContext } from "../nav/tollRouteCompare";

/**
 * Route-compare store (Zustand) — Phase 4c.
 *
 * Owns the three pieces of state that drive the on-map A/B (and A/B/C) compare flow used by:
 *   • traffic / hazard bypass — the original `TrafficBypassComparePanel` use case
 *   • toll preview — same panel reused for "with tolls vs toll-free", flagged via `compareKind: "toll"`
 *
 * **`trafficBypassCompare`** — drives the panel + DriveMap props (selected leg, headline, ETA tags,
 * compare camera framing). When non-null the App layout switches to "compare active" mode (search
 * bar replaced, sheets dismissed, drive overlays paused). Set via `setTrafficBypassCompare`.
 *
 * **`tollRoutePrompt`** — pending toll-prompt sheet shown after route compute when the chosen route
 * has tolls and the user hasn't yet acked tolls on it. Driving the prompt from the store (not a
 * `useState` in App) keeps the toll-cancel-from-compare path simple: the cancel handler just
 * re-opens the prompt by setting this field.
 *
 * **`tollCompareContext`** — purely imperative snapshot taken when entering toll preview, used by
 * the cancel/confirm handlers to restore the original plan + view-mode if the user backs out.
 * Read/written via `getTollCompareContext` / `setTollCompareContext` so we don't trigger
 * re-renders on every snapshot mutation (the panel doesn't observe this field, only the
 * imperative handlers do).
 *
 * **What is NOT in this store:** the helpers `dismissOverlaysForRouteCompare` and
 * `activateRouteCompare` reach into ~13 cross-feature setters (sheets, drawers, search, storm
 * bar, etc.) that still live as `useState` in `App.tsx`. They stay in `App.tsx` for now and call
 * `setTrafficBypassCompare` from this store the same way they used to call the `useState` setter.
 * Phase 4d (weatherStore) and Phase 4e (component splits) will trim that surface progressively
 * and an eventual `useRouteCompareActions` hook can move the helpers next to this store once the
 * cross-feature dependencies have shrunk.
 */

export type TrafficBypassCompareState = {
  headline: string;
  etaA: number;
  etaB: number | null;
  etaC: number | null;
  hasB: boolean;
  hasC: boolean;
  /** From the underlying `RouteImpact` confidence — softens compare panel copy when low. */
  confidence: "low" | "medium" | "high";
  /** Chosen A/B/C leg; promotion + drive view happen on explicit confirm, not on first tap. */
  selectedLeg: "r-a" | "r-b" | "r-c" | null;
  /** Anchor the compare camera + on-map pin to the hazard the driver is being asked to plan around. */
  hazardLngLat: LngLat | null;
  /** Distance from the user along the active route to the hazard (m); drives the tight fit. */
  hazardAlongMeters: number | null;
  /** Toll preview reuses this panel — only A (with tolls) vs B (toll-free). */
  compareKind?: "traffic" | "toll";
};

export type TollRoutePrompt = {
  routeId: string;
  labels: string[];
};

type Updater<T> = T | ((prev: T) => T);

function applyUpdater<T>(prev: T, next: Updater<T>): T {
  return typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
}

export interface RouteCompareState {
  trafficBypassCompare: TrafficBypassCompareState | null;
  tollRoutePrompt: TollRoutePrompt | null;
  /** Imperative-only snapshot for toll preview lifecycle. Not subscribed to anywhere. */
  tollCompareContext: TollRouteCompareContext | null;

  setTrafficBypassCompare: (next: Updater<TrafficBypassCompareState | null>) => void;
  setTollRoutePrompt: (next: Updater<TollRoutePrompt | null>) => void;
  setTollCompareContext: (next: TollRouteCompareContext | null) => void;
}

export const useRouteCompareStore = create<RouteCompareState>((set) => ({
  trafficBypassCompare: null,
  tollRoutePrompt: null,
  tollCompareContext: null,

  setTrafficBypassCompare: (next) =>
    set((state) => ({
      trafficBypassCompare: applyUpdater(state.trafficBypassCompare, next),
    })),
  setTollRoutePrompt: (next) =>
    set((state) => ({ tollRoutePrompt: applyUpdater(state.tollRoutePrompt, next) })),
  setTollCompareContext: (next) => set({ tollCompareContext: next }),
}));

/**
 * Imperative ref-style accessors for `tollCompareContext`.
 *
 * Replaces the prior `tollCompareContextRef = useRef(...)` pattern in App.tsx. Reading / writing
 * these never goes through a React selector, so the toll preview lifecycle keeps its
 * fire-and-forget mutability without triggering compare-panel re-renders.
 */
export function getTollCompareContext(): TollRouteCompareContext | null {
  return useRouteCompareStore.getState().tollCompareContext;
}

export function setTollCompareContext(next: TollRouteCompareContext | null): void {
  useRouteCompareStore.getState().setTollCompareContext(next);
}
