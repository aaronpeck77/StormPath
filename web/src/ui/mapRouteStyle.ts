import type { ExpressionSpecification } from "mapbox-gl";
import type { NavRoute, RouteRole } from "../nav/types";
import type { MapViewMode } from "./driveMapTypes";

/**
 * Active route — sky blue (reads over green/yellow radar better than mid blue).
 * Thin black casing in mapRouteLayers keeps the line readable on streets and radar.
 * Rollback (pre Sep 16 field test): active #38bdf8, suggested #bae6fd — both washed
 * out in daylight, so each moved one step darker.
 */
export const ROUTE_ACTIVE_COLOR = "#0ea5e9";
/**
 * Alternate / suggested on the map — mid blue. Rt / Mp use the same sky blue as
 * Drive for the leg you're taking, so the unused leg has to sit clearly lighter
 * while still being visible against pavement.
 */
export const ROUTE_SUGGESTED_COLOR = "#7dd3fc";

/**
 * Black outline around the colored core.
 * +4 (2 px/side) was in the code twice and still vanished on the phone: Mapbox
 * anti-aliases the blue over the peek, and Drive pitch 68 foreshortens the stripe.
 * Street extra 8 ≈ 4 px/side in the style, which reads as ~2 px after pitch/AA.
 * Overview stays thinner so Rt does not grow a fat black tube.
 */
export const ROUTE_LINE_CASING_COLOR = "#000000";
/** Street-level extra (Drive / Map). Half of this is each side. */
export const ROUTE_LINE_CASING_WIDTH_EXTRA = 8;
export const ROUTE_LINE_CASING_OPACITY = 1;
/** Overview extra — enough to see, not a halo. */
const ROUTE_LINE_CASING_WIDTH_EXTRA_OVERVIEW = 3;

export const ROUTE_ACTIVE_LINE_WIDTH = 8;
export const ROUTE_SUGGESTED_LINE_WIDTH = 6;

/**
 * Street-level width — closer to pavement width so shields stay readable.
 * ~half the prior street curve (was 8→18 at zoom 14–19).
 */
const DRIVE_LINE_WIDTH_STOPS: [number, number][] = [
  [8, 1.8],
  [12, 3.2],
  [14, 4.5],
  [16, 5.5],
  [17.5, 7],
  [19, 9],
];

/**
 * Rt overview sits at mid zooms where the Drive curve is still thin.
 * Nudge those stops up a little for readability; street zoom stays Drive.
 */
const ROUTE_VIEW_LINE_WIDTH_STOPS: [number, number][] = [
  [8, 2.5],
  [12, 4.5],
  [14, 6],
  [16, 6],
  [17.5, 7],
  [19, 9],
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

export function routeCasingExtraByZoom(): ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    10,
    ROUTE_LINE_CASING_WIDTH_EXTRA_OVERVIEW,
    14,
    5,
    16,
    ROUTE_LINE_CASING_WIDTH_EXTRA,
    18,
    ROUTE_LINE_CASING_WIDTH_EXTRA,
  ];
}

export function routeCasingWidthByZoom(
  baseWidth: number,
  viewMode: MapViewMode = "drive"
): ExpressionSpecification {
  return ["+", routeLineWidthByZoom(baseWidth, viewMode), routeCasingExtraByZoom()];
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
export const ROUTE_PICK_SLOT_HEX = [ROUTE_ACTIVE_COLOR, ROUTE_SUGGESTED_COLOR, "#e0f2fe"] as const;

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
