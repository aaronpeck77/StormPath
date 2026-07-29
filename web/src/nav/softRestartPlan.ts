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
