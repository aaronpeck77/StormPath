/**
 * StormPath navigation contract — single source of truth for route-change rules.
 *
 * Goal: simple turn-by-turn on the route the driver chose. No silent swaps like
 * mainstream nav apps. When the driver leaves that line, we detect it and only
 * change guidance after an explicit review + confirm.
 */

export type NavigationPhase = "planning" | "navigating";

/** Why the locked route might change — every mutation must map to one of these. */
export type LockedRouteChangeReason =
  | "go_lock" /** Driver pressed Go — locks leg id; may snap geometry to roads once. */
  | "go_geometry_snap" /** One-time road-following refresh of the locked leg after Go. */
  | "driver_promote" /** Driver confirmed a different leg (compare sheet, promote, bypass confirm). */
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
 * 2. Locked leg geometry never changes except `go_geometry_snap` (once after Go).
 * 3. B/C alternate legs may refresh in Route/Map view only — never replaces locked guidance in Drive.
 * 4. Off-route: voice alert + optional auto-rejoin overlay (temporary B/C leg back to locked
 *    route — locked route id unchanged). Full GPS→destination reroute requires compare + confirm.
 * 5. No silent full replan to destination without compare + confirm.
 * 6. Temporary rejoin overlay in Drive view may activate automatically when auto-rejoin is on.
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
    case "go_geometry_snap":
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

/** Full destination reroute always needs compare + confirm. Auto rejoin is separate. */
export function offRouteFullRerouteRequiresExplicitCompare(): true {
  return true;
}

/** Auto rejoin may follow a temporary overlay leg without changing the locked route id. */
export function mayAutoRejoinOverlay(phase: NavigationPhase, autoRejoinEnabled: boolean): boolean {
  return phase === "navigating" && autoRejoinEnabled;
}
