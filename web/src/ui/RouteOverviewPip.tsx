import mapboxgl from "../mapboxCapacitorWorker";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import { NORTH_AMERICA_BOUNDS } from "../config/mapRegion";
import type { LngLat, NavRoute } from "../nav/types";
import { applyRoutesToMap, fitMapToRemainingRoutes, fitMapToTrip } from "./mapRouteLayers";
import { bringRouteVisualLinesAboveTraffic } from "./mapRouteLayers";
import {
  bringMapboxTrafficLayersToFront,
  ensureMapboxTrafficConditionLayers,
  setMapboxTrafficLayersVisible,
} from "./mapTrafficLayers";
import {
  currentMapPhase,
  currentMapStyle,
  MAP_STYLE_DAY,
  parseNightBasemapPreset,
  type NightBasemapPreset,
} from "./mapBasemapStyle";
import { applyNightBasemapReadability } from "./mapNightBasemapReadability";
import { makeDestEl } from "./mapMarkerDom";

const PIP_PAD = { top: 10, bottom: 10, left: 10, right: 10 };

function makePipPuckEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "pip-user-puck";
  el.setAttribute("aria-hidden", "true");
  return el;
}

type Props = {
  accessToken: string;
  userLngLat: [number, number] | null;
  routes: NavRoute[];
  destLngLat: [number, number] | null;
  lineFocusId: string;
  suggestedRouteId: string | null;
  orderedRouteIds: string[];
  navigationStarted: boolean;
  /** Colored road traffic on the PiP map; default off. */
  trafficConditionsOnMap?: boolean;
  /** Hazard picked in the timeline/advisory — PiP eases to it and marks it. */
  focusHazard?: { lngLat: LngLat; label?: string } | null;
  /** Alternate/bypass geometry drawn as a contrasting line (e.g. backroad hop). */
  alternateGeometry?: LngLat[] | null;
};

