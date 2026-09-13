import { isExtremeTripRoute, isLongTripRoute, isUltraLongTripRoute } from "../utils/dataSaver";
import { haversineMeters } from "../nav/routeGeometry";
import type { LngLat, NavRoute } from "../nav/types";
import { polylineBbox } from "../weatherAlerts/geometryOverlap";
import { isMapUsable } from "./mapCameraSafe";
import { MAIN_MAP_ROUTE_PADDING } from "./driveMapTypes";

/** Extra top padding when full storm advisory bar is expanded under the guidance bar. */
const ROUTE_FIT_STORM_BAR_EXTRA_TOP_PX = 72;
/** Smaller top inset when only the left “Storm” peek control is shown. */
const ROUTE_FIT_STORM_BAR_PEEK_TOP_PX = 46;
/** Phone collapsed: preview strip under guidance — keep in sync with `.storm-advisory-bar--preview` height. */
const ROUTE_FIT_STORM_BAR_PHONE_COMPACT_TOP_PX = 34;

/** Progress rail column + bezel padding + gap before route endpoints (sync with `.nav-route-progress-rail`). */
const ROUTE_RIGHT_RAIL_COLUMN_PX = 56;
const ROUTE_RIGHT_RAIL_BEZEL_PX = 14;
const ROUTE_RIGHT_RAIL_ENDPOINT_GAP_PX = 16;

export type RouteViewAxis = "eastWest" | "northSouth" | "diagonal";

export function isNarrowPhoneViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 520px)").matches;
}

export function routeProgressRailRightClearancePx(axis: RouteViewAxis = "diagonal"): number {
  const base = ROUTE_RIGHT_RAIL_COLUMN_PX + ROUTE_RIGHT_RAIL_BEZEL_PX + ROUTE_RIGHT_RAIL_ENDPOINT_GAP_PX;
  return axis === "eastWest" ? base + 10 : base;
}

export function stormBarTopExtraPx(visible: boolean, expanded: boolean): number {
  if (!visible) return 0;
  if (expanded) return ROUTE_FIT_STORM_BAR_EXTRA_TOP_PX;
  if (isNarrowPhoneViewport()) return ROUTE_FIT_STORM_BAR_PHONE_COMPACT_TOP_PX;
  return ROUTE_FIT_STORM_BAR_PEEK_TOP_PX;
}

const MAP_CHROME_FIT_GAP_PX = 12;
/** Thin rim around the visible map — puck and dest sit in this strip. */
export const ROUTE_EDGE_STRIP_PX = 12;

type MapChromeInsets = { top: number; bottom: number; left: number; right: number };

function measuredMapChromeInsets(progressRailVisible: boolean): MapChromeInsets | null {
  if (typeof document === "undefined") return null;
  const vh = window.innerHeight;
  let bottom = 0;
  let top = 0;
  const right = progressRailVisible ? routeProgressRailRightClearancePx() : 0;

  const bottomStack = document.querySelector<HTMLElement>(".nav-bottom-stack");
  if (bottomStack) {
    const rect = bottomStack.getBoundingClientRect();
    if (rect.height > 4 && rect.top < vh) {
      bottom = Math.round(vh - rect.top + MAP_CHROME_FIT_GAP_PX);
    }
  }

  const topCluster = document.querySelector<HTMLElement>(".nav-top-cluster");
  if (topCluster) {
    const rect = topCluster.getBoundingClientRect();
    if (rect.height > 4 && rect.bottom > 0) {
      top = Math.round(rect.bottom + MAP_CHROME_FIT_GAP_PX);
    }
  }

  if (bottom <= 0 && top <= 0) return null;
  return {
    top: Math.min(Math.max(0, top), Math.round(vh * 0.35)),
    bottom: Math.min(Math.max(0, bottom), Math.round(vh * 0.45)),
    left: MAIN_MAP_ROUTE_PADDING.left,
    right: Math.max(right, progressRailVisible ? routeProgressRailRightClearancePx() : 18),
  };
}

