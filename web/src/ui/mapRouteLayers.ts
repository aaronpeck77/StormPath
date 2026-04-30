import mapboxgl from "mapbox-gl";
import {
  corridorHighlightHex,
  ROUTE_CORRIDOR_HIGHLIGHT_HALF_SPAN_M,
  type RouteAlert,
} from "../nav/routeAlerts";
import { haversineMeters, slicePolylineBetweenAlong } from "../nav/routeGeometry";
import { sliceRouteAhead } from "../nav/routeRemaining";
import type { LngLat, NavRoute } from "../nav/types";
import { polylineBbox, stormOverlapLineFeatures } from "../weatherAlerts/geometryOverlap";
import { FOCUSED_ROUTE_LINE_WIDTH, routePickSlotHex } from "./mapRouteStyle";

const ROUTE_COND_LEGACY_LAYER = "route-condition-markers-circles";
const ROUTE_COND_LEGACY_SRC = "route-condition-markers";

const ROUTE_COND_HIGHLIGHT_SRC = "route-condition-highlights-src";
const ROUTE_COND_HIGHLIGHT_LINE = "route-condition-highlights-line";

export type RouteConditionHighlightOpts = {
  alerts: RouteAlert[] | undefined;
  routeGeometry: LngLat[] | undefined;
  stormGeoJson: GeoJSON.FeatureCollection | null | undefined;
};

/**
 * Colored segments on the active route (weather vs hazard vs notice) plus NWS polygon intersections.
 * Not circle markers — avoids confusion with destination / saved-place dots.
 * Call {@link bringMapboxTrafficLayersToFront}, {@link bringRouteVisualLinesAboveTraffic},
 * then {@link bringRouteHitLayersToTop} (DriveMap batches these in one helper).
 */
export function applyRouteConditionHighlights(
  map: mapboxgl.Map,
  { alerts, routeGeometry, stormGeoJson }: RouteConditionHighlightOpts
) {
  if (map.getLayer(ROUTE_COND_LEGACY_LAYER)) map.removeLayer(ROUTE_COND_LEGACY_LAYER);
  if (map.getSource(ROUTE_COND_LEGACY_SRC)) map.removeSource(ROUTE_COND_LEGACY_SRC);

  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];

  if (routeGeometry?.length && alerts?.length) {
    const half = ROUTE_CORRIDOR_HIGHLIGHT_HALF_SPAN_M;
    for (const a of alerts) {
      const coords = slicePolylineBetweenAlong(
        routeGeometry,
        a.alongMeters - half,
        a.alongMeters + half
      );
      if (coords.length < 2) continue;
      features.push({
        type: "Feature",
        properties: { lineHex: corridorHighlightHex(a.corridorKind, a.severity) },
        geometry: { type: "LineString", coordinates: coords },
      });
    }
  }

  if (routeGeometry?.length) {
    features.push(...stormOverlapLineFeatures(routeGeometry, stormGeoJson ?? null));
  }

  const data: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };

  if (features.length === 0) {
    if (map.getLayer(ROUTE_COND_HIGHLIGHT_LINE)) map.removeLayer(ROUTE_COND_HIGHLIGHT_LINE);
    if (map.getSource(ROUTE_COND_HIGHLIGHT_SRC)) map.removeSource(ROUTE_COND_HIGHLIGHT_SRC);
    return;
  }

  if (!map.getSource(ROUTE_COND_HIGHLIGHT_SRC)) {
    map.addSource(ROUTE_COND_HIGHLIGHT_SRC, { type: "geojson", data });
    map.addLayer({
      id: ROUTE_COND_HIGHLIGHT_LINE,
      type: "line",
      source: ROUTE_COND_HIGHLIGHT_SRC,
      paint: {
        "line-color": ["get", "lineHex"] as never,
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, 5, 12, 8, 16, 12],
        "line-opacity": 0.9,
      },
      layout: { "line-cap": "round", "line-join": "round" },
    });
  } else {
    (map.getSource(ROUTE_COND_HIGHLIGHT_SRC) as mapboxgl.GeoJSONSource).setData(data);
  }
}

export type MapViewMode = "route" | "drive" | "topdown";

export type ApplyRoutesLayerOptions = {
  /** Slot order [A,B,C] — same ids as the route cycle control */
  orderedRouteIds: string[];
  navigationStarted: boolean;
  viewMode: MapViewMode;
  /** Corner PiP: always draw every leg; style like route overview */
  isOverviewPip?: boolean;
};

