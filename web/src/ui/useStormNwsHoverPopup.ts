import { useEffect, type RefObject } from "react";
import mapboxgl from "../mapboxCapacitorWorker";
import type { LngLat } from "../nav/types";
import {
  getMapCanvas,
  isMapUsable,
  readMapLngLat,
  safeSetMapLngLat,
  setMapCanvasCursor,
} from "./mapCameraSafe";
import { WEATHER_ALERTS_NWS_FILL_LAYER_ID } from "./mapWeatherAlertLayers";
import {
  buildStormHoverPopupContent,
  mapHoverPopupSupported,
  nwsHoverAlertKeyFromFeats,
  nwsHoverPopupZoomOk,
  NWS_HOVER_FADE_MS,
  NWS_HOVER_READ_MS,
} from "./mapStormHoverPopup";
import type { MapViewMode } from "./driveMapTypes";

export type UseStormNwsHoverPopupDeps = {
  mapRef: RefObject<mapboxgl.Map | null>;
  mapReady: boolean;
  weatherAlertGeoJson: GeoJSON.FeatureCollection | null | undefined;
  navigationStarted: boolean;
  viewMode: MapViewMode;
};

/** Desktop hover card when the pointer enters NWS warning polygons. */
export function useStormNwsHoverPopup(deps: UseStormNwsHoverPopupDeps): void {
  const { mapRef, mapReady, weatherAlertGeoJson, navigationStarted, viewMode } = deps;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (navigationStarted && viewMode === "drive") return;
    if (!weatherAlertGeoJson?.features?.length) return;
    if (!mapHoverPopupSupported()) return;

    const popup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      maxWidth: "min(320px, 78vw)",
      className: "storm-hover-popup",
      offset: 14,
    });

    let rafId: number | null = null;
    let pending: mapboxgl.MapMouseEvent | null = null;
    let shownForKey: string | null = null;
    let readTimer: number | null = null;
    let fadeRemoveTimer: number | null = null;

    const clearTimers = () => {
      if (readTimer != null) {
        clearTimeout(readTimer);
        readTimer = null;
      }
      if (fadeRemoveTimer != null) {
        clearTimeout(fadeRemoveTimer);
        fadeRemoveTimer = null;
      }
    };

    const stripFadeClass = () => {
      const el = popup.getElement();
      if (el) el.classList.remove("storm-hover-popup--fading");
    };

    const removePopupImmediate = () => {
      clearTimers();
      stripFadeClass();
      try {
        popup.remove();
      } catch {
        /* map removed */
      }
      setMapCanvasCursor(map, "");
    };

    const fadeOutThenRemove = () => {
      readTimer = null;
      const el = popup.getElement();
      if (el) {
        void el.offsetHeight;
        el.classList.add("storm-hover-popup--fading");
        fadeRemoveTimer = window.setTimeout(() => {
          fadeRemoveTimer = null;
          stripFadeClass();
          popup.remove();
        }, NWS_HOVER_FADE_MS);
      } else {
        popup.remove();
      }
    };

    const showForKey = (key: string, lngLat: LngLat, feats: mapboxgl.MapboxGeoJSONFeature[]) => {
      clearTimers();
      stripFadeClass();
      popup.setDOMContent(buildStormHoverPopupContent(feats));
      if (!safeSetMapLngLat(popup, lngLat)) return;
      popup.addTo(map);
      setMapCanvasCursor(map, "pointer");
      shownForKey = key;
      readTimer = window.setTimeout(fadeOutThenRemove, NWS_HOVER_READ_MS);
    };

    const flush = () => {
      rafId = null;
      const ev = pending;
      pending = null;
      if (!ev || !isMapUsable(map) || !map.isStyleLoaded()) return;

      if (!map.getLayer(WEATHER_ALERTS_NWS_FILL_LAYER_ID)) {
        shownForKey = null;
        removePopupImmediate();
        return;
      }

      if (!nwsHoverPopupZoomOk(map)) {
        shownForKey = null;
        removePopupImmediate();
        return;
      }

      let feats: mapboxgl.MapboxGeoJSONFeature[];
      try {
        feats = map.queryRenderedFeatures(ev.point, { layers: [WEATHER_ALERTS_NWS_FILL_LAYER_ID] });
      } catch {
        return;
      }
      if (!feats.length) {
        shownForKey = null;
        removePopupImmediate();
        return;
      }

      const key = nwsHoverAlertKeyFromFeats(feats);
      if (!key) {
        shownForKey = null;
        removePopupImmediate();
        return;
      }

      setMapCanvasCursor(map, "pointer");

      if (key === shownForKey) {
        return;
      }

      const hoverLngLat = readMapLngLat(ev.lngLat);
      if (!hoverLngLat) return;
      showForKey(key, hoverLngLat, feats);
    };

    const mousemove = (e: mapboxgl.MapMouseEvent) => {
      pending = e;
      if (rafId != null) return;
      rafId = requestAnimationFrame(flush);
    };

    const onZoom = () => {
      if (!nwsHoverPopupZoomOk(map)) {
        shownForKey = null;
        removePopupImmediate();
      }
    };

    const leave = () => {
      pending = null;
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      shownForKey = null;
      if (!isMapUsable(map)) return;
      removePopupImmediate();
    };

    map.on("mousemove", mousemove);
    map.on("zoom", onZoom);
    const hoverCanvas = getMapCanvas(map);
    hoverCanvas?.addEventListener("mouseleave", leave);

    return () => {
      map.off("mousemove", mousemove);
      map.off("zoom", onZoom);
      hoverCanvas?.removeEventListener("mouseleave", leave);
      pending = null;
      shownForKey = null;
      if (rafId != null) cancelAnimationFrame(rafId);
      removePopupImmediate();
    };
  }, [mapRef, mapReady, weatherAlertGeoJson, navigationStarted, viewMode]);
}