function mergeMapChromeInsets(base: MapChromeInsets, measured: MapChromeInsets | null): MapChromeInsets {
  if (!measured) return base;
  return {
    top: Math.max(base.top, measured.top),
    bottom: Math.max(base.bottom, measured.bottom),
    left: Math.max(base.left, measured.left),
    right: Math.max(base.right, measured.right),
  };
}

export function isLandscapeViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(orientation: landscape)").matches;
}

export function isLandscapeHandLeft(): boolean {
  if (typeof document === "undefined") return false;
  return Boolean(document.querySelector(".app-shell--landscape-hand-left"));
}

export function routeViewAxis(routes: NavRoute[], primaryRouteId?: string | null): RouteViewAxis {
  const route =
    (primaryRouteId ? routes.find((r) => r.id === primaryRouteId) : null) ??
    routes[0] ??
    null;
  if (!route?.geometry?.length) return "diagonal";

  let minLng = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  for (const c of route.geometry) {
    const [lng, lat] = c as [number, number];
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return "diagonal";

  const midLatRad = (((minLat + maxLat) / 2) * Math.PI) / 180;
  const widthM = Math.abs(maxLng - minLng) * 111_320 * Math.max(0.25, Math.cos(midLatRad));
  const heightM = Math.abs(maxLat - minLat) * 110_540;
  if (widthM > heightM * 1.35) return "eastWest";
  if (heightM > widthM * 1.35) return "northSouth";
  return "diagonal";
}

export function routePrimarySpanMeters(routes: NavRoute[], primaryRouteId?: string | null): number {
  const route =
    (primaryRouteId ? routes.find((r) => r.id === primaryRouteId) : null) ??
    routes[0] ??
    null;
  if (!route?.geometry?.length) return 0;
  const box = polylineBbox(route.geometry);
  if (!box) return 0;
  return haversineMeters([box.west, box.south], [box.east, box.north]);
}

function routeGeomFitToken(route: NavRoute | null | undefined): string {
  const g = route?.geometry;
  if (!g?.length) return `${route?.id ?? ""}:empty`;
  const a = g[0]!;
  const b = g[g.length - 1]!;
  return `${route?.id ?? ""}:${g.length}:${a[0].toFixed(4)},${a[1].toFixed(4)}|${b[0].toFixed(4)},${b[1].toFixed(4)}`;
}

export function planningRoutesFitKey(
  routes: NavRoute[],
  primaryRouteId: string | null | undefined,
  dest: LngLat | null | undefined
): string {
  /* Dest pin is already on the polyline. Including it here refit when Mapbox
   * snapped the pin a few meters — that was the dest zoom hop. */
  void dest;
  /* Pre-Go (no primary): include every leg so A and B stay in the same overview frame. */
  if (!primaryRouteId && routes.length > 1) {
    return routes.map((r) => routeGeomFitToken(r)).join("||");
  }
  const route =
    (primaryRouteId ? routes.find((r) => r.id === primaryRouteId) : null) ?? routes[0] ?? null;
  return routeGeomFitToken(route);
}

/**
 * Quantize remaining meters so Rt re-frames as the trip shortens, not every GPS tick.
 * Near dest the buckets get tighter so zoom can walk all the way in.
 */
export function routeOverviewProgressBucket(remainingM: number): string {
  if (!Number.isFinite(remainingM) || remainingM <= 0) return "0";
  if (remainingM <= 250) return "arrive";
  if (remainingM <= 1200) return `c${Math.round(remainingM / 80)}`;
  if (remainingM <= 8000) return `n${Math.round(remainingM / 350)}`;
  if (remainingM <= 40_000) return `m${Math.round(remainingM / 1400)}`;
  return `f${Math.round(remainingM / 5000)}`;
}

export function padChromeWithEdgeStrip(chrome: {
  top: number;
  bottom: number;
  left: number;
  right: number;
}): { top: number; bottom: number; left: number; right: number } {
  return {
    top: chrome.top + ROUTE_EDGE_STRIP_PX,
    bottom: chrome.bottom + ROUTE_EDGE_STRIP_PX,
    left: chrome.left + ROUTE_EDGE_STRIP_PX,
    right: chrome.right + ROUTE_EDGE_STRIP_PX,
  };
}

export function offRouteAlternatesFitKey(routes: NavRoute[], primaryRouteId: string): string {
  return routes
    .filter((r) => r.id !== primaryRouteId)
    .map((r) => {
      const g = r.geometry;
      if (!g?.length) return `${r.id}:0`;
      const a = g[0]!;
      const b = g[g.length - 1]!;
      return `${r.id}:${g.length}:${a[0].toFixed(3)},${a[1].toFixed(3)}|${b[0].toFixed(3)},${b[1].toFixed(3)}`;
    })
    .join(";");
}

export function mapStyleReadyForCamera(map: mapboxgl.Map): boolean {
  if (!isMapUsable(map)) return false;
  try {
    return map.isStyleLoaded();
  } catch {
    return false;
  }
}

export function minPlanningRouteZoomFloor(routeLengthM: number): number {
  if (isUltraLongTripRoute(routeLengthM)) return 2.8;
  if (routeLengthM >= 100_000) return 5.5;
  if (routeLengthM >= 50_000) return 6.5;
  if (routeLengthM >= 25_000) return 7.5;
  if (routeLengthM >= 10_000) return 9.5;
  return 11.5;
}

/** Rt overview while navigating — if zoom is above this, the map is still on Dr/Mp street framing. */
export function maxRouteOverviewZoomDuringNav(routeLengthM: number): number {
  if (isExtremeTripRoute(routeLengthM)) return 5.5;
  if (isUltraLongTripRoute(routeLengthM)) return 6.5;
  if (isLongTripRoute(routeLengthM)) return 8.5;
  return 12.5;
}

export function routeFitPadding(
  stormBarVisible: boolean,
  stormBarExpanded: boolean,
  routes: NavRoute[],
  primaryRouteId?: string | null,
  progressRailVisible = true
): { top: number; bottom: number; left: number; right: number } {
  void routes;
  void primaryRouteId;
  const stormTop = stormBarTopExtraPx(stormBarVisible, stormBarExpanded);
  const rail = progressRailVisible ? routeProgressRailRightClearancePx() : 10;
  const fallback: MapChromeInsets = {
    top: Math.max(56, 48 + Math.min(stormTop, 28)),
    bottom: isNarrowPhoneViewport() ? 92 : 88,
    left: 10,
    right: rail,
  };
  const chrome = mergeMapChromeInsets(fallback, measuredMapChromeInsets(progressRailVisible));
  return padChromeWithEdgeStrip(chrome);
}

/** Upper zoom for route fitBounds — short trips need street-level; long trips stay capped by span heuristic. */
export const ROUTE_VIEW_ROUTE_FIT_MAX_ZOOM = 18.85;

export function routeFitMaxZoomCeiling(routes: NavRoute[], primaryRouteId?: string | null): number {
  if (!isLandscapeViewport()) return ROUTE_VIEW_ROUTE_FIT_MAX_ZOOM;
  const axis = routeViewAxis(routes, primaryRouteId);
  if (axis === "eastWest") return ROUTE_VIEW_ROUTE_FIT_MAX_ZOOM + 0.35;
  return ROUTE_VIEW_ROUTE_FIT_MAX_ZOOM + 1.15;
}

export function routeFitZoomBias(routes: NavRoute[], primaryRouteId?: string | null): number {
  const span = routePrimarySpanMeters(routes, primaryRouteId);
  if (isLandscapeViewport()) {
    const axis = routeViewAxis(routes, primaryRouteId);
    if (axis === "eastWest") return 0.35;
    return 1.55;
  }
  if (span > 0 && span < 1200) return 2.1;
  if (span < 2800) return 1.65;
  if (span < 9000) return 1;
  if (span < 28000) return 0.4;
  return 0;
}

export function hazardOverviewFitPadding(): { top: number; bottom: number; left: number; right: number } {
  if (isNarrowPhoneViewport()) {
    return { top: 220, bottom: 200, left: 16, right: 84 };
  }
  return { top: 120, bottom: 220, left: 20, right: 24 };
}
