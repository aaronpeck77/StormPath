import type { GeoJSONSource, LineLayer, Map as MapboxMap, SymbolLayer } from "mapbox-gl";
import {
  formatRadarMotionLabel,
  type RadarStormMotion,
} from "../services/radarStormMotion";

const ARROW_SRC = "radar-storm-motion-arrows";
const ARROW_LAYER = "radar-storm-motion-arrows-line";
const LABEL_SRC = "radar-storm-motion-labels";
const LABEL_LAYER = "radar-storm-motion-labels-text";

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
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
  return [(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

function arrowColor(intensity: number): string {
  if (intensity >= 0.72) return "#b91c1c";
  if (intensity >= 0.58) return "#ea580c";
  return "#f59e0b";
}

function motionToGeoJson(motions: RadarStormMotion[]): {
  arrows: GeoJSON.FeatureCollection;
  labels: GeoJSON.FeatureCollection;
} {
  const arrowFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  const labelFeatures: GeoJSON.Feature<GeoJSON.Point>[] = [];

  for (const m of motions) {
    const color = arrowColor(m.intensity);
    /* Short shaft from core — motion continues **out of** the red/white cell, not across green fringe. */
    const shaftM = Math.min(48_000, 18_000 + (m.speedMph ?? 22) * 420);
    const headM = shaftM * 0.28;
    const [lng, lat] = [m.lng, m.lat];
    const tip = destinationPoint(lng, lat, m.bearingDeg, shaftM);
    const leftWing = destinationPoint(
      tip[0],
      tip[1],
      (m.bearingDeg + 180 - 38 + 360) % 360,
      headM
    );
    const rightWing = destinationPoint(tip[0], tip[1], (m.bearingDeg + 180 + 38) % 360, headM);
    const props = { arrowColor: color };
    arrowFeatures.push(
      { type: "Feature", properties: props, geometry: { type: "LineString", coordinates: [[lng, lat], tip] } },
      { type: "Feature", properties: props, geometry: { type: "LineString", coordinates: [leftWing, tip] } },
      { type: "Feature", properties: props, geometry: { type: "LineString", coordinates: [rightWing, tip] } }
    );
    labelFeatures.push({
      type: "Feature",
      properties: { label: formatRadarMotionLabel(m), labelColor: color },
      geometry: { type: "Point", coordinates: tip },
    });
  }

  return {
    arrows: { type: "FeatureCollection", features: arrowFeatures },
    labels: { type: "FeatureCollection", features: labelFeatures },
  };
}

function firstVisibleRouteLineId(map: MapboxMap): string | undefined {
  const layers = map.getStyle()?.layers;
  if (!layers) return undefined;
  for (const l of layers) {
    if (l.id.startsWith("route-") && l.id.endsWith("-line") && !l.id.includes("-hit")) return l.id;
  }
  return undefined;
}

export function removeRadarMotionLayers(map: MapboxMap): void {
  if (map.getLayer(LABEL_LAYER)) map.removeLayer(LABEL_LAYER);
  if (map.getLayer(ARROW_LAYER)) map.removeLayer(ARROW_LAYER);
  if (map.getSource(LABEL_SRC)) map.removeSource(LABEL_SRC);
  if (map.getSource(ARROW_SRC)) map.removeSource(ARROW_SRC);
}

/** Draw motion arrows + speed/time labels for the strongest radar echoes. */
export function applyRadarMotionLayers(map: MapboxMap, motions: RadarStormMotion[] | null): void {
  const beforeId = firstVisibleRouteLineId(map);
  if (!motions?.length) {
    removeRadarMotionLayers(map);
    return;
  }

  const { arrows, labels } = motionToGeoJson(motions);

  if (!map.getSource(ARROW_SRC)) {
    map.addSource(ARROW_SRC, { type: "geojson", data: arrows });
    const arrowLayer: LineLayer = {
      id: ARROW_LAYER,
      type: "line",
      source: ARROW_SRC,
      paint: {
        "line-color": ["get", "arrowColor"],
        "line-width": 3.5,
        "line-opacity": 0.92,
      },
      layout: { "line-cap": "round", "line-join": "round" },
    };
    if (beforeId) map.addLayer(arrowLayer, beforeId);
    else map.addLayer(arrowLayer);
  } else {
    (map.getSource(ARROW_SRC) as GeoJSONSource).setData(arrows);
  }

  if (!map.getSource(LABEL_SRC)) {
    map.addSource(LABEL_SRC, { type: "geojson", data: labels });
    const labelLayer: SymbolLayer = {
      id: LABEL_LAYER,
      type: "symbol",
      source: LABEL_SRC,
      layout: {
        "text-field": ["get", "label"],
        "text-size": 11,
        "text-offset": [0, -1.1],
        "text-anchor": "bottom",
        "text-max-width": 14,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": ["get", "labelColor"],
        "text-halo-color": "rgba(15, 23, 42, 0.88)",
        "text-halo-width": 1.4,
      },
    };
    if (beforeId) map.addLayer(labelLayer, beforeId);
    else map.addLayer(labelLayer);
  } else {
    (map.getSource(LABEL_SRC) as GeoJSONSource).setData(labels);
  }

  try {
    if (map.getLayer(ARROW_LAYER) && beforeId) map.moveLayer(ARROW_LAYER, beforeId);
    if (map.getLayer(LABEL_LAYER) && beforeId) map.moveLayer(LABEL_LAYER, beforeId);
  } catch {
    /* style race */
  }
}
