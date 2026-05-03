import { haversineMeters } from "../nav/routeGeometry";
import type { LngLat } from "../nav/types";
import type { FrequentRouteCluster } from "./types";

const STORAGE_KEY = "stormpath-activity-samples-v1";
/** Throttle: at most one stored dot per interval while moving (keeps months of history under localStorage limits). */
const MIN_INTERVAL_MS = 3 * 60 * 1000;
/** Ignore micro-moves between samples */
const MIN_MOVE_M = 75;
const MAX_SAMPLES = 22_000;

/** Enough trail dots to frame the map in route planning (no destination yet). */
export const ACTIVITY_MIN_SAMPLES_PLANNING_MAP = 12;
/** Enough dots to bias search / frequent-route ordering toward your usual area. */
export const ACTIVITY_MIN_SAMPLES_RANK = 8;

export const ACTIVITY_SAMPLES_UPDATED_EVENT = "stormpath-activity-samples-updated";

export type ActivitySample = { t: number; lng: number; lat: number };

let memLastT = 0;
let memLastPos: LngLat | null = null;

function hydrateMemFromTail(list: ActivitySample[]) {
  if (!list.length) {
    memLastT = 0;
    memLastPos = null;
    return;
  }
  const last = list[list.length - 1]!;
  memLastT = last.t;
  memLastPos = [last.lng, last.lat];
}

function loadRaw(): ActivitySample[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    const out: ActivitySample[] = [];
    for (const row of data) {
      if (!row || typeof row !== "object") continue;
      const o = row as { t?: number; lng?: number; lat?: number };
      if (
        typeof o.t === "number" &&
        typeof o.lng === "number" &&
        typeof o.lat === "number" &&
        Number.isFinite(o.t + o.lng + o.lat)
      ) {
        out.push({ t: o.t, lng: o.lng, lat: o.lat });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function persist(list: ActivitySample[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* quota — drop oldest half and retry once */
    try {
      const half = list.slice(Math.floor(list.length / 2));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(half));
      hydrateMemFromTail(half);
    } catch {
      /* ignore */
    }
    return;
  }
  hydrateMemFromTail(list);
  try {
    window.dispatchEvent(new Event(ACTIVITY_SAMPLES_UPDATED_EVENT));
  } catch {
    /* ignore */
  }
}

hydrateMemFromTail(loadRaw());

/**
 * Plus + “learn trips” only: append a sparse dot when you’ve moved and enough time passed.
 * Independent of the trip-detector polyline (which uses ~16s steps); this is for a long-horizon “where I’ve been” map.
 */
export function tryAppendActivitySample(now: number, lngLat: LngLat, speedMps: number | null): void {
  if (speedMps != null && speedMps < 0.85) return;
  if (now - memLastT < MIN_INTERVAL_MS) return;
  if (memLastPos != null && haversineMeters(memLastPos, lngLat) < MIN_MOVE_M) return;

  const list = loadRaw();
  list.push({ t: now, lng: lngLat[0]!, lat: lngLat[1]! });
  while (list.length > MAX_SAMPLES) list.shift();
  memLastT = now;
  memLastPos = lngLat;
  persist(list);
}

export function loadActivitySamples(): ActivitySample[] {
  return loadRaw();
}

export function clearActivitySamples(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  memLastT = 0;
  memLastPos = null;
  try {
    window.dispatchEvent(new Event(ACTIVITY_SAMPLES_UPDATED_EVENT));
  } catch {
    /* ignore */
  }
}

export function getActivityTrailStats(): {
  count: number;
  oldest: number | null;
  newest: number | null;
  spanDays: number | null;
} {
  const list = loadRaw();
  if (!list.length) {
    return { count: 0, oldest: null, newest: null, spanDays: null };
  }
  const oldest = list[0]!.t;
  const newest = list[list.length - 1]!.t;
  const spanMs = Math.max(0, newest - oldest);
  const spanDays = spanMs / (86_400_000);
  return {
    count: list.length,
    oldest,
    newest,
    spanDays: spanDays > 0.05 ? spanDays : null,
  };
}

export function activitySamplesToGeoJson(samples: ActivitySample[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: samples.map((s, i) => ({
      type: "Feature" as const,
      id: i,
      properties: { t: s.t },
      geometry: {
        type: "Point" as const,
        coordinates: [s.lng, s.lat],
      },
    })),
  };
}

/** Mean lat/lng — fine for local driving regions. */
function trailCentroidLngLat(minSamples: number): LngLat | null {
  const list = loadRaw();
  if (list.length < minSamples) return null;
  let slng = 0;
  let slat = 0;
  for (const s of list) {
    slng += s.lng;
    slat += s.lat;
  }
  const n = list.length;
  return [slng / n, slat / n];
}

/**
 * SW / NE corners for map.fitBounds when framing “where you usually drive” (planning, no route).
 * Returns null until there are enough dots.
 */
export function getActivityTrailPlanningBounds(
  minSamples: number
): [[number, number], [number, number]] | null {
  const list = loadRaw();
  if (list.length < minSamples) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const s of list) {
    if (s.lng < minLng) minLng = s.lng;
    if (s.lat < minLat) minLat = s.lat;
    if (s.lng > maxLng) maxLng = s.lng;
    if (s.lat > maxLat) maxLat = s.lat;
  }
  const spanLng = maxLng - minLng;
  const spanLat = maxLat - minLat;
  const padLng = Math.max(0.018, spanLng * 0.12);
  const padLat = Math.max(0.015, spanLat * 0.12);
  return [
    [minLng - padLng, minLat - padLat],
    [maxLng + padLng, maxLat + padLat],
  ];
}

/**
 * Re-rank search suggestions so places nearer your activity centroid appear first (ties keep input order).
 * No-op if learning trail is too sparse or `enabled` is false.
 */
export function rankSearchSuggestionsByTrailCentroid<T extends { lngLat: LngLat }>(
  items: T[],
  enabled: boolean,
  minTrailSamples = 8
): T[] {
  if (!enabled || items.length <= 1) return items;
  const c = trailCentroidLngLat(minTrailSamples);
  if (!c) return items;
  return [...items]
    .map((item, i) => ({
      item,
      i,
      d: haversineMeters(item.lngLat, c),
    }))
    .sort((a, b) => (a.d !== b.d ? a.d - b.d : a.i - b.i))
    .map((x) => x.item);
}

/**
 * After sorting frequent clusters by recency, nudge order so clusters in your usual area float up when `lastSeen` ties.
 */
export function rankFrequentClustersByTrailCentroid(
  clusters: FrequentRouteCluster[],
  enabled: boolean,
  minTrailSamples = 8
): FrequentRouteCluster[] {
  if (!enabled || clusters.length <= 1) return clusters;
  const c = trailCentroidLngLat(minTrailSamples);
  if (!c) return clusters;
  const mid = (cl: FrequentRouteCluster): LngLat => [
    (cl.centerStart[0]! + cl.centerEnd[0]!) / 2,
    (cl.centerStart[1]! + cl.centerEnd[1]!) / 2,
  ];
  return [...clusters].sort((a, b) => {
    if (b.lastSeen !== a.lastSeen) return b.lastSeen - a.lastSeen;
    return haversineMeters(mid(a), c) - haversineMeters(mid(b), c);
  });
}
