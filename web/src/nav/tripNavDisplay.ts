import type { LngLat } from "./types";
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

export function computeRemainingDistanceMeters(
  navigationStarted: boolean,
  routeLengthM: number,
  alongM: number
): number | null {
  if (!navigationStarted || routeLengthM <= 1) return null;
  const rem = Math.max(0, routeLengthM - alongM);
  return rem <= 0 ? null : rem;
}

/** Remaining drive minutes: full-route ETA scaled by distance left (matches toolbar). */
export function computeRemainingDriveEtaMinutes(input: {
  navigationStarted: boolean;
  fullEtaMinutes: number | null;
  routeLengthM: number;
  alongM: number;
  hasRouteGeometry: boolean;
}): number | null {
  const { navigationStarted, fullEtaMinutes, routeLengthM, alongM, hasRouteGeometry } = input;
  if (!navigationStarted || fullEtaMinutes == null || !Number.isFinite(fullEtaMinutes)) return null;
  const full = Math.round(fullEtaMinutes);
  if (routeLengthM <= 1 || !hasRouteGeometry) return Math.max(1, full);
  const rem = Math.max(0, routeLengthM - alongM);
  const frac = rem / routeLengthM;
  return Math.max(1, Math.round(full * frac));
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
