import type { RouteImpact, RouteImpactConfidence } from "./routeImpacts";
import {
  BYPASS_HEAVY_DELAY_MINUTES,
  DRIVE_AHEAD_WINDOW_M,
  METERS_PER_MILE,
} from "./constants";

export type TrafficBypassOffer = {
  /** Short label for UI */
  headline: string;
  /** Distance to the slow/stop stretch ahead (miles) */
  aheadMi: number;
  /** Fused traffic delay minutes for this leg (when known) */
  delayMinutes: number;
  /** How sure we are about the bypass anchor — drives copy strength in the compare panel. */
  confidence: RouteImpactConfidence;
  /** Source category — determines whether this is a clean traffic jam, a closure, or a fallback delay. */
  category: "traffic" | "closure" | "incident" | "construction" | "other";
};

/**
 * Pick the best impact ahead that warrants a bypass offer.
 *
 * Prefers traffic / closure / incident impacts the driver should act on, with at least medium
 * confidence so we don't push a strong "reroute recommended" prompt off a low-confidence anchor.
 */
/** Nearest reroute-worthy traffic / closure / incident / construction ahead (excludes low-confidence). */
export function pickTrafficBypassAnchorImpact(impacts: RouteImpact[]): RouteImpact | null {
  let best: RouteImpact | null = null;
  let bestAhead = Infinity;
  for (const i of impacts) {
    const cat = i.category;
    if (cat !== "traffic" && cat !== "closure" && cat !== "incident" && cat !== "construction") continue;
    if (i.driverAction !== "rerouteRecommended" && i.driverAction !== "rerouteAvailable") continue;
    if (i.confidence === "low") continue;
    const ahead = i.distanceAheadMeters;
    if (ahead == null || ahead <= 0 || ahead > DRIVE_AHEAD_WINDOW_M) continue;
    if (ahead < bestAhead) {
      bestAhead = ahead;
      best = i;
    }
  }
  return best;
}

/**
 * Offer a live "bypass" CTA when a real reroute-worthy impact is ahead on the active polyline,
 * or as a soft fallback when total corridor delay is heavy enough.
 */
export function computeTrafficBypassOffer(
  impacts: RouteImpact[],
  trafficDelayMinutes: number
): TrafficBypassOffer | null {
  const anchor = pickTrafficBypassAnchorImpact(impacts);
  if (anchor) {
    const cat: TrafficBypassOffer["category"] =
      anchor.category === "traffic" ||
      anchor.category === "closure" ||
      anchor.category === "incident" ||
      anchor.category === "construction"
        ? anchor.category
        : "other";
    return {
      headline: anchor.driverHeadline,
      aheadMi: (anchor.distanceAheadMeters ?? 0) / METERS_PER_MILE,
      delayMinutes: trafficDelayMinutes,
      confidence: anchor.confidence,
      category: cat,
    };
  }

  /* Soft fallback: corridor-wide delay is heavy. We don't know exactly where the jam is, so confidence is low. */
  if (trafficDelayMinutes >= BYPASS_HEAVY_DELAY_MINUTES) {
    return {
      headline: "Heavy delay on corridor",
      aheadMi: Math.min(4.5, DRIVE_AHEAD_WINDOW_M / METERS_PER_MILE),
      delayMinutes: trafficDelayMinutes,
      confidence: "low",
      category: "traffic",
    };
  }

  return null;
}
