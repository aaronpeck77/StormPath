import type { LngLat, NavRoute } from "./types";

/** Plan fingerprint — route id alone misses reroute geometry / ETA updates. */
export function stablePlanRoutesKey(routes: NavRoute[]): string {
  return routes
    .map((r) => {
      const g = r.geometry;
      if (!g?.length) return `${r.id}:0`;
      const n = g.length;
      const a = g[0]!;
      const b = g[n - 1]!;
      return `${r.id}:${n}:${a[0].toFixed(4)},${a[1].toFixed(4)}:${b[0].toFixed(4)},${b[1].toFixed(4)}:${Math.round(r.baseEtaMinutes ?? 0)}`;
    })
    .join("|");
}
import { closestAlongRouteMeters } from "./routeGeometry";

/** Poll while navigating — complements traffic refresh without hammering APIs. */
export const TRIP_NAV_DISPLAY_POLL_MS = 45_000;
export const TRIP_NAV_DISPLAY_REPAIR_COOLDOWN_MS = 60_000;

export type TripNavDisplayIssue =
  | "along_exceeds_route"
  | "remaining_exceeds_route"
  | "eta_exceeds_full"
  | "eta_implausible_fast"
  | "eta_implausible_slow_vs_speed"
  | "along_progress_stale";

export type TripNavDisplayAudit = {
  ok: boolean;
  issues: TripNavDisplayIssue[];
  remainingDistanceM: number | null;
  remainingEtaMinutes: number | null;
};

/**
 * Miles and the clock follow whichever point is farther along the drawn line.
 * Core's distance-traveled resets to the start when its corridor is replaced.
 * The phone's place on that same line does not.
 */
export function fartherAlongMeters(
  coreAlongM: number,
  gpsAlongM: number,
  routeLengthM?: number | null
): number {
  const core = Number.isFinite(coreAlongM) && coreAlongM > 0 ? coreAlongM : 0;
  const gps = Number.isFinite(gpsAlongM) && gpsAlongM > 0 ? gpsAlongM : 0;
  let along = Math.max(core, gps);
  if (routeLengthM != null && Number.isFinite(routeLengthM) && routeLengthM > 1) {
    along = Math.min(along, routeLengthM);
  }
  return along;
}

export function computeRemainingDistanceMeters(
  navigationStarted: boolean,
  routeLengthM: number,
  alongM: number
): number | null {
  if (!navigationStarted || routeLengthM <= 1) return null;
  const rem = Math.max(0, routeLengthM - alongM);
  return rem <= 0 ? null : rem;
}

/**
 * Remaining drive minutes.
 * Live Mapbox minutes win when they describe the road still ahead.
 * A live answer whose free-flow time is a much longer or much shorter road is dropped.
 * The toolbar then steps a higher number up, so one poll cannot jump the clock.
 * Otherwise the planned trip ETA is scaled by miles left on this line divided by the
 * planned trip — not by how full the current (often short) corridor is.
 * A live answer that is still the whole-trip clock, after the corridor has shrunk,
 * is the "2 hours left" lie and is dropped in favor of that scale.
 */
export function computeRemainingDriveEtaMinutes(input: {
  navigationStarted: boolean;
  fullEtaMinutes: number | null;
  routeLengthM: number;
  alongM: number;
  hasRouteGeometry: boolean;
  /** Planned trip length. Longer than `routeLengthM` when Core is on a short corridor. */
  planLengthM?: number | null;
  /** Straight-line miles already driven. Used when along snaps back to the start of a full line. */
  tripOdometerM?: number | null;
  /** Mapbox duration for the remaining path (not the full planned leg). */
  liveRemainingEtaMinutes?: number | null;
  /** Mapbox free-flow minutes for that same path. A much longer road than the miles left is dropped. */
  typicalRemainingMinutes?: number | null;
}): number | null {
  const {
    navigationStarted,
    fullEtaMinutes,
    routeLengthM,
    alongM,
    hasRouteGeometry,
    planLengthM = null,
    tripOdometerM = null,
    liveRemainingEtaMinutes = null,
    typicalRemainingMinutes = null,
  } = input;
  if (!navigationStarted) return null;
  const full =
    fullEtaMinutes != null && Number.isFinite(fullEtaMinutes) ? Math.round(fullEtaMinutes) : null;
  const scaled = scaledRemainingMinutes({
    full,
    routeLengthM,
    alongM,
    hasRouteGeometry,
    planLengthM,
    tripOdometerM,
  });
  if (
    liveRemainingEtaMinutes != null &&
    Number.isFinite(liveRemainingEtaMinutes) &&
    liveRemainingEtaMinutes > 0
  ) {
    const live = Math.max(1, Math.round(liveRemainingEtaMinutes));
    if (scaled != null && liveDurationIsWholeTrip(live, full, scaled, routeLengthM, alongM, planLengthM)) {
      return scaled;
    }
    if (scaled != null && !liveSliceMatchesRoadLeft(typicalRemainingMinutes, scaled)) {
      return scaled;
    }
    return live;
  }
  if (scaled != null) return scaled;
  if (full == null) return null;
  return Math.max(1, full);
}

