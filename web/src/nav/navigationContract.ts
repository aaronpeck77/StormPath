/**
 * StormPath navigation contract — single source of truth for route-change rules.
 *
 * While navigating the driver owns one locked corridor chosen at Go (or by explicit
 * promote). Leaving the road does a **soft restart from GPS** (same trip / destination,
 * new locked geometry ahead) so Drive / Route / Map stay on one line — not a full Stop,
 * and not a temporary overlay that only paints in Rt/Mp.
 *
 * Soft restart / Core reroute should preserve route style (e.g. no-interstate) via
 * preferBackroads when fetching — but once a new corridor is chosen it becomes the
 * Go lock (`force` adopt). Never keep the old Go polyline frozen while alongM
 * advances on a different line (that empties the Drive blue line).
 */

export type NavigationPhase = "planning" | "navigating";

/** Why the locked route might change — every mutation must map to one of these. */
export type LockedRouteChangeReason =
  | "go_lock" /** Driver pressed Go — locks leg id and geometry from planning. */
  | "driver_stay_on_road" /** Explicit stay-on-road control — same as soft restart. */
  | "off_route_soft_restart" /** Confirmed off-route: GPS→dest rewrite of locked geometry. */
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
 * 2. Locked leg geometry soft-restarts from GPS (or Core reroute) when off-route — becomes the new Go lock.
 * 3. After soft restart / Core reroute, Dr/Rt/Mp share that single corridor (stale B/C overlays cleared).
 * 4. B/C alternate legs may refresh in Route/Map while on-route; they must not leave Drive on a stub.
 * 5. Traffic bypass: offer → compare → explicit confirm only (`trafficBypassFlow.ts`).
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
    case "off_route_soft_restart":
    case "driver_stay_on_road":
      return true;
    default:
      return false;
  }
}

/** Alternate legs (B/C) may refresh while navigating — locked leg must be preserved. */
export function mayRefreshAlternateLegsOnly(phase: NavigationPhase, viewMode: string): boolean {
  return phase === "navigating" && (viewMode === "route" || viewMode === "topdown");
}

/**
 * Off-route auto recovery soft-restarts the locked leg from GPS (keeps destination).
 * Explicit compare is only required for traffic-bypass / promote of a different slot.
 */
export function offRouteFullRerouteRequiresExplicitCompare(): boolean {
  return false;
}

/** Auto rejoin may follow a temporary overlay leg without changing the locked route id. */
export function mayAutoRejoinOverlay(phase: NavigationPhase): boolean {
  return phase === "navigating";
}

/**
 * Drive turn-by-turn may follow a temporary rejoin stub while it exists. The locked
 * corridor returns once the puck is back on it (or the stub clears).
 */
export function driveGuidanceUsesRejoinOverlay(
  temporaryGuidanceRouteId: string | null | undefined,
  lockedRouteId: string | null | undefined
): boolean {
  if (!temporaryGuidanceRouteId) return false;
  if (!lockedRouteId) return true;
  return temporaryGuidanceRouteId !== lockedRouteId;
}