export function removeStaleRoutes(
  map: mapboxgl.Map,
  keepIds: Set<string>,
  prevIds: Set<string>,
  layerPrefix = "route"
) {
  for (const id of prevIds) {
    if (keepIds.has(id)) continue;
    const sid = `${layerPrefix}-${id}`;
    const lid = `${sid}-line`;
    const hitLid = `${sid}-line-hit`;
    if (map.getLayer(hitLid)) map.removeLayer(hitLid);
    if (map.getLayer(lid)) map.removeLayer(lid);
    if (map.getSource(sid)) map.removeSource(sid);
  }
}

/**
 * Remove every A/B/C trip route line + hit layer (route-{id}-line), not condition highlights or recording.
 * Used when clearing the trip so we never leave ghost polylines if routeIdsRef was out of sync.
 */
export function removeAllTripRouteLegLayers(map: mapboxgl.Map, layerPrefix = "route"): void {
  const style = map.getStyle();
  if (!style?.layers) return;
  const sourcesToRemove = new Set<string>();
  const layerIds: string[] = [];
  for (const layer of style.layers) {
    const id = layer.id;
    if (!id.startsWith(`${layerPrefix}-`)) continue;
    if (id.includes("route-condition") || id.startsWith("route-recording")) continue;
    if (!id.endsWith("-line") && !id.endsWith("-line-hit")) continue;
    layerIds.push(id);
    if (typeof layer.source === "string") sourcesToRemove.add(layer.source);
  }
  for (const lid of layerIds) {
    try {
      if (map.getLayer(lid)) map.removeLayer(lid);
    } catch {
      /* style race */
    }
  }
  for (const sid of sourcesToRemove) {
    try {
      if (map.getSource(sid)) map.removeSource(sid);
    } catch {
      /* style race */
    }
  }
}

/** Layer id shape: `route-${routeId}-line-hit` (see {@link applyRoutesToMap}). */
export function routeIdFromRouteHitLayerId(layerId: string): string | null {
  const prefix = "route-";
  const suffix = "-line-hit";
  if (!layerId.startsWith(prefix) || !layerId.endsWith(suffix)) return null;
  return layerId.slice(prefix.length, -suffix.length);
}

/** Route legs that currently have map layers (matches {@link applyRoutesToMap} visibility). */
export function visibleRouteIdsForHitLayers(
  routes: NavRoute[],
  lineFocusId: string,
  navigationStarted: boolean,
  viewMode: MapViewMode,
  isOverviewPip = false
): string[] {
  const hideAltsOnMainDrive = navigationStarted && viewMode === "drive" && !isOverviewPip;
  if (hideAltsOnMainDrive) {
    return routes.filter((r) => r.id === lineFocusId).map((r) => r.id);
  }
  return routes.map((r) => r.id);
}

/**
 * Draw route polylines above Mapbox traffic overlays so A/B/C lines stay readable.
 * {@link bringMapboxTrafficLayersToFront} moves traffic to the top of the stack; call this after it,
 * then {@link bringRouteHitLayersToTop}. Optional corridor highlight follows the same route geometry.
 */
export function bringRouteVisualLinesAboveTraffic(
  map: mapboxgl.Map,
  routeIds: string[],
  layerPrefix = "route"
) {
  for (const id of routeIds) {
    const lid = `${layerPrefix}-${id}-line`;
    if (map.getLayer(lid)) {
      try {
        map.moveLayer(lid);
      } catch {
        /* style teardown */
      }
    }
  }
  if (map.getLayer(ROUTE_COND_HIGHLIGHT_LINE)) {
    try {
      map.moveLayer(ROUTE_COND_HIGHLIGHT_LINE);
    } catch {
      /* style teardown */
    }
  }
}

/** Keep invisible hit targets above traffic / radar so route taps still resolve. */
export function bringRouteHitLayersToTop(map: mapboxgl.Map, routeIds: string[], layerPrefix = "route") {
  for (const id of routeIds) {
    const lid = `${layerPrefix}-${id}-line-hit`;
    if (map.getLayer(lid)) {
      try {
        map.moveLayer(lid);
      } catch {
        /* style teardown */
      }
    }
  }
}

