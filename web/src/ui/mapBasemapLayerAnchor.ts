import type { Map as MapboxMap } from "mapbox-gl";

/** StormPath overlays — skip these when looking for Mapbox road-name / POI symbol layers. */
export function isStormPathOverlayLayerId(id: string): boolean {
  return (
    id.startsWith("route-") ||
    id.startsWith("pip-route-") ||
    id.includes("rainviewer") ||
    id.startsWith("weather-alerts") ||
    id.startsWith("radar-storm-motion") ||
    id === "3d-buildings" ||
    id.startsWith("mapbox-traffic")
  );
}

/**
 * First Mapbox label/icon layer (road names, shields, POIs).
 * Route lines and traffic sit immediately under this so names paint on top of a solid line.
 */
export function firstBasemapSymbolLayerId(map: MapboxMap): string | undefined {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type === "symbol" && !isStormPathOverlayLayerId(layer.id)) return layer.id;
  }
  return undefined;
}

/**
 * Insert `layerId` just below basemap labels. If the style has no symbol layers, lift to the top.
 * `moveLayer(id)` with no before-id would cover road names — do not use that when labels exist.
 */
export function moveLayerBelowBasemapLabels(map: MapboxMap, layerId: string): void {
  if (!map.getLayer(layerId)) return;
  const beforeId = firstBasemapSymbolLayerId(map);
  if (beforeId) map.moveLayer(layerId, beforeId);
  else map.moveLayer(layerId);
}
