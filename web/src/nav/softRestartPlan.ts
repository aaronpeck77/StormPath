import { isReverseRejoinRoute } from "./detourRejoin";
import { pickBestForwardRoute } from "./forwardRoutePick";
import type { LngLat, NavRoute, TripPlan } from "./types";

export type SoftRestartLegPatch = {
  geometry: LngLat[];
  baseEtaMinutes?: number;
  turnSteps?: NavRoute["turnSteps"];
  routeNotices?: NavRoute["routeNotices"];
  routeNoticeAlongMeters?: NavRoute["routeNoticeAlongMeters"];
  mapboxIncidents?: NavRoute["mapboxIncidents"];
  hasTolls?: NavRoute["hasTolls"];
  tollLabels?: NavRoute["tollLabels"];
  postedSpeedSamples?: NavRoute["postedSpeedSamples"];
  role?: NavRoute["role"];
  label?: string;
};

/**
 * Missed turn / off-route: forget the old corridor and install a fresh
 * GPS→dest plan. Drive follows A; Map / Route show A + B when present.
 */
export function planAfterOffRouteReplan(plan: TripPlan, routes: NavRoute[]): TripPlan {
  const next = routes.filter((r) => r.geometry.length >= 2).slice(0, 2);
  if (!next.length) return plan;
  return { ...plan, routes: next };
}

export function offRouteReplanSlotIds(routes: NavRoute[]): string[] {
  return routes.filter((r) => r.geometry.length >= 2).slice(0, 2).map((r) => r.id);
}

/** Pick forward A (and B when Mapbox gave a distinct alternate). */
export function assignOffRouteReplanSlots(
  fresh: NavRoute[],
  userLngLat: LngLat,
  headingDeg: number | null
): NavRoute[] {
  const usable = fresh.filter((r) => r.geometry.length >= 2);
  const forward = usable.filter((r) => !isReverseRejoinRoute(r, userLngLat, headingDeg));
  const pool = forward.length > 0 ? forward : usable;
  const primary = pickBestForwardRoute(pool, userLngLat, headingDeg) ?? pool[0];
  if (!primary) return [];
  const a: NavRoute = {
    ...primary,
    id: "r-a",
    role: "fastest",
    label: "Main",
  };
  const alt = pool.find((r) => r !== primary);
  if (!alt) return [a];
  const b: NavRoute = {
    ...alt,
    id: "r-b",
    role: alt.role === "hazardSmart" ? "hazardSmart" : "balanced",
    label: alt.role === "hazardSmart" ? "No interstate" : "Alternate",
  };
  return [a, b];
}

/**
 * Install a GPS→dest soft restart as a brand-new Go lock:
 * one primary corridor, no leftover B/C or rejoin overlays behind the puck.
 */
export function planAfterSoftRestartLock(
  plan: TripPlan,
  lockedId: string,
  patch: SoftRestartLegPatch
): TripPlan {
  const prev = plan.routes.find((r) => r.id === lockedId);
  const next: NavRoute = {
    id: lockedId,
    role: patch.role ?? prev?.role ?? "fastest",
    label: patch.label?.trim()
      ? patch.label
      : prev?.label?.trim()
        ? prev.label
        : "Main",
    geometry: patch.geometry,
    baseEtaMinutes: patch.baseEtaMinutes ?? prev?.baseEtaMinutes ?? 1,
    turnSteps: patch.turnSteps ?? prev?.turnSteps,
    routeNotices: patch.routeNotices ?? prev?.routeNotices,
    routeNoticeAlongMeters: patch.routeNoticeAlongMeters ?? prev?.routeNoticeAlongMeters,
    mapboxIncidents: patch.mapboxIncidents ?? prev?.mapboxIncidents,
    hasTolls: patch.hasTolls ?? prev?.hasTolls,
    tollLabels: patch.tollLabels ?? prev?.tollLabels,
    postedSpeedSamples: patch.postedSpeedSamples ?? prev?.postedSpeedSamples,
  };
  return { ...plan, routes: [next] };
}
