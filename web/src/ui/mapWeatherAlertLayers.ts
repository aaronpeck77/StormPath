import type {
  DataDrivenPropertyValueSpecification,
  FillLayer,
  GeoJSONSource,
  LineLayer,
  Map as MapboxMap,
  SymbolLayer,
} from "mapbox-gl";

import { nwsMapKindHex, nwsMapKindFromEvent, type NwsMapKind } from "../weatherAlerts/nwsMapKind";

const SRC = "weather-alerts-nws";
const FILL = "weather-alerts-nws-fill";
const LINE = "weather-alerts-nws-outline";

const MOTION_SRC = "weather-alerts-motion";
const MOTION_LAYER = "weather-alerts-motion-arrows";
const MOTION_LABEL_SRC = "weather-alerts-motion-labels";
const MOTION_LABEL_LAYER = "weather-alerts-motion-labels-text";

/** Hit-test layer for hover / identify (fill has the polygon area). */
export const WEATHER_ALERTS_NWS_FILL_LAYER_ID = FILL;

/**
 * Rt / Mp (and planning): hide county-scale NWS fills once zoomed in past regional view.
 * Layer is visible below this zoom; at zoom ≥ this value it is hidden (Mapbox `maxzoom`).
 */
export const NWS_POLYGON_MAP_MAX_ZOOM = 10.75;

/**
 * Severity-tiered rendering — Tornado Warnings / Extreme alerts punch through at full
 * weight; lesser advisories (watches, minor) fade to the background so the storm front
 * stays readable at a glance while driving.
 *
 * Extreme  → Tornado Warning, Extreme Wind Warning, etc.     full opacity + thick line + subtle fill
 * Severe   → Severe Thunderstorm Warning, Flash Flood Warning full opacity, normal line
 * Moderate → Flash Flood Watch, Winter Storm Watch, etc.      25% — clearly secondary
 * Minor    → Wind Advisory, Frost Advisory, etc.              10% — barely visible
 */
const NWS_LINE_OPACITY_EXPR: unknown = [
  "match",
  ["get", "severity"],
  "Extreme", 0.85,
  "Severe",  0.65,
  "Moderate", 0.20,
  /* Minor + fallback */ 0.08,
];

const NWS_LINE_WIDTH_EXPR: unknown = [
  "match",
  ["get", "severity"],
  "Extreme", 1.6,
  "Severe",  1.0,
  "Moderate", 0.7,
  /* Minor + fallback */ 0.5,
];

/** Subtle area fill only on Extreme (tornado) polygons so they stand out. */
const NWS_FILL_OPACITY_EXPR: unknown = [
  "match",
  ["get", "severity"],
  "Extreme", 0.09,
  /* all others stay 0 — hit-test only */ 0,
];

const NWS_KIND_ORDER: NwsMapKind[] = [
  "hydro",
  "winter",
  "fire",
  "convective",
  "marine",
  "wind",
  "heat",
  "vis",
];

/** When `kind` is absent or `other`, fall back to severity palette (same as pre-kind behavior). */
const NWS_SEVERITY_COLOR_MATCH: unknown[] = [
  "match",
  ["get", "severity"],
  "Extreme",
  "#991b1b",
  "Severe",
  "#ea580c",
  "Moderate",
  "#ca8a04",
  "Minor",
  "#64748b",
  "#94a3b8",
];

function nwsAlertMapColorExpr(): unknown {
  const kindPairs: unknown[] = [];
  for (const k of NWS_KIND_ORDER) {
    kindPairs.push(k, nwsMapKindHex(k));
  }
  return [
    "case",
    ["any", ["!", ["has", "kind"]], ["==", ["get", "kind"], "other"]],
    NWS_SEVERITY_COLOR_MATCH,
    ["match", ["get", "kind"], ...kindPairs, NWS_SEVERITY_COLOR_MATCH],
  ];
}

function syncNwsPolygonPaint(map: MapboxMap): void {
  if (map.getLayer(FILL)) {
    map.setPaintProperty(FILL, "fill-opacity", NWS_FILL_OPACITY_EXPR as DataDrivenPropertyValueSpecification<number>);
    try {
      map.setPaintProperty(FILL, "fill-opacity-transition", { duration: 0, delay: 0 });
    } catch {
      /* style race */
    }
  }
  if (map.getLayer(LINE)) {
    map.setPaintProperty(LINE, "line-width", NWS_LINE_WIDTH_EXPR as DataDrivenPropertyValueSpecification<number>);
    map.setPaintProperty(LINE, "line-opacity", NWS_LINE_OPACITY_EXPR as DataDrivenPropertyValueSpecification<number>);
    try {
      map.setPaintProperty(LINE, "line-opacity-transition", { duration: 0, delay: 0 });
    } catch {
      /* style race */
    }
  }
}

