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

function firstVisibleRouteLineId(map: MapboxMap): string | undefined {
  const layers = map.getStyle()?.layers;
  if (!layers) return undefined;
  for (const l of layers) {
    if (l.id.startsWith("route-") && l.id.endsWith("-line") && !l.id.includes("-hit")) return l.id;
  }
  return undefined;
}

/** Place warning polygons directly under route lines (above radar and traffic). */
export function positionWeatherAlertLayersAboveRadar(map: MapboxMap): void {
  if (!map.getLayer(FILL)) return;
  const beforeRoute = firstVisibleRouteLineId(map);
  if (!beforeRoute) return;
  try {
    map.moveLayer(FILL, beforeRoute);
    if (map.getLayer(LINE)) map.moveLayer(LINE, FILL);
    if (map.getLayer(MOTION_LAYER)) map.moveLayer(MOTION_LAYER, FILL);
  } catch {
    /* style race */
  }
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
    const color = nwsMapKindHex(nwsMapKindFromEvent(event) !== "other"
      ? nwsMapKindFromEvent(event)
      : kind as NwsMapKind);

    const centroid = geometryCentroid(g);
    const shaftM = 38000 + motionMph * 700;
    const tip = destinationPoint(centroid[0], centroid[1], motionDeg, shaftM);
    features.push(...stormMotionArrowLines(centroid, motionDeg, motionMph, color));
    labels.push({
      type: "Feature",
      properties: { label: nwsMotionLabel(motionDeg, motionMph), labelColor: color },
      geometry: { type: "Point", coordinates: tip },
    });
  }

  return {
    arrows: { type: "FeatureCollection", features },
    labels: { type: "FeatureCollection", features: labels },
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

const EMPTY_ALERT_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * Draw NWS warning polygons + storm motion arrows under route lines.
 * Arrows are derived from `motionDeg` / `motionMph` properties embedded in features
 * (Severe Thunderstorm and Tornado warnings only — other products have no motion data).
 */
export function applyWeatherAlertLayers(
  map: MapboxMap,
  collection: GeoJSON.FeatureCollection | null
): void {
  if (import.meta.env.DEV) {
    console.log("[applyWeatherAlertLayers] features:", collection?.features?.length ?? "null");
  }
  const beforeId = firstVisibleRouteLineId(map);

  // Treat null as empty — keep layers alive so Mapbox doesn't tear down and
  // rebuild the WebGL buffers every time the collection flips to/from null
  // (which caused repeated GL_INVALID_OPERATION errors).
  const effective = collection ?? EMPTY_ALERT_FC;
  const hasFeatures = effective.features.length > 0;

  // ── Polygon fill + outline ───────────────────────────────────────────────
  if (!hasFeatures) {
    const src = map.getSource(SRC) as GeoJSONSource | undefined;
    if (src) src.setData(EMPTY_ALERT_FC);
    removeMotionArrows(map);
    return;
  }

  if (!map.getSource(SRC)) {
    map.addSource(SRC, { type: "geojson", data: effective });
    const fillLayer: FillLayer = {
      id: FILL,
      type: "fill",
      source: SRC,
      paint: {
        "fill-color": nwsAlertMapColorExpr() as DataDrivenPropertyValueSpecification<string>,
        "fill-opacity": 0.38,
        "fill-opacity-transition": { duration: 280, delay: 0 },
      },
    };
    const lineLayer: LineLayer = {
      id: LINE,
      type: "line",
      source: SRC,
      paint: {
        "line-color": nwsAlertMapColorExpr() as DataDrivenPropertyValueSpecification<string>,
        "line-width": 3,
        "line-opacity": 0.95,
        "line-opacity-transition": { duration: 280, delay: 0 },
      },
    };
    if (beforeId) {
      map.addLayer(fillLayer, beforeId);
      map.addLayer(lineLayer, beforeId);
    } else {
      map.addLayer(fillLayer);
      map.addLayer(lineLayer);
    }
  } else {
    (map.getSource(SRC) as GeoJSONSource).setData(effective);
  }

  // ── Storm motion arrows ──────────────────────────────────────────────────
  const motion = buildMotionArrowCollection(effective);
  if (motion.arrows.features.length > 0) {
    applyMotionArrows(map, motion.arrows, motion.labels, beforeId);
  } else {
    removeMotionArrows(map);
  }

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
      paint: {
        "line-color": ["get", "arrowColor"] as unknown as DataDrivenPropertyValueSpecification<string>,
        "line-width": 3.5,
        "line-opacity": 0.95,
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