function scaledRemainingMinutes(input: {
  full: number | null;
  routeLengthM: number;
  alongM: number;
  hasRouteGeometry: boolean;
  planLengthM: number | null;
  tripOdometerM: number | null;
}): number | null {
  const { full, routeLengthM, alongM, hasRouteGeometry, planLengthM, tripOdometerM } = input;
  if (full == null) return null;
  if (routeLengthM <= 1 || !hasRouteGeometry) return Math.max(1, full);
  const planM =
    planLengthM != null && Number.isFinite(planLengthM) && planLengthM > 1
      ? Math.max(planLengthM, routeLengthM)
      : routeLengthM;
  const along = Number.isFinite(alongM) ? Math.max(0, alongM) : 0;
  let rem = Math.max(0, routeLengthM - along);
  const odometer =
    tripOdometerM != null && Number.isFinite(tripOdometerM) ? Math.max(0, tripOdometerM) : 0;
  /* Core along reset to the start of a line that is still the whole plan. */
  if (routeLengthM > planM * 0.75 && along <= 800 && odometer > along + 1609) {
    rem = Math.max(0, planM - odometer);
  }
  const frac = planM > 1 ? rem / planM : rem / routeLengthM;
  return Math.max(1, Math.round(full * Math.min(1, Math.max(0, frac))));
}

/** Live minutes are still the planned trip, while the line ahead is only a slice of it. */
function liveDurationIsWholeTrip(
  liveMin: number,
  fullMin: number | null,
  scaledMin: number,
  routeLengthM: number,
  alongM: number,
  planLengthM: number | null
): boolean {
  if (fullMin == null || fullMin <= 1) return false;
  const planM =
    planLengthM != null && Number.isFinite(planLengthM) && planLengthM > 1
      ? Math.max(planLengthM, routeLengthM)
      : routeLengthM;
  if (planM <= 1) return false;
  const along = Number.isFinite(alongM) ? Math.max(0, alongM) : 0;
  const corridorRem = Math.max(0, routeLengthM - along);
  const remFrac = corridorRem / planM;
  if (remFrac >= 0.8) return false;
  return liveMin >= fullMin - 12 && liveMin > scaledMin + 15;
}

/**
 * Free-flow time for the fetched path should be the road the miles say is left.
 * A sampled detour, or the whole trip fetched from a point behind the car, is much longer.
 * A snap too far ahead is much shorter. Real congestion keeps a normal free-flow and a higher live time.
 */
function liveSliceMatchesRoadLeft(typicalMin: number | null, scaledMin: number): boolean {
  if (typicalMin == null || !Number.isFinite(typicalMin) || typicalMin <= 0) return true;
  if (typicalMin > scaledMin * 1.75 && typicalMin > scaledMin + 12) return false;
  if (typicalMin < scaledMin * 0.45 && scaledMin - typicalMin > 12) return false;
  return true;
}

/** One upward step. Stays under the 3-minute jump the drive dump calls a lie. */
export const ETA_UP_STEP_MIN = 2;
/** How long a higher answer has to persist before the clock takes another step toward it. */
export const ETA_UP_STEP_MS = 45_000;
/** Remaining road grew by about this much: a new line, so the new time is allowed at once. */
export const ETA_REROUTE_GROW_M = 3_200;

export type EtaEaseState = {
  shown: number | null;
  target: number | null;
  distanceM: number | null;
  raisedAtMs: number | null;
  key: string;
};

export function emptyEtaEaseState(): EtaEaseState {
  return { shown: null, target: null, distanceM: null, raisedAtMs: null, key: "" };
}

/**
 * The clock may count down as the car moves. A higher live answer steps up,
 * and only again after it is still high. A longer road ahead is a new line and shows at once.
 */
