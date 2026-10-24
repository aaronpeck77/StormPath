import type { LngLat } from "./types";
import { mapboxNearbyPoi } from "../services/mapboxGeocode";
import { haversineMeters } from "./routeGeometry";

/** Sparse drive-time POI tips — one short line, rare cadence. */

export const NEARBY_POI_CATEGORIES = [
  { category: "park", query: "park", label: "Park" },
  { category: "museum", query: "museum", label: "Museum" },
  { category: "restaurant", query: "restaurant", label: "Food" },
  { category: "coffee", query: "coffee", label: "Coffee" },
  { category: "fast_food", query: "fast food", label: "Food" },
] as const;

export const NEARBY_POI_MIN_INTERVAL_MS = 10 * 60_000;
export const NEARBY_POI_MIN_MOVE_M = 8_000;
/** Skip tips when moving faster than ~45 mph. */
export const NEARBY_POI_MAX_SPEED_MPS = 20;

export type NearbyPoiTip = {
  text: string;
  fetchedAtMs: number;
  lngLat: LngLat;
};

export function formatNearbyPoiTipLine(name: string, distanceMeters: number | null): string {
  const n = name.trim() || "Place";
  if (distanceMeters == null || !Number.isFinite(distanceMeters) || distanceMeters < 0) {
    return `${n} nearby`;
  }
  if (distanceMeters < 400) {
    const blocks = Math.max(1, Math.round(distanceMeters / 80));
    return `${n} ~${blocks} block${blocks === 1 ? "" : "s"} away`;
  }
  const mi = distanceMeters / 1609.344;
  if (mi < 10) return `${n} ~${mi < 1 ? mi.toFixed(1) : Math.round(mi)} mi away`;
  return `${n} nearby`;
}

export function shouldFetchNearbyPoiTip(opts: {
  nowMs: number;
  lastFetchMs: number | null;
  lastFetchLngLat: LngLat | null;
  userLngLat: LngLat;
  speedMps: number | null;
  navigationStarted: boolean;
  hazardBannerActive: boolean;
}): boolean {
  if (!opts.navigationStarted || opts.hazardBannerActive) return false;
  if (opts.speedMps != null && opts.speedMps > NEARBY_POI_MAX_SPEED_MPS) return false;
  if (opts.lastFetchMs != null && opts.nowMs - opts.lastFetchMs < NEARBY_POI_MIN_INTERVAL_MS) {
    return false;
  }
  if (opts.lastFetchLngLat) {
    const moved = haversineMeters(opts.lastFetchLngLat, opts.userLngLat);
    if (moved < NEARBY_POI_MIN_MOVE_M && opts.lastFetchMs != null) return false;
  }
  return true;
}

export function pickNearbyPoiCategory(seed: number): (typeof NEARBY_POI_CATEGORIES)[number] {
  const i = Math.abs(Math.floor(seed)) % NEARBY_POI_CATEGORIES.length;
  return NEARBY_POI_CATEGORIES[i]!;
}

/**
 * One nearby place for the banner. Uses Geocoding, not a Search Box session:
 * a session bills after two quiet minutes even when the driver never picks a row.
 */
export async function fetchNearbyPoiTip(opts: {
  mapboxToken: string;
  userLngLat: LngLat;
  seed?: number;
}): Promise<NearbyPoiTip | null> {
  const token = opts.mapboxToken.trim();
  if (!token) return null;
  const cat = pickNearbyPoiCategory(opts.seed ?? Date.now());
  const hit = await mapboxNearbyPoi(cat.query, token, opts.userLngLat);
  if (!hit) return null;
  return {
    text: formatNearbyPoiTipLine(hit.name, hit.distanceMeters),
    fetchedAtMs: Date.now(),
    lngLat: opts.userLngLat,
  };
}
