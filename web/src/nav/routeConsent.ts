import { closestPointOnPolyline, pointAtAlongMeters, polylineLengthMeters } from "./routeGeometry";
import { routeGeometryAgreesWithLocked } from "./lockedRouteGeometryGuard";
import type { DrivingRejoinMode, RoadNetworkClass } from "./drivingRejoinContext";
import type { LngLat } from "./types";

/**
 * Route consent — Bill's tiered contract (docs/ROUTE_CONSENT.md):
 *
 *   city    → rerouting is fully automatic; the driver cannot interact.
 *   town    → inform: "route line changed, same destination" — non-blocking.
 *   highway → offer: show the change, allow "return to original route";
 *             the offer times out and falls through to the fastest route
 *             already installed, so it can never stall progress.
 *
 * Materiality decides whether the consent UX fires at all: a tactical move
 * that stays on the approved corridor is execution, not rerouting.
 */

export type ConsentTier = "city" | "town" | "highway";

/** How the driver is told about a route change. */
export type RouteChangeUx = "silent" | "notify" | "offer";

export type RouteChangeMateriality = "tactical" | "material";

/** Highway offer window — long enough to glance at the map, short enough
 *  that a missed banner never matters (the new route is already guiding). */
export const ROUTE_CHANGE_OFFER_TIMEOUT_MS = 20_000;

/** A proposed line "rejoins" the previous corridor when this fraction of its
 *  samples sit within the lateral bound of the old line. */
export const REJOIN_AGREE_MAX_LATERAL_M = 220;
export const REJOIN_AGREE_MIN_FRACTION = 0.45;
const REJOIN_SAMPLE_STEP_M = 350;

/**
 * Consent tier from the road context the off-route poll already maintains.
 * `auto_local` (city streets on a local trip / local phase) is the city tier;
 * plain city_streets on a through trip is town — streets spread out enough
 * that a visible notice lands. Highway always gets the offer tier.
 */
export function consentTierForContext(input: {
  roadClass: RoadNetworkClass;
  rejoinMode: DrivingRejoinMode;
}): ConsentTier {
  if (input.roadClass === "highway") return "highway";
  if (input.roadClass === "city_streets" && input.rejoinMode === "auto_local") {
    return "city";
  }
  return "town";
}

/**
 * Tactical = the proposed line still largely follows the corridor the driver
 * locked (rejoin-style recovery, corridor refinement). Material = a different
 * road to the same destination — the case Bill wants surfaced.
 */
export function classifyRouteChangeMateriality(input: {
  proposedGeometry: LngLat[];
  previousGeometry: LngLat[] | null | undefined;
}): RouteChangeMateriality {
  const prev = input.previousGeometry;
  if (!prev || prev.length < 2 || input.proposedGeometry.length < 2) return "material";
  if (routeGeometryAgreesWithLocked(input.proposedGeometry, prev)) return "tactical";
  return "material";
}

/**
 * Does the proposed line get back onto the previous corridor ahead? Used to
 * word the offer honestly ("rejoins your route at X") and to prefer keeping
 * the old line as the return target.
 */
export function proposedRejoinsPreviousCorridor(input: {
  proposedGeometry: LngLat[];
  previousGeometry: LngLat[];
  maxLateralM?: number;
  minFraction?: number;
}): boolean {
  const { proposedGeometry, previousGeometry } = input;
  if (proposedGeometry.length < 2 || previousGeometry.length < 2) return false;
  const maxLat = input.maxLateralM ?? REJOIN_AGREE_MAX_LATERAL_M;
  const minFrac = input.minFraction ?? REJOIN_AGREE_MIN_FRACTION;
  const totalM = polylineLengthMeters(proposedGeometry);
  if (totalM < 80) return false;
  const step = Math.max(REJOIN_SAMPLE_STEP_M, totalM / 40);
  let hits = 0;
  let checks = 0;
  for (let d = 0; d <= totalM; d += step) {
    checks++;
    const pt = pointAtAlongMeters(proposedGeometry, d);
    if (closestPointOnPolyline(pt, previousGeometry).lateralMetersApprox <= maxLat) hits++;
  }
  return checks > 0 && hits / checks >= minFrac;
}

/**
 * The consent decision for a completed route change.
 *  - tactical        → "notify" (a line moved but stayed on your corridor —
 *                      voice/hint only, never a blocking card)
 *  - material+city   → "notify" (auto; eyes-free alert, no tap required)
 *  - material+town   → "notify" (visible transient notice)
 *  - material+highway→ "offer" when a previous corridor exists to return to,
 *                      else "notify" — there is nothing to offer back to.
 */
export function routeChangeUxFor(input: {
  materiality: RouteChangeMateriality;
  tier: ConsentTier;
  canReturnToPrevious: boolean;
}): RouteChangeUx {
  if (input.materiality === "tactical") return "notify";
  if (input.tier === "highway" && input.canReturnToPrevious) return "offer";
  return "notify";
}

/**
 * A pending "route changed — keep or return?" card. The new route is ALREADY
 * installed and guiding: dismissing or letting the timeout expire keeps it
 * (the fastest-from-here fallback). "Return" replans through a rejoin point
 * on `previousGeometry`. Shared shape — the hazard-bypass flow (P3) mounts
 * the same consent surface later.
 */
export type RouteChangeOffer = {
  id: number;
  createdAtMs: number;
  /** Corridor the driver locked before the change — the return target. */
  previousGeometry: LngLat[];
  /** Route id now guiding (for diagnostics / future undo). */
  newRouteId: string;
  /** New line merges back onto the old corridor — word the card honestly. */
  rejoinsPrevious: boolean;
};
