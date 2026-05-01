import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";
import type { RouteAlert } from "../nav/routeAlerts";
import type { LngLat, NavRoute } from "../nav/types";
import type { SavedPlace } from "../nav/savedPlaces";
import { closestPointOnPolyline } from "../nav/routeGeometry";
import { getWebEnv } from "../config/env";
import {
  fetchRainViewerRadarFrames,
  RAINVIEWER_ANIMATION_DWELL_MS,
  tileUrlFromHostAndPath,
} from "../services/rainViewerRadar";
import {
  applyRouteConditionHighlights,
  applyRoutesToMap,
  bringRouteHitLayersToTop,
  bringRouteVisualLinesAboveTraffic,
  fitMapToRemainingRoutes,
  fitMapToTrip,
  routeIdFromRouteHitLayerId,
  visibleRouteIdsForHitLayers,
} from "./mapRouteLayers";
import { applyWeatherAlertLayers, WEATHER_ALERTS_NWS_FILL_LAYER_ID } from "./mapWeatherAlertLayers";
import {
  bringMapboxTrafficLayersToFront,
  ensureMapboxTrafficConditionLayers,
  setMapboxTrafficLayersVisible,
} from "./mapTrafficLayers";

/** Mapbox traffic is moved to the top of the layer stack; route lines must be lifted above it again. */
function liftTrafficThenRoutesThenHits(
  map: mapboxgl.Map,
  routeIds: string[],
  layerPrefix = "route"
) {
  bringMapboxTrafficLayersToFront(map);
  bringRouteVisualLinesAboveTraffic(map, routeIds, layerPrefix);
  bringRouteHitLayersToTop(map, routeIds, layerPrefix);
}
import {
  animateRainViewerDualCrossfade,
  ensureRainViewerRadarDual,
  RAINVIEWER_RADAR_CROSSFADE_MS,
  RAINVIEWER_RADAR_VISIBLE_OPACITY,
  removeRainViewerRadar,
  setRainViewerRadarTilesOnSource,
  waitForRainViewerSideLoaded,
} from "./mapRadarLayer";

import type { MapFocusRequest, MapViewMode } from "./driveMapTypes";
import { MAIN_MAP_ROUTE_PADDING } from "./driveMapTypes";
export type { MapFocusRequest, MapViewMode };
export { MAIN_MAP_ROUTE_PADDING };

/** Map pins during traffic-bypass compare (ETA + savings vs A). */
export type TrafficBypassCompareCallout = {
  routeId: string;
  lngLat: LngLat;
  slot: "A" | "B" | "C";
  etaMinutes: number;
  /** `null` for A. Positive = fewer minutes than A (time saved). */
  savingsVsAMinutes: number | null;
};

const MAP_STYLE_DAY = "mapbox://styles/mapbox/streets-v12";
const MAP_STYLE_NIGHT = "mapbox://styles/mapbox/dark-v11";

/** Day vs night for style + 3D lighting (local time). */
type MapPhase = "day" | "night";

function currentMapPhase(): MapPhase {
  const h = new Date().getHours();
  return h >= 6 && h < 20 ? "day" : "night";
}

function currentMapStyle(phase?: MapPhase): string {
  return (phase ?? currentMapPhase()) === "night" ? MAP_STYLE_NIGHT : MAP_STYLE_DAY;
}

/** Mapbox light position & color for each phase.
 *  position = [radial, azimuthal-deg, polar-deg]
 *  azimuthal: 0=N, 90=E, 180=S, 270=W
 *  polar: 0=overhead, 90=horizon (larger = longer shadows)
 */
function sceneLightForPhase(phase: MapPhase): {
  anchor: "map" | "viewport";
  position: [number, number, number];
  color: string;
  intensity: number;
} {
  if (phase === "night") {
    return { anchor: "map", position: [1.5, 210, 55], color: "#6677aa", intensity: 0.22 };
  }
  // Day: sun high, short shadows
  return { anchor: "map", position: [1.5, 180, 28], color: "white", intensity: 0.5 };
}

function buildingColorForPhase(phase: MapPhase): string {
  return phase === "night" ? "#1a1c22" : "#d4d4d8";
}

function isNarrowPhoneViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 520px)").matches;
}

