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
import { safeCameraForBounds, safeEaseTo, safeExtendBounds, safeFitBounds, readMapLngLat } from "./mapCameraSafe";
import { FOCUSED_ROUTE_LINE_WIDTH, routePickSlotHex } from "./mapRouteStyle";

const ROUTE_COND_LEGACY_LAYER = "route-condition-markers-circles";
const ROUTE_COND_LEGACY_SRC = "route-condition-markers";

const ROUTE_COND_HIGHLIGHT_SRC = "route-condition-highlights-src";
/** Wide halo under route legs — hazard/storm colors frame the line instead of covering it */
const ROUTE_COND_HIGHLIGHT_CASING = "route-condition-highlights-casing";

export type RouteConditionHighlightOpts = {
  alerts: RouteAlert[] | undefined;
  routeGeometry: LngLat[] | undefined;
  stormGeoJson: GeoJSON.FeatureCollection | null | undefined;
};

/** Zoom-dependent halo width so the blue route core (~4–8px) stays readable at all scales */
const ROUTE_COND_CASING_WIDTH: mapboxgl.ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  9,
  14,
  12,
  18,
  16,
  22,
];

/**
 * Hazard / weather / NWS overlap segments as a colored outline under the route line (not a solid overlay).
 * Call {@link bringMapboxTrafficLayersToFront}, {@link bringRouteVisualLinesAboveTraffic},
 * then {@link bringRouteHitLayersToTop} (DriveMap batches these in one helper).
 */
export function applyRouteConditionHighlights(
  map: mapboxgl.Map,
  { alerts, routeGeometry, stormGeoJson }: RouteConditionHighlightOpts
) {
  /* Former solid overlay on top of the route — remove if present (e.g. HMR). */
  const legacyOverlay = "route-condition-highlights-line";
  if (map.getLayer(legacyOverlay)) map.removeLayer(legacyOverlay);

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
    if (map.getLayer(ROUTE_COND_HIGHLIGHT_CASING)) map.removeLayer(ROUTE_COND_HIGHLIGHT_CASING);
    if (map.getSource(ROUTE_COND_HIGHLIGHT_SRC)) map.removeSource(ROUTE_COND_HIGHLIGHT_SRC);
    return;
  }

  if (!map.getSource(ROUTE_COND_HIGHLIGHT_SRC)) {
    map.addSource(ROUTE_COND_HIGHLIGHT_SRC, { type: "geojson", data });
    map.addLayer({
      id: ROUTE_COND_HIGHLIGHT_CASING,
      type: "line",
      source: ROUTE_COND_HIGHLIGHT_SRC,
      paint: {
        "line-color": ["get", "lineHex"] as never,
        "line-width": ROUTE_COND_CASING_WIDTH,
        "line-opacity": 0.92,
      },
      layout: { "line-cap": "round", "line-join": "round" },
    });
  } else {
    (map.getSource(ROUTE_COND_HIGHLIGHT_SRC) as mapboxgl.GeoJSONSource).setData(data);
    if (!map.getLayer(ROUTE_COND_HIGHLIGHT_CASING)) {
      map.addLayer({
        id: ROUTE_COND_HIGHLIGHT_CASING,
        type: "line",
        source: ROUTE_COND_HIGHLIGHT_SRC,
        paint: {
          "line-color": ["get", "lineHex"] as never,
          "line-width": ROUTE_COND_CASING_WIDTH,
          "line-opacity": 0.92,
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });
    }
  }
}

