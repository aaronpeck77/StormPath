import type { LngLat } from "../nav/types";

/**
 * Region / provider codes — add EU, CA, etc. later with new providers.
 * UI and map layers stay agnostic; only fetch/normalize is per-region.
 */
export type WeatherAlertRegionCode = "US" | "XX";

export type WeatherAlertProviderId = "nws-us" | "placeholder";

/** Normalized alert for UI + overlap logic (not raw NWS JSON). */
export type NormalizedWeatherAlert = {
  id: string;
  regionCode: WeatherAlertRegionCode;
  providerId: WeatherAlertProviderId;
  headline: string;
  event: string;
  description: string;
  severity: string;
  urgency: string;
  certainty: string;
  /** ISO 8601 when the alert ends, if known */
  ends: string | null;
  /** GeoJSON geometry, or null (text-only / marine zones) */
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  /** Human-readable area from source */
  areaDesc: string;
};

export type WeatherAlertFetchResult = {
  alerts: NormalizedWeatherAlert[];
  /** GeoJSON for map overlay (polygons only) */
  mapGeoJson: GeoJSON.FeatureCollection;
};

export type RouteOverlapResult = {
  /** Alert ids whose polygon intersects the route corridor */
  overlappingIds: string[];
  /** Representative point on route inside first overlapping polygon (for “focus”) */
  overlapLngLat: LngLat | null;
};
