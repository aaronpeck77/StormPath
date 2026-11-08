import mapboxgl from "../mapboxCapacitorWorker";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import { NORTH_AMERICA_BOUNDS } from "../config/mapRegion";
import type { NavRoute } from "../nav/types";
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
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const routeIdsRef = useRef<Set<string>>(new Set());
  const puckRef = useRef<mapboxgl.Marker | null>(null);
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
      interactive: false,
      attributionControl: false,
      maxBounds: NORTH_AMERICA_BOUNDS,
    });
    map.scrollZoom.disable();
    map.boxZoom.disable();
    map.dragRotate.disable();
    map.dragPan.disable();
    map.keyboard.disable();
    map.doubleClickZoom.disable();
    map.touchZoomRotate.disable();
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
    if (!map || !ready || routes.length === 0) return;

    const flatten = () => {
      map.easeTo({ pitch: 0, bearing: 0, duration: 240, essential: true });
    };

    const fitRemaining = () => {
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
  }, [ready, routes, destLngLat]);

  return (
    <div className="route-overview-pip-map-shell">
      <div ref={wrapRef} className="route-overview-pip-inner" aria-hidden />
    </div>
  );
}
