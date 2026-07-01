import type { NavRoute } from "./types";

/** Debounce after foreground resume — lets Mapbox style + React settle. */
export const TRIP_SURFACE_FOREGROUND_DEBOUNCE_MS = 900;
/** Minimum spacing between automatic trip-surface repairs. */
export const TRIP_SURFACE_REPAIR_COOLDOWN_MS = 28_000;
/** Periodic audit while a trip is on screen (slow links, busy main thread). */
export const TRIP_SURFACE_POLL_MS = 42_000;

export type TripSurfaceIssue =
  /** A visible route slot has no polyline — common when Directions partially returned. */
  | "ordered_route_missing_geometry"
  /** Navigating but the guidance leg has no turn list — banner/voice may be blank. */
  | "guidance_missing_turn_steps"
  /** App returned to foreground with an active trip — re-verify surfaces. */
  | "foreground_resume";

export type TripSurfaceRepairAction =
  | "bump_map_fit"
  | "refresh_traffic"
  | "refresh_forecast"
  | "reset_along_hold";

export type TripSurfaceAudit = {
  ok: boolean;
  issues: TripSurfaceIssue[];
};

export function auditTripSurface(input: {
  orderedRouteIds: string[];
  planRoutes: NavRoute[];
  navigationStarted: boolean;
  guidanceRouteId: string;
  foregroundResume?: boolean;
}): TripSurfaceAudit {
  const issues: TripSurfaceIssue[] = [];
  const { orderedRouteIds, planRoutes, navigationStarted, guidanceRouteId, foregroundResume } =
    input;

  if (foregroundResume) {
    issues.push("foreground_resume");
  }

  const byId = new Map(planRoutes.map((r) => [r.id, r]));
  for (const id of orderedRouteIds) {
    const route = byId.get(id);
    if (!route?.geometry || route.geometry.length < 2) {
      issues.push("ordered_route_missing_geometry");
      break;
    }
  }

  if (navigationStarted && guidanceRouteId) {
    const guidance = byId.get(guidanceRouteId);
    if (guidance && (!guidance.turnSteps || guidance.turnSteps.length === 0)) {
      issues.push("guidance_missing_turn_steps");
    }
  }

  return { ok: issues.length === 0, issues };
}

export function repairActionsForTripSurfaceIssues(
  issues: readonly TripSurfaceIssue[]
): TripSurfaceRepairAction[] {
  if (!issues.length) return [];
  const actions = new Set<TripSurfaceRepairAction>();

  if (issues.includes("foreground_resume")) {
    actions.add("bump_map_fit");
    actions.add("refresh_traffic");
  }
  if (issues.includes("ordered_route_missing_geometry")) {
    actions.add("bump_map_fit");
    actions.add("refresh_traffic");
    actions.add("refresh_forecast");
  }
  if (issues.includes("guidance_missing_turn_steps")) {
    actions.add("reset_along_hold");
    actions.add("refresh_traffic");
  }

  return [...actions];
}
