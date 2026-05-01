import type { LngLat } from "./types";
import { MAX_STRIP_ALERTS } from "./constants";

/**
 * Legacy `RouteAlert` shape — kept for the strip / map / corridor sheet which still consume it.
 * The unified `RouteImpact` model in `routeImpacts.ts` is now the source of truth; this type
 * is produced by `routeImpactToRouteAlert()` so every surface stays consistent.
 */
export type RouteAlertCorridorKind = "weather" | "hazard" | "notice" | "traffic";

export type RouteAlert = {
  id: string;
  severity: number;
  title: string;
  detail: string;
  lngLat: LngLat;
  zoom: number;
  /** Approximate distance from route start along the selected polyline (meters). */
  alongMeters: number;
  /** Include in drive-mode “within 5 mi” reroute prompts. */
  promptRerouteAhead: boolean;
  corridorKind: RouteAlertCorridorKind;
};

/** Half-length of highlighted segment on map + strip (meters each side of alert position). */
export const ROUTE_CORRIDOR_HIGHLIGHT_HALF_SPAN_M = 400;

/** Map + progress strip segment color for corridor alerts (NWS polygons use separate severity colors on the map). */
export function corridorHighlightHex(kind: RouteAlertCorridorKind, severity: number): string {
  if (kind === "weather") {
    return severity >= 70 ? "#7c3aed" : "#0ea5e9";
  }
  if (kind === "hazard") {
    return severity >= 80 ? "#dc2626" : severity >= 60 ? "#ea580c" : "#f59e0b";
  }
  if (kind === "traffic") {
    return severity >= 80 ? "#dc2626" : severity >= 58 ? "#ea580c" : "#f59e0b";
  }
  return severity >= 48 ? "#475569" : "#94a3b8";
}

/**
 * Strip layout: road notices / construction outrank generic traffic so they stay visible under MAX_STRIP_ALERTS.
 */
export function augmentAlertsForProgressStrip(base: RouteAlert[]): RouteAlert[] {
  const hazardsStrip = base.filter((a) => a.id.startsWith("hazard-"));
  const restStrip = base.filter((a) => !a.id.startsWith("hazard-"));
  hazardsStrip.sort((a, b) => b.severity - a.severity);
  restStrip.sort((a, b) => b.severity - a.severity);
  return [...hazardsStrip, ...restStrip].slice(0, MAX_STRIP_ALERTS);
}
