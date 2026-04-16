import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import { NORTH_AMERICA_BOUNDS } from "../config/mapRegion";

const MAP_STYLE = "mapbox://styles/mapbox/streets-v12";

type Props = {
  accessToken: string;
  /** Center of hazard zone (near user / along route) */
  center: [number, number];
  summary: string;
};

/** Top-down mini-map: hazard footprint + suggested bypass (mock geometry). */
export function HazardPipMap({ accessToken, center, summary }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!wrapRef.current || mapRef.current) return;
    mapboxgl.accessToken = accessToken;
    const map = new mapboxgl.Map({
      container: wrapRef.current,
      style: MAP_STYLE,
      center,
      zoom: 15.2,
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
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [accessToken]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const [lng, lat] = center;
    const hazardPoly: GeoJSON.Feature<GeoJSON.Polygon> = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [lng - 0.004, lat - 0.0025],
            [lng + 0.0035, lat - 0.002],
            [lng + 0.0042, lat + 0.003],
            [lng - 0.002, lat + 0.0038],
            [lng - 0.004, lat - 0.0025],
          ],
        ],
      },
    };
    const bypass: GeoJSON.Feature<GeoJSON.LineString> = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [lng - 0.0055, lat - 0.001],
          [lng - 0.001, lat + 0.0012],
          [lng + 0.0045, lat + 0.0005],
        ],
      },
    };

    const upsert = (id: string, data: GeoJSON.Feature, layer: "fill" | "line", paint: Record<string, unknown>) => {
      const src = map.getSource(id) as mapboxgl.GeoJSONSource | undefined;
      if (!src) {
        map.addSource(id, { type: "geojson", data });
        if (layer === "fill") {
          map.addLayer({
            id: `${id}-layer`,
            type: "fill",
            source: id,
            paint: paint as mapboxgl.FillPaint,
          });
        } else {
          map.addLayer({
            id: `${id}-layer`,
            type: "line",
            source: id,
            paint: paint as mapboxgl.LinePaint,
            layout: { "line-cap": "round", "line-join": "round" },
          });
        }
      } else {
        src.setData(data);
      }
    };

    upsert("hz-area", hazardPoly, "fill", {
      "fill-color": "#f97316",
      "fill-opacity": 0.35,
    });
    upsert("hz-bypass", bypass, "line", {
      "line-color": "#22c55e",
      "line-width": 4,
      "line-opacity": 0.95,
    });

    const b = new mapboxgl.LngLatBounds();
    hazardPoly.geometry.coordinates[0]!.forEach((c) => b.extend(c as [number, number]));
    bypass.geometry.coordinates.forEach((c) => b.extend(c as [number, number]));
    map.fitBounds(b, { padding: 10, maxZoom: 16, duration: 400 });
  }, [ready, center]);

  return (
    <div className="hazard-pip" role="img" aria-label={summary}>
      <div ref={wrapRef} className="hazard-pip-map" />
      <p className="hazard-pip-caption">{summary}</p>
    </div>
  );
}
