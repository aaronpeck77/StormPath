import mapboxgl from "mapbox-gl";
import {
  corridorHighlightHex,
  ROUTE_CORRIDOR_HIGHLIGHT_HALF_SPAN_M,
  type RouteAlert,
} from "../nav/routeAlerts";
import {
  closestAlongRouteMeters,
  geometryForPlanningMapDisplay,
  geometryForRouteOverviewDisplay,
  haversineMeters,
  pointAtAlongMeters,
  routeHighlightFrameForMap,
  routeLineGeometryForDriveDisplay,
  slicePolylineBetweenAlongForDisplay,
} from "../nav/routeGeometry";
import { findRouteDivergenceWindow } from "../nav/routeDivergenceWindow";
import { sliceRouteAhead } from "../nav/routeRemaining";
import type { LngLat, NavRoute } from "../nav/types";
import {
  polylineBbox,
  stormOverlapLineFeatures,
  stormStripBandsToLineFeatures,
  type StormProgressStripBand,
} from "../weatherAlerts/geometryOverlap";
import { safeCameraForBounds, safeEaseTo, safeExtendBounds, safeFitBounds, readMapLngLat } from "./mapCameraSafe";
import { ROUTE_SUGGESTED_LINE_WIDTH, routeMapLineStyle } from "./mapRouteStyle";

const ROUTE_COND_LEGACY_LAYER = "route-condition-markers-circles";
const ROUTE_COND_LEGACY_SRC = "route-condition-markers";

const ROUTE_COND_HIGHLIGHT_SRC = "route-condition-highlights-src";
/** Wide halo under route legs — hazard/storm colors frame the line instead of covering it */
const ROUTE_COND_HIGHLIGHT_CASING = "route-condition-highlights-casing";

export type RouteConditionHighlightOpts = {
  alerts: RouteAlert[] | undefined;
  routeGeometry: LngLat[] | undefined;
  stormGeoJson: GeoJSON.FeatureCollection | null | undefined;
  /** Per-alert NWS spans along the route — same source as the progress strip storm bands. */
  stormAlongRouteBands?: StormProgressStripBand[];
  /** Drive mode: omit halo segments behind the puck (avoids a “stray line” back toward the start). */
  clipBehindAlongM?: number | null;
};

function clipStormBandsBehindUser(
  bands: StormProgressStripBand[] | undefined,
  clipBehindAlongM: number | null | undefined
): StormProgressStripBand[] | undefined {
  if (!bands?.length || clipBehindAlongM == null || !Number.isFinite(clipBehindAlongM)) {
    return bands;
  }
  const floorM = Math.max(0, clipBehindAlongM - 200);
  return bands
    .map((b) => ({ ...b, startM: Math.max(b.startM, floorM) }))
    .filter((b) => b.endM - b.startM >= 8);
}

/** Zoom-dependent halo under the route leg — visible but not overpowering the blue core */
const ROUTE_COND_CASING_WIDTH: mapboxgl.ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  9,
  10,
  12,
  13,
  16,
  16,
];

const ROUTE_COND_CASING_OPACITY = 0.58;

function syncRouteConditionCasingPaint(map: mapboxgl.Map): void {
  if (!map.getLayer(ROUTE_COND_HIGHLIGHT_CASING)) return;
  map.setPaintProperty(ROUTE_COND_HIGHLIGHT_CASING, "line-width", ROUTE_COND_CASING_WIDTH);
  map.setPaintProperty(ROUTE_COND_HIGHLIGHT_CASING, "line-opacity", ROUTE_COND_CASING_OPACITY);
}

let lastHighlightMap: mapboxgl.Map | null = null;
let lastHighlightKey = "";

function routeHighlightContentKey({
  alerts,
  routeGeometry,
  stormAlongRouteBands,
  clipBehindAlongM,
}: RouteConditionHighlightOpts): string {
  const clip =
    clipBehindAlongM != null && Number.isFinite(clipBehindAlongM)
      ? Math.floor(clipBehindAlongM / 400)
      : "all";
  const alertKey = alerts?.map((a) => `${a.id}:${Math.round(a.alongMeters / 200)}`).join(",") ?? "";
  const bandKey =
    stormAlongRouteBands?.map((b) => `${Math.round(b.startM / 200)}-${Math.round(b.endM / 200)}`).join("|") ??
    "";
  const geomKey = routeGeometry?.length ?? 0;
  return `${clip}|${alertKey}|${bandKey}|${geomKey}`;
}

