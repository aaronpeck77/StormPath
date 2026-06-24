import type { NavRoute, RouteRole } from "../nav/types";

/** Active route you are following — dark blue on the map. */
export const ROUTE_ACTIVE_COLOR = "#1e40af";
/** Alternate / suggested / background legs — light blue. */
export const ROUTE_SUGGESTED_COLOR = "#7dd3fc";

export const ROUTE_ACTIVE_LINE_WIDTH = 8;
export const ROUTE_SUGGESTED_LINE_WIDTH = 5;

/** @deprecated use ROUTE_ACTIVE_COLOR */
export const ROUTE_A_COLOR = ROUTE_ACTIVE_COLOR;
/** @deprecated use ROUTE_SUGGESTED_COLOR */
export const ROUTE_B_COLOR = ROUTE_SUGGESTED_COLOR;

export const ROLE_COLOR: Record<RouteRole, string> = {
  fastest: ROUTE_ACTIVE_COLOR,
  balanced: "#2563eb",
  hazardSmart: ROUTE_SUGGESTED_COLOR,
};

/** A / B / C picker — blue shades (active slot is darkest). */
export const ROUTE_PICK_SLOT_HEX = [ROUTE_ACTIVE_COLOR, "#3b82f6", ROUTE_SUGGESTED_COLOR] as const;

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
      opacity: 0.88,
    };
  }
  return {
    color: ROUTE_SUGGESTED_COLOR,
    width: ROUTE_SUGGESTED_LINE_WIDTH,
    opacity: 0.4,
  };
}

/** @deprecated use routeMapLineStyle(true).color */
export const FOCUSED_ROUTE_LINE_COLOR = ROUTE_ACTIVE_COLOR;
export const FOCUSED_ROUTE_LINE_OPACITY = 0.88;
/** @deprecated use ROUTE_ACTIVE_LINE_WIDTH */
export const FOCUSED_ROUTE_LINE_WIDTH = ROUTE_ACTIVE_LINE_WIDTH;

export const ROUTE_C_COLOR = "#bfdbfe";

export function routeHex(route: NavRoute): string {
  if (route.id === "r-a" || route.id.startsWith("r-a")) return ROUTE_ACTIVE_COLOR;
  return ROUTE_SUGGESTED_COLOR;
}
