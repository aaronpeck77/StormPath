import type { LngLat } from "../nav/types";
import type { GeocodeHit } from "./mapboxGeocode";

/** ~220 m cells at mid-latitudes — town labels don't need meter precision. */
export const REVERSE_GEOCODE_CELL_DEG = 0.002;
/** Keep labels for a day; moving into a new cell still fetches. */
export const REVERSE_GEOCODE_TTL_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = "stormpath.reverseGeocodeCache.v1";
const MAX_ENTRIES = 200;

type CacheEntry = { hit: GeocodeHit | null; atMs: number };

const memory = new Map<string, CacheEntry>();

export function reverseGeocodeCellKey(lng: number, lat: number, cellDeg = REVERSE_GEOCODE_CELL_DEG): string {
  const qLng = Math.round(lng / cellDeg) * cellDeg;
  const qLat = Math.round(lat / cellDeg) * cellDeg;
  return `${qLng.toFixed(4)},${qLat.toFixed(4)}`;
}

function readSession(): void {
  if (typeof sessionStorage === "undefined") return;
  if (memory.size > 0) return;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
    for (const [k, v] of Object.entries(parsed)) {
      if (v && typeof v.atMs === "number") memory.set(k, v);
    }
  } catch {
    /* ignore */
  }
}

function writeSession(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const obj: Record<string, CacheEntry> = {};
    let n = 0;
    for (const [k, v] of memory) {
      obj[k] = v;
      n += 1;
      if (n >= MAX_ENTRIES) break;
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* quota */
  }
}

export function getCachedReverseGeocode(
  lng: number,
  lat: number,
  nowMs = Date.now()
): GeocodeHit | null | undefined {
  readSession();
  const key = reverseGeocodeCellKey(lng, lat);
  const entry = memory.get(key);
  if (!entry) return undefined;
  if (nowMs - entry.atMs > REVERSE_GEOCODE_TTL_MS) {
    memory.delete(key);
    return undefined;
  }
  return entry.hit;
}

export function setCachedReverseGeocode(
  lng: number,
  lat: number,
  hit: GeocodeHit | null,
  nowMs = Date.now()
): void {
  readSession();
  const key = reverseGeocodeCellKey(lng, lat);
  memory.set(key, { hit, atMs: nowMs });
  if (memory.size > MAX_ENTRIES) {
    const first = memory.keys().next().value;
    if (first != null) memory.delete(first);
  }
  writeSession();
}

/** Test helper — clears in-memory + session cache. */
export function clearReverseGeocodeCacheForTests(): void {
  memory.clear();
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

export function cachedLngLatInSameCell(a: LngLat, b: LngLat): boolean {
  return reverseGeocodeCellKey(a[0], a[1]) === reverseGeocodeCellKey(b[0], b[1]);
}