function syncNwsPolygonZoomRange(map: MapboxMap): void {
  const max = NWS_POLYGON_MAP_MAX_ZOOM;
  for (const id of [FILL, LINE, MOTION_LAYER, MOTION_LABEL_LAYER] as const) {
    if (map.getLayer(id)) {
      try {
        map.setLayerZoomRange(id, 0, max);
      } catch {
        /* style race */
      }
    }
  }
}

function firstVisibleRouteLineId(map: MapboxMap): string | undefined {
  const layers = map.getStyle()?.layers;
  if (!layers) return undefined;
  for (const l of layers) {
    if (l.id.startsWith("route-") && l.id.endsWith("-line") && !l.id.includes("-hit")) return l.id;
  }
  return undefined;
}

/**
 * Place warning outlines above radar and under route lines (outline-only — no fill washout).
 */
export function positionWeatherAlertLayersAboveRadar(map: MapboxMap): void {
  if (!map.getLayer(FILL)) return;
  const beforeRoute = firstVisibleRouteLineId(map);
  if (!beforeRoute) return;
  try {
    map.moveLayer(FILL, beforeRoute);
    if (map.getLayer(LINE)) map.moveLayer(LINE, beforeRoute);
    if (map.getLayer(MOTION_LAYER)) map.moveLayer(MOTION_LAYER, beforeRoute);
    if (map.getLayer(MOTION_LABEL_LAYER)) map.moveLayer(MOTION_LABEL_LAYER, beforeRoute);
  } catch {
    /* style race */
  }
}

/** @deprecated Prefer {@link positionWeatherAlertLayersAboveRadar}. */
export function positionWeatherAlertLayersBelowRadar(map: MapboxMap): void {
  positionWeatherAlertLayersAboveRadar(map);
}

// ─── Storm motion arrow geometry ─────────────────────────────────────────────

/** Project a point forward by distance along a compass bearing (spherical). */
function destinationPoint(
  lng: number,
  lat: number,
  bearingDeg: number,
  distanceM: number
): [number, number] {
  const R = 6371000;
  const d = distanceM / R;
  const b = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
  return [(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

/** Mean of the outer ring of a Polygon. */
function polygonCentroid(coords: GeoJSON.Position[][]): [number, number] {
  const ring = coords[0] ?? [];
  if (!ring.length) return [0, 0];
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0]!;
    y += p[1]!;
  }
  return [x / ring.length, y / ring.length];
}

function geometryCentroid(g: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number] {
  if (g.type === "Polygon") return polygonCentroid(g.coordinates);
  return polygonCentroid(g.coordinates[0] ?? [[]]);
}

/**
 * Build shaft + arrowhead LineStrings for one storm motion vector.
 * Shaft length scales with speed; arrowhead is 28% of shaft at ±38°.
 */
function stormMotionArrowLines(
  centroid: [number, number],
  bearingDeg: number,
  speedMph: number,
  color: string
): GeoJSON.Feature<GeoJSON.LineString>[] {
  const shaftM = 38000 + speedMph * 700; // ~38 km base + 0.7 km/mph
  const headM = shaftM * 0.28;
  const [lng, lat] = centroid;

  const tip = destinationPoint(lng, lat, bearingDeg, shaftM);
  const leftWing = destinationPoint(
    tip[0], tip[1], (bearingDeg + 180 - 38 + 360) % 360, headM
  );
  const rightWing = destinationPoint(
    tip[0], tip[1], (bearingDeg + 180 + 38) % 360, headM
  );

  const props = { arrowColor: color };
  return [
    { type: "Feature", properties: props, geometry: { type: "LineString", coordinates: [centroid, tip] } },
    { type: "Feature", properties: props, geometry: { type: "LineString", coordinates: [leftWing, tip] } },
    { type: "Feature", properties: props, geometry: { type: "LineString", coordinates: [rightWing, tip] } },
  ];
}

function cardinalLabel(bearingDeg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(bearingDeg / 45) % 8]!;
}

function nwsMotionLabel(motionDeg: number, motionMph: number): string {
  return `${Math.round(motionMph)} mph ${cardinalLabel(motionDeg)}`;
}

