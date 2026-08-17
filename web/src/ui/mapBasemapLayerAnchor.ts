import type { AnyLayer, Map as MapboxMap } from "mapbox-gl";

/** Street-name layers in Mapbox Streets / Dark / Navigation. Prefer these over the first symbol. */
export const BASEMAP_ROAD_NAME_LAYER_IDS = [
  "road-label",
  "road-label-simple",
  "road-label-navigation",
] as const;

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

type StyleLayer = Pick<AnyLayer, "id" | "type"> & {
  source?: string;
  "source-layer"?: string;
};

/**
 * Mapbox road pavement (casings, fills, bridges). Not labels, arrows, or shields.
 * Streets-v12 draws these AFTER early symbol layers like `tunnel-oneway-arrow-blue`.
 */
export function isBasemapRoadPavementLayer(layer: StyleLayer): boolean {
  if (layer.type !== "line" && layer.type !== "fill") return false;
  if (isStormPathOverlayLayerId(layer.id)) return false;
  const id = layer.id.toLowerCase();
  if (id.includes("label") || id.includes("arrow") || id.includes("shield")) return false;
  if (id.includes("rail")) return false;
  if (layer["source-layer"] === "road") return true;
  return id.startsWith("road-") || id.startsWith("tunnel-") || id.startsWith("bridge-");
}

/**
 * Layer to insert route/traffic immediately under.
 * Must be the road-name stack — not the first symbol in the style. Streets-v12's first
 * symbol is `tunnel-oneway-arrow-blue`, which sits under the pavement; parking the
 * route there makes the blue line vanish at street zoom.
 */
export function firstBasemapSymbolLayerId(map: MapboxMap): string | undefined {
  const layers = (map.getStyle()?.layers ?? []) as StyleLayer[];
  for (const id of BASEMAP_ROAD_NAME_LAYER_IDS) {
    if (map.getLayer(id) && !isStormPathOverlayLayerId(id)) return id;
  }
  let lastPavement = -1;
  for (let i = 0; i < layers.length; i++) {
    if (isBasemapRoadPavementLayer(layers[i]!)) lastPavement = i;
  }
  for (let i = lastPavement + 1; i < layers.length; i++) {
    const layer = layers[i]!;
    if (layer.type === "symbol" && !isStormPathOverlayLayerId(layer.id)) return layer.id;
  }
  for (const layer of layers) {
    if (layer.type === "symbol" && !isStormPathOverlayLayerId(layer.id)) return layer.id;
  }
  return undefined;
}

/**
 * Insert `layerId` on the road pavement and under road names.
 * `moveLayer(id)` with no before-id would cover those names.
 */
export function moveLayerBelowBasemapLabels(map: MapboxMap, layerId: string): void {
  if (!map.getLayer(layerId)) return;
  const beforeId = firstBasemapSymbolLayerId(map);
  if (beforeId) map.moveLayer(layerId, beforeId);
  else map.moveLayer(layerId);
}
