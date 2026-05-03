import type { RouteImpact } from "./routeImpacts";
import { compareRouteImpactPriority } from "./routeImpacts";
import { METERS_PER_MILE } from "./constants";

/** ~2 mi — “near” heads-up (full actions when appropriate). */
export const DRIVE_HAZARD_APPROACH_PREVIEW_METERS = 2 * METERS_PER_MILE;

/** ~5 mi — early strip for major hazards only (stopped traffic, closures, strong weather). */
export const DRIVE_HAZARD_APPROACH_EARLY_MAX_METERS = 5 * METERS_PER_MILE;

const PASSED_CLEAR_METERS = 90;
/** Slight overshoot so the banner can appear just before the 2 mi mark on coarse GPS. */
const APPROACH_UPPER_SLACK_M = 380;

/** Upper bound for the near panel (≈2 mi + slack). */
export const DRIVE_HAZARD_APPROACH_NEAR_MAX_METERS =
  DRIVE_HAZARD_APPROACH_PREVIEW_METERS + APPROACH_UPPER_SLACK_M;

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
 * Major hazards only, for the **early** band (between near max and ~5 mi): interstate-style
 * stopped/slow traffic, hard road blocks, strong NWS/radar — not generic corridor delay.
 */
export function impactQualifiesForEarlyMajorApproach(i: RouteImpact): boolean {
  const ahead = i.distanceAheadMeters;
  if (ahead == null || ahead <= PASSED_CLEAR_METERS) return false;

  if (i.severity === "avoid" || i.severity === "serious") return true;

  if (i.category === "traffic" && i.source === "mapboxTraffic") {
    if (i.confidence === "low") return false;
    return i.driverAction === "rerouteRecommended";
  }

  if (i.category === "closure" || i.category === "incident" || i.category === "construction") {
    return i.driverAction === "rerouteRecommended" || i.driverAction === "rerouteAvailable";
  }

  return false;
}

export type DriveApproachBannerPhase = "early" | "near";

export type DriveApproachBannerPick = {
  impact: RouteImpact;
  phase: DriveApproachBannerPhase;
};

function sortApproachCandidates(candidates: RouteImpact[]): RouteImpact | null {
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

/**
 * Prefer **near** (~2 mi) when anything qualifies; otherwise **early** (~2–5 mi) for major hazards only.
 */
export function pickDriveApproachBanner(
  impacts: RouteImpact[],
  dismissedIds: ReadonlySet<string>
): DriveApproachBannerPick | null {
  const nearDismissed = (id: string) =>
    dismissedIds.has(`n:${id}`) || dismissedIds.has(id);

  const nearList = impacts.filter((i) => {
    if (!impactQualifiesForDriveApproachBanner(i)) return false;
    if (nearDismissed(i.id)) return false;
    const a = i.distanceAheadMeters;
    if (a == null) return false;
    return a <= DRIVE_HAZARD_APPROACH_NEAR_MAX_METERS && a > PASSED_CLEAR_METERS;
  });
  const near = sortApproachCandidates(nearList);
  if (near) return { impact: near, phase: "near" };

  const earlyList = impacts.filter((i) => {
    if (!impactQualifiesForEarlyMajorApproach(i)) return false;
    if (dismissedIds.has(`e:${i.id}`)) return false;
    const a = i.distanceAheadMeters;
    if (a == null) return false;
    return a > DRIVE_HAZARD_APPROACH_NEAR_MAX_METERS && a <= DRIVE_HAZARD_APPROACH_EARLY_MAX_METERS;
  });
  const early = sortApproachCandidates(earlyList);
  if (early) return { impact: early, phase: "early" };

  return null;
}

/** @deprecated Prefer {@link pickDriveApproachBanner} for phase-aware UI. */
export function pickDriveApproachBannerImpact(
  impacts: RouteImpact[],
  dismissedIds: ReadonlySet<string>
): RouteImpact | null {
  return pickDriveApproachBanner(impacts, dismissedIds)?.impact ?? null;
}