/** Desktop / trackpad: true hover — skip on touch-primary devices. */
function mapHoverPopupSupported(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function truncateStormHoverText(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

/** No hazard hover popups when zoomed past this (street-level — too noisy). */
const NWS_HOVER_POPUP_MAX_ZOOM = 11.5;
/** Time to read the card before fade. */
const NWS_HOVER_READ_MS = 4500;
const NWS_HOVER_FADE_MS = 480;

function nwsHoverPopupZoomOk(map: mapboxgl.Map): boolean {
  return map.getZoom() <= NWS_HOVER_POPUP_MAX_ZOOM;
}

function nwsHoverAlertKeyFromFeats(feats: mapboxgl.MapboxGeoJSONFeature[]): string {
  const ids = new Set<string>();
  for (const f of feats) {
    const p = f.properties as Record<string, unknown> | null;
    const id = String(p?.id ?? "");
    if (id) ids.add(id);
  }
  return [...ids].sort().join("|");
}

/** Safe DOM for NWS hover popup (overlapping polygons → multiple rows). */
function buildStormHoverPopupContent(feats: mapboxgl.MapboxGeoJSONFeature[]): HTMLDivElement {
  const root = document.createElement("div");
  root.className = "storm-hover-popup-inner";

  const byId = new Map<string, { event: string; severity: string; headline: string }>();
  for (const f of feats) {
    const p = f.properties as Record<string, unknown> | null;
    if (!p) continue;
    const id = String(p.id ?? "");
    if (!id || byId.has(id)) continue;
    byId.set(id, {
      event: String(p.event ?? "Weather alert"),
      severity: String(p.severity ?? ""),
      headline: typeof p.headline === "string" ? p.headline : "",
    });
  }

  const all = [...byId.values()];
  const rows = all.slice(0, 4);
  for (const a of rows) {
    const row = document.createElement("div");
    row.className = "storm-hover-popup-row";

    const title = document.createElement("div");
    title.className = "storm-hover-popup-title";
    title.textContent = a.event;

    row.appendChild(title);
    if (a.severity) {
      const meta = document.createElement("div");
      meta.className = "storm-hover-popup-meta";
      meta.textContent = a.severity;
      row.appendChild(meta);
    }
    if (a.headline) {
      const hl = document.createElement("div");
      hl.className = "storm-hover-popup-hl";
      hl.textContent = truncateStormHoverText(a.headline, 160);
      row.appendChild(hl);
    }
    root.appendChild(row);
  }

  if (all.length > 4) {
    const more = document.createElement("div");
    more.className = "storm-hover-popup-more";
    more.textContent = `+${all.length - 4} more`;
    root.appendChild(more);
  }

  return root;
}

/** Dark basemap: stronger labels (NWS + night driving). */
function brightenNightMapLabels(map: mapboxgl.Map): void {
  const layers = map.getStyle()?.layers;
  if (!layers) return;
  for (const layer of layers) {
    if (layer.type !== "symbol") continue;
    const layout = layer.layout as Record<string, unknown> | undefined;
    if (layout?.["text-field"] == null) continue;
    try {
      map.setPaintProperty(layer.id, "text-opacity", 1);
      const haloW = map.getPaintProperty(layer.id, "text-halo-width");
      if (haloW == null || (typeof haloW === "number" && haloW < 0.75)) {
        map.setPaintProperty(layer.id, "text-halo-color", "rgba(0,0,0,0.9)");
        map.setPaintProperty(layer.id, "text-halo-width", 1.35);
      }
    } catch {
      /* data-driven paint */
    }
  }
}

/** Extra top padding when full storm advisory bar is expanded under the guidance bar. */
const ROUTE_FIT_STORM_BAR_EXTRA_TOP_PX = 72;
/** Smaller top inset when only the left “Storm” peek control is shown. */
const ROUTE_FIT_STORM_BAR_PEEK_TOP_PX = 46;
/** Phone collapsed: preview strip under guidance — keep in sync with `.storm-advisory-bar--preview` height. */
const ROUTE_FIT_STORM_BAR_PHONE_COMPACT_TOP_PX = 34;

/** Progress rail width + gap. */
const ROUTE_RIGHT_RAIL_PX = 56;
const ROUTE_RIGHT_RAIL_GAP_PX = 8;

function stormBarTopExtraPx(visible: boolean, expanded: boolean): number {
  if (!visible) return 0;
  if (expanded) return ROUTE_FIT_STORM_BAR_EXTRA_TOP_PX;
  if (isNarrowPhoneViewport()) return ROUTE_FIT_STORM_BAR_PHONE_COMPACT_TOP_PX;
  return ROUTE_FIT_STORM_BAR_PEEK_TOP_PX;
}

/** Route overview fit: turn/storm strip, address/toolbar, progress rail.
 * Top inset was a bit generous vs bottom — long N–S legs left the north end sitting low with empty sky.
 * Keep enough room for the guidance strip; trim top so fitBounds can use more vertical space above the line. */
const ROUTE_FIT_TOP_TRIM_PX = 36;
/** Keep start/end dots close to safe-area edges (inside chrome), not centered deep in map. */
const ROUTE_FIT_EDGE_INSET_PX = 12;

/** Route overview fit: turn/storm strip, address/toolbar, progress rail. */
function isLandscapeViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(orientation: landscape)").matches;
}

function isLandscapeHandLeft(): boolean {
  if (typeof document === "undefined") return false;
  return Boolean(document.querySelector(".app-shell--landscape-hand-left"));
}

function cssPxVar(name: string): number {
  if (typeof window === "undefined") return 0;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!v) return 0;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function safeAreaInsetsPx(): { top: number; bottom: number } {
  return {
    top: Math.max(0, cssPxVar("--sp-safe-top")),
    bottom: Math.max(0, cssPxVar("--sp-safe-bottom")),
  };
}

type RouteViewAxis = "eastWest" | "northSouth" | "diagonal";

function routeViewAxis(
  routes: NavRoute[],
  primaryRouteId?: string | null
): RouteViewAxis {
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

/** Route overview fit: turn/storm strip, address/toolbar, progress rail. */
function routeFitPadding(
  stormBarVisible: boolean,
  stormBarExpanded: boolean,
  routes: NavRoute[],
  primaryRouteId?: string | null,
  progressRailVisible = true
): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  const p = MAIN_MAP_ROUTE_PADDING;
  const stormTop = stormBarTopExtraPx(stormBarVisible, stormBarExpanded);
  const rightNeed = progressRailVisible ? ROUTE_RIGHT_RAIL_PX + ROUTE_RIGHT_RAIL_GAP_PX : 18;
  const planningOverview = !progressRailVisible;
  if (isNarrowPhoneViewport()) {
    const safe = safeAreaInsetsPx();
    const sidePad = Math.max(p.left, 22);
    /* Before Go there is no progress rail, so keep the route overview centered in the full map width. */
    return {
      top: Math.max(128, 182 - ROUTE_FIT_TOP_TRIM_PX) + stormTop + Math.min(6, safe.top * 0.25),
      bottom: 164 + Math.min(34, safe.bottom),
      left: sidePad,
      right: planningOverview ? sidePad : Math.max(88, rightNeed),
    };
  }
  if (isLandscapeViewport()) {
    const axis = routeViewAxis(routes, primaryRouteId);
    const handLeft = isLandscapeHandLeft();
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    const nearEdge = Math.max(ROUTE_FIT_EDGE_INSET_PX, 10);
    const rightUiNeed = Math.max(Math.max(p.right, rightNeed), nearEdge);
    const leftUiNeed = Math.max(Math.max(p.left, rightNeed), nearEdge);

    /*
     * Landscape framing target:
     * - N/S + diagonal: center the fitted map in the left-half safe viewing pane.
     * - E/W: allow extra middle-right room.
     *
     * fitBounds viewport center is (W - right + left) / 2.
     * For default right-hand mode (rail left), left-pane center ~= 0.25W.
     */
    const nonEastWestRightPad = Math.round(vw * 0.5) + nearEdge;
    const eastWestRightPad = Math.round(vw * 0.34) + nearEdge;
    const nonEastWestLeftPad = Math.round(vw * 0.5) + nearEdge;
    const eastWestLeftPad = Math.round(vw * 0.34) + nearEdge;

    const leftPad = handLeft
      ? Math.max(axis === "eastWest" ? eastWestLeftPad : nonEastWestLeftPad, leftUiNeed)
      : axis === "eastWest"
        ? Math.max(nearEdge, rightNeed + 10)
        : Math.max(nearEdge, rightNeed + 6);
    const rightPad = handLeft
      ? rightUiNeed
      : Math.max(axis === "eastWest" ? eastWestRightPad : nonEastWestRightPad, rightUiNeed);
    return axis === "eastWest"
      ? {
          /* E/W: raise route center so endpoints sit higher in the safe viewing lane. */
          top: Math.max(74, p.top + stormTop - ROUTE_FIT_TOP_TRIM_PX - 22),
          bottom: Math.max(144, p.bottom - 20),
          left: leftPad,
          right: rightPad,
        }
      : {
          /* N/S + diagonal: use almost the full safe lane height (tight to outer walls). */
          top: Math.max(20, 18 + Math.min(18, stormTop)),
          bottom: 18,
          left: leftPad,
          right: rightPad,
        };
  }
  return {
    top: Math.max(128, p.top + stormTop - ROUTE_FIT_TOP_TRIM_PX),
    bottom: p.bottom,
    left: p.left,
    right: planningOverview ? p.left : Math.max(p.right, rightNeed),
  };
}

function routeFitMaxZoomCeiling(routes: NavRoute[], primaryRouteId?: string | null): number {
  if (!isLandscapeViewport()) return ROUTE_VIEW_ROUTE_FIT_MAX_ZOOM;
  const axis = routeViewAxis(routes, primaryRouteId);
  if (axis === "eastWest") return ROUTE_VIEW_ROUTE_FIT_MAX_ZOOM + 0.35;
  /* N/S + diagonal: zoom in further so endpoints stay near outer safe edges. */
  return ROUTE_VIEW_ROUTE_FIT_MAX_ZOOM + 1.15;
}

function routeFitZoomBias(routes: NavRoute[], primaryRouteId?: string | null): number {
  if (!isLandscapeViewport()) return 0;
  const axis = routeViewAxis(routes, primaryRouteId);
  if (axis === "eastWest") return 0.35;
  /* N/S + diagonal: keep endpoints near pane walls while traveling. */
  return 1.55;
}

function hazardOverviewFitPadding(): mapboxgl.PaddingOptions {
  if (isNarrowPhoneViewport()) {
    return { top: 220, bottom: 200, left: 16, right: 84 };
  }
  return { top: 120, bottom: 220, left: 20, right: 24 };
}

function driveCameraEaseOptions(
  stormBarVisible: boolean,
  stormBarExpanded: boolean,
  progressRailVisible: boolean
): { padding: mapboxgl.PaddingOptions; offset: [number, number] } {
  const stormTop = stormBarTopExtraPx(stormBarVisible, stormBarExpanded);
  const rightNeed = progressRailVisible ? ROUTE_RIGHT_RAIL_PX + ROUTE_RIGHT_RAIL_GAP_PX : 18;
  /*
   * Landscape + side-T chrome: bottom dock and top strip sit on the right half only.
   * Portrait-style bottom/top padding is far too tall for ~360–430px viewport height and
   * shoves the follow camera / puck off the bottom of the map.
   */
  if (isLandscapeViewport()) {
    const handLeft = isLandscapeHandLeft();
    const vw = typeof window !== "undefined" ? window.innerWidth : 900;
    const vh = typeof window !== "undefined" ? window.innerHeight : 400;
    const rightChrome = Math.max(200, Math.round(vw * 0.5) + 8);
    const railPad = Math.max(72, rightNeed + 14);
    const topPad = Math.max(52, 44 + Math.round(stormTop * 0.45));
    const bottomPad = Math.max(36, 48);
    const yOff = Math.min(104, Math.max(54, Math.round(vh * 0.17)));
    if (handLeft) {
      return {
        padding: {
          top: topPad,
          bottom: bottomPad,
          left: rightChrome,
          right: railPad,
        },
        offset: [progressRailVisible ? -10 : -2, yOff],
      };
    }
    return {
      padding: {
        top: topPad,
        bottom: bottomPad,
        left: railPad,
        right: rightChrome,
      },
      offset: [progressRailVisible ? 10 : 2, yOff],
    };
  }
  if (isNarrowPhoneViewport()) {
    /** Match left/right so the follow point sits on the horizontal screen center (rail overlays the gutter). */
    const sidePad = Math.max(12, Math.max(104, rightNeed));
    return {
      padding: {
        top: 172 + stormTop,
        bottom: 156,
        left: sidePad,
        right: sidePad,
      },
      /* +Y: focal point lower on screen → more road ahead above the puck. */
      offset: [0, 152],
    };
  }
  const sidePadWide = Math.max(16, Math.max(96, rightNeed));
  return {
    padding: {
      top: 268 + stormTop,
      bottom: 176,
      left: sidePadWide,
      right: sidePadWide,
    },
    offset: [0, 238],
  };
}

type Props = {
  routes: NavRoute[];
  lineFocusId: string;
  suggestedRouteId: string | null;
  userLngLat: [number, number] | null;
  destLngLat: [number, number] | null;
  fitTrigger: number;
  viewMode: MapViewMode;
  navigationStarted: boolean;
  heading: number | null;
  /** When set (drive + active leg), camera bearing follows the polyline ahead instead of GPS heading. */
  driveRouteBearingDeg?: number | null;
  /** Ground speed from Geolocation; used to tighten puck smoothing while moving. */
  speedMps?: number | null;
  allowDestinationPick: boolean;
  topdownZoomRef: MutableRefObject<number>;
  onMapClick: (lng: number, lat: number) => void;
  savedPlaces: SavedPlace[];
  savedPlacesVisible: boolean;
  onSavedPlaceClick: (id: string) => void;
  mapFocus: MapFocusRequest | null;
  onMapFocusComplete: () => void;
  /** A / B / C order — same as route picker */
  orderedRouteIds: string[];
  showRadar: boolean;
  /** RainViewer frame `time` (unix seconds, UTC instant) for the mosaic shown, or null when radar is off / unavailable. */
  onRadarFrameUtcSec?: (utcSec: number | null) => void;
  /** Same corridor points as the progress-strip ticks (weather, notices) — drawn on the active route line. */
  alongRouteAlerts?: RouteAlert[];
  /**
   * Polyline for those corridor overlays — must match the geometry used to build {@link alongRouteAlerts}
   * (active guidance leg). When omitted, falls back to `routes.find(lineFocusId)?.geometry`.
   */
  corridorRouteGeometry?: LngLat[] | null;
  /** Live GPS path while “Record driven path” is active (dashed line + rubber-band to current position). */
  recordingGeometry?: LngLat[];
  /** US NWS warning polygons (GeoJSON), when storm advisory is on */
  weatherAlertGeoJson?: GeoJSON.FeatureCollection | null;
  /** Storm UI under guidance — extra top inset for route fit + drive camera. */
  stormBarVisible?: boolean;
  /** Full storm bar expanded (vs left peek only). */
  stormBarExpanded?: boolean;
  /** Bumps when user taps “My location” in route planning (no trip yet). */
  recenterPlanningPuckTick?: number;
  /** While navigating, smooth the puck along this polyline (closest point) when GPS is near the line. */
  puckSnapGeometry?: LngLat[] | null;
  /** Colored road traffic (Mapbox traffic-v1); mirrors Hazards → Road & traffic checkbox. Default off. */
  trafficConditionsOnMap?: boolean;
  /** Drive mode: live map bearing (degrees) for a north-fixed compass in the chrome. */
  onDriveCameraBearingDeg?: (deg: number | null) => void;
  /** When set with {@link onStormBrowseBoundsChange}, reports visible bounds for viewport NWS fetches (browse, no route). */
  stormBrowseBoundsReporting?: boolean;
  onStormBrowseBoundsChange?: (bounds: {
    west: number;
    south: number;
    east: number;
    north: number;
  }) => void;
  /** Traffic bypass compare: pins on each route with ETA / savings — only in topdown compare. */
  trafficBypassCompareCallouts?: TrafficBypassCompareCallout[] | null;
  onTrafficBypassCompareFlagPick?: (routeId: string) => void;
  /** Plus: sparse GPS dots over weeks/months (see About → Activity trail). */
  activityTrailGeoJson?: GeoJSON.FeatureCollection | null;
  /** Multi-result destination search: temporary pins until the user picks one. */
  searchPickMarkers?: { id: string; lngLat: LngLat; label: string }[] | null;
  onSearchPickMarkerClick?: (id: string) => void;
  /** Right-side route progress rail visibility affects camera/right padding. */
  progressRailVisible?: boolean;
};

/**
 * Planning/browse modes: keep manual pan/zoom control much longer before auto-recenter so
 * users can freely browse far away areas (other countries/continents) without snap-back.
 */
const EXPLORE_IDLE_MS = 120_000;
/** Drive mode: return to follow-cam sooner after the user pans/zooms the map. */
const DRIVE_EXPLORE_IDLE_MS = 4_000;
/** Blend route/GPS bearing frame-to-frame (reduces jitter at segment joins). */
const DRIVE_ROUTE_BEARING_SMOOTH = 0.22;
/** Top-down map view: nudge puck slightly right of visual center to balance the side rail/chrome. */
const TOPDOWN_PUCK_OFFSET_PX: [number, number] = [24, 0];

/**
 * Drive (3D) view: lateral balance comes from symmetric horizontal padding in
 * {@link driveCameraEaseOptions} (portrait); marker stays on the route line.
 */
const DRIVE_PUCK_MARKER_OFFSET_PX: [number, number] = [0, 0];

/** Route (Rt): start with regional / state context; user zooms or taps My location for street level. */
const ROUTE_VIEW_REGIONAL_ZOOM = 6.95;
/** Narrow phones: a bit wider context before “My location” street zoom. */
const ROUTE_VIEW_REGIONAL_ZOOM_PHONE = 6.35;

function regionalPlanningZoom(): number {
  if (typeof window === "undefined") return ROUTE_VIEW_REGIONAL_ZOOM;
  return window.matchMedia("(max-width: 520px)").matches
    ? ROUTE_VIEW_REGIONAL_ZOOM_PHONE
    : ROUTE_VIEW_REGIONAL_ZOOM;
}
/** Cap auto fitBounds on the trip so preview stays overview-ish until the user zooms in. */
const ROUTE_VIEW_ROUTE_FIT_MAX_ZOOM = 10.85;
/** Planning “My location” / recenter — street-level framing. */
const ROUTE_VIEW_PLANNING_STREET_ZOOM = 14.2;
const ZERO_MAP_PADDING: mapboxgl.PaddingOptions = { top: 0, bottom: 0, left: 0, right: 0 };

function smoothDriveBearingDeg(prev: number | null, raw: number, alpha: number): number {
  if (prev == null || !Number.isFinite(prev)) return raw;
  let d = raw - prev;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  const next = prev + d * alpha;
  return ((next % 360) + 360) % 360;
}

const ROUTE_RECORDING_SRC = "route-recording-preview";
const ROUTE_RECORDING_LAYER = "route-recording-preview-line";
const ACTIVITY_TRAIL_SRC = "stormpath-activity-trail";
const ACTIVITY_TRAIL_LAYER = "stormpath-activity-trail-dots";
const SAVED_PLACE_DOT_MIN_ZOOM = 7;
const SAVED_PLACE_DOT_FULL_ZOOM = 12.5;
const SAVED_PLACE_DOT_MIN_SIZE_PX = 5;
const SAVED_PLACE_DOT_FULL_SIZE_PX = 14;

type SelectableMapPoi = {
  lngLat: LngLat;
  label: string;
};

function savedPlaceDotSizeForZoom(zoom: number): { sizePx: number; borderPx: number } {
  const t = Math.max(
    0,
    Math.min(1, (zoom - SAVED_PLACE_DOT_MIN_ZOOM) / (SAVED_PLACE_DOT_FULL_ZOOM - SAVED_PLACE_DOT_MIN_ZOOM))
  );
  return {
    sizePx: SAVED_PLACE_DOT_MIN_SIZE_PX + (SAVED_PLACE_DOT_FULL_SIZE_PX - SAVED_PLACE_DOT_MIN_SIZE_PX) * t,
    borderPx: 1 + t,
  };
}

function selectablePoiLayerIds(map: mapboxgl.Map): string[] {
  return (
    map
      .getStyle()
      .layers?.filter((layer) => {
        if (layer.type !== "symbol") return false;
        const sourceLayer = String((layer as { "source-layer"?: unknown })["source-layer"] ?? "");
        return layer.id.toLowerCase().includes("poi") || sourceLayer.toLowerCase().includes("poi");
      })
      .map((layer) => layer.id)
      .filter((id) => map.getLayer(id)) ?? []
  );
}

function featurePointLngLat(feature: mapboxgl.MapboxGeoJSONFeature): LngLat | null {
  const geometry = feature.geometry as { type?: string; coordinates?: unknown } | null;
  if (geometry?.type !== "Point" || !Array.isArray(geometry.coordinates)) return null;
  const [lng, lat] = geometry.coordinates;
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  return [lng, lat];
}

function featureLabel(feature: mapboxgl.MapboxGeoJSONFeature): string {
  const props = feature.properties as Record<string, unknown> | null;
  const label = props?.name_en ?? props?.name ?? props?.name_script;
  return typeof label === "string" && label.trim() ? label.trim() : "Map place";
}

function selectablePoiAtPoint(map: mapboxgl.Map, point: mapboxgl.PointLike): SelectableMapPoi | null {
  const layers = selectablePoiLayerIds(map);
  if (layers.length === 0) return null;
  const feature = map.queryRenderedFeatures(point, { layers })[0];
  if (!feature) return null;
  const lngLat = featurePointLngLat(feature);
  if (!lngLat) return null;
  return { lngLat, label: featureLabel(feature) };
}

function mapEventFromUser(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  return (e as { originalEvent?: unknown }).originalEvent != null;
}

function makePuckEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "map-user-puck";
  return el;
}

function makeDestEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "map-dest-marker";
  el.setAttribute("aria-label", "Destination");
  return el;
}

function makePoiHoverEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "map-poi-hover-target";
  return el;
}

function trafficBypassSavingsLabel(savingsVsAMinutes: number | null): string {
  if (savingsVsAMinutes == null) return "Baseline";
  const d = Math.round(savingsVsAMinutes);
  if (d >= 1) return `−${d} min vs A`;
  if (d <= -1) return `+${-d} min vs A`;
  return "Same as A";
}

function makeTrafficBypassCompareFlagEl(
  slot: "A" | "B" | "C",
  etaMinutes: number,
  savingsVsAMinutes: number | null,
  routeId: string,
  onPick: (id: string) => void
): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `map-bypass-compare-flag map-bypass-compare-flag--${slot.toLowerCase()}`;
  el.setAttribute("aria-label", `Route ${slot}, about ${Math.round(etaMinutes)} minutes`);
  const slotEl = document.createElement("span");
  slotEl.className = "map-bypass-compare-flag__slot";
  slotEl.textContent = slot;
  const etaEl = document.createElement("span");
  etaEl.className = "map-bypass-compare-flag__eta";
  etaEl.textContent = `~${Math.round(etaMinutes)} min`;
  const saveEl = document.createElement("span");
  saveEl.className = "map-bypass-compare-flag__save";
  saveEl.textContent = trafficBypassSavingsLabel(savingsVsAMinutes);
  el.appendChild(slotEl);
  el.appendChild(etaEl);
  el.appendChild(saveEl);
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    onPick(routeId);
  });
  return el;
}