/** A/B/C slot index for a route id — same as progress strip & {@link routePickSlotHex} input. */
export function routeSlotIndexFor(routeId: string, orderedRouteIds: string[]): number {
  const i = orderedRouteIds.indexOf(routeId);
  return i >= 0 ? i : 0;
}

export function applyRoutesToMap(
  map: mapboxgl.Map,
  routes: NavRoute[],
  lineFocusId: string,
  suggestedRouteId: string | null,
  prevIds: Set<string>,
  layerPrefix = "route",
  opts?: ApplyRoutesLayerOptions
): Set<string> {
  const orderedRouteIds = opts?.orderedRouteIds?.length
    ? opts.orderedRouteIds
    : routes.map((r) => r.id);
  const navigationStarted = opts?.navigationStarted ?? false;
  const viewMode = opts?.viewMode ?? "route";
  const isOverviewPip = opts?.isOverviewPip ?? false;

  const hideAltsOnMainDrive = navigationStarted && viewMode === "drive" && !isOverviewPip;
  const routesToDraw = hideAltsOnMainDrive
    ? routes.filter((r) => r.id === lineFocusId)
    : routes;

  if (routes.length === 0) {
    removeStaleRoutes(map, new Set(), prevIds, layerPrefix);
    removeAllTripRouteLegLayers(map, layerPrefix);
    return new Set();
  }

  const keepIds = new Set(routesToDraw.map((r) => r.id));
  removeStaleRoutes(map, keepIds, prevIds, layerPrefix);

  const rank = (id: string) =>
    id === lineFocusId ? 2 : suggestedRouteId != null && id === suggestedRouteId ? 1 : 0;
  const ordered = [...routesToDraw].sort((a, b) => rank(a.id) - rank(b.id));

  for (const route of ordered) {
    const id = `${layerPrefix}-${route.id}`;
    const isFocus = route.id === lineFocusId;
    const isSuggested = suggestedRouteId != null && route.id === suggestedRouteId && !isFocus;
    const slot = routeSlotIndexFor(route.id, orderedRouteIds);
    const slotHex = routePickSlotHex(slot);

    let lineColor: string;
    let lineWidth: number;
    let lineOpacity: number;

    if (!navigationStarted) {
      /* Planning: selected leg uses A/B/C slot color; others same slot hue, dimmed */
      lineColor = slotHex;
      lineWidth = isFocus ? 7 : isSuggested ? 5 : 4;
      lineOpacity = isFocus ? 0.82 : isSuggested ? 0.55 : 0.38;
    } else {
      /* Navigating: same A=blue / B=green / C=orange as planning (focus is always slot 0). */
      lineColor = slotHex;
      lineWidth = isFocus ? FOCUSED_ROUTE_LINE_WIDTH : isSuggested ? 5 : 4;
      lineOpacity = isFocus ? 0.78 : 0.44;
    }

    const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: route.geometry },
    };

    const lineId = `${id}-line`;
    const hitLineId = `${id}-line-hit`;
    if (!map.getSource(id)) {
      map.addSource(id, { type: "geojson", data: geojson });
      map.addLayer({
        id: lineId,
        type: "line",
        source: id,
        paint: {
          "line-color": lineColor,
          "line-width": lineWidth,
          "line-opacity": lineOpacity,
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: hitLineId,
        type: "line",
        source: id,
        paint: {
          "line-color": "#000000",
          "line-width": 22,
          "line-opacity": 0,
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });
    } else {
      (map.getSource(id) as mapboxgl.GeoJSONSource).setData(geojson);
      map.setPaintProperty(lineId, "line-color", lineColor);
      map.setPaintProperty(lineId, "line-width", lineWidth);
      map.setPaintProperty(lineId, "line-opacity", lineOpacity);
      if (!map.getLayer(hitLineId)) {
        map.addLayer({
          id: hitLineId,
          type: "line",
          source: id,
          paint: {
            "line-color": "#000000",
            "line-width": 22,
            "line-opacity": 0,
          },
          layout: { "line-cap": "round", "line-join": "round" },
        });
      }
    }
  }

  return keepIds;
}

/** Diagonal of bounds (m) — drives how close fitBounds can zoom before hitting maxZoom. */
function boundsDiagonalMeters(b: mapboxgl.LngLatBounds): number {
  const sw = b.getSouthWest();
  const ne = b.getNorthEast();
  return haversineMeters([sw.lng, sw.lat], [ne.lng, ne.lat]);
}

