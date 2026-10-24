import { FALLBACK_LNGLAT } from "../nav/constants";
import { safeStorage } from "../storage/safeStorage";

const LS_LAST_MAP_OPEN = "stormpath-last-map-open";
/** Street-level frames only. A country view must not become the next open. */
const MIN_OPEN_ZOOM = 11;
const MAX_OPEN_ZOOM = 17;
/** Drop a saved frame after a month. A newer drive replaces it long before that. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type LastMapOpen = {
  lng: number;
  lat: number;
  zoom: number;
  bearing: number;
  savedAtMs: number;
};

function isFactoryCenter(lng: number, lat: number): boolean {
  return Math.abs(lng - FALLBACK_LNGLAT[0]) < 0.02 && Math.abs(lat - FALLBACK_LNGLAT[1]) < 0.02;
}

export function readLastMapOpen(nowMs = Date.now()): LastMapOpen | null {
  const raw = safeStorage.get(LS_LAST_MAP_OPEN);
  if (!raw) return null;
  let parsed: Partial<LastMapOpen>;
  try {
    parsed = JSON.parse(raw) as Partial<LastMapOpen>;
  } catch {
    return null;
  }
  const lng = parsed.lng;
  const lat = parsed.lat;
  const zoom = parsed.zoom;
  const bearing = parsed.bearing ?? 0;
  const savedAtMs = parsed.savedAtMs ?? 0;
  if (typeof lng !== "number" || typeof lat !== "number" || typeof zoom !== "number") return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(zoom)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (zoom < MIN_OPEN_ZOOM || zoom > MAX_OPEN_ZOOM) return null;
  if (!Number.isFinite(savedAtMs) || nowMs - savedAtMs > MAX_AGE_MS) return null;
  if (isFactoryCenter(lng, lat)) return null;
  return { lng, lat, zoom, bearing: Number.isFinite(bearing) ? bearing : 0, savedAtMs };
}

export function writeLastMapOpen(frame: {
  lng: number;
  lat: number;
  zoom: number;
  bearing?: number;
}): void {
  const { lng, lat, zoom } = frame;
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(zoom)) return;
  if (zoom < MIN_OPEN_ZOOM || zoom > 22) return;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
  if (isFactoryCenter(lng, lat)) return;
  const saved: LastMapOpen = {
    lng,
    lat,
    zoom: Math.min(zoom, MAX_OPEN_ZOOM),
    bearing: frame.bearing != null && Number.isFinite(frame.bearing) ? frame.bearing : 0,
    savedAtMs: Date.now(),
  };
  safeStorage.set(LS_LAST_MAP_OPEN, JSON.stringify(saved));
}

/** A small box around the last neighborhood so those streets are already on the phone. */
export function neighborhoodBounds(
  lng: number,
  lat: number,
  padDeg = 0.012
): [[number, number], [number, number]] {
  return [
    [lng - padDeg, lat - padDeg],
    [lng + padDeg, lat + padDeg],
  ];
}
