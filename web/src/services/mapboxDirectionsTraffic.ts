import type { LngLat } from "../nav/types";
import { fetchWithTimeout, MAPBOX_TRAFFIC_TIMEOUT_MS } from "../utils/fetchResilient";
import { recordMapboxUsage } from "../monitoring/mapboxUsageMeter";

/** Mapbox Directions API limit for coordinates in one request. */
const MAPBOX_MAX_COORDS = 25;

const SAMPLE_TRIES = [25, 16, 8, 3] as const;

/** Evenly sample vertices so the traffic profile follows the route corridor approximately. */
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
  /** Live Mapbox incidents typed as construction (plan-time gaps; refreshes with traffic poll). */
  constructionCount: number;
  /** Short label from the first construction incident, if any. */
  constructionSummary: string | null;
  /** Approximate position of near-stopped traffic along the leg (0..1), if detected. */
  nearStopFraction: number | null;
  /** First segment at/above heavy congestion along the sampled path (0..1), if any. */
  firstHeavyCongestionFraction: number | null;
};

type DirectionsRoute = {
  duration?: number;
  duration_typical?: number;
  legs?: {
    annotation?: {
      congestion_numeric?: (number | null)[];
    };
    /**
     * Live-traffic closures on this leg (requires `annotations=closure` + `overview=full`).
     * Response field is `closures`, NOT a boolean array under `annotation.closure`.
     */
    closures?: { geometry_index_start?: number; geometry_index_end?: number }[];
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

/** True when segment index `i` falls inside any leg closure range. */
function segmentIsClosed(
  i: number,
  closures: { geometry_index_start?: number; geometry_index_end?: number }[] | undefined
): boolean {
  if (!closures?.length) return false;
  return closures.some(
    (c) =>
      typeof c.geometry_index_start === "number" &&
      typeof c.geometry_index_end === "number" &&
      i >= c.geometry_index_start &&
      i <= c.geometry_index_end
  );
}

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
    const segCount = congestion.length;
    if (segCount <= 0) continue;
    for (let i = 0; i < segCount; i++) {
      const c = congestion[i];
      /* 96+ ≈ nearly stopped; 90 catches many signalized intersections */
      const nearStopByCongestion = typeof c === "number" && c >= 96;
      const nearStopByClosure = segmentIsClosed(i, leg.closures);
      if ((nearStopByCongestion || nearStopByClosure) && firstNearStop == null) {
        firstNearStop = total + i;
      }
    }
    total += segCount;
  }
  if (firstNearStop == null || total <= 0) return null;
  return Math.max(0, Math.min(1, (firstNearStop + 0.5) / total));
}

/** First segment with congestion ≥ 60 (heavy-ish) — anchors delay to a real place on the polyline. */
function detectFirstHeavyCongestionFraction(route: DirectionsRoute): number | null {
  let total = 0;
  let firstHeavy: number | null = null;
  for (const leg of route.legs ?? []) {
    const congestion = leg.annotation?.congestion_numeric ?? [];
    const segCount = congestion.length;
    if (segCount <= 0) continue;
    for (let i = 0; i < segCount; i++) {
      const c = congestion[i];
      if (typeof c === "number" && c >= 60 && firstHeavy == null) {
        firstHeavy = total + i;
      }
    }
    total += segCount;
  }
  if (firstHeavy == null || total <= 0) return null;
  return Math.max(0, Math.min(1, (firstHeavy + 0.5) / total));
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
  /* Mapbox requires overview=full for `annotations` to be populated — with `false` the
   * congestion_numeric / closure arrays come back empty, silently hiding all live
   * construction / closure / congestion detection while duration still updates. */
  url.searchParams.set("overview", "full");
  url.searchParams.set("annotations", "congestion_numeric,closure");

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

  recordMapboxUsage("directions");

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

  const hasClosure = route.legs?.some((l) => (l.closures?.length ?? 0) > 0) ?? false;

  const constructionIncidents =
    route.legs?.flatMap((l) => l.incidents ?? []).filter((inc) => {
      const t = (inc.type ?? "").toLowerCase();
      const sub = (inc.sub_type ?? "").toLowerCase();
      return t.includes("construction") || sub.includes("construction") || sub.includes("lane_restriction");
    }) ?? [];
  const constructionCount = constructionIncidents.length;
  const firstConstruction = constructionIncidents[0];
  const constructionSummary =
    firstConstruction?.description?.trim() ||
    firstConstruction?.long_description?.trim() ||
    null;

  return {
    mapboxDurationMinutes: liveMin,
    typicalDurationMinutes: typicalMin,
    delayVsTypicalMinutes: delayMin,
    congestionSummary: summarizeCongestion(route),
    hasClosure,
    constructionCount,
    constructionSummary,
    nearStopFraction: detectNearStopFraction(route),
    firstHeavyCongestionFraction: detectFirstHeavyCongestionFraction(route),
  };
}

/**
 * Live traffic-aware duration along a path that follows the given polyline (sampled waypoints).
 * Delay is computed against Mapbox's own free-flow baseline (duration_typical).
 * Retries with fewer samples if Mapbox rejects the request (e.g. NoRoute).
 */
/** Best Mapbox-derived fraction along the sampled path for map / fly-to (near-stop wins). */
export function trafficCongestionAnchorFraction(leg: MapboxTrafficLeg | null | undefined): number | null {
  if (!leg) return null;
  if (leg.nearStopFraction != null) return leg.nearStopFraction;
  return leg.firstHeavyCongestionFraction ?? null;
}

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
