import type { LngLat, NavRoute } from "./types";
import { polylineLengthMeters } from "./routeGeometry";

const MI_PER_M = 1 / 1609.34;

/** Driving distance along the polyline (road geometry), miles. */
export function routeDistanceMiles(geometry: LngLat[]): number {
  return polylineLengthMeters(geometry) * MI_PER_M;
}

export function formatRouteDistanceMi(geometry: LngLat[]): string {
  if (geometry.length < 2) return "—";
  const mi = routeDistanceMiles(geometry);
  if (mi < 0.05) return "<0.1 mi";
  if (mi < 100) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}

/** One short line for UI: how this option was biased. */
export function routeConsiderationSummary(route: NavRoute): string {
  const L = route.label.toLowerCase();
  if (L.includes("scenic")) return "Scenic · alternate path";
  if (L.includes("no interstate") || L.includes("no highway") || /\bhighway\b/.test(L)) {
    return "No interstate";
  }
  if (L.includes("main")) return "Main · fastest";
  if (L.includes("shortest")) return "Shorter distance";
  if (route.role === "fastest") return "Main · fastest";
  if (route.role === "hazardSmart") return "No interstate";
  if (route.role === "balanced") return "Scenic · alternate";
  return "Route option";
}