export function easeRemainingEtaMinutes(
  state: EtaEaseState,
  targetMin: number | null,
  distanceM: number | null,
  nowMs: number
): number | null {
  if (targetMin == null || !Number.isFinite(targetMin) || targetMin <= 0) {
    state.shown = null;
    state.target = null;
    state.distanceM = null;
    state.raisedAtMs = null;
    state.key = "";
    return null;
  }
  const target = Math.round(targetMin);
  const distBucket =
    distanceM == null || !Number.isFinite(distanceM) ? "" : String(Math.round(distanceM / 500));
  const timeBucket = Number.isFinite(nowMs) ? Math.floor(nowMs / ETA_UP_STEP_MS) : 0;
  const key = `${target}|${distBucket}|${timeBucket}`;
  if (state.key === key) return state.shown;

  const prev = state.shown;
  const prevDist = state.distanceM;
  let shown = target;
  if (prev != null) {
    const roadGrew =
      distanceM != null &&
      prevDist != null &&
      Number.isFinite(distanceM) &&
      Number.isFinite(prevDist) &&
      distanceM > prevDist + ETA_REROUTE_GROW_M;
    if (roadGrew || target <= prev) {
      shown = target;
    } else if (
      state.raisedAtMs == null ||
      nowMs - state.raisedAtMs >= ETA_UP_STEP_MS
    ) {
      shown = Math.min(target, prev + ETA_UP_STEP_MIN);
    } else {
      shown = prev;
    }
  }

  state.shown = shown;
  state.target = target;
  state.distanceM = distanceM != null && Number.isFinite(distanceM) ? distanceM : null;
  state.key = key;
  if (prev != null && shown > prev) state.raisedAtMs = nowMs;
  else if (shown <= (prev ?? shown)) {
    /* A countdown clears the wait so the next real delay can take its first step. */
    if (target <= shown) state.raisedAtMs = null;
  }
  return shown;
}

export function auditTripNavDisplay(input: {
  navigationStarted: boolean;
  routeLengthM: number;
  alongM: number;
  fullEtaMinutes: number | null;
  remainingEtaMinutes: number | null;
  remainingDistanceM: number | null;
  speedMps: number | null | undefined;
  /** Ms since along-route distance last moved meaningfully while moving. */
  alongStaleMs?: number;
}): TripNavDisplayAudit {
  const issues: TripNavDisplayIssue[] = [];
  const {
    navigationStarted,
    routeLengthM,
    alongM,
    fullEtaMinutes,
    remainingEtaMinutes,
    remainingDistanceM,
    speedMps,
    alongStaleMs = 0,
  } = input;

  if (!navigationStarted || routeLengthM <= 1) {
    return { ok: true, issues, remainingDistanceM, remainingEtaMinutes };
  }

  if (alongM > routeLengthM + 40) issues.push("along_exceeds_route");
  if (remainingDistanceM != null && remainingDistanceM > routeLengthM + 40) {
    issues.push("remaining_exceeds_route");
  }
  if (
    fullEtaMinutes != null &&
    remainingEtaMinutes != null &&
    remainingEtaMinutes > fullEtaMinutes + 2
  ) {
    issues.push("eta_exceeds_full");
  }

  if (remainingDistanceM != null && remainingEtaMinutes != null && remainingEtaMinutes > 0) {
    const hours = remainingEtaMinutes / 60;
    const impliedMph = hours > 0 ? (remainingDistanceM / 1609.34) / hours : 0;
    if (impliedMph > 130 && remainingDistanceM > 400) issues.push("eta_implausible_fast");
    const speedMph = speedMps != null && speedMps > 0 ? speedMps * 2.23694 : null;
    if (
      speedMph != null &&
      speedMph >= 18 &&
      remainingDistanceM > 3_000 &&
      impliedMph > 0 &&
      impliedMph < speedMph * 0.35
    ) {
      issues.push("eta_implausible_slow_vs_speed");
    }
  }

  if (alongStaleMs >= 90_000) issues.push("along_progress_stale");

  return {
    ok: issues.length === 0,
    issues,
    remainingDistanceM,
    remainingEtaMinutes,
  };
}

/** Live closest-point along (no hold) — used to repair stuck progress. */
export function liveAlongRouteMeters(pos: LngLat | null, geometry: LngLat[] | undefined): number | null {
  if (!pos || !geometry || geometry.length < 2) return null;
  const { alongMeters } = closestAlongRouteMeters(pos, geometry);
  return Number.isFinite(alongMeters) ? alongMeters : null;
}

export type TripNavDisplayRepairAction = "refresh_traffic" | "reset_along_hold";

export function repairActionsForIssues(issues: TripNavDisplayIssue[]): TripNavDisplayRepairAction[] {
  const actions = new Set<TripNavDisplayRepairAction>();
  for (const issue of issues) {
    if (issue === "along_progress_stale" || issue === "along_exceeds_route") {
      actions.add("reset_along_hold");
    }
    if (
      issue === "eta_exceeds_full" ||
      issue === "eta_implausible_fast" ||
      issue === "eta_implausible_slow_vs_speed" ||
      issue === "remaining_exceeds_route"
    ) {
      actions.add("refresh_traffic");
    }
  }
  if (issues.includes("along_exceeds_route")) actions.add("reset_along_hold");
  return [...actions];
}
