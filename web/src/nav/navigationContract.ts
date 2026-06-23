/**
 * StormPath navigation contract — single source of truth for route-change rules.
 *
 * Nav v1: one locked route after Go. The chosen leg geometry is frozen at Go.
 * Off-route recovery may use a temporary rejoin overlay only — never silently swap
 * the locked path for a new Mapbox default route.
 */

export type NavigationPhase = "planning" | "navigating";

/** Why the locked route might change — every mutation must map to one of these. */
export type LockedRouteChangeReason =
  | "go_lock" /** Driver pressed Go — locks leg id and geometry from planning. */
  | "driver_promote" /** Driver confirmed a different leg (compare sheet, promote). */
  | "driver_stop" /** Stop / clear trip. */
  | "replan_destination" /** New destination or full replan before/during nav with preserve flag off. */
  | "forbidden";

export type RouteCompareIntent =
  | "traffic_bypass"
  | "off_route_recovery"
  | "hazard_alternate";

/**
 * Invariants while `navigationStarted`:
 *
 * 1. `lockedRouteId` never changes except via `driver_promote` or `driver_stop`.
 * 2. Locked leg geometry is frozen at Go — no silent GPS→destination replans.
 * 3. B/C alternate legs may refresh in Route/Map view only — never replace locked guidance in Drive.
 * 4. Off-route: optional temporary rejoin overlay back to the locked line only.
 * 5. No drive-time route compare or manual rejoin shuffle (planning compare remains).
 * 6. Traffic bypass: offer → compare → explicit confirm only (`trafficBypassFlow.ts`).
 */
export function mayChangeLockedRouteId(
  phase: NavigationPhase,
  reason: LockedRouteChangeReason
): boolean {
  if (phase === "planning") return reason !== "forbidden";
  switch (reason) {
    case "driver_promote":
    case "driver_stop":
    case "replan_destination":
      return true;
    default:
      return false;
  }
}

export function mayMutateLockedRouteGeometry(
  phase: NavigationPhase,
  reason: LockedRouteChangeReason
): boolean {
  if (phase === "planning") return reason !== "forbidden";
  switch (reason) {
    case "driver_promote":
    case "driver_stop":
    case "replan_destination":
      return true;
    default:
      return false;
  }
}

/** Alternate legs (B/C) may refresh while navigating — locked leg must be preserved. */
export function mayRefreshAlternateLegsOnly(phase: NavigationPhase, viewMode: string): boolean {
  return phase === "navigating" && (viewMode === "route" || viewMode === "topdown");
}

/** Nav v1: never silently full-replan the locked leg during drive. */
export function offRouteFullRerouteRequiresExplicitCompare(): true {
  return true;
}

/** Auto rejoin may follow a temporary overlay leg without changing the locked route id. */
export function mayAutoRejoinOverlay(phase: NavigationPhase): boolean {
  return phase === "navigating";
}
