import { useEffect, type RefObject } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import type { LngLat, NavRoute } from "../nav/types";
import { visibleRouteIdsForHitLayers } from "./mapRouteLayers";
import { liftTrafficThenRoutesThenHits } from "./mapLayerStack";
import {
  syncActivityTrailOverlay,
  syncRouteRecordingPreview,
} from "./mapGeoJsonOverlays";
import type { MapViewMode } from "./driveMapTypes";

export type UseMapGeoJsonOverlaysDeps = {
  mapRef: RefObject<MapboxMap | null>;
  mapReady: boolean;
  recordingGeometry: LngLat[] | undefined;
  userLngLat: LngLat | null;
  activityTrailGeoJson: GeoJSON.FeatureCollection | null | undefined;
  routes: NavRoute[];
  lineFocusId: string;
  viewMode: MapViewMode;
  navigationStarted: boolean;
};

export function useMapGeoJsonOverlays(deps: UseMapGeoJsonOverlaysDeps): void {
  const {
    mapRef,
    mapReady,
    recordingGeometry,
    userLngLat,
    activityTrailGeoJson,
    routes,
    lineFocusId,
    viewMode,
    navigationStarted,
  } = deps;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const liftHits = () => {
      liftTrafficThenRoutesThenHits(
        map,
        visibleRouteIdsForHitLayers(routes, lineFocusId, viewMode, false)
      );
    };

    const sync = () => {
      const g = recordingGeometry;
      const lineCoords: LngLat[] =
        g && g.length >= 2
          ? g
          : g && g.length === 1 && userLngLat
            ? [g[0]!, [userLngLat[0], userLngLat[1]]]
            : [];
      syncRouteRecordingPreview(map, lineCoords, liftHits);
    };

    if (map.isStyleLoaded()) sync();
    else map.once("load", sync);
  }, [mapRef, mapReady, recordingGeometry, userLngLat, routes, lineFocusId, navigationStarted, viewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const liftHits = () => {
      liftTrafficThenRoutesThenHits(
        map,
        visibleRouteIdsForHitLayers(routes, lineFocusId, viewMode, false)
      );
    };

    const sync = () => {
      syncActivityTrailOverlay(map, activityTrailGeoJson, liftHits);
    };

    if (map.isStyleLoaded()) sync();
    else map.once("load", sync);
  }, [
    mapRef,
    mapReady,
    activityTrailGeoJson,
    routes,
    lineFocusId,
    navigationStarted,
    viewMode,
  ]);
}
