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

function shortTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Banner is the entry point to the A/B/C bypass-compare flow, so it only fires for road events
 * we can plausibly route around (traffic, closure, incident, construction) with a real driver
 * action available. Weather (NWS / radar) is intentionally excluded — it's already covered by
 * the advisory bar and rerouting around weather isn't useful, so a banner there would just be
 * a redundant duplicate.
 */
export function impactQualifiesForDriveApproachBanner(i: RouteImpact): boolean {
  const ahead = i.distanceAheadMeters;
  if (ahead == null || ahead <= PASSED_CLEAR_METERS) return false;

  if (
    i.category !== "traffic" &&
    i.category !== "closure" &&
    i.category !== "incident" &&
    i.category !== "construction"
  ) {
    return false;
  }

  if (i.confidence === "low") return false;

  return (
    i.driverAction === "rerouteRecommended" || i.driverAction === "rerouteAvailable"
  );
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
 * Stricter early band (≈2–5 mi out): only the strongest reroute-recommended road events.
 * Same road-only scope as the near band, just gated harder so we don't alarm the driver
 * 5 minutes before a problem we'd merely "watch".
 */
export function impactQualifiesForEarlyMajorApproach(i: RouteImpact): boolean {
  if (!impactQualifiesForDriveApproachBanner(i)) return false;
  return i.driverAction === "rerouteRecommended" || i.severity === "avoid";
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
 * Prefer **near** (~2 mi) when anything qualifies; otherwise **early** (~2–5 mi, more at
 * highway speeds) for major hazards only. The early-band ceiling is speed-aware: at 65 mph,
 * a 5 mi warning is only ~4.5 minutes — not enough lead time to decide and exit. Caller can
 * pass live `speedMps` to widen the early band up to ~8 mi for interstate speeds.
 */
export function pickDriveApproachBanner(
  impacts: RouteImpact[],
  dismissedIds: ReadonlySet<string>,
  earlyMaxMeters: number = DRIVE_HAZARD_APPROACH_EARLY_MAX_METERS
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

  const earlyCeiling = Math.max(DRIVE_HAZARD_APPROACH_EARLY_MAX_METERS, earlyMaxMeters);
  const earlyList = impacts.filter((i) => {
    if (!impactQualifiesForEarlyMajorApproach(i)) return false;
    if (dismissedIds.has(`e:${i.id}`)) return false;
    const a = i.distanceAheadMeters;
    if (a == null) return false;
    return a > DRIVE_HAZARD_APPROACH_NEAR_MAX_METERS && a <= earlyCeiling;
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
