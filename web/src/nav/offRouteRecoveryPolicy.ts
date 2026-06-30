import type { DrivingRejoinMode } from "./drivingRejoinContext";
import {
  OFF_ROUTE_FORCE_REOFFER_LATERAL_M,
  OFF_ROUTE_HEADING_DELTA_DEG,
  OFF_ROUTE_HEADING_MIN_LATERAL_M,
  OFF_ROUTE_REROUTE_EXIT_M,
} from "./offRouteDetect";

/** Max observation window before committing rejoin/replan (gas stop, parking). */
export const OFF_ROUTE_OBSERVATION_MAX_MS = 120_000;
/** Short patience for ambiguous moving departures before committing. */
export const OFF_ROUTE_OBSERVATION_AMBIGUOUS_MS = 12_000;
/** Below this speed, treat as stopped/slow pull-off (~5 mph). */
export const OFF_ROUTE_OBSERVATION_HOLD_SPEED_MPS = 2.2;
/** Fully stopped — hold indefinitely until the driver moves (fuel, parking). */
export const OFF_ROUTE_GAS_STOP_HOLD_SPEED_MPS = 1.2;
/** Lateral cap while slow — still beside the corridor, not a new leg. */
export const OFF_ROUTE_OBSERVATION_HOLD_LATERAL_M = 55;
/** Prefer rejoin (not full replan) when lateral is below this. */
export const OFF_ROUTE_REJOIN_MAX_LATERAL_M = 120;
/** Mapbox-style: tighter corridor near an upcoming maneuver. */
export const OFF_ROUTE_NEAR_STEP_M = 80;
export const OFF_ROUTE_ENTER_NEAR_STEP_M = 14;
export const OFF_ROUTE_ENTER_DEFAULT_M = 22;

export type OffRouteRecoveryAction = "hold" | "rejoin" | "replan";

export type OffRouteRecoveryInput = {
  nowMs: number;
  latchedAtMs: number;
  lateralM: number;
  priorLateralM: number | null;
  lateralPeakM: number;
  speedMps: number;
  headingDeg: number | null;
  routeBearingDeg: number | null;
  rejoinFailCount: number;
  drivingRejoinMode: DrivingRejoinMode;
  recoveryCommitted: boolean;
};

function headingDeltaDegrees(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/** Step-aware off-route enter threshold (Mapbox Nav SDK pattern). */
export function offRouteEnterThresholdM(metersToCurrentStepEnd: number | null | undefined): number {
  if (
    metersToCurrentStepEnd != null &&
    Number.isFinite(metersToCurrentStepEnd) &&
    metersToCurrentStepEnd <= OFF_ROUTE_NEAR_STEP_M
  ) {
    return OFF_ROUTE_ENTER_NEAR_STEP_M;
  }
  return OFF_ROUTE_ENTER_DEFAULT_M;
}

export function isClearlyDivergingFromRoute(input: Pick<
  OffRouteRecoveryInput,
  "lateralM" | "priorLateralM" | "speedMps" | "headingDeg" | "routeBearingDeg" | "lateralPeakM"
>): boolean {
  const { lateralM, priorLateralM, speedMps, headingDeg, routeBearingDeg, lateralPeakM } = input;

  if (lateralM >= OFF_ROUTE_FORCE_REOFFER_LATERAL_M) return true;

  if (
    priorLateralM != null &&
    speedMps >= OFF_ROUTE_OBSERVATION_HOLD_SPEED_MPS &&
    lateralM >= priorLateralM + 2.5 &&
    lateralM >= OFF_ROUTE_HEADING_MIN_LATERAL_M
  ) {
    return true;
  }

  if (
    headingDeg != null &&
    routeBearingDeg != null &&
    Number.isFinite(headingDeg) &&
    Number.isFinite(routeBearingDeg) &&
    lateralM >= OFF_ROUTE_HEADING_MIN_LATERAL_M &&
    headingDeltaDegrees(headingDeg, routeBearingDeg) >= OFF_ROUTE_HEADING_DELTA_DEG + 7
  ) {
    return true;
  }

  if (lateralPeakM >= OFF_ROUTE_REJOIN_MAX_LATERAL_M && lateralM >= lateralPeakM - 5) {
    return true;
  }

  return false;
}

function shouldPreferRejoin(input: OffRouteRecoveryInput): boolean {
  if (input.rejoinFailCount >= 2) return false;
  if (input.lateralM > OFF_ROUTE_REJOIN_MAX_LATERAL_M) return false;

  /* Missed turn beside the corridor — rejoin beats a GPS replan that often adds a U-turn. */
  if (input.lateralM <= 90 && input.lateralPeakM <= OFF_ROUTE_REJOIN_MAX_LATERAL_M + 15) {
    return true;
  }

  const diverging = isClearlyDivergingFromRoute(input);

  if (input.drivingRejoinMode === "auto_local" && !diverging) return true;

  if (diverging) return false;

  if (input.lateralM <= OFF_ROUTE_OBSERVATION_HOLD_LATERAL_M) return true;

  if (
    input.headingDeg != null &&
    input.routeBearingDeg != null &&
    headingDeltaDegrees(input.headingDeg, input.routeBearingDeg) <
      OFF_ROUTE_HEADING_DELTA_DEG
  ) {
    return true;
  }

  return input.lateralM <= 70;
}

/**
 * Hands-free recovery ladder: hold → rejoin locked route → full replan.
 * Called each poll tick while off-route is latched and recovery is not yet committed.
 */
export function classifyOffRouteRecovery(input: OffRouteRecoveryInput): OffRouteRecoveryAction {
  if (input.recoveryCommitted) return "hold";

  const elapsed = Math.max(0, input.nowMs - input.latchedAtMs);
  const diverging = isClearlyDivergingFromRoute(input);

  /* Fuel stop / parking: stay in hold until the driver actually moves. */
  if (
    !diverging &&
    input.speedMps < OFF_ROUTE_GAS_STOP_HOLD_SPEED_MPS &&
    input.lateralM <= OFF_ROUTE_OBSERVATION_HOLD_LATERAL_M
  ) {
    return "hold";
  }

  if (!diverging) {
    if (
      input.speedMps < OFF_ROUTE_OBSERVATION_HOLD_SPEED_MPS &&
      input.lateralM <= OFF_ROUTE_OBSERVATION_HOLD_LATERAL_M &&
      elapsed < OFF_ROUTE_OBSERVATION_MAX_MS
    ) {
      return "hold";
    }

    if (
      input.priorLateralM != null &&
      input.lateralM <= input.priorLateralM - 1.5 &&
      input.lateralM >= OFF_ROUTE_REROUTE_EXIT_M &&
      elapsed < OFF_ROUTE_OBSERVATION_MAX_MS
    ) {
      return "hold";
    }

    if (
      elapsed < OFF_ROUTE_OBSERVATION_AMBIGUOUS_MS &&
      input.lateralM < OFF_ROUTE_FORCE_REOFFER_LATERAL_M
    ) {
      return "hold";
    }
  }

  return shouldPreferRejoin(input) ? "rejoin" : "replan";
}