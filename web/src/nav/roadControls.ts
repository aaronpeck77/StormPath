import type { LngLat, RoadControlKind, RoadControlPoint } from "./types";

/** Cap so a city-heavy cross-country plan cannot balloon stored routes. */
export const MAX_ROAD_CONTROLS = 1500;

type IntersectionLike = {
  location?: number[];
  traffic_signal?: boolean;
  stop_sign?: boolean;
  yield_sign?: boolean;
  railway_crossing?: boolean;
};

type LegLike = { steps?: { intersections?: IntersectionLike[] }[] };

/**
 * Which kinds we draw. Stop and yield flags come from OSM tagging and are missing on
 * most residential streets — a Sep 16 probe returned 0–2 stop signs per 2 mi where
 * every block has one, against 14 signals in 3.8 downtown mi. A layer that shows one
 * stop sign in ten teaches you to distrust the signals too, so only the well-covered
 * kinds draw. Collection keeps all four; add "stop_sign" back here if coverage improves.
 */
export const ROAD_CONTROL_DISPLAY_KINDS: readonly RoadControlKind[] = [
  "traffic_signal",
  "railway_crossing",
];

export function displayedRoadControls(
  points: RoadControlPoint[] | null | undefined
): RoadControlPoint[] {
  if (!points?.length) return [];
  return points.filter((p) => ROAD_CONTROL_DISPLAY_KINDS.includes(p.kind));
}

/** One node can carry several flags — show the one the driver actually obeys. */
function roadControlKindOf(ix: IntersectionLike): RoadControlKind | null {
  if (ix.traffic_signal === true) return "traffic_signal";
  if (ix.stop_sign === true) return "stop_sign";
  if (ix.railway_crossing === true) return "railway_crossing";
  if (ix.yield_sign === true) return "yield_sign";
  return null;
}

/**
 * Controlled intersections from Mapbox Directions `intersections[]`. Mapbox flags
 * these per node on the driven line, so the points are already on our corridor —
 * no snapping needed.
 */
export function collectRoadControls(legs: LegLike[] | undefined): RoadControlPoint[] | undefined {
  if (!legs?.length) return undefined;
  const out: RoadControlPoint[] = [];
  const seen = new Set<string>();
  for (const leg of legs) {
    for (const step of leg.steps ?? []) {
      for (const ix of step.intersections ?? []) {
        const kind = roadControlKindOf(ix);
        if (!kind) continue;
        const loc = ix.location;
        if (!loc || loc.length < 2) continue;
        const lng = loc[0]!;
        const lat = loc[1]!;
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        /* Adjacent steps repeat the shared node — 5 dp is about a meter. */
        const key = `${kind}:${lng.toFixed(5)},${lat.toFixed(5)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ lngLat: [lng, lat] as LngLat, kind });
        if (out.length >= MAX_ROAD_CONTROLS) return out;
      }
    }
  }
  return out.length ? out : undefined;
}
