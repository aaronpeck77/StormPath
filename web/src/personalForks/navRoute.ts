import { SAVED_ROUTE_AVG_KMH } from "../nav/constants";
import { buildTurnStepsFromRecordedGeometry } from "../nav/recordedPathTurnSteps";
import {
  closestAlongRouteMeters,
  haversineMeters,
  polylineLengthMeters,
  slicePolylineBetweenAlong,
} from "../nav/routeGeometry";
import type { LngLat, NavRoute } from "../nav/types";
import type { PersonalFork } from "./types";

export const PERSONAL_FORK_ROUTE_ID = "r-your-route";

export function isPersonalForkRouteId(routeId: string | null | undefined): boolean {
  return routeId === PERSONAL_FORK_ROUTE_ID || Boolean(routeId?.startsWith("r-your-route"));
}

/**
 * Build a NavRoute for the familiar fork, splicing remaining main corridor up to the fork
 * with the learned detour geometry so guidance is continuous from the driver's position.
 */
export function buildYourRouteNavRoute(opts: {
  fork: PersonalFork;
  mainGeometry: LngLat[];
  userAlongMainM: number;
  userLngLat?: LngLat | null;
}): NavRoute {
  const { fork, mainGeometry, userAlongMainM } = opts;
  const { alongMeters: forkAlongMain } = closestAlongRouteMeters(fork.forkPoint, mainGeometry);

  const startAlong = Math.max(0, Math.min(userAlongMainM, forkAlongMain) - 30);
  const prefix = slicePolylineBetweenAlong(mainGeometry, startAlong, forkAlongMain);

  const forkGeom = fork.geometry.map(([a, b]) => [a, b] as LngLat);
  let spliceIdx = 0;
  if (prefix.length >= 1) {
    const join = prefix[prefix.length - 1]!;
    let best = Infinity;
    for (let i = 0; i < Math.min(forkGeom.length, 12); i++) {
      const d = haversineMeters(join, forkGeom[i]!);
      if (d < best) {
        best = d;
        spliceIdx = i;
      }
    }
  }
  const forkTail = forkGeom.slice(Math.max(0, spliceIdx));
  const geometry =
    prefix.length >= 2
      ? [...prefix.slice(0, -1), ...forkTail]
      : forkTail.length >= 2
        ? forkTail
        : forkGeom;

  const meters = polylineLengthMeters(geometry);
  const etaMinutes = Math.max(1, Math.round((meters / 1000 / SAVED_ROUTE_AVG_KMH) * 60));

  return {
    id: PERSONAL_FORK_ROUTE_ID,
    role: "balanced",
    label: "Your route",
    geometry,
    baseEtaMinutes: etaMinutes,
    turnSteps: buildTurnStepsFromRecordedGeometry(geometry),
  };
}

/** Preview-only branch from the fork point (no main prefix) — for map overlay before commit. */
export function buildYourRoutePreviewGeometry(fork: PersonalFork): LngLat[] {
  return fork.geometry.map(([a, b]) => [a, b] as LngLat);
}
