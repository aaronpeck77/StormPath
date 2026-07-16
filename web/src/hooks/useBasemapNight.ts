import { useEffect, useState, type RefObject } from "react";
import { isMapBasemapDaytime } from "../map/mapBasemapDaytime";
import type { LngLat } from "../nav/types";

/** Periodic day/night basemap class for the app shell. */
export function useBasemapNight(
  effectiveUserLngLatRef: RefObject<LngLat | null | undefined>,
  lng: number | undefined,
  lat: number | undefined
): boolean {
  const [basemapNight, setBasemapNight] = useState(() => !isMapBasemapDaytime());

  useEffect(() => {
    const sync = () => setBasemapNight(!isMapBasemapDaytime(effectiveUserLngLatRef.current ?? null));
    sync();
    const id = window.setInterval(sync, 60_000);
    return () => window.clearInterval(id);
  }, [effectiveUserLngLatRef, lng, lat]);

  return basemapNight;
}
