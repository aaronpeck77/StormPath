import { haversineMeters } from "../nav/routeGeometry";
import type { LngLat } from "../nav/types";

const STORAGE_KEY = "stormpath-activity-samples-v1";
/** Throttle: at most one stored dot per interval while moving (keeps months of history under localStorage limits). */
const MIN_INTERVAL_MS = 3 * 60 * 1000;
/** Ignore micro-moves between samples */
const MIN_MOVE_M = 75;
const MAX_SAMPLES = 22_000;

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