/** Drop cached skip guard after style reload or map teardown. */
export function resetRouteConditionHighlightCache(map?: mapboxgl.Map | null): void {
  if (map == null || map === lastHighlightMap) {
    lastHighlightMap = null;
    lastHighlightKey = "";
  }
}

/** Remove corridor halo segments — call when the trip ends so pan/zoom cannot leave ghosts. */
export function clearRouteConditionHighlights(map: mapboxgl.Map): void {
  resetRouteConditionHighlightCache(map);
  applyRouteConditionHighlights(map, {
    alerts: [],
    routeGeometry: undefined,
    stormGeoJson: undefined,
    stormAlongRouteBands: [],
  });
}

/**
 * Hazard / weather / NWS overlap segments as a colored outline under the route line (not a solid overlay).
 * Returns whether GeoJSON data changed (false = skipped identical rebuild).
 * Call {@link bringMapboxTrafficLayersToFront}, {@link bringRouteVisualLinesAboveTraffic},
 * then {@link bringRouteHitLayersToTop} (DriveMap batches these in one helper).
 */
export function applyRouteConditionHighlights(
  map: mapboxgl.Map,
  opts: RouteConditionHighlightOpts
): boolean {
  const { alerts, routeGeometry, stormGeoJson, stormAlongRouteBands, clipBehindAlongM } = opts;
  const contentKey = routeHighlightContentKey(opts);
  if (
    map === lastHighlightMap &&
    contentKey === lastHighlightKey &&
    map.getSource(ROUTE_COND_HIGHLIGHT_SRC)
  ) {
    return false;
  }
  /* Former solid overlay on top of the route — remove if present (e.g. HMR). */
  const legacyOverlay = "route-condition-highlights-line";
  if (map.getLayer(legacyOverlay)) map.removeLayer(legacyOverlay);

  if (map.getLayer(ROUTE_COND_LEGACY_LAYER)) map.removeLayer(ROUTE_COND_LEGACY_LAYER);
  if (map.getSource(ROUTE_COND_LEGACY_SRC)) map.removeSource(ROUTE_COND_LEGACY_SRC);

  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  if (!routeGeometry?.length) {
    if (map.getLayer(ROUTE_COND_HIGHLIGHT_CASING)) map.removeLayer(ROUTE_COND_HIGHLIGHT_CASING);
    if (map.getSource(ROUTE_COND_HIGHLIGHT_SRC)) map.removeSource(ROUTE_COND_HIGHLIGHT_SRC);
    lastHighlightMap = map;
    lastHighlightKey = contentKey;
    return true;
  }

  const frame = routeHighlightFrameForMap(routeGeometry, clipBehindAlongM);
  const { geometry: highlightGeom, alongOffsetM, totalM: routeTotalM, fullDetail } = frame;
  const sliceOpts = fullDetail ? { fullDetail: true as const } : undefined;

  if (highlightGeom.length >= 2 && alerts?.length) {
    const half = ROUTE_CORRIDOR_HIGHLIGHT_HALF_SPAN_M;
    for (const a of alerts) {
      if (
        clipBehindAlongM != null &&
        Number.isFinite(clipBehindAlongM) &&
        a.alongMeters + half < clipBehindAlongM - 80
      ) {
        continue;
      }
      const loRoute = Math.max(a.alongMeters - half, clipBehindAlongM ?? 0);
      const hiRoute = a.alongMeters + half;
      const lo = loRoute - alongOffsetM;
      const hi = hiRoute - alongOffsetM;
      if (hi <= 0 || hi - lo < 0.5) continue;
      const coords = slicePolylineBetweenAlongForDisplay(
        highlightGeom,
        Math.max(0, lo),
        hi,
        routeTotalM,
        sliceOpts
      );
      if (coords.length < 2) continue;
      features.push({
        type: "Feature",
        properties: { lineHex: corridorHighlightHex(a.corridorKind, a.severity) },
        geometry: { type: "LineString", coordinates: coords },
      });
    }
  }

  if (highlightGeom.length >= 2) {
    if (stormAlongRouteBands?.length) {
      const bandsForMap = clipStormBandsBehindUser(stormAlongRouteBands, clipBehindAlongM);
      if (bandsForMap?.length) {
        const remapped = bandsForMap
          .map((b) => ({
            ...b,
            startM: b.startM - alongOffsetM,
            endM: b.endM - alongOffsetM,
          }))
          .filter((b) => b.endM - b.startM >= 8);
        features.push(
          ...stormStripBandsToLineFeatures(highlightGeom, remapped, routeTotalM, sliceOpts)
        );
      }
    } else {
      features.push(...stormOverlapLineFeatures(highlightGeom, stormGeoJson ?? null, sliceOpts));
    }
  }

  const data: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };

  if (features.length === 0) {
    if (map.getLayer(ROUTE_COND_HIGHLIGHT_CASING)) map.removeLayer(ROUTE_COND_HIGHLIGHT_CASING);
    if (map.getSource(ROUTE_COND_HIGHLIGHT_SRC)) map.removeSource(ROUTE_COND_HIGHLIGHT_SRC);
    lastHighlightMap = map;
    lastHighlightKey = contentKey;
    return true;
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
        "line-opacity": ROUTE_COND_CASING_OPACITY,
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
          "line-opacity": ROUTE_COND_CASING_OPACITY,
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });
    } else {
      syncRouteConditionCasingPaint(map);
    }
  }
  lastHighlightMap = map;
  lastHighlightKey = contentKey;
  return true;
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
  /** Drive mode: slice the active leg from just behind the puck with full road detail. */
  userAlongMeters?: number | null;
  /** Auto rejoin: draw locked A faint behind green/orange temp guidance. */
  rejoinOverlayActive?: boolean;
  lockedRouteId?: string | null;
};

