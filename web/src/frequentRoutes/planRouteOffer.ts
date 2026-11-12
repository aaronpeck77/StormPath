import { SAVED_ROUTE_AVG_KMH } from "../nav/constants";
import { buildTurnStepsFromRecordedGeometry } from "../nav/recordedPathTurnSteps";
import {
  closestAlongRouteMeters,
  haversineMeters,
  polylineLengthMeters,
  routeCorridorOverlapFraction,
  slicePolylineBetweenAlong,
} from "../nav/routeGeometry";
import type { LngLat, NavRoute } from "../nav/types";
import type { FrequentRouteCluster } from "./types";

/**
 * Plan-time "Your route": a learned corridor (commute etc.) offered as a third
 * pick beside Fastest/Straightest — only when the driver is planning near the
 * learned origin, at a usual time, toward the learned destination.
 */

export const LEARNED_ROUTE_ID_PREFIX = "r-your-route-corridor-";
export const LEARNED_ROUTE_MIN_COUNT = 3;
export const LEARNED_ROUTE_MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000;
export const LEARNED_ROUTE_ORIGIN_MATCH_M = 500;
export const LEARNED_ROUTE_DEST_MATCH_M = 600;
/** Local-time window around a learned start time (minutes, either side). */
export const LEARNED_ROUTE_TIME_WINDOW_MIN = 80;
/** Keep some lead-in so guidance does not demand an instant U-turn at trip start. */
const TRIM_LEAD_IN_M = 60;
/** Learned GPS trace vs the Mapbox line — wider corridor absorbs GPS noise. */
const LEARNED_DUPLICATE_CORRIDOR_M = 140;
const LEARNED_DUPLICATE_OVERLAP = 0.9;
const MAX_RECENT_STARTS_USED = 12;

export type LearnedPlanMatch = {
  cluster: FrequentRouteCluster;
  /** Corridor oriented toward the planned destination and trimmed to the driver. */
  geometry: LngLat[];
};

function minutesOfDay(t: number): number {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
}

function circularDayDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 1440;
  return d > 720 ? 1440 - d : d;
}

/**
 * Time trigger: with ≥3 recorded starts we know "when" this corridor is usual.
 * A real weekly rhythm (3–6 distinct weekdays) also gates the day; 7-day or
 * thin history does not. Fewer than 3 starts → no time gate (not enough data).
 */
export function learnedStartTimesMatch(recentStarts: number[] | undefined, now: number): boolean {
  const starts = (recentStarts ?? []).filter((t) => Number.isFinite(t)).slice(-MAX_RECENT_STARTS_USED);
  if (starts.length < 3) return true;

  const nowDow = new Date(now).getDay();
  const days = new Set(starts.map((t) => new Date(t).getDay()));
  if (days.size >= 3 && days.size <= 6 && !days.has(nowDow)) return false;

  const nowMin = minutesOfDay(now);
  return starts.some(
    (t) => circularDayDiff(minutesOfDay(t), nowMin) <= LEARNED_ROUTE_TIME_WINDOW_MIN
  );
}

/** Orient cluster geometry so it runs user → destination; null when ends don't match. */
function orientedToward(
  cluster: FrequentRouteCluster,
  user: LngLat,
  dest: LngLat
): LngLat[] | null {
  const g = cluster.geometry;
  if (g.length < 2) return null;
  const dUserStart = haversineMeters(user, g[0]!);
  const dUserEnd = haversineMeters(user, g[g.length - 1]!);
  const oriented = dUserStart <= dUserEnd ? g : [...g].reverse();
  if (haversineMeters(user, oriented[0]!) > LEARNED_ROUTE_ORIGIN_MATCH_M) return null;
  if (haversineMeters(dest, oriented[oriented.length - 1]!) > LEARNED_ROUTE_DEST_MATCH_M) {
    return null;
  }
  return oriented;
}

/**
 * Best learned corridor for this plan, or null. Requires: enough repeats,
 * recent use, driver near the learned start, destination near the learned end,
 * usual time-of-day, and a path that actually differs from the primary route.
 */
export function matchLearnedPlanRoute(opts: {
  clusters: FrequentRouteCluster[];
  userLngLat: LngLat | null;
  destLngLat: LngLat | null;
  /** Primary (fastest) geometry — used to suppress a duplicate "Your route" card. */
  primaryGeometry?: LngLat[] | null;
  now?: number;
}): LearnedPlanMatch | null {
  const { clusters, userLngLat, destLngLat } = opts;
  if (!userLngLat || !destLngLat || clusters.length === 0) return null;
  const now = opts.now ?? Date.now();
  const primary = opts.primaryGeometry;

  let best: { cluster: FrequentRouteCluster; geometry: LngLat[] } | null = null;
  for (const cluster of clusters) {
    if (cluster.count < LEARNED_ROUTE_MIN_COUNT) continue;
    if (now - cluster.lastSeen > LEARNED_ROUTE_MAX_AGE_MS) continue;
    if (!learnedStartTimesMatch(cluster.recentStarts, now)) continue;
    const oriented = orientedToward(cluster, userLngLat, destLngLat);
    if (!oriented) continue;
    if (
      primary &&
      primary.length >= 2 &&
      routeCorridorOverlapFraction(oriented, primary, {
        corridorM: LEARNED_DUPLICATE_CORRIDOR_M,
      }) >= LEARNED_DUPLICATE_OVERLAP
    ) {
      continue;
    }
    if (
      !best ||
      cluster.count > best.cluster.count ||
      (cluster.count === best.cluster.count && cluster.lastSeen > best.cluster.lastSeen)
    ) {
      best = { cluster, geometry: oriented };
    }
  }
  if (!best) return null;

  const total = polylineLengthMeters(best.geometry);
  const { alongMeters } = closestAlongRouteMeters(userLngLat, best.geometry);
  const startM = Math.max(0, Math.min(alongMeters - TRIM_LEAD_IN_M, total - 1));
  const trimmed = slicePolylineBetweenAlong(best.geometry, startM, total);
  const geometry = trimmed.length >= 2 ? trimmed : best.geometry;
  return { cluster: best.cluster, geometry };
}

/** Turn a learned match into a navigable route — same machinery as saved routes. */
export function learnedMatchToNavRoute(match: LearnedPlanMatch): NavRoute {
  const meters = polylineLengthMeters(match.geometry);
  const etaMinutes = Math.max(1, Math.round((meters / 1000 / SAVED_ROUTE_AVG_KMH) * 60));
  return {
    id: `${LEARNED_ROUTE_ID_PREFIX}${match.cluster.id}`,
    role: "balanced",
    label: "Your route",
    geometry: match.geometry,
    baseEtaMinutes: etaMinutes,
    turnSteps: buildTurnStepsFromRecordedGeometry(match.geometry),
    routeNotices: ["Learned from your drives — ETA is an estimate."],
  };
}
