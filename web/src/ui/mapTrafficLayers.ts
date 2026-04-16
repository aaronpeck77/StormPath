import type { Map } from "mapbox-gl";

export const MAPBOX_TRAFFIC_LAYER_IDS = [
  "mapbox-traffic-congestion-mh",
  "mapbox-traffic-congestion-severe",
  "mapbox-traffic-closed",
] as const;

/**
 * Mapbox Traffic v1 — only slowdowns and closures (no free-flow / low-congestion paint).
 * Yellow = moderate, orange = heavy, red = severe, purple dashed = closed.
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

  const width = ["interpolate", ["linear"], ["zoom"], 9, 1.8, 12, 3, 16, 6];

  map.addLayer({
    ...base,
    id: "mapbox-traffic-congestion-mh",
    filter: [
      "match",
      ["get", "congestion"],
      "moderate",
      true,
      "heavy",
      true,
      false,
    ],
    paint: {
      "line-width": width as never,
      "line-opacity": 0.8,
      "line-color": [
        "match",
        ["get", "congestion"],
        "moderate",
        "#eab308",
        "heavy",
        "#ea580c",
        "#eab308",
      ],
    },
  });

  const widthSevere = ["interpolate", ["linear"], ["zoom"], 9, 3, 12, 4.5, 16, 8];

  map.addLayer({
    ...base,
    id: "mapbox-traffic-congestion-severe",
    filter: ["==", ["get", "congestion"], "severe"],
    paint: {
      "line-width": widthSevere as never,
      "line-opacity": 0.9,
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