function routeCoordinatesForMap(route: NavRoute, opts?: ApplyRoutesLayerOptions): LngLat[] {
  const geometry = route.geometry;
  if (!geometry.length) return geometry;
  const viewMode = opts?.viewMode ?? "route";
  const navigating = opts?.navigationStarted ?? false;
  const isOverviewPip = opts?.isOverviewPip ?? false;
  const along = opts?.userAlongMeters;
  /** Dr + Mp while navigating: road-faithful slice near the puck (overview line is OK on Rt). */
  const nearNavLine =
    navigating &&
    !isOverviewPip &&
    (viewMode === "drive" || viewMode === "topdown") &&
    along != null &&
    Number.isFinite(along);
  if (nearNavLine) {
    return routeLineGeometryForDriveDisplay(geometry, along);
  }
  if (viewMode === "route" || isOverviewPip) {
    return geometryForRouteOverviewDisplay(geometry);
  }
  return geometryForPlanningMapDisplay(geometry);
}

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
    return routes
      .filter((r) => r.id === lineFocusId || r.id === "r-your-route")
      .map((r) => r.id);
  }
  return routes.map((r) => r.id);
}

function isStormPathOverlayLayerId(id: string): boolean {
  return (
    id.startsWith("route-") ||
    id.includes("rainviewer") ||
    id.startsWith("weather-alerts") ||
    id === "3d-buildings" ||
    id.startsWith("mapbox-traffic")
  );
}

