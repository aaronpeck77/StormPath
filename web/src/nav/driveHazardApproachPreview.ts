import type { RouteImpact } from "./routeImpacts";
import { compareRouteImpactPriority } from "./routeImpacts";
import { METERS_PER_MILE } from "./constants";

/** ~2 mi — show a short heads-up when the hazard is within this distance but not yet passed (any nav view). */
export const DRIVE_HAZARD_APPROACH_PREVIEW_METERS = 2 * METERS_PER_MILE;

const PASSED_CLEAR_METERS = 90;
/** Slight overshoot so the banner can appear just before the 2 mi mark on coarse GPS. */
const APPROACH_UPPER_SLACK_M = 380;

function shortTitle(raw: string, max = 52): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * High-trust hazards only: road work / crashes / anchored slow traffic, and strong NWS / radar.
 * (Avoids vague corridor delay and low-confidence traffic pins.)
 */
export function impactQualifiesForDriveApproachBanner(i: RouteImpact): boolean {
  const ahead = i.distanceAheadMeters;
  if (ahead == null || ahead <= PASSED_CLEAR_METERS) return false;

  if (i.category === "closure" || i.category === "incident" || i.category === "construction") {
    return i.confidence !== "low" || i.severity === "serious" || i.severity === "avoid";
  }
  if (i.category === "traffic" && i.source === "mapboxTraffic") {
    if (i.confidence === "low") return false;
    return (
      i.driverAction === "rerouteRecommended" ||
      i.driverAction === "rerouteAvailable" ||
      i.confidence === "high"
    );
  }
  if (i.source === "nws") {
    return i.severity === "serious" || i.severity === "avoid";
  }
  if (i.source === "radar") {
    return i.severity === "serious" || i.severity === "avoid";
  }
  return false;
}

export function approachBannerTitle(i: RouteImpact): string {
  return shortTitle(i.driverHeadline);
}

export function approachBannerShowsBypass(i: RouteImpact): boolean {
  return (
    (i.category === "traffic" || i.category === "closure") &&
    i.confidence !== "low" &&
    (i.driverAction === "rerouteRecommended" || i.driverAction === "rerouteAvailable")
  );
}

/**
 * Pick one impact to show in the ~2 mi approach strip, respecting dismissals.
 */
export function pickDriveApproachBannerImpact(
  impacts: RouteImpact[],
  dismissedIds: ReadonlySet<string>
): RouteImpact | null {
  const upper = DRIVE_HAZARD_APPROACH_PREVIEW_METERS + APPROACH_UPPER_SLACK_M;
  const candidates = impacts.filter((i) => {
    if (!impactQualifiesForDriveApproachBanner(i)) return false;
    if (dismissedIds.has(i.id)) return false;
    const a = i.distanceAheadMeters;
    if (a == null) return false;
    return a <= upper && a > PASSED_CLEAR_METERS;
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const pr = compareRouteImpactPriority(b, a);
    if (pr !== 0) return pr;
    const da = a.distanceAheadMeters ?? 1e12;
    const db = b.distanceAheadMeters ?? 1e12;
    return da - db;
  });
  return candidates[0] ?? null;
}