/**
 * Shorter span → higher maxZoom (more road detail). Long span → stay zoomed out so both ends stay in frame.
 */
function maxZoomForBoundsSpanMeters(spanM: number): number {
  if (!Number.isFinite(spanM) || spanM < 400) return 17.6;
  if (spanM < 2500) return 16.9;
  if (spanM < 10000) return 15.7;
  if (spanM < 35000) return 14.6;
  if (spanM < 90000) return 13.5;
  if (spanM < 200000) return 12.5;
  return 11.6;
}

/** Per-point extend is O(n) — long country routes block the main thread. Use a bbox for huge lines. */
const BOUNDS_EXTEND_VERTEX_BUDGET = 320;

function extendBoundsWithPolyline(b: mapboxgl.LngLatBounds, geometry: LngLat[] | null | undefined): void {
  if (!geometry?.length) return;
  if (geometry.length > BOUNDS_EXTEND_VERTEX_BUDGET) {
    const box = polylineBbox(geometry);
    if (box) {
      b.extend([box.west, box.south]);
      b.extend([box.east, box.north]);
    }
    return;
  }
  for (const c of geometry) b.extend(c);
}

export type FitMapToTripOptions = {
  /** After fitBounds finishes (no extra pan — keeps start/end on the padded edges). */
  onAfterFit?: () => void;
  /**
   * If set, extend bounds only from this leg (+ user/dest). Avoids unioning A/B/C when alternatives
   * diverge (which was shoving the active line off-screen). Omit to include every route (e.g. pip).
   */
  onlyRouteId?: string;
  /** Positive bias = allow tighter zoom than span heuristic when safe. */
  zoomBias?: number;
};

export function fitMapToTrip(
  map: mapboxgl.Map,
  routes: NavRoute[],
  user: [number, number] | null,
  dest: [number, number] | null,
  padding: mapboxgl.PaddingOptions,
  maxZoomCeiling = 18,
  opts?: FitMapToTripOptions
) {
  const b = new mapboxgl.LngLatBounds();
  if (user) b.extend(user);
  if (dest) b.extend(dest);

  const onlyId = opts?.onlyRouteId;
  if (onlyId) {
    const one = routes.find((r) => r.id === onlyId);
    if (one?.geometry?.length) {
      extendBoundsWithPolyline(b, one.geometry);
    } else {
      for (const r of routes) {
        extendBoundsWithPolyline(b, r.geometry);
      }
    }
  } else {
    for (const r of routes) {
      extendBoundsWithPolyline(b, r.geometry);
    }
  }

  if (b.isEmpty()) {
    opts?.onAfterFit?.();
    return;
  }

  const spanM = boundsDiagonalMeters(b);
  const maxZoom = Math.min(maxZoomCeiling, maxZoomForBoundsSpanMeters(spanM) + Math.max(0, opts?.zoomBias ?? 0));

  const finish = () => opts?.onAfterFit?.();
  map.once("moveend", finish);
  map.fitBounds(b, { padding, maxZoom, duration: 360, essential: true });
}

export function fitMapToRemainingRoutes(
  map: mapboxgl.Map,
  routes: NavRoute[],
  userLngLat: [number, number],
  dest: [number, number] | null,
  padding: mapboxgl.PaddingOptions,
  maxZoomCeiling = 18,
  /** Active leg only — tighter bounds + zoom as remaining path shortens. */
  primaryRouteId?: string | null,
  /** Positive bias = allow tighter zoom than span heuristic when safe. */
  zoomBias = 0
) {
  const b = new mapboxgl.LngLatBounds();
  b.extend(userLngLat);
  if (dest) b.extend(dest);

  const primary = primaryRouteId ? routes.find((r) => r.id === primaryRouteId) : null;
  if (primary?.geometry?.length) {
    const ahead = sliceRouteAhead(primary.geometry, userLngLat);
    extendBoundsWithPolyline(b, ahead);
  } else {
    for (const r of routes) {
      const ahead = sliceRouteAhead(r.geometry, userLngLat);
      extendBoundsWithPolyline(b, ahead);
    }
  }

  if (b.isEmpty()) return;

  const spanM = boundsDiagonalMeters(b);
  const maxZoom = Math.min(maxZoomCeiling, maxZoomForBoundsSpanMeters(spanM) + Math.max(0, zoomBias));

  map.fitBounds(b, { padding, maxZoom, duration: 400, essential: true });
}
