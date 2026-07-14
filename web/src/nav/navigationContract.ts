/**
 * StormPath navigation contract — single source of truth for route-change rules.
 *
 * While navigating the driver owns one locked corridor chosen at Go (or by explicit
 * promote). That corridor’s id **and** geometry stay frozen. Leaving the road uses a
 * temporary forward rejoin stub back onto the locked line — never a silent GPS→dest
 * rewrite that would yank a chosen alternate onto Mapbox “fastest.”
 */

export type NavigationPhase = "planning" | "navigating";

/** Why the locked route might change — every mutation must map to one of these. */
export type LockedRouteChangeReason =
  | "go_lock" /** Driver pressed Go — locks leg id and geometry from planning. */
  | "driver_stay_on_road" /** Legacy full GPS→dest replan — forbidden while navigating. */
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
 * 2. Locked leg geometry is frozen — off-route recovery uses a temporary rejoin overlay.
 * 3. Route/Map view may show B/C alternates; Drive follows locked + optional rejoin stub.
 * 4. B/C alternate legs refresh in Route/Map view only — never replace locked guidance in Drive.
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
      return true;
    case "driver_stay_on_road":
      /* Silent GPS→dest overwrite used to yank chosen B onto highway-fastest. Forbidden. */
      return false;
    default:
      return false;
  }
}

/** Alternate legs (B/C) may refresh while navigating — locked leg must be preserved. */
export function mayRefreshAlternateLegsOnly(phase: NavigationPhase, viewMode: string): boolean {
  return phase === "navigating" && (viewMode === "route" || viewMode === "topdown");
}

/**
 * Full GPS→destination overwrite of the locked leg requires an explicit driver confirm
 * (compare / promote). Silent Drive recovery must use forward rejoin only.
 */
export function offRouteFullRerouteRequiresExplicitCompare(): boolean {
  return true;
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
