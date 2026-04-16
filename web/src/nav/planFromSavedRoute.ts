import { SAVED_ROUTE_AVG_KMH } from "./constants";
import { polylineLengthMeters } from "./routeGeometry";
import type { SavedRoute } from "./savedRoutes";
import type { LngLat, NavRoute, TripPlan } from "./types";

export function planRouteIdForSaved(savedId: string, reverse?: boolean): string {
  return reverse ? `saved-route-${savedId}-rev` : `saved-route-${savedId}`;
}

export function tripPlanFromSavedRoute(
  saved: SavedRoute,
  opts?: { reverse?: boolean }
): TripPlan {
  const reverse = opts?.reverse ?? false;
  const baseGeom = saved.geometry.map(([lng, lat]) => [lng, lat] as LngLat);
  const geometry = reverse ? [...baseGeom].reverse() : baseGeom;
  const meters = polylineLengthMeters(geometry);
  const etaMinutes = Math.max(1, Math.round((meters / 1000 / SAVED_ROUTE_AVG_KMH) * 60));
  /* Turn steps describe the original direction; drop when reversed. */
  const steps =
    !reverse && saved.turnSteps?.length ? saved.turnSteps.map((s) => ({ ...s })) : undefined;
  const route: NavRoute = {
    id: planRouteIdForSaved(saved.id, reverse),
    role: "balanced",
    label: reverse ? `${saved.name} (reverse)` : saved.name,
    geometry,
    baseEtaMinutes: etaMinutes,
    turnSteps: steps,
  };
  const destinationLabel = reverse
    ? saved.startLabel?.trim() || "Start of path"
    : saved.destinationLabel;
  return {
    originLabel: "Your location",
    destinationLabel,
    routes: [route],
  };
}
