import { haversineMeters } from "../nav/routeGeometry";
import type { LngLat } from "../nav/types";
import {
  ACTIVITY_MIN_SAMPLES_PLANNING_MAP,
  loadActivitySamples,
  type ActivitySample,
} from "../frequentRoutes/activitySamples";
import { safeStorage } from "../storage/safeStorage";

const LS_HOME_PRELOAD_ENABLED = "stormpath-home-preload-enabled";
const LS_HOME_PRELOAD_LAST = "stormpath-home-preload-last-v1";

/** Minimum trail dots before we derive a preload region. */
export const ACTIVITY_MIN_SAMPLES_PRELOAD = ACTIVITY_MIN_SAMPLES_PLANNING_MAP;

/** Max radius from centroid (~56 km wide box) — avoids downloading a whole state. */
export const MAX_PRELOAD_RADIUS_M = 28_000;
/** Minimum useful preload radius when the trail is very tight. */
export const MIN_PRELOAD_RADIUS_M = 6_000;

/** Don't re-warm the same region more than once per interval (ms). */
export const PRELOAD_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;

export function readHomePreloadEnabled(): boolean {
  const v = safeStorage.get(LS_HOME_PRELOAD_ENABLED);
  if (v === "0" || v === "false") return false;
  return true;
}

export function writeHomePreloadEnabled(on: boolean): void {
  safeStorage.set(LS_HOME_PRELOAD_ENABLED, on ? "1" : "0");
}

type PreloadLastRecord = { at: number; hash: string };

function readPreloadLast(): PreloadLastRecord | null {
  const raw = safeStorage.getJson<unknown>(LS_HOME_PRELOAD_LAST, null);
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { at?: number; hash?: string };
  if (typeof o.at !== "number" || typeof o.hash !== "string") return null;
  return { at: o.at, hash: o.hash };
}

export function markHomePreloadCompleted(bounds: [[number, number], [number, number]]): void {
  safeStorage.setJson(LS_HOME_PRELOAD_LAST, {
    at: Date.now(),
    hash: boundsHash(bounds),
  });
}

export function clearHomePreloadRecord(): void {
  safeStorage.remove(LS_HOME_PRELOAD_LAST);
}

export function shouldSkipHomePreloadThrottle(
  bounds: [[number, number], [number, number]]
): boolean {
  const last = readPreloadLast();
  if (!last) return false;
  if (Date.now() - last.at < PRELOAD_MIN_INTERVAL_MS) {
    return last.hash === boundsHash(bounds);
  }
  return false;
}

function boundsHash(bounds: [[number, number], [number, number]]): string {
  const r = (n: number) => n.toFixed(3);
  return `${r(bounds[0][0])},${r(bounds[0][1])}|${r(bounds[1][0])},${r(bounds[1][1])}`;
}

function centroidOf(samples: ActivitySample[]): LngLat | null {
  if (!samples.length) return null;
  let slng = 0;
  let slat = 0;
  for (const s of samples) {
    slng += s.lng;
    slat += s.lat;
  }
  return [slng / samples.length, slat / samples.length];
}

/**
 * Density-based home territory for tile cache warming — capped radius around trail centroid,
 * not the full span of every dot ever recorded.
 */
export function getHomePreloadBounds(
  minSamples = ACTIVITY_MIN_SAMPLES_PRELOAD
): [[number, number], [number, number]] | null {
  const list = loadActivitySamples();
  if (list.length < minSamples) return null;
  const c = centroidOf(list);
  if (!c) return null;

  const distances = list
    .map((s) => haversineMeters(c, [s.lng, s.lat]))
    .sort((a, b) => a - b);
  const p85 = distances[Math.floor(distances.length * 0.85)] ?? MIN_PRELOAD_RADIUS_M;
  const radiusM = Math.min(
    MAX_PRELOAD_RADIUS_M,
    Math.max(MIN_PRELOAD_RADIUS_M, p85 * 1.12)
  );

  const cosLat = Math.max(0.25, Math.cos((c[1] * Math.PI) / 180));
  const padLat = radiusM / 111_000;
  const padLng = radiusM / (111_000 * cosLat);

  return [
    [c[0] - padLng, c[1] - padLat],
    [c[0] + padLng, c[1] + padLat],
  ];
}

/** Rough user-facing size hint (vector tile cache is approximate). */
export function estimatePreloadStorageLabel(
  bounds: [[number, number], [number, number]] | null
): string | null {
  if (!bounds) return null;
  const [[swLng, swLat], [neLng, neLat]] = bounds;
  const wM = haversineMeters([swLng, swLat], [neLng, swLat]);
  const hM = haversineMeters([swLng, swLat], [swLng, neLat]);
  const areaKm2 = (wM / 1000) * (hM / 1000);
  const mb = Math.round(Math.min(180, Math.max(15, areaKm2 * 1.8)));
  return `~${mb} MB (estimate)`;
}
