import type { LngLat } from "./types";
import type { RouteAlert } from "./routeAlerts";
import { closestAlongRouteMeters } from "./routeGeometry";
import {
  DRIVE_AHEAD_WINDOW_M,
  METERS_PER_MILE,
  SERIOUS_DRIVE_AHEAD_MIN_SEVERITY,
} from "./constants";

export { SERIOUS_DRIVE_AHEAD_MIN_SEVERITY } from "./constants";

type PickOpts = {
  /** If true, only severity ≥ SERIOUS_DRIVE_AHEAD_MIN_SEVERITY and still promptRerouteAhead. */
  seriousOnly: boolean;
};

export function pickDriveAheadCandidate(
  active: boolean,
  geometry: LngLat[] | undefined,
  userLngLat: LngLat | null,
  alerts: RouteAlert[],
  opts: PickOpts
): { alert: RouteAlert; aheadM: number; aheadMi: number } | null {
  if (!active || !geometry?.length || !userLngLat) return null;
  const { alongMeters: userAlong } = closestAlongRouteMeters(userLngLat, geometry);

  type Cand = { alert: RouteAlert; aheadM: number; aheadMi: number };
  const cands: Cand[] = [];
  for (const a of alerts) {
    if (!a.promptRerouteAhead) continue;
    if (opts.seriousOnly && a.severity < SERIOUS_DRIVE_AHEAD_MIN_SEVERITY) continue;
    const aheadM = a.alongMeters - userAlong;
    if (aheadM <= 0 || aheadM > DRIVE_AHEAD_WINDOW_M) continue;
    cands.push({ alert: a, aheadM, aheadMi: aheadM / METERS_PER_MILE });
  }
  if (cands.length === 0) return null;
  cands.sort((x, y) => y.alert.severity - x.alert.severity || x.aheadM - y.aheadM);
  return cands[0]!;
}
