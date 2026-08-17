import type { Map as MapboxMap } from "mapbox-gl";
import {
  bringRouteHitLayersToTop,
  bringRouteVisualLinesAboveTraffic,
} from "./mapRouteLayers";
import { positionWeatherAlertLayersAboveRadar } from "./mapWeatherAlertLayers";
import { positionRainViewerRadarUnderRoads } from "./mapRadarLayer";
import { bringMapboxTrafficLayersToFront } from "./mapTrafficLayers";

/**
 * Restack overlays: traffic, then solid route lines, then invisible hit targets.
 * Basemap road names stay above the colored line so driving labels are not covered.
 */
export function liftTrafficThenRoutesThenHits(
  map: MapboxMap,
  routeIds: string[],
  layerPrefix = "route",
  lineFocusId?: string
) {
  bringMapboxTrafficLayersToFront(map);
  positionWeatherAlertLayersAboveRadar(map);
  positionRainViewerRadarUnderRoads(map);
  bringRouteVisualLinesAboveTraffic(map, routeIds, layerPrefix, lineFocusId);
  bringRouteHitLayersToTop(map, routeIds, layerPrefix, lineFocusId);
}
