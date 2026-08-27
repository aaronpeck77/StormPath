import type { ExpressionSpecification } from "mapbox-gl";
import type { NavRoute, RouteRole } from "../nav/types";
import type { MapViewMode } from "./driveMapTypes";

/**
 * Active route — sky blue (reads over green/yellow radar better than mid blue).
 * White casing in mapRouteLayers keeps it separated from radar wash.
 */
export const ROUTE_ACTIVE_COLOR = "#38bdf8";
/**
 * Alternate / suggested on the map — light cyan so B is visible on streets
 * and still reads over green radar (dark blue disappeared into the overlay).
 */
export const ROUTE_SUGGESTED_COLOR = "#7dd3fc";

/** Halo under the colored core so routes stay readable on radar. */
export const ROUTE_LINE_CASING_COLOR = "#0f172a";
export const ROUTE_LINE_CASING_WIDTH_EXTRA = 2.5;
export const ROUTE_LINE_CASING_OPACITY = 0.92;

export const ROUTE_ACTIVE_LINE_WIDTH = 8;
export const ROUTE_SUGGESTED_LINE_WIDTH = 6;

/**
 * Street-level width so the blue line sits on the pavement in Dr / Mp
 * without covering the whole lane. Zoom 14 stays at the historic 8px.
 */
const DRIVE_LINE_WIDTH_STOPS: [number, number][] = [
  [8, 2.5],
  [12, 5],
  [14, 8],
  [16, 10],
  [17.5, 14],
  [19, 18],
];

/**
 * Rt overview sits at mid zooms where the Drive curve is still thin.
 * Nudge those stops up a little for readability; street zoom stays Drive.
 */
const ROUTE_VIEW_LINE_WIDTH_STOPS: [number, number][] = [
  [8, 3.5],
  [12, 6.5],
  [14, 10],
  [16, 10],
  [17.5, 14],
  [19, 18],
];

/** Main Rt map only — Drive, Map, and the corner PiP keep the slim line. */
export function routeLineWidthViewMode(
  viewMode: MapViewMode | undefined,
  isOverviewPip = false
): MapViewMode {
  return viewMode === "route" && !isOverviewPip ? "route" : "drive";
}

export function routeLineWidthByZoom(
  baseWidth: number,
  viewMode: MapViewMode = "drive"
): ExpressionSpecification {
  const scale = baseWidth / ROUTE_ACTIVE_LINE_WIDTH;
  const at = (n: number) => Math.round(n * scale * 10) / 10;
  const stops = viewMode === "route" ? ROUTE_VIEW_LINE_WIDTH_STOPS : DRIVE_LINE_WIDTH_STOPS;
  const expr: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"]];
  for (const [zoom, width] of stops) {
    expr.push(zoom, at(width));
  }
  return expr;
}

export function routeCasingWidthByZoom(
  baseWidth: number,
  viewMode: MapViewMode = "drive"
): ExpressionSpecification {
  return ["+", routeLineWidthByZoom(baseWidth, viewMode), ROUTE_LINE_CASING_WIDTH_EXTRA];
}

export function routeHitWidthByZoom(
  baseWidth: number,
  viewMode: MapViewMode = "drive"
): ExpressionSpecification {
  return ["+", routeLineWidthByZoom(baseWidth, viewMode), 12];
}

/** @deprecated use ROUTE_ACTIVE_COLOR */
export const ROUTE_A_COLOR = ROUTE_ACTIVE_COLOR;
/** @deprecated use ROUTE_SUGGESTED_COLOR */
export const ROUTE_B_COLOR = ROUTE_SUGGESTED_COLOR;

export const ROLE_COLOR: Record<RouteRole, string> = {
  fastest: ROUTE_ACTIVE_COLOR,
  balanced: ROUTE_SUGGESTED_COLOR,
  hazardSmart: ROUTE_SUGGESTED_COLOR,
};

/** A / B / C picker — active sky, then the same cyan used for the alternate map line. */
export const ROUTE_PICK_SLOT_HEX = [ROUTE_ACTIVE_COLOR, ROUTE_SUGGESTED_COLOR, "#bae6fd"] as const;

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
