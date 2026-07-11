import type { NavRoute, RouteRole } from "../nav/types";

/**
 * Active route — sky blue (reads over green/yellow radar better than mid blue).
 * White casing in mapRouteLayers keeps it separated from radar wash.
 */
export const ROUTE_ACTIVE_COLOR = "#38bdf8";
/**
 * Alternate / suggested — near-white so B stays visible on green radar
 * (dark blue was disappearing into the overlay).
 */
export const ROUTE_SUGGESTED_COLOR = "#f1f5f9";

/** Halo under the colored core so routes stay readable on radar. */
export const ROUTE_LINE_CASING_COLOR = "#0f172a";
export const ROUTE_LINE_CASING_WIDTH_EXTRA = 5;
export const ROUTE_LINE_CASING_OPACITY = 0.92;

export const ROUTE_ACTIVE_LINE_WIDTH = 8;
export const ROUTE_SUGGESTED_LINE_WIDTH = 6;

/** @deprecated use ROUTE_ACTIVE_COLOR */
export const ROUTE_A_COLOR = ROUTE_ACTIVE_COLOR;
/** @deprecated use ROUTE_SUGGESTED_COLOR */
export const ROUTE_B_COLOR = ROUTE_SUGGESTED_COLOR;

export const ROLE_COLOR: Record<RouteRole, string> = {
  fastest: ROUTE_ACTIVE_COLOR,
  balanced: "#7dd3fc",
  hazardSmart: ROUTE_SUGGESTED_COLOR,
};

/** A / B / C picker — active sky, mid cyan, alternate light. */
export const ROUTE_PICK_SLOT_HEX = [ROUTE_ACTIVE_COLOR, "#7dd3fc", ROUTE_SUGGESTED_COLOR] as const;

export function routePickSlotHex(slotIndex: number): string {
  return ROUTE_PICK_SLOT_HEX[
    Math.min(Math.max(0, slotIndex), ROUTE_PICK_SLOT_HEX.length - 1)
  ]!;
}

export function routeMapLineStyle(isActive: boolean): {
  color: string;
  width: number;
  opacity: number;
} {
  if (isActive) {
    return {
      color: ROUTE_ACTIVE_COLOR,
      width: ROUTE_ACTIVE_LINE_WIDTH,
      opacity: 0.95,
    };
  }
  return {
    color: ROUTE_SUGGESTED_COLOR,
    width: ROUTE_SUGGESTED_LINE_WIDTH,
    opacity: 0.88,
  };
}

/** @deprecated use routeMapLineStyle(true).color */
export const FOCUSED_ROUTE_LINE_COLOR = ROUTE_ACTIVE_COLOR;
export const FOCUSED_ROUTE_LINE_OPACITY = 0.95;
/** @deprecated use ROUTE_ACTIVE_LINE_WIDTH */
export const FOCUSED_ROUTE_LINE_WIDTH = ROUTE_ACTIVE_LINE_WIDTH;

export const ROUTE_C_COLOR = "#cbd5e1";

export function routeHex(route: NavRoute): string {
  if (route.id === "r-a" || route.id.startsWith("r-a")) return ROUTE_ACTIVE_COLOR;
  return ROUTE_SUGGESTED_COLOR;
}
