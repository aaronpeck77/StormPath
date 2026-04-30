import type { NavRoute, RouteRole } from "../nav/types";

/** Route A / B — match right-rail buttons and map lines */
export const ROUTE_A_COLOR = "#3b82f6";
export const ROUTE_B_COLOR = "#22c55e";

export const ROLE_COLOR: Record<RouteRole, string> = {
  fastest: ROUTE_A_COLOR,
  balanced: "#0d9488",
  hazardSmart: ROUTE_B_COLOR,
};

export const ROUTE_C_COLOR = "#f59e0b";

/** A / B / C picker & planning highlight — matches cycle button */
export const ROUTE_PICK_SLOT_HEX = ["#3b82f6", "#22c55e", "#f59e0b"] as const;

export function routePickSlotHex(slotIndex: number): string {
  return ROUTE_PICK_SLOT_HEX[
    Math.min(Math.max(0, slotIndex), ROUTE_PICK_SLOT_HEX.length - 1)
  ]!;
}

/** Focused leg on main map: bright green, semi-transparent so base map stays readable */
export const FOCUSED_ROUTE_LINE_COLOR = "#4ade80";
export const FOCUSED_ROUTE_LINE_OPACITY = 0.55;
export const FOCUSED_ROUTE_LINE_WIDTH = 8;

export function routeHex(route: NavRoute): string {
  if (route.id === "r-a" || route.id.startsWith("r-a")) return ROUTE_A_COLOR;
  if (route.id === "r-b" || route.id.startsWith("r-b")) return ROUTE_B_COLOR;
  if (route.id === "r-c" || route.id.startsWith("r-c")) return ROUTE_C_COLOR;
  return ROLE_COLOR[route.role] ?? "#64748b";
}