/** Place hazard halo directly under the lowest route leg line (above traffic). */
export function positionRouteConditionCasingBelowRouteLines(
  map: mapboxgl.Map,
  routeIds: string[],
  layerPrefix = "route"
) {
  if (!map.getLayer(ROUTE_COND_HIGHLIGHT_CASING)) return;
  const layers = map.getStyle()?.layers;
  if (!layers?.length) return;
  for (const layer of layers) {
    const lid = layer.id;
    if (routeIds.some((rid) => lid === `${layerPrefix}-${rid}-line`)) {
      try {
        map.moveLayer(ROUTE_COND_HIGHLIGHT_CASING, lid);
      } catch {
        /* style race */
      }
      return;
    }
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
  /** Top-down A/B/C picker: bold selected slot color, dim the other legs */
  routeComparePicker?: boolean;
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
  viewMode: MapViewMode,
  isOverviewPip = false
): string[] {
  /* Drive (Dr) view: always the active leg only — Rt / Mp show A/B/C for picking. */
  const hideAltsOnMainDrive = viewMode === "drive" && !isOverviewPip;
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
  positionRouteConditionCasingBelowRouteLines(map, routeIds, layerPrefix);
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
  const routeComparePicker = Boolean(opts?.routeComparePicker && viewMode === "topdown");

  const hideAltsOnMainDrive = viewMode === "drive" && !isOverviewPip;
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

    if (routeComparePicker) {
      /* Compare sheet: A/B/C slot colors; selected leg pops, others fade */
      lineColor = slotHex;
      lineWidth = isFocus ? 10 : 4;
      lineOpacity = isFocus ? 0.95 : 0.22;
    } else if (!navigationStarted) {
      /* Planning: selected leg uses A/B/C slot color; others same slot hue, dimmed */
      lineColor = slotHex;
      lineWidth = isFocus ? 7 : isSuggested ? 5 : 4;
      lineOpacity = isFocus ? 0.82 : isSuggested ? 0.55 : 0.38;
    } else {
      /* Navigating: the active guidance leg is always “primary” blue; alts keep A/B/C hue if visible. */
      lineColor = isFocus ? routePickSlotHex(0) : slotHex;
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
  const sw = readMapLngLat(b.getSouthWest());
  const ne = readMapLngLat(b.getNorthEast());
  if (!sw || !ne) return 0;
  return haversineMeters(sw, ne);
}

/**
 * Shorter span → higher maxZoom (more road detail). Long span → stay zoomed out so both ends stay in frame.
 */
function maxZoomForBoundsSpanMeters(spanM: number): number {
  if (!Number.isFinite(spanM) || spanM < 400) return 18;
  if (spanM < 2500) return 17.2;
  if (spanM < 10000) return 16.1;
  if (spanM < 35000) return 14.9;
  if (spanM < 90000) return 13.8;
  if (spanM < 200000) return 12.7;
  return 11.8;
}

/** Per-point extend is O(n) — long country routes block the main thread. Use a bbox for huge lines. */
const BOUNDS_EXTEND_VERTEX_BUDGET = 320;

function extendBoundsWithPolyline(b: mapboxgl.LngLatBounds, geometry: LngLat[] | null | undefined): void {
  if (!geometry?.length) return;
  if (geometry.length > BOUNDS_EXTEND_VERTEX_BUDGET) {
    const box = polylineBbox(geometry);
    if (box) {
      safeExtendBounds(b, [box.west, box.south]);
      safeExtendBounds(b, [box.east, box.north]);
    }
    return;
  }
  for (const c of geometry) safeExtendBounds(b, c);
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

export type TripFitBoundsMode = {
  bounds: mapboxgl.LngLatBounds;
  /** Straight-line user → destination (m). */
  directM: number;
  /** Fit from endpoints only — winding polyline bbox is not used. */
  endpointsOnly: boolean;
};

function directTripMeters(user: LngLat | null, dest: LngLat | null): number {
  if (!user || !dest) return Number.POSITIVE_INFINITY;
  return haversineMeters(user, dest);
}

function primaryRouteGeometry(routes: NavRoute[], onlyRouteId?: string | null): LngLat[] | null {
  const route =
    (onlyRouteId ? routes.find((r) => r.id === onlyRouteId) : null) ?? routes[0] ?? null;
  return route?.geometry?.length ? route.geometry : null;
}

/** Short / winding trips: anchor on user + destination so fitBounds pushes them to the padded edges. */
export function preferEndpointAnchoredTripFit(
  user: LngLat | null,
  dest: LngLat | null,
  geometry: LngLat[] | null | undefined
): boolean {
  const direct = directTripMeters(user, dest);
  if (!Number.isFinite(direct)) return false;
  if (direct < 32_000) {
    if (!geometry?.length || geometry.length < 2) return true;
    const box = polylineBbox(geometry);
    if (!box) return true;
    const routeSpan = haversineMeters([box.west, box.south], [box.east, box.north]);
    return routeSpan > direct * 1.22 || direct < 24_000;
  }
  return false;
}

function extendEndpointPairBounds(b: mapboxgl.LngLatBounds, user: LngLat, dest: LngLat): void {
  safeExtendBounds(b, user);
  safeExtendBounds(b, dest);
  const direct = haversineMeters(user, dest);
  if (direct < 120) {
    const bump = 0.00035;
    safeExtendBounds(b, [user[0] + bump, user[1] + bump * 0.35]);
    safeExtendBounds(b, [dest[0] - bump, dest[1] - bump * 0.35]);
  }
}

export function buildTripFitBounds(
  user: LngLat | null,
  dest: LngLat | null,
  routes: NavRoute[],
  onlyRouteId?: string | null
): TripFitBoundsMode | null {
  const geometry = primaryRouteGeometry(routes, onlyRouteId);
  const directM = directTripMeters(user, dest);
  const endpointsOnly = preferEndpointAnchoredTripFit(user, dest, geometry);
  const b = new mapboxgl.LngLatBounds();

  if (endpointsOnly && user && dest) {
    extendEndpointPairBounds(b, user, dest);
  } else {
    if (user) safeExtendBounds(b, user);
    if (dest) safeExtendBounds(b, dest);
    if (onlyRouteId) {
      const one = routes.find((r) => r.id === onlyRouteId);
      if (one?.geometry?.length) extendBoundsWithPolyline(b, one.geometry);
      else for (const r of routes) extendBoundsWithPolyline(b, r.geometry);
    } else {
      for (const r of routes) extendBoundsWithPolyline(b, r.geometry);
    }
  }

  if (b.isEmpty()) return null;
  return { bounds: b, directM, endpointsOnly };
}

function computeTripFitMaxZoom(
  spanM: number,
  directM: number,
  endpointsOnly: boolean,
  maxZoomCeiling: number,
  zoomBias: number
): number {
  const bias = Math.max(0, zoomBias);
  if (endpointsOnly && Number.isFinite(directM)) {
    if (directM < 900) return Math.min(18.85, maxZoomCeiling + 1.35 + bias);
    if (directM < 2500) return Math.min(18.85, maxZoomCeiling + 1.1 + bias);
    if (directM < 8000) return Math.min(18.85, maxZoomCeiling + 0.65 + bias);
    if (directM < 20_000) return Math.min(18.85, maxZoomCeiling + 0.25 + bias);
  }
  return Math.min(maxZoomCeiling, maxZoomForBoundsSpanMeters(spanM) + bias);
}

function applyTripCameraFit(
  map: mapboxgl.Map,
  fit: TripFitBoundsMode,
  padding: mapboxgl.PaddingOptions,
  maxZoomCeiling: number,
  zoomBias: number,
  durationMs: number
): boolean {
  const spanM = boundsDiagonalMeters(fit.bounds);
  const maxZoom = computeTripFitMaxZoom(
    spanM,
    fit.directM,
    fit.endpointsOnly,
    maxZoomCeiling,
    zoomBias
  );
  const cam = safeCameraForBounds(map, fit.bounds, {
    padding,
    maxZoom,
    bearing: 0,
    pitch: 0,
  });
  if (!cam?.center || cam.zoom == null || !Number.isFinite(cam.zoom)) {
    return safeFitBounds(map, fit.bounds, {
      padding,
      maxZoom,
      duration: durationMs,
      bearing: 0,
      pitch: 0,
      essential: true,
    });
  }
  return safeEaseTo(map, {
    center: cam.center,
    zoom: cam.zoom,
    bearing: 0,
    pitch: 0,
    duration: durationMs,
    essential: true,
  });
}

export function fitMapToTrip(
  map: mapboxgl.Map,
  routes: NavRoute[],
  user: [number, number] | null,
  dest: [number, number] | null,
  padding: mapboxgl.PaddingOptions,
  maxZoomCeiling = 18,
  opts?: FitMapToTripOptions
) {
  const fit = buildTripFitBounds(user, dest, routes, opts?.onlyRouteId);
  if (!fit) {
    opts?.onAfterFit?.();
    return;
  }

  const finish = () => opts?.onAfterFit?.();
  map.once("moveend", finish);
  const ok = applyTripCameraFit(map, fit, padding, maxZoomCeiling, opts?.zoomBias ?? 0, 360);
  if (!ok) {
    map.off("moveend", finish);
    opts?.onAfterFit?.();
  }
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
  const primary = primaryRouteId ? routes.find((r) => r.id === primaryRouteId) : null;
  const geometry = primary?.geometry ?? null;
  const ahead = geometry?.length ? sliceRouteAhead(geometry, userLngLat) : null;
  const directM = directTripMeters(userLngLat, dest);
  const endpointsOnly = preferEndpointAnchoredTripFit(userLngLat, dest, ahead ?? geometry);

  let fit: TripFitBoundsMode | null = null;
  if (endpointsOnly && dest) {
    const b = new mapboxgl.LngLatBounds();
    extendEndpointPairBounds(b, userLngLat, dest);
    fit = { bounds: b, directM, endpointsOnly: true };
  } else {
    const b = new mapboxgl.LngLatBounds();
    safeExtendBounds(b, userLngLat);
    if (dest) safeExtendBounds(b, dest);
    if (ahead?.length) {
      extendBoundsWithPolyline(b, ahead);
      if (geometry?.length) {
        const end = geometry[geometry.length - 1]!;
        safeExtendBounds(b, end);
      }
    } else if (primary?.geometry?.length) {
      extendBoundsWithPolyline(b, primary.geometry);
    } else {
      for (const r of routes) {
        const ahead = sliceRouteAhead(r.geometry, userLngLat);
        extendBoundsWithPolyline(b, ahead);
      }
    }
    if (!b.isEmpty()) {
      fit = { bounds: b, directM, endpointsOnly: false };
    }
  }

  if (!fit) return;
  applyTripCameraFit(map, fit, padding, maxZoomCeiling, zoomBias, 400);
}
