import type { Map as MapboxMap, MapboxGeoJSONFeature, PointLike } from "mapbox-gl";
import type { LngLat } from "../nav/types";

export type SelectableMapPoi = {
  lngLat: LngLat;
  label: string;
};

function selectablePoiLayerIds(map: MapboxMap): string[] {
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

function featurePointLngLat(feature: MapboxGeoJSONFeature): LngLat | null {
  const geometry = feature.geometry as { type?: string; coordinates?: unknown } | null;
  if (geometry?.type !== "Point" || !Array.isArray(geometry.coordinates)) return null;
  const [lng, lat] = geometry.coordinates;
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  return [lng, lat];
}

function featureLabel(feature: MapboxGeoJSONFeature): string {
  const props = feature.properties as Record<string, unknown> | null;
  const label = props?.name_en ?? props?.name ?? props?.name_script;
  return typeof label === "string" && label.trim() ? label.trim() : "Map place";
}

export function selectablePoiAtPoint(map: MapboxMap, point: PointLike): SelectableMapPoi | null {
  const layers = selectablePoiLayerIds(map);
  if (layers.length === 0) return null;
  const feature = map.queryRenderedFeatures(point, { layers })[0];
  if (!feature) return null;
  const lngLat = featurePointLngLat(feature);
  if (!lngLat) return null;
  return { lngLat, label: featureLabel(feature) };
}