/** Small route overview: all route lines + puck — no route picker UI. */
export function RouteOverviewPip({
  accessToken,
  userLngLat,
  routes,
  destLngLat,
  lineFocusId,
  suggestedRouteId,
  orderedRouteIds,
  navigationStarted,
  trafficConditionsOnMap = false,
  focusHazard = null,
  alternateGeometry = null,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const routeIdsRef = useRef<Set<string>>(new Set());
  const puckRef = useRef<mapboxgl.Marker | null>(null);
  const destMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const hazardMarkerRef = useRef<mapboxgl.Marker | null>(null);
  /** User grabbed the PiP or a hazard has focus — stop the 2 s route re-fit. */
  const viewLockedRef = useRef(false);
  const userRef = useRef(userLngLat);
  userRef.current = userLngLat;
  const [ready, setReady] = useState(false);
  /* Same day/night resolution as the main map — the PiP used to stay on
   * streets-v12 forever, so it glared day-white next to a dark Drive map. */
  const [nightPreset] = useState<NightBasemapPreset>(parseNightBasemapPreset);
  const [mapPhase, setMapPhase] = useState(() => currentMapPhase(userLngLat));
  const [styleEpoch, setStyleEpoch] = useState(0);
  const appliedStyleRef = useRef<string | null>(null);
  const styleRef = useRef(MAP_STYLE_DAY);
  styleRef.current = currentMapStyle(mapPhase, nightPreset);
  const pipStyle = styleRef.current;
  const pipNight = mapPhase === "night" && nightPreset !== "streets";

  useEffect(() => {
    const tick = () => setMapPhase(currentMapPhase(userRef.current));
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setMapPhase(currentMapPhase(userLngLat));
  }, [userLngLat?.[0], userLngLat?.[1]]);

  useEffect(() => {
    if (!wrapRef.current || mapRef.current) return;
    mapboxgl.accessToken = accessToken;
    const initialStyle = styleRef.current;
    appliedStyleRef.current = initialStyle;
    const map = new mapboxgl.Map({
      container: wrapRef.current,
      style: initialStyle,
      center: userLngLat ?? [-98.5, 39.8],
      zoom: 12,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
      maxBounds: NORTH_AMERICA_BOUNDS,
    });
    /* Interactive: pan + pinch/wheel zoom inside the PiP box. Rotate stays
     * off — north-up keeps the overview readable. */
    map.dragRotate.disable();
    map.keyboard.disable();
    map.boxZoom.disable();
    map.on("dragstart", () => {
      viewLockedRef.current = true;
    });
    /* zoomstart also fires for programmatic easeTo — lock on raw input instead. */
    const container = wrapRef.current;
    const lockView = () => {
      viewLockedRef.current = true;
    };
    container?.addEventListener("wheel", lockView, { passive: true });
    container?.addEventListener("dblclick", lockView);
    container?.addEventListener("touchstart", lockView, { passive: true });
    mapRef.current = map;
    const onLoad = () => setReady(true);
    if (map.isStyleLoaded()) setReady(true);
    else map.once("load", onLoad);
    return () => {
      map.off("load", onLoad);
      puckRef.current?.remove();
      puckRef.current = null;
      map.remove();
      mapRef.current = null;
      setReady(false);
      routeIdsRef.current = new Set();
    };
  }, [accessToken]);

  /* Dawn/dusk flips the basemap under the live map — swap styles and re-run the
   * layer passes once the new style reports loaded (setStyle wipes sources). */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (appliedStyleRef.current === pipStyle) return;
    const bump = () => setStyleEpoch((n) => n + 1);
    map.once("style.load", bump);
    try {
      map.setStyle(pipStyle);
      appliedStyleRef.current = pipStyle;
    } catch {
      map.off("style.load", bump);
    }
    return () => {
      map.off("style.load", bump);
    };
  }, [pipStyle, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    try {
      ensureMapboxTrafficConditionLayers(map);
      setMapboxTrafficLayersVisible(map, trafficConditionsOnMap);
    } catch {
      /* PiP uses minimal style; layers may fail on some builds */
    }
    if (pipNight) {
      try {
        applyNightBasemapReadability(map);
      } catch {
        /* style race */
      }
    }
  }, [ready, styleEpoch, trafficConditionsOnMap, pipNight]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    routeIdsRef.current = applyRoutesToMap(
      map,
      routes,
      lineFocusId,
      suggestedRouteId,
      routeIdsRef.current,
      "pip-route",
      {
        orderedRouteIds,
        navigationStarted,
        viewMode: "route",
        isOverviewPip: true,
      }
    );
    bringMapboxTrafficLayersToFront(map);
    bringRouteVisualLinesAboveTraffic(
      map,
      routes.map((r) => r.id),
      "pip-route",
      lineFocusId
    );
  }, [ready, styleEpoch, routes, lineFocusId, suggestedRouteId, orderedRouteIds, navigationStarted]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !userLngLat) {
      puckRef.current?.remove();
      puckRef.current = null;
      return;
    }
    if (!puckRef.current) {
      puckRef.current = new mapboxgl.Marker({ element: makePipPuckEl() })
        .setLngLat(userLngLat)
        .addTo(map);
    } else {
      puckRef.current.setLngLat(userLngLat);
    }
  }, [ready, userLngLat]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    if (!destLngLat) {
      destMarkerRef.current?.remove();
      destMarkerRef.current = null;
      return;
    }

    if (!destMarkerRef.current) {
      destMarkerRef.current = new mapboxgl.Marker({ element: makeDestEl(), anchor: "center" })
        .setLngLat(destLngLat)
        .addTo(map);
    } else {
      destMarkerRef.current.setLngLat(destLngLat);
    }
  }, [ready, destLngLat]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || routes.length === 0) return;

    const flatten = () => {
      map.easeTo({ pitch: 0, bearing: 0, duration: 240, essential: true });
    };

    const fitRemaining = () => {
      /* User is exploring the PiP or a hazard has focus — don't yank the
       * camera back to the route. */
      if (viewLockedRef.current) return;
      const u = userRef.current;
      if (u && destLngLat) {
        fitMapToRemainingRoutes(map, routes, u, destLngLat, { ...PIP_PAD }, 15.5);
      } else {
        fitMapToTrip(map, routes, userRef.current, destLngLat, { ...PIP_PAD }, 13.2);
      }
      map.once("idle", flatten);
    };

    fitRemaining();
    const intervalId = setInterval(fitRemaining, 2000);

    return () => {
      clearInterval(intervalId);
      map.off("idle", flatten);
    };
  }, [ready, routes, destLngLat, focusHazard]);

  /* Hazard picked in the timeline/advisory — fly the PiP to it and mark it. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!focusHazard) {
      hazardMarkerRef.current?.remove();
      hazardMarkerRef.current = null;
      return;
    }
    viewLockedRef.current = true;
    map.easeTo({ center: focusHazard.lngLat, zoom: 13.5, duration: 550, essential: true });
    if (!hazardMarkerRef.current) {
      const el = document.createElement("div");
      el.className = "pip-hazard-dot";
      el.title = focusHazard.label ?? "Hazard";
      hazardMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: "center" })
        .setLngLat(focusHazard.lngLat)
        .addTo(map);
    } else {
      hazardMarkerRef.current.setLngLat(focusHazard.lngLat);
      hazardMarkerRef.current.getElement().title = focusHazard.label ?? "Hazard";
    }
  }, [ready, focusHazard]);

  /* Alternate/bypass line (e.g. backroad hop around a closure). */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const sourceId = "pip-alternate";
    const layerId = "pip-alternate-line";
    const coords = alternateGeometry?.length ? alternateGeometry : null;
    try {
      const existing = map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined;
      if (!coords) {
        if (existing) existing.setData({ type: "FeatureCollection", features: [] });
        if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", "none");
        return;
      }
      const data: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: coords },
          },
        ],
      };
      if (existing) {
        existing.setData(data);
      } else {
        map.addSource(sourceId, { type: "geojson", data });
        map.addLayer({
          id: layerId,
          type: "line",
          source: sourceId,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#34d399",
            "line-width": 4,
            "line-opacity": 0.9,
            "line-dasharray": [1.2, 1.2],
          },
        });
      }
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", "visible");
    } catch {
      /* style race — alternate line is best-effort */
    }
  }, [ready, styleEpoch, alternateGeometry]);

  const resetView = () => {
    viewLockedRef.current = false;
    const map = mapRef.current;
    if (!map) return;
    const u = userRef.current;
    if (u && destLngLat) {
      fitMapToRemainingRoutes(map, routes, u, destLngLat, { ...PIP_PAD }, 15.5);
    } else {
      fitMapToTrip(map, routes, userRef.current, destLngLat, { ...PIP_PAD }, 13.2);
    }
  };

  return (
    <div className="route-overview-pip-map-shell">
      <div ref={wrapRef} className="route-overview-pip-inner" />
      <div className="route-overview-pip-controls">
        {focusHazard?.label ? (
          <span className="route-overview-pip-hazard-label">{focusHazard.label}</span>
        ) : null}
        <button
          type="button"
          className="route-overview-pip-ctrl"
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => mapRef.current?.zoomIn()}
        >
          +
        </button>
        <button
          type="button"
          className="route-overview-pip-ctrl"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => mapRef.current?.zoomOut()}
        >
          −
        </button>
        <button
          type="button"
          className="route-overview-pip-ctrl"
          aria-label="Reset route view"
          title="Reset route view"
          onClick={resetView}
        >
          ⌖
        </button>
      </div>
    </div>
  );
}
