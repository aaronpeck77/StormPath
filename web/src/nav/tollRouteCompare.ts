import type { NavRoute, TripPlan } from "./types";

export type TollRouteCompareContext = {
  originalPlan: TripPlan;
  originalRouteId: string;
  originalPreviewLegIndex: number;
  originalSlotOrder: string[];
  originalViewMode: "route" | "topdown" | "drive";
  fullTollFreePlan: TripPlan;
  pendingGo: boolean;
};

/** Two-leg plan for top-down compare: current toll route (A) vs toll-free preview (B). */
export function buildTollCompareDisplayPlan(
  plan: TripPlan,
  currentRoute: NavRoute,
  tollFreePrimary: NavRoute
): TripPlan {
  const withTollsLabel = currentRoute.label?.trim() || "With tolls";
  return {
    ...plan,
    routes: [
      { ...currentRoute, id: "r-a", label: withTollsLabel },
      { ...tollFreePrimary, id: "r-b", label: "Toll-free" },
    ],
  };
}
