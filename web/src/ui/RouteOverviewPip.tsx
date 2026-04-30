import mapboxgl from "mapbox-gl";
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

const MAP_STYLE = "mapbox://styles/mapbox/streets-v12";

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

  useEffect(() => {
    if (!wrapRef.current || mapRef.current) return;
    mapboxgl.accessToken = accessToken;
    const map = new mapboxgl.Map({
      container: wrapRef.current,
      style: MAP_STYLE,
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    try {
      ensureMapboxTrafficConditionLayers(map);
      setMapboxTrafficLayersVisible(map, trafficConditionsOnMap);
    } catch {
      /* PiP uses minimal style; layers may fail on some builds */
    }
  }, [ready, trafficConditionsOnMap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    routeIdsRef.current = applyRoutesToMap(
      map,
      routes,
      lineFocusId,
      suggestedRouteId,
      routeIdsRef.current,
      "pip-route"
    );
    bringMapboxTrafficLayersToFront(map);
    bringRouteVisualLinesAboveTraffic(
      map,
      routes.map((r) => r.id),
      "pip-route"
    );
  }, [ready, routes, lineFocusId, suggestedRouteId, orderedRouteIds, navigationStarted]);

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