/** Labels/icons — route lines sit just below so they paint over Mapbox road geometry. */
function firstBasemapSymbolBeforeId(map: mapboxgl.Map): string | undefined {
  for (const l of map.getStyle()?.layers ?? []) {
    if (l.type === "symbol" && !isStormPathOverlayLayerId(l.id)) return l.id;
  }
  return undefined;
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
  const anchorBefore = firstBasemapSymbolBeforeId(map);
  for (const id of routeIds) {
    const lid = `${layerPrefix}-${id}-line`;
    if (!map.getLayer(lid)) continue;
    try {
      if (anchorBefore) map.moveLayer(lid, anchorBefore);
      map.moveLayer(lid);
    } catch {
      /* style teardown */
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
  const navigationStarted = opts?.navigationStarted ?? false;
  const viewMode = opts?.viewMode ?? "route";
  const isOverviewPip = opts?.isOverviewPip ?? false;
  const routeComparePicker = Boolean(opts?.routeComparePicker && viewMode === "topdown");

  const hideAltsOnMainDrive = viewMode === "drive" && !isOverviewPip;
  const routesToDraw = hideAltsOnMainDrive
    ? routes.filter(
        (r) =>
          r.id === lineFocusId ||
          /* Habitual fork branch while still on the main corridor. */
          r.id === "r-your-route"
      )
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

    let lineColor: string;
    let lineWidth: number;
    let lineOpacity: number;

    if (routeComparePicker) {
      const style = routeMapLineStyle(isFocus);
      lineColor = style.color;
      lineWidth = isFocus ? 10 : style.width;
      lineOpacity = isFocus ? 0.95 : 0.24;
    } else if (!navigationStarted) {
      const style = routeMapLineStyle(isFocus);
      lineColor = style.color;
      lineWidth = isFocus ? style.width : isSuggested ? ROUTE_SUGGESTED_LINE_WIDTH : style.width - 1;
      lineOpacity = isFocus ? 0.88 : isSuggested ? 0.52 : 0.36;
    } else {
      const lockedId = opts?.lockedRouteId?.trim() || null;
      const rejoinOverlay =
        Boolean(opts?.rejoinOverlayActive) &&
        Boolean(lockedId) &&
        lockedId !== lineFocusId;
      const isLockedBackground = rejoinOverlay && route.id === lockedId && !isFocus;

      if (isLockedBackground) {
        const bg = routeMapLineStyle(false);
        lineColor = bg.color;
        lineWidth = bg.width;
        lineOpacity = 0.26;
      } else {
        const style = routeMapLineStyle(isFocus);
        lineColor = style.color;
        lineWidth = style.width;
        lineOpacity = style.opacity;
      }
    }

    const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: routeCoordinatesForMap(route, opts) },
    };

    const lineId = `${id}-line`;
    const hitLineId = `${id}-line-hit`;
    const lineAnchorBefore = firstBasemapSymbolBeforeId(map);
    if (!map.getSource(id)) {
      map.addSource(id, { type: "geojson", data: geojson });
      map.addLayer(
        {
          id: lineId,
          type: "line",
          source: id,
          paint: {
            "line-color": lineColor,
            "line-width": lineWidth,
            "line-opacity": lineOpacity,
          },
          layout: { "line-cap": "round", "line-join": "round" },
        },
        lineAnchorBefore
      );
      map.addLayer(
        {
          id: hitLineId,
          type: "line",
          source: id,
          paint: {
            "line-color": "#000000",
            "line-width": 22,
            "line-opacity": 0,
          },
          layout: { "line-cap": "round", "line-join": "round" },
        },
        lineAnchorBefore
      );
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
  if (spanM < 500_000) return 10.5;
  if (spanM < 1_200_000) return 8.5;
  if (spanM < 2_500_000) return 6.5;
  return 5.5;
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
  /** Planning overview: always frame the full polyline, not just user→destination endpoints. */
  forceFullPolyline?: boolean;
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

/** Cross-country legs — endpoint diagonal misses the corridor; fit the full polyline instead. */
const ENDPOINT_ANCHORED_TRIP_MAX_DIRECT_M = 250_000;

/**
 * Rt / planning framing: anchor user + destination on the padded edges (same treatment for every
 * trip under ~155 mi). Only cross-country legs use the full polyline bbox.
 */
export function preferEndpointAnchoredTripFit(
  user: LngLat | null,
  dest: LngLat | null,
  geometry: LngLat[] | null | undefined
): boolean {
  const direct = directTripMeters(user, dest);
  if (!Number.isFinite(direct)) return false;
  if (!geometry?.length || geometry.length < 2) return direct < ENDPOINT_ANCHORED_TRIP_MAX_DIRECT_M;
  if (direct >= ENDPOINT_ANCHORED_TRIP_MAX_DIRECT_M) return false;
  const box = polylineBbox(geometry);
  if (!box) return true;
  const routeSpan = haversineMeters([box.west, box.south], [box.east, box.north]);
  /* Winding local trip: polyline bulges far outside the start/end box — include the path. */
  if (routeSpan > direct * 1.85) return false;
  return true;
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
  onlyRouteId?: string | null,
  forceFullPolyline = false
): TripFitBoundsMode | null {
  const geometry = primaryRouteGeometry(routes, onlyRouteId);
  const directM = directTripMeters(user, dest);
  const endpointsOnly = forceFullPolyline
    ? false
    : preferEndpointAnchoredTripFit(user, dest, geometry);
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
    if (directM < 250_000) {
      return Math.min(maxZoomCeiling, maxZoomForBoundsSpanMeters(spanM) + 0.35 + bias);
    }
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
): boolean {
  const fit = buildTripFitBounds(user, dest, routes, opts?.onlyRouteId, opts?.forceFullPolyline);
  if (!fit) {
    opts?.onAfterFit?.();
    return false;
  }

  const finish = () => opts?.onAfterFit?.();
  map.once("moveend", finish);
  const ok = applyTripCameraFit(map, fit, padding, maxZoomCeiling, opts?.zoomBias ?? 0, 360);
  if (!ok) {
    map.off("moveend", finish);
    opts?.onAfterFit?.();
  }
  return ok;
}

const ROUTE_COMPARE_DEFAULT_AHEAD_M = 28_000;
const ROUTE_COMPARE_HAZARD_TAIL_M = 10_000;

/** Trim `sliceRouteAhead` to a local corridor — keeps compare/rejoin framing near the driver. */
function capRouteAheadWindow(geometry: LngLat[], user: LngLat, maxAheadM: number): LngLat[] {
  const ahead = sliceRouteAhead(geometry, user);
  if (ahead.length < 2 || maxAheadM <= 0) return ahead;
  const out: LngLat[] = [ahead[0]!];
  let acc = 0;
  for (let i = 1; i < ahead.length; i++) {
    const prev = ahead[i - 1]!;
    const cur = ahead[i]!;
    acc += haversineMeters(prev, cur);
    out.push(cur);
    if (acc >= maxAheadM) break;
  }
  return out;
}

function resolveRouteCompareAheadM(
  userAlongM: number | null | undefined,
  hazardAlongM: number | null | undefined
): number {
  if (
    userAlongM != null &&
    Number.isFinite(userAlongM) &&
    hazardAlongM != null &&
    Number.isFinite(hazardAlongM) &&
    hazardAlongM > userAlongM
  ) {
    return Math.max(12_000, hazardAlongM - userAlongM + ROUTE_COMPARE_HAZARD_TAIL_M);
  }
  return ROUTE_COMPARE_DEFAULT_AHEAD_M;
}

/** Local window on the locked leg near the driver — full cross-country A is omitted from the fit. */
function primaryRouteLocalWindowForOffRouteFit(
  geometry: LngLat[],
  user: LngLat
): LngLat[] {
  if (geometry.length < 2) return geometry;
  let bestI = 0;
  let bestD = Infinity;
  for (let i = 0; i < geometry.length; i++) {
    const [lng, lat] = geometry[i]!;
    const d = (lng - user[0]) ** 2 + (lat - user[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  const start = Math.max(0, bestI - 28);
  const end = Math.min(geometry.length, bestI + 64);
  return geometry.slice(start, end);
}

/** Bounds for off-route map view: user + B/C rejoin legs + a local slice of locked route A. */
export function buildOffRouteRejoinFitBounds(
  user: LngLat,
  routes: NavRoute[],
  primaryRouteId: string
): TripFitBoundsMode | null {
  const b = new mapboxgl.LngLatBounds();
  safeExtendBounds(b, user);

  for (const r of routes) {
    const geom = r.geometry;
    if (!geom?.length) continue;
    if (r.id === primaryRouteId) {
      extendBoundsWithPolyline(b, primaryRouteLocalWindowForOffRouteFit(geom, user));
    } else {
      extendBoundsWithPolyline(b, geom);
    }
  }

  if (b.isEmpty()) return null;
  return {
    bounds: b,
    directM: boundsDiagonalMeters(b),
    endpointsOnly: false,
  };
}

/** Off-route Mp view: frame user position and both rejoin alternates (B/C). */
export function fitMapToOffRouteRejoinChoices(
  map: mapboxgl.Map,
  routes: NavRoute[],
  userLngLat: LngLat,
  primaryRouteId: string,
  padding: mapboxgl.PaddingOptions,
  maxZoomCeiling = 17.4
): boolean {
  const fit = buildOffRouteRejoinFitBounds(userLngLat, routes, primaryRouteId);
  if (!fit) return false;
  return applyTripCameraFit(map, fit, padding, maxZoomCeiling, 0.45, 520);
}

/** Toll compare: frame where with-tolls vs toll-free diverge (not the whole trip). */
export function buildTollCompareLocalFitBounds(
  routes: NavRoute[]
): TripFitBoundsMode | null {
  const withTolls = routes.find((r) => r.id === "r-a");
  const tollFree = routes.find((r) => r.id === "r-b");
  const geomA = withTolls?.geometry;
  const geomB = tollFree?.geometry;
  if (!geomA?.length || !geomB?.length) return null;

  const window = findRouteDivergenceWindow(geomA, geomB);
  if (!window) return null;

  const padStart = Math.max(0, window.startM - 4_000);
  const padEnd = window.endM + 4_000;
  const sliceA = slicePolylineBetweenAlongForDisplay(geomA, padStart, padEnd);
  const startPt = pointAtAlongMeters(geomA, padStart);
  const endPt = pointAtAlongMeters(geomA, padEnd);
  const altStart = closestAlongRouteMeters(startPt, geomB).alongMeters;
  const altEnd = closestAlongRouteMeters(endPt, geomB).alongMeters;
  const sliceB = slicePolylineBetweenAlongForDisplay(
    geomB,
    Math.min(altStart, altEnd),
    Math.max(altStart, altEnd)
  );

  const b = new mapboxgl.LngLatBounds();
  if (sliceA.length >= 2) extendBoundsWithPolyline(b, sliceA);
  if (sliceB.length >= 2) extendBoundsWithPolyline(b, sliceB);
  if (b.isEmpty()) return null;

  return {
    bounds: b,
    directM: boundsDiagonalMeters(b),
    endpointsOnly: false,
  };
}

/** Bounds for A/B/C compare: user + hazard + local ahead slices (not the full trip). */
export function buildRouteCompareLocalFitBounds(
  user: LngLat,
  routes: NavRoute[],
  _primaryRouteId: string,
  hazardLngLat: LngLat | null,
  opts?: { userAlongM?: number | null; hazardAlongM?: number | null }
): TripFitBoundsMode | null {
  const b = new mapboxgl.LngLatBounds();
  safeExtendBounds(b, user);
  if (hazardLngLat) safeExtendBounds(b, hazardLngLat);

  const maxAheadM = resolveRouteCompareAheadM(opts?.userAlongM, opts?.hazardAlongM);

  for (const r of routes) {
    const geom = r.geometry;
    if (!geom?.length) continue;
    extendBoundsWithPolyline(b, capRouteAheadWindow(geom, user, maxAheadM));
  }

  if (b.isEmpty()) return null;
  return {
    bounds: b,
    directM: boundsDiagonalMeters(b),
    endpointsOnly: false,
  };
}

/** Traffic bypass / hazard compare: zoom to the corridor being decided, not the whole route. */
export function fitMapToRouteCompareLocal(
  map: mapboxgl.Map,
  routes: NavRoute[],
  userLngLat: LngLat,
  primaryRouteId: string,
  hazardLngLat: LngLat | null,
  padding: mapboxgl.PaddingOptions,
  maxZoomCeiling = 17.8,
  opts?: {
    userAlongM?: number | null;
    hazardAlongM?: number | null;
    compareKind?: "traffic" | "toll";
  }
): boolean {
  const fit =
    opts?.compareKind === "toll"
      ? buildTollCompareLocalFitBounds(routes) ??
        buildRouteCompareLocalFitBounds(userLngLat, routes, primaryRouteId, hazardLngLat, opts)
      : buildRouteCompareLocalFitBounds(userLngLat, routes, primaryRouteId, hazardLngLat, opts);
  if (!fit) return false;
  const maxZoom = opts?.compareKind === "toll" ? Math.min(maxZoomCeiling, 12.5) : maxZoomCeiling;
  return applyTripCameraFit(map, fit, padding, maxZoom, 0.5, 560);
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
