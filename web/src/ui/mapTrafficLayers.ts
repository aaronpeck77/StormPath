import type { Map } from "mapbox-gl";

export const MAPBOX_TRAFFIC_LAYER_IDS = [
  "mapbox-traffic-congestion-mh",
  "mapbox-traffic-congestion-severe",
  "mapbox-traffic-closed",
] as const;

/**
 * Mapbox Traffic v1 — emphasize real slowdowns, not routine signal delays.
 * Moderate (often stoplights / urban noise) is hidden. Orange = heavy jam only;
 * red = severe; purple dashed = closed / construction-style closures.
 */
export function ensureMapboxTrafficConditionLayers(map: Map): void {
  if (map.getSource("mapbox-traffic")) return;

  map.addSource("mapbox-traffic", {
    type: "vector",
    url: "mapbox://mapbox.mapbox-traffic-v1",
  });

  const base = {
    type: "line" as const,
    source: "mapbox-traffic",
    "source-layer": "traffic",
  };

  const widthHeavy = ["interpolate", ["linear"], ["zoom"], 9, 1.4, 12, 2.6, 16, 5];

  map.addLayer({
    ...base,
    id: "mapbox-traffic-congestion-mh",
    filter: ["==", ["get", "congestion"], "heavy"],
    paint: {
      "line-width": widthHeavy as never,
      "line-opacity": 0.58,
      "line-color": "#c2410c",
    },
  });

  const widthSevere = ["interpolate", ["linear"], ["zoom"], 9, 2.2, 12, 3.4, 16, 6];

  map.addLayer({
    ...base,
    id: "mapbox-traffic-congestion-severe",
    filter: ["==", ["get", "congestion"], "severe"],
    paint: {
      "line-width": widthSevere as never,
      "line-opacity": 0.68,
      "line-color": "#dc2626",
    },
  });

  const widthClosed = ["interpolate", ["linear"], ["zoom"], 9, 3.5, 12, 6, 16, 9];

  map.addLayer({
    ...base,
    id: "mapbox-traffic-closed",
    filter: ["==", ["get", "closed"], "yes"],
    paint: {
      "line-width": widthClosed as never,
      "line-opacity": 1.0,
      "line-color": "#a855f7",
      "line-dasharray": [1.2, 0.8],
    },
  });
}

/** Show or hide Mapbox traffic condition line layers (after `ensureMapboxTrafficConditionLayers`). */
export function setMapboxTrafficLayersVisible(map: Map, visible: boolean): void {
  const vis = visible ? "visible" : "none";
  for (const id of MAPBOX_TRAFFIC_LAYER_IDS) {
    if (!map.getLayer(id)) continue;
    try {
      map.setLayoutProperty(id, "visibility", vis);
    } catch {
      /* style race */
    }
  }
}

/** Route lines are added after traffic; move traffic back on top so it's visible. */
export function bringMapboxTrafficLayersToFront(map: Map): void {
  for (const id of MAPBOX_TRAFFIC_LAYER_IDS) {
    if (!map.getLayer(id)) continue;
    try {
      map.moveLayer(id);
    } catch {
      /* ignore */
    }
  }
}
