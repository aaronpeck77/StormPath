import type { LngLat } from "../nav/types";
import { fetchWithTimeout, MAPBOX_TRAFFIC_TIMEOUT_MS } from "../utils/fetchResilient";

/** Mapbox Directions API limit for coordinates in one request. */
const MAPBOX_MAX_COORDS = 25;

const SAMPLE_TRIES = [25, 16, 8, 3] as const;

/** Evenly sample vertices so the traffic profile follows the ORS corridor approximately. */
export function samplePolylineForMapbox(geometry: LngLat[], max: number): LngLat[] {
  if (geometry.length <= max) return [...geometry];
  const out: LngLat[] = [];
  const last = geometry.length - 1;
  const step = last / (max - 1);
  for (let i = 0; i < max; i++) {
    const idx = Math.min(last, Math.round(i * step));
    out.push(geometry[idx]!);
  }
  return out;
}

export type CongestionLevel = "low" | "moderate" | "heavy" | "severe" | "unknown";

export type MapboxTrafficLeg = {
  /** Duration with live traffic (minutes), from Mapbox driving-traffic profile. */
  mapboxDurationMinutes: number;
  /** Mapbox free-flow baseline (minutes) — duration_typical from the same API. */
  typicalDurationMinutes: number;
  /** Real congestion delay: max(0, duration − duration_typical). */
  delayVsTypicalMinutes: number;
  /** Per-leg congestion annotation from Mapbox (when available). */
  congestionSummary: CongestionLevel;
  /** True when any segment on this leg has a closure annotation. */
  hasClosure: boolean;
  /** Approximate position of near-stopped traffic along the leg (0..1), if detected. */
  nearStopFraction: number | null;
};

type DirectionsRoute = {
  duration?: number;
  duration_typical?: number;
  legs?: {
    annotation?: {
      congestion_numeric?: (number | null)[];
      closure?: boolean[];
    };
    incidents?: {
      id?: string;
      type?: string;
      description?: string;
      long_description?: string;
      impact?: string;
      sub_type?: string;
      lanes_blocked?: string[];
      num_lanes_blocked?: number;
      affected_road_names?: string[];
    }[];
  }[];
};

type DirectionsResponse = {
  code?: string;
  message?: string;
  routes?: DirectionsRoute[];
};

function summarizeCongestion(route: DirectionsRoute): CongestionLevel {
  const segs = route.legs?.flatMap((l) => l.annotation?.congestion_numeric ?? []) ?? [];
  const valid = segs.filter((v): v is number => v != null);
  if (!valid.length) return "unknown";
  let severe = 0;
  let heavy = 0;
  let moderate = 0;
  for (const v of valid) {
    if (v >= 80) severe++;
    else if (v >= 60) heavy++;
    else if (v >= 40) moderate++;
  }
  const total = valid.length;
  if (severe / total >= 0.08 || severe >= 3) return "severe";
  if ((severe + heavy) / total >= 0.12 || heavy >= 4) return "heavy";
  if ((severe + heavy + moderate) / total >= 0.2) return "moderate";
  return "low";
}

function detectNearStopFraction(route: DirectionsRoute): number | null {
  let total = 0;
  let firstNearStop: number | null = null;
  for (const leg of route.legs ?? []) {
    const congestion = leg.annotation?.congestion_numeric ?? [];
    const closures = leg.annotation?.closure ?? [];
    const segCount = Math.max(congestion.length, closures.length);
    if (segCount <= 0) continue;
    for (let i = 0; i < segCount; i++) {
      const c = congestion[i];
      /* 96+ ≈ nearly stopped; 90 catches many signalized intersections */
      const nearStopByCongestion = typeof c === "number" && c >= 96;
      const nearStopByClosure = closures[i] === true;
      if ((nearStopByCongestion || nearStopByClosure) && firstNearStop == null) {
        firstNearStop = total + i;
      }
    }
    total += segCount;
  }
  if (firstNearStop == null || total <= 0) return null;
  return Math.max(0, Math.min(1, (firstNearStop + 0.5) / total));
}

async function fetchDirectionsOnce(
  path: string,
  accessToken: string
): Promise<MapboxTrafficLeg | null> {
  const url = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${path}`
  );
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("overview", "false");
  url.searchParams.set("annotations", "congestion_numeric");

  const res = await fetchWithTimeout({
    input: url.toString(),
    init: { method: "GET" },
    timeoutMs: MAPBOX_TRAFFIC_TIMEOUT_MS,
  });
  const data = (await res.json()) as DirectionsResponse;

  if (!res.ok) {
    console.warn(
      "[traffic] Mapbox Directions HTTP",
      res.status,
      data.message ?? data.code ?? res.statusText
    );
    return null;
  }

  if (data.code && data.code !== "Ok") {
    console.warn("[traffic] Mapbox Directions", data.code, data.message ?? "");
    return null;
  }

  const route = data.routes?.[0];
  const durationSec = route?.duration;
  if (durationSec == null || !Number.isFinite(durationSec) || !route) {
    return null;
  }

  const typicalSec = route.duration_typical;
  const typicalMin =
    typicalSec != null && Number.isFinite(typicalSec) ? typicalSec / 60 : durationSec / 60;
  const liveMin = durationSec / 60;
  const delayMin = Math.max(0, liveMin - typicalMin);

  const hasClosure = route.legs?.some(
    (l) => l.annotation?.closure?.some((c) => c === true)
  ) ?? false;

  return {
    mapboxDurationMinutes: liveMin,
    typicalDurationMinutes: typicalMin,
    delayVsTypicalMinutes: delayMin,
    congestionSummary: summarizeCongestion(route),
    hasClosure,
    nearStopFraction: detectNearStopFraction(route),
  };
}

/**
 * Live traffic-aware duration along a path that follows the given polyline (sampled waypoints).
 * Delay is computed against Mapbox's own free-flow baseline (duration_typical), not ORS.
 * Retries with fewer samples if Mapbox rejects the request (e.g. NoRoute).
 */
export async function fetchMapboxTrafficAlongPolyline(
  accessToken: string,
  geometry: LngLat[]
): Promise<MapboxTrafficLeg | null> {
  for (const n of SAMPLE_TRIES) {
    const coords = samplePolylineForMapbox(geometry, Math.min(n, MAPBOX_MAX_COORDS));
    if (coords.length < 2) return null;
    const path = coords.map(([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`).join(";");
    const leg = await fetchDirectionsOnce(path, accessToken);
    if (leg) return leg;
  }
  return null;
}
