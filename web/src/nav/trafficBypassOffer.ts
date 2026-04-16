import type { RouteAlert } from "./routeAlerts";
import { closestAlongRouteMeters } from "./routeGeometry";
import type { LngLat } from "./types";
import {
  BYPASS_HEAVY_DELAY_MINUTES,
  DRIVE_AHEAD_WINDOW_M,
  METERS_PER_MILE,
  TRAFFIC_DELAY_ALERT_MINUTES,
} from "./constants";

export type TrafficBypassOffer = {
  /** Short label for UI */
  headline: string;
  /** Distance to the slow/stop stretch ahead (miles) */
  aheadMi: number;
  /** Fused traffic delay minutes for this leg (when known) */
  delayMinutes: number;
};

/**
 * Offer a live “bypass” CTA when heavy traffic is ahead on the active polyline.
 * True exit-before / rejoin-after interchanges need waypoint routing; this only gates the offer.
 */
export function computeTrafficBypassOffer(
  geometry: LngLat[] | undefined,
  userLngLat: LngLat | null,
  routeAlerts: RouteAlert[],
  trafficDelayMinutes: number
): TrafficBypassOffer | null {
  if (!geometry?.length || !userLngLat) return null;
  const { alongMeters: userAlong } = closestAlongRouteMeters(userLngLat, geometry);

  let bestAhead = Infinity;
  let headline = "";

  for (const a of routeAlerts) {
    if (!a.promptRerouteAhead) continue;
    const aheadM = a.alongMeters - userAlong;
    if (aheadM <= 0 || aheadM > DRIVE_AHEAD_WINDOW_M) continue;

    const isTraffic =
      a.id === "traffic-delay" ||
      a.id === "traffic" ||
      /traffic|slow|congest|delay|jam/i.test(a.title + " " + a.detail);

    if (isTraffic && (a.severity >= 68 || trafficDelayMinutes >= TRAFFIC_DELAY_ALERT_MINUTES)) {
      if (aheadM < bestAhead) {
        bestAhead = aheadM;
        headline = a.title;
      }
    }
  }

  if (bestAhead < Infinity) {
    return {
      headline: headline || "Traffic ahead",
      aheadMi: bestAhead / METERS_PER_MILE,
      delayMinutes: trafficDelayMinutes,
    };
  }

  if (trafficDelayMinutes >= BYPASS_HEAVY_DELAY_MINUTES) {
    return {
      headline: "Heavy delay on corridor",
      aheadMi: Math.min(4.5, DRIVE_AHEAD_WINDOW_M / METERS_PER_MILE),
      delayMinutes: trafficDelayMinutes,
    };
  }

  return null;
}
