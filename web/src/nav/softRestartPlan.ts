import { isReverseRejoinRoute } from "./detourRejoin";
import { pickBestForwardRoute } from "./forwardRoutePick";
import { polylineLengthMeters } from "./routeGeometry";
import { routeDoublesBack } from "./routeDoublesBack";
import { routeFitsAlternateCap, type RoutingPreference } from "./routePreference";
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
  roadControls?: NavRoute["roadControls"];
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

function asMain(route: NavRoute): NavRoute {
  return { ...route, id: "r-a", role: "fastest", label: "Main" };
}

function asAlternate(route: NavRoute, id: "r-a" | "r-b"): NavRoute {
  return { ...route, id, role: "balanced", label: "Alternate" };
}

function alternateFits(candidate: NavRoute, main: NavRoute): boolean {
  return routeFitsAlternateCap({
    etaMinutes: candidate.baseEtaMinutes,
    distanceM: polylineLengthMeters(candidate.geometry),
    mainEtaMinutes: main.baseEtaMinutes,
    mainDistanceM: polylineLengthMeters(main.geometry),
  });
}

/**
 * Pick a forward line from here. Fastest locks Main. Alternate locks the
 * different line when it is still within the progress cap, and keeps Main
 * available. A line that turns back or returns to a point already passed
 * is dropped — that is how the remaining time grew as he got closer.
 */
export function assignOffRouteReplanSlots(
  fresh: NavRoute[],
  userLngLat: LngLat,
  headingDeg: number | null,
  preference: RoutingPreference = "fastest"
): NavRoute[] {
  const usable = fresh.filter((r) => r.geometry.length >= 2);
  const forward = usable.filter(
    (r) => !isReverseRejoinRoute(r, userLngLat, headingDeg) && !routeDoublesBack(r.geometry)
  );
  if (forward.length === 0) return [];
  const primary = pickBestForwardRoute(forward, userLngLat, headingDeg) ?? forward[0];
  if (!primary) return [];
  const main = asMain(primary);
  const altSrc = forward.find((r) => r !== primary && alternateFits(r, primary));
  const alt = altSrc ? asAlternate(altSrc, "r-b") : null;
  if (preference === "alternate" && altSrc) {
    return [asAlternate(altSrc, "r-a"), { ...main, id: "r-b" }];
  }
  return alt ? [main, alt] : [main];
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
    roadControls: patch.roadControls ?? prev?.roadControls,
  };
  return { ...plan, routes: [next] };
}