export function DriveMap({
  routes,
  lineFocusId,
  suggestedRouteId,
  userLngLat,
  destLngLat,
  fitTrigger,
  viewMode,
  navigationStarted,
  heading,
  driveRouteBearingDeg = null,
  speedMps = null,
  allowDestinationPick,
  topdownZoomRef,
  onMapClick,
  savedPlaces,
  savedPlacesVisible,
  onSavedPlaceClick,
  mapFocus,
  onMapFocusComplete,
  orderedRouteIds,
  showRadar,
  onRadarFrameUtcSec,
  alongRouteAlerts,
  corridorRouteGeometry = null,
  recordingGeometry,
  weatherAlertGeoJson,
  stormBarVisible = false,
  stormBarExpanded = true,
  recenterPlanningPuckTick = 0,
  puckSnapGeometry = null,
  trafficConditionsOnMap = false,
  onDriveCameraBearingDeg,
  stormBrowseBoundsReporting = false,
  onStormBrowseBoundsChange,
  trafficBypassCompareCallouts = null,
  onTrafficBypassCompareFlagPick,
  activityTrailGeoJson = null,
  searchPickMarkers = null,
  onSearchPickMarkerClick,
  progressRailVisible = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const puckMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const destMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const poiHoverMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const bypassCompareMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const onTrafficBypassCompareFlagPickRef = useRef(onTrafficBypassCompareFlagPick);
  onTrafficBypassCompareFlagPickRef.current = onTrafficBypassCompareFlagPick;
  const savedMarkerMapRef = useRef<Map<string, { marker: mapboxgl.Marker; el: HTMLButtonElement }>>(new Map());
  const onSavedClickRef = useRef(onSavedPlaceClick);
  onSavedClickRef.current = onSavedPlaceClick;
  const searchPickMarkerMapRef = useRef<Map<string, { marker: mapboxgl.Marker; el: HTMLButtonElement }>>(new Map());
  const onSearchPickMarkerClickRef = useRef(onSearchPickMarkerClick);
  onSearchPickMarkerClickRef.current = onSearchPickMarkerClick;
  const routeIdsRef = useRef<Set<string>>(new Set());
  const userFlewRef = useRef(false);
  const prevTopdownRef = useRef(false);
  const onClickRef = useRef(onMapClick);
  onClickRef.current = onMapClick;
  const userLngLatRef = useRef(userLngLat);
  userLngLatRef.current = userLngLat;
  const puckSnapGeomRef = useRef<LngLat[] | null>(null);
  puckSnapGeomRef.current =
    navigationStarted && puckSnapGeometry && puckSnapGeometry.length >= 2 ? puckSnapGeometry : null;
  const speedMpsRef = useRef<number | null>(null);
  speedMpsRef.current = speedMps;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const navigationStartedRef = useRef(navigationStarted);
  navigationStartedRef.current = navigationStarted;
  const userExploringRef = useRef(false);
  const exploreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastForcedPlanningFitTriggerRef = useRef<number | null>(null);
  const driveCamBearingSmoothedRef = useRef<number | null>(null);
  const onMapFocusCompleteRef = useRef(onMapFocusComplete);
  onMapFocusCompleteRef.current = onMapFocusComplete;
  const onRadarFrameUtcSecRef = useRef(onRadarFrameUtcSec);
  onRadarFrameUtcSecRef.current = onRadarFrameUtcSec;
  const onDriveCameraBearingDegRef = useRef(onDriveCameraBearingDeg);
  onDriveCameraBearingDegRef.current = onDriveCameraBearingDeg;
  const onStormBrowseBoundsRef = useRef(onStormBrowseBoundsChange);
  onStormBrowseBoundsRef.current = onStormBrowseBoundsChange;
  const routesForHitRef = useRef({ routes, lineFocusId, navigationStarted, viewMode });
  routesForHitRef.current = { routes, lineFocusId, navigationStarted, viewMode };

  const token = getWebEnv().mapboxToken;
  const [mapReady, setMapReady] = useState(false);
  const [mapResumeTick, setMapResumeTick] = useState(0);
  const [mapPhase, setMapPhase] = useState(currentMapPhase);
  const activeStyleRef = useRef(currentMapStyle(mapPhase));
  const trafficConditionsOnMapRef = useRef(trafficConditionsOnMap);
  trafficConditionsOnMapRef.current = trafficConditionsOnMap;

  const beginUserExploreRef = useRef<() => void>(() => {});
  const scheduleExploreEndRef = useRef<() => void>(() => {});
  beginUserExploreRef.current = () => {
    userExploringRef.current = true;
    if (exploreTimerRef.current) {
      clearTimeout(exploreTimerRef.current);
      exploreTimerRef.current = null;
    }
  };
  scheduleExploreEndRef.current = () => {
    if (exploreTimerRef.current) clearTimeout(exploreTimerRef.current);
    const idleMs =
      navigationStartedRef.current && viewModeRef.current === "drive"
        ? DRIVE_EXPLORE_IDLE_MS
        : EXPLORE_IDLE_MS;
    exploreTimerRef.current = setTimeout(() => {
      userExploringRef.current = false;
      exploreTimerRef.current = null;
      setMapResumeTick((n) => n + 1);
    }, idleMs);
  };

  useEffect(() => {
    if (!containerRef.current || !token || mapRef.current) return;

    mapboxgl.accessToken = token;
    activeStyleRef.current = currentMapStyle();
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: activeStyleRef.current,
      center: [-98.5, 39.8],
      zoom: 4,
      attributionControl: false,
      dragRotate: true,
      touchPitch: true,
      scrollZoom: true,
      dragPan: true,
      touchZoomRotate: true,
      boxZoom: true,
      doubleClickZoom: true,
    });
    map.addControl(new mapboxgl.AttributionControl({ compact: true }));
    mapRef.current = map;

    const installTrafficLayers = () => {
      try {
        ensureMapboxTrafficConditionLayers(map);
        setMapboxTrafficLayersVisible(map, trafficConditionsOnMapRef.current);
      } catch (err) {
        console.warn("[traffic-map] add traffic failed:", err);
      }
    };
    map.on("style.load", installTrafficLayers);

    const bumpResize = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            map.resize();
          } catch {
            /* style teardown */
          }
        });
      });
    };

    const onLoad = () => {
      setMapReady(true);
      bumpResize();
      installTrafficLayers();
    };
    if (map.isStyleLoaded()) {
      setMapReady(true);
      bumpResize();
      installTrafficLayers();
    } else map.once("load", onLoad);

    return () => {
      map.off("style.load", installTrafficLayers);
      map.off("load", onLoad);
      puckMarkerRef.current?.remove();
      puckMarkerRef.current = null;
      destMarkerRef.current?.remove();
      destMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
      setMapReady(false);
      routeIdsRef.current = new Set();
      userFlewRef.current = false;
      if (exploreTimerRef.current) clearTimeout(exploreTimerRef.current);
    };
  }, [token]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !stormBrowseBoundsReporting || !onStormBrowseBoundsChange) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const emit = () => {
      try {
        if (!map.isStyleLoaded()) return;
        const bounds = map.getBounds();
        if (!bounds) return;
        onStormBrowseBoundsRef.current?.({
          west: bounds.getWest(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          north: bounds.getNorth(),
        });
      } catch {
        /* map teardown */
      }
    };

    const debounced = () => {
      if (debounceTimer != null) clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        emit();
      }, 680);
    };

    map.on("moveend", debounced);
    map.on("zoomend", debounced);
    requestAnimationFrame(() => {
      requestAnimationFrame(emit);
    });

    return () => {
      if (debounceTimer != null) clearTimeout(debounceTimer);
      map.off("moveend", debounced);
      map.off("zoomend", debounced);
    };
  }, [mapReady, stormBrowseBoundsReporting, onStormBrowseBoundsChange]);

  useEffect(() => {
    const id = window.setInterval(() => setMapPhase(currentMapPhase()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.isStyleLoaded()) return;
    if (mapPhase === "night") {
      requestAnimationFrame(() => brightenNightMapLabels(map));
    }
  }, [mapPhase, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.isStyleLoaded()) return;
    const apply = () => {
      try {
        ensureMapboxTrafficConditionLayers(map);
        setMapboxTrafficLayersVisible(map, trafficConditionsOnMap);
      } catch {
        /* style race */
      }
    };
    apply();
    /* Layers can appear one frame after style load — retry so visibility matches the toggle. */
    const t = window.setTimeout(apply, 0);
    const t2 = window.setTimeout(apply, 120);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(t2);
    };
  }, [trafficConditionsOnMap, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const want = currentMapStyle(mapPhase);
    if (want === activeStyleRef.current) return;
    activeStyleRef.current = want;
    setMapReady(false);
    /* Keep prev route ids so applyRoutesToMap can remove layers after style reload; clearing the ref
       caused ghost polylines if the trip was cleared before routes re-synced. */
    map.setStyle(want);
    const onStyle = () => setMapReady(true);
    map.once("style.load", onStyle);
    return () => { map.off("style.load", onStyle); };
  }, [mapPhase]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (map.getSource("mapbox-dem")) return;

    map.addSource("mapbox-dem", {
      type: "raster-dem",
      url: "mapbox://mapbox.mapbox-terrain-dem-v1",
      tileSize: 512,
      maxzoom: 14,
    });
    map.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });

    if (!map.getLayer("3d-buildings")) {
      const layers = map.getStyle()?.layers ?? [];
      let labelLayerId: string | undefined;
      for (const layer of layers) {
        if (layer.type === "symbol" && (layer.layout as Record<string, unknown>)?.["text-field"]) {
          labelLayerId = layer.id;
          break;
        }
      }
      map.addLayer(
        {
          id: "3d-buildings",
          source: "composite",
          "source-layer": "building",
          filter: ["==", "extrude", "true"],
          type: "fill-extrusion",
          minzoom: 14,
          paint: {
            "fill-extrusion-color": buildingColorForPhase(mapPhase),
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-base": ["get", "min_height"],
            "fill-extrusion-opacity": 0.6,
          },
        },
        labelLayerId
      );
    }
  }, [mapReady, mapPhase]);

  /** Keep 3D building color in sync when phase changes after the layer is already live. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (!map.getLayer("3d-buildings")) return;
    try {
      map.setPaintProperty("3d-buildings", "fill-extrusion-color", buildingColorForPhase(mapPhase));
    } catch { /* layer not ready */ }
  }, [mapReady, mapPhase]);

  /** Day vs night: sun position and intensity for 3D buildings. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.isStyleLoaded()) return;
    try {
      map.setLight(sceneLightForPhase(mapPhase));
    } catch { /* style race */ }
  }, [mapReady, mapPhase]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const dragstart = (e: unknown) => {
      if (mapEventFromUser(e)) beginUserExploreRef.current();
    };
    const dragend = (e: unknown) => {
      if (mapEventFromUser(e)) scheduleExploreEndRef.current();
    };
    const zoomstart = (e: unknown) => {
      if (mapEventFromUser(e)) beginUserExploreRef.current();
    };
    const zoomend = (e: unknown) => {
      if (mapEventFromUser(e)) scheduleExploreEndRef.current();
    };
    const rotatestart = (e: unknown) => {
      if (mapEventFromUser(e)) beginUserExploreRef.current();
    };
    const rotateend = (e: unknown) => {
      if (mapEventFromUser(e)) scheduleExploreEndRef.current();
    };

    map.on("dragstart", dragstart);
    map.on("dragend", dragend);
    map.on("zoomstart", zoomstart);
    map.on("zoomend", zoomend);
    map.on("rotatestart", rotatestart);
    map.on("rotateend", rotateend);
    return () => {
      map.off("dragstart", dragstart);
      map.off("dragend", dragend);
      map.off("zoomstart", zoomstart);
      map.off("zoomend", zoomend);
      map.off("rotatestart", rotatestart);
      map.off("rotateend", rotateend);
      if (exploreTimerRef.current) clearTimeout(exploreTimerRef.current);
    };
  }, [mapReady]);

  /** Mobile: URL bar / rotation / safe-area change the map container — Mapbox must resize or the canvas stays wrong and the puck can disappear. */
  useEffect(() => {
    const map = mapRef.current;
    const el = containerRef.current;
    if (!map || !mapReady || !el) return;

    const resize = () => {
      try {
        map.resize();
      } catch {
        /* teardown */
      }
    };

    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", resize);
    vv?.addEventListener("scroll", resize);
    const ro = new ResizeObserver(() => resize());
    ro.observe(el);
    resize();

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", resize);
      vv?.removeEventListener("resize", resize);
      vv?.removeEventListener("scroll", resize);
      ro.disconnect();
    };
  }, [mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !mapFocus) return;

    beginUserExploreRef.current();

    if (mapFocus.kind === "hazardOverview") {
      const b = new mapboxgl.LngLatBounds();
      b.extend([mapFocus.hazardLng, mapFocus.hazardLat]);
      if (userLngLat) b.extend(userLngLat);
      if (destLngLat) b.extend(destLngLat);
      for (const r of routes) {
        for (const pt of r.geometry) {
          b.extend(pt as [number, number]);
        }
      }
      map.fitBounds(b, {
        padding: hazardOverviewFitPadding(),
        duration: 1100,
        maxZoom: 12.8,
        pitch: 0,
        bearing: 0,
        essential: true,
      });
    } else {
      map.flyTo({
        center: [mapFocus.lng, mapFocus.lat],
        zoom: mapFocus.zoom ?? 12.8,
        duration: 950,
        essential: true,
      });
    }
    map.once("moveend", () => scheduleExploreEndRef.current());
    onMapFocusCompleteRef.current();
  }, [mapReady, mapFocus, routes, userLngLat, destLngLat]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const click = (e: mapboxgl.MapMouseEvent) => {
      /* Consume taps on the route corridor so they don’t move the destination pin; hazard details are via Hazards + progress strip. */
      if (routes.length > 0) {
        const hideAltsOnMainDrive = navigationStarted && viewMode === "drive";
        const hitLayerIds = routes
          .filter((r) => !hideAltsOnMainDrive || r.id === lineFocusId)
          .map((r) => `route-${r.id}-line-hit`)
          .filter((lid) => map.getLayer(lid));
        if (hitLayerIds.length > 0) {
          const feats = map.queryRenderedFeatures(e.point, { layers: hitLayerIds });
          const lid = feats[0]?.layer?.id;
          if (lid && routeIdFromRouteHitLayerId(lid)) {
            return;
          }
        }
      }

      if (!allowDestinationPick) return;
      const poi = selectablePoiAtPoint(map, e.point);
      if (poi) {
        onClickRef.current(poi.lngLat[0], poi.lngLat[1]);
        return;
      }
      const { lng, lat } = e.lngLat;
      onClickRef.current(lng, lat);
    };
    map.on("click", click);
    return () => {
      map.off("click", click);
    };
  }, [mapReady, allowDestinationPick, routes, lineFocusId, navigationStarted, viewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const clearHover = () => {
      map.getCanvas().style.cursor = "";
      poiHoverMarkerRef.current?.remove();
      poiHoverMarkerRef.current = null;
    };

    const mousemove = (e: mapboxgl.MapMouseEvent) => {
      if (!allowDestinationPick) {
        clearHover();
        return;
      }
      const poi = selectablePoiAtPoint(map, e.point);
      if (!poi) {
        clearHover();
        return;
      }
      map.getCanvas().style.cursor = "pointer";
      if (!poiHoverMarkerRef.current) {
        poiHoverMarkerRef.current = new mapboxgl.Marker({
          element: makePoiHoverEl(),
          anchor: "center",
        }).addTo(map);
      }
      poiHoverMarkerRef.current.setLngLat(poi.lngLat).getElement().setAttribute("aria-label", poi.label);
    };

    map.on("mousemove", mousemove);
    map.on("mouseleave", clearHover);
    return () => {
      map.off("mousemove", mousemove);
      map.off("mouseleave", clearHover);
      clearHover();
    };
  }, [mapReady, allowDestinationPick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !userLngLat) return;

    if (!puckMarkerRef.current) {
      puckMarkerRef.current = new mapboxgl.Marker({
        element: makePuckEl(),
        anchor: "center",
        pitchAlignment: "map",
        rotationAlignment: "map",
      })
        .setLngLat(userLngLat)
        .addTo(map);
    } else if (!navigationStarted) {
      puckMarkerRef.current.setLngLat(userLngLat);
    }

    if (!userFlewRef.current && routes.length === 0) {
      userFlewRef.current = true;
      try {
        map.resize();
      } catch {
        /* ignore */
      }
      map.flyTo({
        center: userLngLat,
        zoom: regionalPlanningZoom(),
        padding: ZERO_MAP_PADDING,
        essential: true,
        duration: 1200,
      });
    }
  }, [mapReady, userLngLat, routes.length, navigationStarted]);

  useEffect(() => {
    if (!navigationStarted || !mapReady) return;
    const marker = puckMarkerRef.current;
    if (!marker) return;
    const t0 = userLngLatRef.current;
    if (t0) marker.setLngLat(t0);

    let raf = 0;
    let lastTs = performance.now();
    const OFF_LINE_SNAP_M = 95;

    // GPS fix history for constant-velocity interpolation between samples.
    // Instead of lurching toward each new raw fix, we lerp from prevFix→curFix
    // at a steady pace, with slight dead-reckoning past curFix while waiting
    // for the next sample.  A small exponential polish on top handles micro-jitter.
    type Fix = { lng: number; lat: number; t: number };
    let prevFix: Fix | null = null;
    let curFix: Fix | null = t0 ? { lng: t0[0], lat: t0[1], t: performance.now() } : null;
    let lastSeenLng = t0?.[0] ?? NaN;
    let lastSeenLat = t0?.[1] ?? NaN;

    const loop = () => {
      const t = userLngLatRef.current;
      if (t) {
        const now = performance.now();
        const dt = Math.min(0.12, (now - lastTs) / 1000);
        lastTs = now;

        // Detect a new GPS sample arriving.
        if (t[0] !== lastSeenLng || t[1] !== lastSeenLat) {
          prevFix = curFix;
          curFix = { lng: t[0], lat: t[1], t: now };
          lastSeenLng = t[0];
          lastSeenLat = t[1];
        }

        // Compute interpolated/dead-reckoned position between the two most
        // recent fixes.  Cap at 1.25× the interval so we don't coast too far.
        let targetLng: number;
        let targetLat: number;
        if (prevFix && curFix && curFix.t > prevFix.t) {
          const interval = curFix.t - prevFix.t;
          const alpha = Math.min((now - prevFix.t) / interval, 1.25);
          targetLng = prevFix.lng + (curFix.lng - prevFix.lng) * alpha;
          targetLat = prevFix.lat + (curFix.lat - prevFix.lat) * alpha;
        } else {
          targetLng = curFix?.lng ?? t[0];
          targetLat = curFix?.lat ?? t[1];
        }

        // Snap to the route polyline when close enough.
        const geom = puckSnapGeomRef.current;
        if (geom) {
          const snap = closestPointOnPolyline([targetLng, targetLat], geom);
          if (snap.lateralMetersApprox < OFF_LINE_SNAP_M) {
            targetLng = snap.lngLat[0]!;
            targetLat = snap.lngLat[1]!;
          }
        }

        // Tight exponential polish — the lerp above handles the coarse motion;
        // this only irons out sub-frame residuals.
        const blend = 1 - Math.exp(-dt / 0.07);
        const cur = marker.getLngLat();
        marker.setLngLat([
          cur.lng + (targetLng - cur.lng) * blend,
          cur.lat + (targetLat - cur.lat) * blend,
        ]);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [navigationStarted, mapReady]);

  useEffect(() => {
    const marker = puckMarkerRef.current;
    if (!marker) return;
    const el = marker.getElement();
    const isDriveView = navigationStarted && viewMode === "drive";
    el.classList.toggle("map-user-puck--driving", navigationStarted);
    try {
      marker.setOffset(isDriveView ? DRIVE_PUCK_MARKER_OFFSET_PX : [0, 0]);
      marker.setPitchAlignment(navigationStarted ? "viewport" : "map");
      marker.setRotationAlignment(navigationStarted ? "viewport" : "map");
    } catch {
      /* older mapbox */
    }
  }, [navigationStarted, viewMode, mapReady, userLngLat]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (!destLngLat) {
      destMarkerRef.current?.remove();
      destMarkerRef.current = null;
      return;
    }

    if (!destMarkerRef.current) {
      destMarkerRef.current = new mapboxgl.Marker({ element: makeDestEl(), anchor: "center" })
        .setLngLat(destLngLat)
        .addTo(map);
    } else {
      destMarkerRef.current.setLngLat(destLngLat);
    }
  }, [mapReady, destLngLat]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    for (const m of bypassCompareMarkersRef.current) {
      m.remove();
    }
    bypassCompareMarkersRef.current = [];
    const callouts = trafficBypassCompareCallouts;
    const onPick = onTrafficBypassCompareFlagPickRef.current;
    if (!callouts?.length || !onPick) return;
    for (const c of callouts) {
      const el = makeTrafficBypassCompareFlagEl(
        c.slot,
        c.etaMinutes,
        c.savingsVsAMinutes,
        c.routeId,
        onPick
      );
      const marker = new mapboxgl.Marker({ element: el, anchor: "bottom" })
        .setLngLat(c.lngLat)
        .addTo(map);
      bypassCompareMarkersRef.current.push(marker);
    }
    return () => {
      for (const m of bypassCompareMarkersRef.current) {
        m.remove();
      }
      bypassCompareMarkersRef.current = [];
    };
  }, [mapReady, trafficBypassCompareCallouts]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    let cancelled = false;

    /** When there are no routes, always try to strip trip line layers; retry if style is mid-transition. */
    const clearTripRouteLayers = () => {
      if (cancelled || !map.isStyleLoaded()) return;
      routeIdsRef.current = applyRoutesToMap(
        map,
        [],
        lineFocusId,
        suggestedRouteId,
        routeIdsRef.current,
        "route",
        {
          orderedRouteIds,
          navigationStarted,
          viewMode,
          isOverviewPip: false,
        }
      );
      liftTrafficThenRoutesThenHits(
        map,
        visibleRouteIdsForHitLayers([], lineFocusId, navigationStarted, viewMode, false)
      );
    };

    const sync = () => {
      if (routes.length === 0) {
        clearTripRouteLayers();
        if (!map.isStyleLoaded()) {
          map.once("style.load", clearTripRouteLayers);
          map.once("idle", clearTripRouteLayers);
        }
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!cancelled) clearTripRouteLayers();
          });
        });
        return;
      }

      if (!map.isStyleLoaded()) return;
      routeIdsRef.current = applyRoutesToMap(
        map,
        routes,
        lineFocusId,
        suggestedRouteId,
        routeIdsRef.current,
        "route",
        {
          orderedRouteIds,
          navigationStarted,
          viewMode,
          isOverviewPip: false,
        }
      );
      liftTrafficThenRoutesThenHits(
        map,
        visibleRouteIdsForHitLayers(routes, lineFocusId, navigationStarted, viewMode, false)
      );
    };

    /* After setStyle, "load" does not fire again — use style.load so polylines always re-attach. */
    sync();
    map.on("style.load", sync);
    return () => {
      cancelled = true;
      map.off("style.load", sync);
    };
  }, [
    mapReady,
    routes,
    lineFocusId,
    suggestedRouteId,
    orderedRouteIds,
    navigationStarted,
    viewMode,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const liftHits = () => {
      liftTrafficThenRoutesThenHits(
        map,
        visibleRouteIdsForHitLayers(routes, lineFocusId, navigationStarted, viewMode, false)
      );
    };

    const sync = () => {
      const g = recordingGeometry;
      const lineCoords: LngLat[] =
        g && g.length >= 2
          ? g
          : g && g.length === 1 && userLngLat
            ? [g[0]!, [userLngLat[0], userLngLat[1]]]
            : [];

      if (lineCoords.length < 2) {
        if (map.getLayer(ROUTE_RECORDING_LAYER)) map.removeLayer(ROUTE_RECORDING_LAYER);
        if (map.getSource(ROUTE_RECORDING_SRC)) map.removeSource(ROUTE_RECORDING_SRC);
        liftHits();
        return;
      }

      const data: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: lineCoords },
          },
        ],
      };

      if (!map.getSource(ROUTE_RECORDING_SRC)) {
        map.addSource(ROUTE_RECORDING_SRC, { type: "geojson", data });
        map.addLayer({
          id: ROUTE_RECORDING_LAYER,
          type: "line",
          source: ROUTE_RECORDING_SRC,
          paint: {
            "line-color": "#c026d3",
            "line-width": 5,
            "line-opacity": 0.88,
            "line-dasharray": [1.8, 1.2],
          },
          layout: { "line-cap": "round", "line-join": "round" },
        });
      } else {
        (map.getSource(ROUTE_RECORDING_SRC) as mapboxgl.GeoJSONSource).setData(data);
      }
      liftHits();
    };

    if (map.isStyleLoaded()) sync();
    else map.once("load", sync);
  }, [
    mapReady,
    recordingGeometry,
    userLngLat,
    routes,
    lineFocusId,
    navigationStarted,
    viewMode,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const liftHits = () => {
      liftTrafficThenRoutesThenHits(
        map,
        visibleRouteIdsForHitLayers(routes, lineFocusId, navigationStarted, viewMode, false)
      );
    };

    const sync = () => {
      const data = activityTrailGeoJson;
      const ok = data && data.features?.length;
      if (!ok) {
        if (map.getLayer(ACTIVITY_TRAIL_LAYER)) map.removeLayer(ACTIVITY_TRAIL_LAYER);
        if (map.getSource(ACTIVITY_TRAIL_SRC)) map.removeSource(ACTIVITY_TRAIL_SRC);
        liftHits();
        return;
      }

      if (!map.getSource(ACTIVITY_TRAIL_SRC)) {
        map.addSource(ACTIVITY_TRAIL_SRC, { type: "geojson", data: data! });
        map.addLayer({
          id: ACTIVITY_TRAIL_LAYER,
          type: "circle",
          source: ACTIVITY_TRAIL_SRC,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 1.2, 10, 3, 16, 5],
            "circle-color": "rgba(125, 211, 252, 0.55)",
            "circle-opacity": 0.85,
            "circle-stroke-width": 0.6,
            "circle-stroke-color": "rgba(255,255,255,0.35)",
          },
        });
      } else {
        (map.getSource(ACTIVITY_TRAIL_SRC) as mapboxgl.GeoJSONSource).setData(data!);
      }
      liftHits();
    };

    if (map.isStyleLoaded()) sync();
    else map.once("load", sync);
  }, [
    mapReady,
    activityTrailGeoJson,
    routes,
    lineFocusId,
    navigationStarted,
    viewMode,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const sync = () => {
      applyWeatherAlertLayers(map, weatherAlertGeoJson ?? null);
      liftTrafficThenRoutesThenHits(
        map,
        visibleRouteIdsForHitLayers(routes, lineFocusId, navigationStarted, viewMode, false)
      );
    };
    if (map.isStyleLoaded()) sync();
    else map.once("load", sync);
  }, [mapReady, weatherAlertGeoJson, routes, lineFocusId, navigationStarted, viewMode]);

  /**
   * Quick glance: entering an NWS polygon shows event/headline once; after a few seconds it fades out
   * so the map stays readable. Entering a different polygon shows again. Disabled when zoomed in past
   * `NWS_HOVER_POPUP_MAX_ZOOM` (see constant above).
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (!weatherAlertGeoJson?.features?.length) return;
    if (!mapHoverPopupSupported()) return;

    const popup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      maxWidth: "min(320px, 78vw)",
      className: "storm-hover-popup",
      offset: 14,
    });

    let rafId: number | null = null;
    let pending: mapboxgl.MapMouseEvent | null = null;
    /** Alert id key we last showed for; cleared when pointer leaves polygons or zoom blocks. */
    let shownForKey: string | null = null;
    let readTimer: ReturnType<typeof setTimeout> | null = null;
    let fadeRemoveTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimers = () => {
      if (readTimer != null) {
        clearTimeout(readTimer);
        readTimer = null;
      }
      if (fadeRemoveTimer != null) {
        clearTimeout(fadeRemoveTimer);
        fadeRemoveTimer = null;
      }
    };

    const stripFadeClass = () => {
      const el = popup.getElement();
      if (el) el.classList.remove("storm-hover-popup--fading");
    };

    const removePopupImmediate = () => {
      clearTimers();
      stripFadeClass();
      popup.remove();
      map.getCanvas().style.cursor = "";
    };

    const fadeOutThenRemove = () => {
      readTimer = null;
      const el = popup.getElement();
      if (el) {
        void el.offsetHeight;
        el.classList.add("storm-hover-popup--fading");
        fadeRemoveTimer = window.setTimeout(() => {
          fadeRemoveTimer = null;
          stripFadeClass();
          popup.remove();
          /* Pointer may still be over the polygon — leave cursor as pointer until mousemove leaves. */
        }, NWS_HOVER_FADE_MS);
      } else {
        popup.remove();
      }
    };

    const showForKey = (
      key: string,
      lngLat: mapboxgl.LngLat,
      feats: mapboxgl.MapboxGeoJSONFeature[]
    ) => {
      clearTimers();
      stripFadeClass();
      popup.setLngLat(lngLat).setDOMContent(buildStormHoverPopupContent(feats)).addTo(map);
      map.getCanvas().style.cursor = "pointer";
      shownForKey = key;
      readTimer = window.setTimeout(fadeOutThenRemove, NWS_HOVER_READ_MS);
    };

    const flush = () => {
      rafId = null;
      const ev = pending;
      pending = null;
      if (!ev) return;

      if (!map.getLayer(WEATHER_ALERTS_NWS_FILL_LAYER_ID)) {
        shownForKey = null;
        removePopupImmediate();
        return;
      }

      if (!nwsHoverPopupZoomOk(map)) {
        shownForKey = null;
        removePopupImmediate();
        return;
      }

      const feats = map.queryRenderedFeatures(ev.point, { layers: [WEATHER_ALERTS_NWS_FILL_LAYER_ID] });
      if (!feats.length) {
        shownForKey = null;
        removePopupImmediate();
        return;
      }

      const key = nwsHoverAlertKeyFromFeats(feats);
      if (!key) {
        shownForKey = null;
        removePopupImmediate();
        return;
      }

      map.getCanvas().style.cursor = "pointer";

      if (key === shownForKey) {
        return;
      }

      showForKey(key, ev.lngLat, feats);
    };

    const mousemove = (e: mapboxgl.MapMouseEvent) => {
      pending = e;
      if (rafId != null) return;
      rafId = requestAnimationFrame(flush);
    };

    const onZoom = () => {
      if (!nwsHoverPopupZoomOk(map)) {
        shownForKey = null;
        removePopupImmediate();
      }
    };

    const leave = () => {
      pending = null;
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      shownForKey = null;
      removePopupImmediate();
    };

    map.on("mousemove", mousemove);
    map.on("zoom", onZoom);
    map.getCanvas().addEventListener("mouseleave", leave);

    return () => {
      map.off("mousemove", mousemove);
      map.off("zoom", onZoom);
      map.getCanvas().removeEventListener("mouseleave", leave);
      pending = null;
      shownForKey = null;
      if (rafId != null) cancelAnimationFrame(rafId);
      removePopupImmediate();
    };
  }, [mapReady, weatherAlertGeoJson]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const focusGeom =
      corridorRouteGeometry && corridorRouteGeometry.length >= 2
        ? corridorRouteGeometry
        : routes.find((r) => r.id === lineFocusId)?.geometry;

    const lift = () => {
      applyRouteConditionHighlights(map, {
        alerts: alongRouteAlerts,
        routeGeometry: focusGeom,
        stormGeoJson: weatherAlertGeoJson,
      });
      liftTrafficThenRoutesThenHits(
        map,
        visibleRouteIdsForHitLayers(routes, lineFocusId, navigationStarted, viewMode, false)
      );
    };

    if (map.isStyleLoaded()) lift();
    else map.once("load", lift);
  }, [
    mapReady,
    alongRouteAlerts,
    corridorRouteGeometry,
    routes,
    lineFocusId,
    navigationStarted,
    viewMode,
    weatherAlertGeoJson,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let cancelled = false;
    let manifestTimer: ReturnType<typeof setInterval> | null = null;
    let radarLoopGeneration = 0;

    const clearTimers = () => {
      if (manifestTimer) {
        clearInterval(manifestTimer);
        manifestTimer = null;
      }
    };

    const liftRouteHits = () => {
      const { routes: rts, lineFocusId: lid, navigationStarted: nav, viewMode: vm } =
        routesForHitRef.current;
      const ids = visibleRouteIdsForHitLayers(rts, lid, nav, vm, false);
      bringRouteVisualLinesAboveTraffic(map, ids, "route");
      bringRouteHitLayersToTop(map, ids, "route");
    };

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    type RadarCell = { path: string; time: number };

    const runRadarFrameLoop = (loopGen: number, host: string, cells: RadarCell[]) => {
      const o = RAINVIEWER_RADAR_VISIBLE_OPACITY;
      void (async () => {
        let visible: "a" | "b" = "a";
        let idx = 0;
        while (
          !cancelled &&
          loopGen === radarLoopGeneration &&
          cells.length > 1 &&
          mapRef.current === map
        ) {
          const nextIdx = (idx + 1) % cells.length;
          const incoming: "a" | "b" = visible === "a" ? "b" : "a";
          const url = tileUrlFromHostAndPath(host, cells[nextIdx]!.path);
          setRainViewerRadarTilesOnSource(map, incoming, url);
          await waitForRainViewerSideLoaded(map, incoming, 3500);
          if (cancelled || loopGen !== radarLoopGeneration || mapRef.current !== map) return;
          const from =
            visible === "a" ? { a: o, b: 0 } : { a: 0, b: o };
          const to = visible === "a" ? { a: 0, b: o } : { a: o, b: 0 };
          await animateRainViewerDualCrossfade(map, from, to, RAINVIEWER_RADAR_CROSSFADE_MS);
          if (cancelled || loopGen !== radarLoopGeneration || mapRef.current !== map) return;
          visible = incoming;
          idx = nextIdx;
          onRadarFrameUtcSecRef.current?.(cells[idx]!.time);
          bringMapboxTrafficLayersToFront(map);
          liftRouteHits();
          await sleep(RAINVIEWER_ANIMATION_DWELL_MS);
        }
      })();
    };

    const loadManifest = async () => {
      if (!showRadar) {
        clearTimers();
        radarLoopGeneration += 1;
        onRadarFrameUtcSecRef.current?.(null);
        removeRainViewerRadar(map);
        bringMapboxTrafficLayersToFront(map);
        liftRouteHits();
        return;
      }
      const pack = await fetchRainViewerRadarFrames();
      if (cancelled || mapRef.current !== map) return;
      if (!pack?.frames.length) {
        radarLoopGeneration += 1;
        onRadarFrameUtcSecRef.current?.(null);
        removeRainViewerRadar(map);
        bringMapboxTrafficLayersToFront(map);
        liftRouteHits();
        return;
      }
      const host = pack.host;
      const cells: RadarCell[] = pack.frames.map((f) => ({ path: f.path, time: f.time }));
      const url0 = tileUrlFromHostAndPath(host, cells[0]!.path);
      radarLoopGeneration += 1;
      const myGen = radarLoopGeneration;
      ensureRainViewerRadarDual(map, url0);
      bringMapboxTrafficLayersToFront(map);
      liftRouteHits();
      onRadarFrameUtcSecRef.current?.(cells[0]!.time);
      if (cells.length > 1) runRadarFrameLoop(myGen, host, cells);
    };

    void loadManifest();
    if (showRadar) manifestTimer = setInterval(() => void loadManifest(), 600_000);

    return () => {
      cancelled = true;
      radarLoopGeneration += 1;
      onRadarFrameUtcSecRef.current?.(null);
      clearTimers();
      try {
        if (mapRef.current === map) removeRainViewerRadar(map);
      } catch {
        /* map may already be torn down */
      }
    };
  }, [mapReady, showRadar]);

  /** Route planning, no trip: allow one auto-center per “empty planning” session (leaving Rt or getting a route resets). */
  const routeEmptyPlanningRef = useRef(false);
  useEffect(() => {
    if (viewMode !== "route" || routes.length > 0) {
      routeEmptyPlanningRef.current = false;
    }
  }, [viewMode, routes.length]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || viewMode !== "route" || routes.length > 0) return;
    if (!userLngLat || userExploringRef.current) return;
    if (routeEmptyPlanningRef.current) return;
    routeEmptyPlanningRef.current = true;
    map.easeTo({
      center: userLngLat,
      zoom: regionalPlanningZoom(),
      pitch: 0,
      bearing: 0,
      padding: ZERO_MAP_PADDING,
      duration: 520,
      essential: true,
    });
  }, [mapReady, viewMode, routes.length, userLngLat]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || viewMode !== "route") return;
    if (routes.length > 0 || navigationStarted) return;
    if (userExploringRef.current) return;
    const u = userLngLatRef.current;
    if (!u || !destLngLat) return;
    const b = new mapboxgl.LngLatBounds();
    b.extend(u);
    b.extend(destLngLat);
    map.fitBounds(b, {
      padding: routeFitPadding(stormBarVisible, stormBarExpanded, [], null, progressRailVisible),
      maxZoom: ROUTE_VIEW_ROUTE_FIT_MAX_ZOOM,
      duration: 260,
      pitch: 0,
      bearing: 0,
      essential: true,
    });
  }, [
    mapReady,
    viewMode,
    routes.length,
    navigationStarted,
    destLngLat,
    fitTrigger,
    stormBarVisible,
    stormBarExpanded,
    progressRailVisible,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || viewMode !== "route" || routes.length > 0) return;
    if (recenterPlanningPuckTick === 0) return;
    const u = userLngLatRef.current;
    if (!u) return;
    userExploringRef.current = false;
    if (exploreTimerRef.current) {
      clearTimeout(exploreTimerRef.current);
      exploreTimerRef.current = null;
    }
    map.easeTo({
      center: u,
      zoom: Math.max(ROUTE_VIEW_PLANNING_STREET_ZOOM, map.getZoom()),
      pitch: 0,
      bearing: 0,
      padding: ZERO_MAP_PADDING,
      duration: 480,
      essential: true,
    });
    /* Intentionally omit userLngLat from deps — GPS updates must not re-fire this (only tick bumps). */
  }, [mapReady, viewMode, routes.length, recenterPlanningPuckTick]);

  useEffect(() => {
    if (viewMode !== "drive" || !navigationStarted) {
      driveCamBearingSmoothedRef.current = null;
    }
  }, [viewMode, navigationStarted]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || viewMode !== "route" || routes.length === 0) return;

    const forcePlanningFit = !navigationStarted;
    if (!navigationStarted && fitTrigger !== lastForcedPlanningFitTriggerRef.current) {
      lastForcedPlanningFitTriggerRef.current = fitTrigger;
      userExploringRef.current = false;
      if (exploreTimerRef.current) {
        clearTimeout(exploreTimerRef.current);
        exploreTimerRef.current = null;
      }
    }

    const flatten = () => {
      map.easeTo({ pitch: 0, bearing: 0, duration: 240, essential: true });
    };

    let pendingFlatten: (() => void) | null = null;

    const doPlanningFit = () => {
      if (userExploringRef.current && !forcePlanningFit) return;
      const u = userLngLatRef.current;
      if (pendingFlatten) {
        map.off("moveend", pendingFlatten);
        pendingFlatten = null;
      }
      fitMapToTrip(
        map,
        routes,
        u,
        destLngLat,
        {
          ...routeFitPadding(stormBarVisible, stormBarExpanded, routes, lineFocusId, progressRailVisible),
        },
        routeFitMaxZoomCeiling(routes, lineFocusId),
        {
          onAfterFit: flatten,
          onlyRouteId: lineFocusId,
          zoomBias: routeFitZoomBias(routes, lineFocusId),
        }
      );
    };

    const doNavRemainingFit = () => {
      if (userExploringRef.current) return;
      const u = userLngLatRef.current;
      if (!u || !destLngLat) {
        doPlanningFit();
        return;
      }
      if (pendingFlatten) {
        map.off("moveend", pendingFlatten);
        pendingFlatten = null;
      }
      pendingFlatten = () => {
        pendingFlatten = null;
        flatten();
      };
      map.once("moveend", pendingFlatten);
      fitMapToRemainingRoutes(
        map,
        routes,
        u,
        destLngLat,
        { ...routeFitPadding(stormBarVisible, stormBarExpanded, routes, lineFocusId, progressRailVisible) },
        routeFitMaxZoomCeiling(routes, lineFocusId),
        lineFocusId,
        routeFitZoomBias(routes, lineFocusId)
      );
    };

    let intervalId: ReturnType<typeof setInterval> | undefined;

    if (navigationStarted && destLngLat) {
      doNavRemainingFit();
      intervalId = setInterval(doNavRemainingFit, 2200);
    } else {
      doPlanningFit();
    }

    return () => {
      if (intervalId != null) clearInterval(intervalId);
      if (pendingFlatten) {
        map.off("moveend", pendingFlatten);
        pendingFlatten = null;
      }
    };
  }, [
    mapReady,
    fitTrigger,
    viewMode,
    routes,
    destLngLat,
    navigationStarted,
    mapResumeTick,
    stormBarVisible,
    stormBarExpanded,
    lineFocusId,
    progressRailVisible,
  ]);

  const canCameraFollow = Boolean(userLngLat && (navigationStarted || routes.length > 0));

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !userLngLat || !canCameraFollow) return;
    if (userExploringRef.current) return;

    if (viewMode === "drive") {
      const { padding, offset } = driveCameraEaseOptions(
        stormBarVisible,
        stormBarExpanded,
        progressRailVisible
      );
      const raw =
        driveRouteBearingDeg != null
          ? driveRouteBearingDeg
          : heading != null
            ? heading
            : map.getBearing();
      driveCamBearingSmoothedRef.current = smoothDriveBearingDeg(
        driveCamBearingSmoothedRef.current,
        raw,
        DRIVE_ROUTE_BEARING_SMOOTH
      );
      map.easeTo({
        center: userLngLat,
        zoom: 16.35,
        pitch: 58,
        bearing: driveCamBearingSmoothedRef.current,
        padding,
        offset,
        duration: 420,
        essential: true,
      });
    }
  }, [
    mapReady,
    viewMode,
    canCameraFollow,
    userLngLat,
    heading,
    driveRouteBearingDeg,
    navigationStarted,
    mapResumeTick,
    fitTrigger,
    stormBarVisible,
    stormBarExpanded,
    progressRailVisible,
  ]);

  /** On Go: clear "user exploring" so the drive camera is not stuck; nudge follow + size after nav chrome. */
  const wasNavRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady) return;
    if (navigationStarted && !wasNavRef.current) {
      userExploringRef.current = false;
      if (exploreTimerRef.current) {
        clearTimeout(exploreTimerRef.current);
        exploreTimerRef.current = null;
      }
      setMapResumeTick((n) => n + 1);
      if (map) {
        requestAnimationFrame(() => {
          try {
            map.resize();
          } catch {
            /* map disposed */
          }
        });
      }
    }
    wasNavRef.current = navigationStarted;
  }, [mapReady, navigationStarted]);

  /**
   * Rt / T / Dr: switching back to drive after top-down (or a layout shift) can leave the canvas
   * sized to a stale box — the puck and follow camera sit wrong until a resize. Double-rAF + bump
   * so {@link canCameraFollow} run re-runs after the real layout.
   */
  useEffect(() => {
    if (viewMode !== "drive" || !navigationStarted || !mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    const raf0 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          map.resize();
        } catch {
          /* map disposed */
        }
        setMapResumeTick((n) => n + 1);
      });
    });
    return () => cancelAnimationFrame(raf0);
  }, [viewMode, navigationStarted, mapReady]);

  /** Report map bearing while driving so the dock compass can keep N aligned with true north. */
  useEffect(() => {
    const map = mapRef.current;
    const report = onDriveCameraBearingDegRef.current;
    if (!map || !mapReady || !report) return;
    if (viewMode !== "drive" || !navigationStarted) {
      report(null);
      return;
    }
    let rafId = 0;
    const push = () => {
      rafId = 0;
      report(map.getBearing());
    };
    const schedule = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(push);
    };
    push();
    map.on("move", schedule);
    map.on("rotate", schedule);
    return () => {
      map.off("move", schedule);
      map.off("rotate", schedule);
      if (rafId) cancelAnimationFrame(rafId);
      report(null);
    };
  }, [mapReady, viewMode, navigationStarted]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !userLngLat || !canCameraFollow) return;

    if (viewMode !== "topdown") {
      prevTopdownRef.current = false;
      return;
    }

    if (userExploringRef.current) return;

    if (!prevTopdownRef.current) {
      prevTopdownRef.current = true;
      map.easeTo({
        center: userLngLat,
        zoom: topdownZoomRef.current,
        pitch: 0,
        bearing: 0,
        offset: TOPDOWN_PUCK_OFFSET_PX,
        duration: 0,
        essential: true,
      });
    } else {
      map.easeTo({
        center: userLngLat,
        offset: TOPDOWN_PUCK_OFFSET_PX,
        duration: 0,
        essential: true,
      });
    }
  }, [mapReady, viewMode, canCameraFollow, userLngLat, topdownZoomRef, mapResumeTick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const saveZoom = () => {
      if (viewMode === "topdown" && canCameraFollow) {
        topdownZoomRef.current = map.getZoom();
      }
    };
    map.on("zoomend", saveZoom);
    return () => {
      map.off("zoomend", saveZoom);
    };
  }, [mapReady, viewMode, canCameraFollow, topdownZoomRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const existing = savedMarkerMapRef.current;

    if (!savedPlacesVisible || savedPlaces.length === 0) {
      for (const { marker } of existing.values()) marker.remove();
      existing.clear();
      return;
    }

    const wantedIds = new Set(savedPlaces.map((p) => p.id));

    for (const [id, { marker }] of existing) {
      if (!wantedIds.has(id)) {
        marker.remove();
        existing.delete(id);
      }
    }

    for (const p of savedPlaces) {
      if (existing.has(p.id)) continue;
      const el = document.createElement("button");
      el.type = "button";
      el.className = "saved-place-dot";
      el.title = p.name;
      el.setAttribute("aria-label", `Saved: ${p.name}`);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        onSavedClickRef.current(p.id);
      });
      const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
        .setLngLat(p.lngLat)
        .addTo(map);
      existing.set(p.id, { marker, el });
    }

    const applyScale = () => {
      const { sizePx, borderPx } = savedPlaceDotSizeForZoom(map.getZoom());
      for (const { el } of existing.values()) {
        el.style.setProperty("--saved-place-dot-size", `${sizePx.toFixed(2)}px`);
        el.style.setProperty("--saved-place-dot-border", `${borderPx.toFixed(2)}px`);
      }
    };

    applyScale();
    map.on("zoom", applyScale);
    return () => {
      map.off("zoom", applyScale);
    };
  }, [mapReady, savedPlaces, savedPlacesVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const existing = searchPickMarkerMapRef.current;
    const markers = searchPickMarkers;
    const canClick = Boolean(onSearchPickMarkerClick);

    if (!markers?.length || !canClick) {
      for (const { marker } of existing.values()) marker.remove();
      existing.clear();
      return;
    }

    const wantedIds = new Set(markers.map((m) => m.id));
    for (const [id, { marker }] of existing) {
      if (!wantedIds.has(id)) {
        marker.remove();
        existing.delete(id);
      }
    }

    for (const m of markers) {
      if (existing.has(m.id)) continue;
      const el = document.createElement("button");
      el.type = "button";
      el.className = "map-search-pick-dot";
      el.title = m.label;
      el.setAttribute("aria-label", `Search result: ${m.label}`);
      const mid = m.id;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        onSearchPickMarkerClickRef.current?.(mid);
      });
      const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
        .setLngLat(m.lngLat)
        .addTo(map);
      existing.set(m.id, { marker, el });
    }

    const applyScale = () => {
      const z = map.getZoom();
      const s = Math.max(0.15, Math.min(1, (z - 2.5) / 12.5));
      for (const { el } of existing.values()) {
        el.style.transform = `scale(${s})`;
      }
    };

    applyScale();
    map.on("zoom", applyScale);
    return () => {
      map.off("zoom", applyScale);
    };
  }, [mapReady, searchPickMarkers, onSearchPickMarkerClick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const markers = searchPickMarkers;
    if (!markers || markers.length < 2) return;

    const b = new mapboxgl.LngLatBounds();
    for (const m of markers) b.extend(m.lngLat as [number, number]);
    const u = userLngLatRef.current;
    if (u) b.extend(u);

    const pad = isNarrowPhoneViewport()
      ? { top: 200, bottom: 200, left: 20, right: 88 }
      : { top: 160, bottom: 160, left: 28, right: 28 };
    map.fitBounds(b, { padding: pad, maxZoom: 14, duration: 480, essential: true });
    /* Intentionally not depending on userLngLat — GPS ticks would re-fit; ref has latest puck. */
  }, [mapReady, searchPickMarkers]);

  if (!token) {
    return (
      <div className="drive-map map-missing-token">
        <p>
          Add <code>VITE_MAPBOX_TOKEN</code> to <code>web/.env</code>.
        </p>
      </div>
    );
  }

  return <div ref={containerRef} className="drive-map" />;
}

export default DriveMap;
