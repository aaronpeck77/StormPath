import type { Map as MapboxMap } from "mapbox-gl";
import {
  bringRouteHitLayersToTop,
  bringRouteVisualLinesAboveTraffic,
} from "./mapRouteLayers";
import { positionWeatherAlertLayersAboveRadar } from "./mapWeatherAlertLayers";
import { positionRainViewerRadarUnderRoads } from "./mapRadarLayer";
import { bringMapboxTrafficLayersToFront } from "./mapTrafficLayers";

/** Mapbox traffic is moved to the top of the layer stack; route lines must be lifted above it again. */
export function liftTrafficThenRoutesThenHits(
  map: MapboxMap,
  routeIds: string[],
  layerPrefix = "route"
) {
  bringMapboxTrafficLayersToFront(map);
  positionWeatherAlertLayersAboveRadar(map);
  positionRainViewerRadarUnderRoads(map);
  bringRouteVisualLinesAboveTraffic(map, routeIds, layerPrefix);
  bringRouteHitLayersToTop(map, routeIds, layerPrefix);
}
