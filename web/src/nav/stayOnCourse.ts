import { destination } from "@turf/destination";
import { distance } from "@turf/distance";
import { point } from "@turf/helpers";
import type { LngLat, NavRoute } from "./types";

/**
 * Driver's-way recovery (field report Nov 19: 42 off-routes, 34 Core restarts —
 * every GPS→dest replan kept answering "get back on the highway"). When the
 * driver deliberately leaves the corridor, the road they are on is itself a
 * route choice: fetch a line that is FORCED through a waypoint just ahead on
 * their heading, and prefer it unless it costs meaningfully more time.
 */

/** How far ahead the stay-on-course waypoint sits — past the next intersection
 *  so Mapbox commits to the road being driven, close enough that a
 *  still-turning heading does not overshoot the bend. */
export const STAY_ON_COURSE_VIA_AHEAD_M = 1_100;
/** Below ~9 mph the GPS course is noise (pulling out, parking lot). */
export const STAY_ON_COURSE_MIN_SPEED_MPS = 4;
/** Do not aim a stay-on waypoint when the destination is barely past it. */
export const STAY_ON_COURSE_MIN_DEST_M = 2_800;
/** The driver's road may keep this much ETA over Mapbox's fastest and still
 *  win — they are already driving it; re-fighting them is the failure mode. */
export const STAY_ON_COURSE_MAX_EXTRA_MIN = 6;
/** A stay pick this much worse is abandoned — protects a truly wrong road. */

/**
 * Point ~1.1 km ahead on the driver's travel heading — a `via` that makes the
 * Directions engine route along the road being driven instead of snapping the
 * origin back toward the corridor just left.
 */
export function stayOnCourseWaypoint(input: {
  userLngLat: LngLat;
  headingDeg: number | null | undefined;
  speedMps: number | null | undefined;
  destLngLat: LngLat | null | undefined;
}): LngLat | null {
  const { userLngLat, headingDeg, speedMps, destLngLat } = input;
  if (headingDeg == null || !Number.isFinite(headingDeg)) return null;
  if (speedMps == null || !Number.isFinite(speedMps) || speedMps < STAY_ON_COURSE_MIN_SPEED_MPS) {
    return null;
  }
  if (!destLngLat) return null;
  const toDestM = distance(
    point([userLngLat[0], userLngLat[1]]),
    point([destLngLat[0], destLngLat[1]]),
    { units: "meters" }
  );
  if (toDestM < STAY_ON_COURSE_MIN_DEST_M) return null;
  const wp = destination(
    point([userLngLat[0], userLngLat[1]]),
    STAY_ON_COURSE_VIA_AHEAD_M / 1000,
    headingDeg,
    { units: "kilometers" }
  );
  const c = wp.geometry.coordinates;
  return [c[0]!, c[1]!];
}

/**
 * Choose between the driver's-road candidate and the fastest-from-here
 * candidate. The stay line wins any tie up to the extra-minutes cap — the
 * driver already voted with their wheels; ETA parity means follow them.
 */
export function pickStayOnRoadRoute(input: {
  stayRoute: NavRoute | null | undefined;
  fastestRoute: NavRoute | null | undefined;
  maxExtraMin?: number;
}): NavRoute | null {
  const { stayRoute, fastestRoute } = input;
  if (!stayRoute?.geometry?.length) return fastestRoute ?? null;
  if (!fastestRoute?.geometry?.length) return stayRoute;
  const cap = input.maxExtraMin ?? STAY_ON_COURSE_MAX_EXTRA_MIN;
  return stayRoute.baseEtaMinutes <= fastestRoute.baseEtaMinutes + cap
    ? stayRoute
    : fastestRoute;
}
