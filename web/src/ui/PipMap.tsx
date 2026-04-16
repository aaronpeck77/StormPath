import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";

const MAP_STYLE = "mapbox://styles/mapbox/streets-v12";

type Props = {
  accessToken: string;
  userLngLat: [number, number] | null;
};

/** Small north-up overview for corner PiP while in drive mode */
export function PipMap({ accessToken, userLngLat }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!wrapRef.current || mapRef.current) return;
    mapboxgl.accessToken = accessToken;
    const map = new mapboxgl.Map({
      container: wrapRef.current,
      style: MAP_STYLE,
      center: userLngLat ?? [-98.5, 39.8],
      zoom: 15,
      pitch: 0,
      bearing: 0,
      interactive: false,
      attributionControl: false,
    });
    map.scrollZoom.disable();
    map.boxZoom.disable();
    map.dragRotate.disable();
    map.dragPan.disable();
    map.keyboard.disable();
    map.doubleClickZoom.disable();
    map.touchZoomRotate.disable();
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [accessToken]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userLngLat) return;
    map.jumpTo({ center: userLngLat, zoom: 15, pitch: 0, bearing: 0 });
  }, [userLngLat]);

  return <div ref={wrapRef} className="pip-map-inner" aria-hidden />;
}
