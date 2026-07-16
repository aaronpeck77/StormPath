import { useEffect, useMemo, useRef, useState } from "react";
import type { LngLat } from "../nav/types";
import { mapboxReverseGeocode } from "../services/mapboxGeocode";
import {
  formatCoordsAreaLabel,
  shortenPlaceNameForForecast,
} from "../utils/forecastDisplay";
import { shouldRefreshForecastReverseGeocode } from "../utils/forecastReverseGeocodeGate";

/**
 * Reverse-geocode the local-forecast area label, throttled so GPS ticks do not burn Temporary Geocoding.
 */
export function useForecastPlaceLabel(opts: {
  mapboxToken: string | undefined;
  effectiveUserLngLat: LngLat | null | undefined;
}): {
  forecastPlaceShort: string | null;
  forecastAreaLabel: string;
} {
  const { mapboxToken, effectiveUserLngLat } = opts;
  const [forecastPlaceShort, setForecastPlaceShort] = useState<string | null>(null);
  const effectiveUserLngLatRef = useRef(effectiveUserLngLat);
  effectiveUserLngLatRef.current = effectiveUserLngLat;

  const forecastReverseGeocodeAtRef = useRef<{ lngLat: LngLat; atMs: number } | null>(null);
  const forecastGeocodeInFlightRef = useRef(false);
  const forecastGeocodeFailUntilMsRef = useRef(0);

  useEffect(() => {
    if (!mapboxToken) {
      forecastReverseGeocodeAtRef.current = null;
      forecastGeocodeInFlightRef.current = false;
      forecastGeocodeFailUntilMsRef.current = 0;
      setForecastPlaceShort(null);
      return;
    }
    if (!effectiveUserLngLat) {
      forecastReverseGeocodeAtRef.current = null;
      return;
    }
    const [lng, lat] = effectiveUserLngLat;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    const next: LngLat = [lng, lat];
    const prev = forecastReverseGeocodeAtRef.current;
    if (
      !shouldRefreshForecastReverseGeocode({
        next,
        lastLngLat: prev?.lngLat ?? null,
        lastFetchedAtMs: prev?.atMs ?? null,
      })
    ) {
      return;
    }
    if (forecastGeocodeInFlightRef.current) return;
    if (Date.now() < forecastGeocodeFailUntilMsRef.current) return;

    forecastReverseGeocodeAtRef.current = { lngLat: next, atMs: Date.now() };
    forecastGeocodeInFlightRef.current = true;
    void mapboxReverseGeocode(lng, lat, mapboxToken)
      .then((hit) => {
        if (!hit?.placeName) {
          forecastReverseGeocodeAtRef.current = null;
          forecastGeocodeFailUntilMsRef.current = Date.now() + 30_000;
          return;
        }
        forecastGeocodeFailUntilMsRef.current = 0;
        if (!effectiveUserLngLatRef.current) return;
        setForecastPlaceShort(shortenPlaceNameForForecast(hit.placeName));
      })
      .finally(() => {
        forecastGeocodeInFlightRef.current = false;
      });
  }, [effectiveUserLngLat, mapboxToken]);

  const forecastAreaLabel = useMemo(() => {
    if (forecastPlaceShort) return forecastPlaceShort;
    if (effectiveUserLngLat) {
      const [lng, lat] = effectiveUserLngLat;
      return formatCoordsAreaLabel(lat, lng);
    }
    return "Your location";
  }, [forecastPlaceShort, effectiveUserLngLat]);

  return { forecastPlaceShort, forecastAreaLabel };
}