/** Build arrow GeoJSON from polygon features that carry motionDeg + motionMph properties. */
function buildMotionArrowCollection(
  collection: GeoJSON.FeatureCollection
): { arrows: GeoJSON.FeatureCollection; labels: GeoJSON.FeatureCollection } {
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  const labels: GeoJSON.Feature<GeoJSON.Point>[] = [];

  for (const f of collection.features) {
    const props = f.properties as Record<string, unknown> | null;
    if (!props) continue;
    const motionDeg = typeof props.motionDeg === "number" ? props.motionDeg : null;
    const motionMph = typeof props.motionMph === "number" ? props.motionMph : null;
    if (motionDeg == null || motionMph == null) continue;
    const g = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;

    const kind = typeof props.kind === "string" ? props.kind : "other";
    const event = typeof props.event === "string" ? props.event : "";
    const severity = typeof props.severity === "string" ? props.severity : "";
    const color = nwsMapKindHex(nwsMapKindFromEvent(event) !== "other"
      ? nwsMapKindFromEvent(event)
      : kind as NwsMapKind);

    // Match arrow opacity to polygon opacity so lesser alerts don't add arrow clutter.
    const arrowOpacity =
      severity === "Extreme" ? 0.95 :
      severity === "Severe"  ? 0.88 :
      severity === "Moderate" ? 0.22 : 0.10;

    const centroid = geometryCentroid(g);
    const shaftM = 38000 + motionMph * 700;
    const tip = destinationPoint(centroid[0], centroid[1], motionDeg, shaftM);
    features.push(...stormMotionArrowLines(centroid, motionDeg, motionMph, color).map(af => ({
      ...af,
      properties: { ...af.properties, arrowOpacity },
    })));
    labels.push({
      type: "Feature",
      properties: { label: nwsMotionLabel(motionDeg, motionMph), labelColor: color, arrowOpacity },
      geometry: { type: "Point", coordinates: tip },
    });
  }

  return {
    arrows: { type: "FeatureCollection", features },
    labels: { type: "FeatureCollection", features: labels },
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Only render map polygons for convective alerts and Severe/Extreme warnings.
 * Minor advisories stay in the advisory list but are too area-heavy for the map.
 *
 * Hydro (flood) events are deliberately more restrictive: county-scale Flood Warnings
 * cover enormous areas and obscure the map. Only Flash Flood Warning/Emergency at
 * Severe+ earns a polygon — mirrors the same rule used on the progress strip.
 * Regular Flood Warning / Watch / Advisory remain in the advisory list only.
 */
function isMapRenderableAlert(props: Record<string, unknown>): boolean {
  const kind = typeof props.kind === "string" ? props.kind : "other";
  const severity = typeof props.severity === "string" ? props.severity : "";
  const event = typeof props.event === "string" ? props.event : "";

  if (kind === "hydro") {
    // Flash Flood Warning or Flash Flood Emergency at Severe+ only.
    return /flash\s+flood/i.test(event) && (severity === "Extreme" || severity === "Severe");
  }

  return kind === "convective" || severity === "Extreme" || severity === "Severe";
}

const EMPTY_ALERT_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * Draw NWS warning outlines (no fill) + storm motion arrows under radar / route lines.
 * Arrows are derived from `motionDeg` / `motionMph` properties embedded in features
 * (Severe Thunderstorm and Tornado warnings only — other products have no motion data).
 */
export function applyWeatherAlertLayers(
  map: MapboxMap,
  collection: GeoJSON.FeatureCollection | null
): void {
  if (import.meta.env.DEV) {
    console.log("[applyWeatherAlertLayers] raw features:", collection?.features?.length ?? "null");
  }
  const beforeId = firstVisibleRouteLineId(map);

  // Treat null as empty — keep layers alive so Mapbox doesn't tear down and
  // rebuild the WebGL buffers every time the collection flips to/from null
  // (which caused repeated GL_INVALID_OPERATION errors).
  const effective = collection ?? EMPTY_ALERT_FC;

  // Only render convective + Extreme alerts as map polygons — the rest are
  // available in the advisory list but too area-heavy to show on the map.
  const mapRenderable: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: effective.features.filter((f) =>
      isMapRenderableAlert((f.properties ?? {}) as Record<string, unknown>)
    ),
  };
  const hasFeatures = mapRenderable.features.length > 0;
  if (import.meta.env.DEV) {
    const kinds = mapRenderable.features.map(
      (f) => `${(f.properties as Record<string, unknown>)?.event ?? "?"}(${(f.properties as Record<string, unknown>)?.kind ?? "?"})`
    );
    console.log(`[applyWeatherAlertLayers] after filter: ${mapRenderable.features.length}`, kinds);
  }

  // ── Invisible hit area + visible outline ───────────────────────────────────
  if (!hasFeatures) {
    const src = map.getSource(SRC) as GeoJSONSource | undefined;
    if (src) src.setData(EMPTY_ALERT_FC);
    syncNwsPolygonPaint(map);
    removeMotionArrows(map);
    return;
  }

  if (!map.getSource(SRC)) {
    map.addSource(SRC, { type: "geojson", data: mapRenderable });
    const fillLayer: FillLayer = {
      id: FILL,
      type: "fill",
      source: SRC,
      maxzoom: NWS_POLYGON_MAP_MAX_ZOOM,
      paint: {
        "fill-color": nwsAlertMapColorExpr() as DataDrivenPropertyValueSpecification<string>,
        "fill-opacity": NWS_FILL_OPACITY_EXPR as DataDrivenPropertyValueSpecification<number>,
        "fill-antialias": false,
      },
    };
    const lineLayer: LineLayer = {
      id: LINE,
      type: "line",
      source: SRC,
      maxzoom: NWS_POLYGON_MAP_MAX_ZOOM,
      paint: {
        "line-color": nwsAlertMapColorExpr() as DataDrivenPropertyValueSpecification<string>,
        "line-width": NWS_LINE_WIDTH_EXPR as DataDrivenPropertyValueSpecification<number>,
        "line-opacity": NWS_LINE_OPACITY_EXPR as DataDrivenPropertyValueSpecification<number>,
      },
      layout: { "line-join": "round", "line-cap": "round" },
    };
    if (beforeId) {
      map.addLayer(fillLayer, beforeId);
      map.addLayer(lineLayer, beforeId);
    } else {
      map.addLayer(fillLayer);
      map.addLayer(lineLayer);
    }
  } else {
    (map.getSource(SRC) as GeoJSONSource).setData(mapRenderable);
    syncNwsPolygonPaint(map);
    syncNwsPolygonZoomRange(map);
  }

  // ── Storm motion arrows ──────────────────────────────────────────────────
  const motion = buildMotionArrowCollection(mapRenderable);
  if (motion.arrows.features.length > 0) {
    applyMotionArrows(map, motion.arrows, motion.labels, beforeId);
  } else {
    removeMotionArrows(map);
  }

  syncNwsPolygonZoomRange(map);
  syncNwsPolygonPaint(map);
  positionWeatherAlertLayersAboveRadar(map);
}

function applyMotionArrows(
  map: MapboxMap,
  arrows: GeoJSON.FeatureCollection,
  labels: GeoJSON.FeatureCollection,
  beforeId: string | undefined
): void {
  if (!map.getSource(MOTION_SRC)) {
    map.addSource(MOTION_SRC, { type: "geojson", data: arrows });
    const arrowLayer: LineLayer = {
      id: MOTION_LAYER,
      type: "line",
      source: MOTION_SRC,
      maxzoom: NWS_POLYGON_MAP_MAX_ZOOM,
      paint: {
        "line-color": ["get", "arrowColor"] as unknown as DataDrivenPropertyValueSpecification<string>,
        "line-width": 3.5,
        /* Only show motion arrows for Extreme/Severe features — they're the ones that matter. */
        "line-opacity": ["coalesce", ["get", "arrowOpacity"], 0.95] as unknown as DataDrivenPropertyValueSpecification<number>,
      },
      layout: { "line-cap": "round", "line-join": "round" },
    };
    if (beforeId) {
      map.addLayer(arrowLayer, beforeId);
    } else {
      map.addLayer(arrowLayer);
    }
  } else {
    (map.getSource(MOTION_SRC) as GeoJSONSource).setData(arrows);
  }

  if (!map.getSource(MOTION_LABEL_SRC)) {
    map.addSource(MOTION_LABEL_SRC, { type: "geojson", data: labels });
    const labelLayer: SymbolLayer = {
      id: MOTION_LABEL_LAYER,
      type: "symbol",
      source: MOTION_LABEL_SRC,
      maxzoom: NWS_POLYGON_MAP_MAX_ZOOM,
      layout: {
        "text-field": ["get", "label"],
        "text-size": 11,
        "text-offset": [0, -1.1],
        "text-anchor": "bottom",
        "text-max-width": 12,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": ["get", "labelColor"] as unknown as DataDrivenPropertyValueSpecification<string>,
        "text-opacity": ["coalesce", ["get", "arrowOpacity"], 0.95] as unknown as DataDrivenPropertyValueSpecification<number>,
        "text-halo-color": "rgba(15, 23, 42, 0.88)",
        "text-halo-width": 1.4,
      },
    };
    if (beforeId) map.addLayer(labelLayer, beforeId);
    else map.addLayer(labelLayer);
  } else {
    (map.getSource(MOTION_LABEL_SRC) as GeoJSONSource).setData(labels);
  }
}

function removeMotionArrows(map: MapboxMap): void {
  if (map.getLayer(MOTION_LABEL_LAYER)) map.removeLayer(MOTION_LABEL_LAYER);
  if (map.getLayer(MOTION_LAYER)) map.removeLayer(MOTION_LAYER);
  if (map.getSource(MOTION_LABEL_SRC)) map.removeSource(MOTION_LABEL_SRC);
  if (map.getSource(MOTION_SRC)) map.removeSource(MOTION_SRC);
}
