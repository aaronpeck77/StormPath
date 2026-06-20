import type { GeoJSONSource, Map as MapboxMap } from "mapbox-gl";
import type { LngLat } from "../nav/types";

export const ROUTE_RECORDING_SRC = "route-recording-preview";
export const ROUTE_RECORDING_LAYER = "route-recording-preview-line";
export const ACTIVITY_TRAIL_SRC = "stormpath-activity-trail";
export const ACTIVITY_TRAIL_LAYER = "stormpath-activity-trail-dots";

export function syncRouteRecordingPreview(
  map: MapboxMap,
  lineCoords: LngLat[],
  onAfterChange: () => void
): void {
  if (lineCoords.length < 2) {
    if (map.getLayer(ROUTE_RECORDING_LAYER)) map.removeLayer(ROUTE_RECORDING_LAYER);
    if (map.getSource(ROUTE_RECORDING_SRC)) map.removeSource(ROUTE_RECORDING_SRC);
    onAfterChange();
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
    (map.getSource(ROUTE_RECORDING_SRC) as GeoJSONSource).setData(data);
  }
  onAfterChange();
}

export function syncActivityTrailOverlay(
  map: MapboxMap,
  data: GeoJSON.FeatureCollection | null | undefined,
  onAfterChange: () => void
): void {
  const ok = data && data.features?.length;
  if (!ok) {
    if (map.getLayer(ACTIVITY_TRAIL_LAYER)) map.removeLayer(ACTIVITY_TRAIL_LAYER);
    if (map.getSource(ACTIVITY_TRAIL_SRC)) map.removeSource(ACTIVITY_TRAIL_SRC);
    onAfterChange();
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
    (map.getSource(ACTIVITY_TRAIL_SRC) as GeoJSONSource).setData(data!);
  }
  onAfterChange();
}
