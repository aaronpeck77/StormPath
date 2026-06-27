/**
 * Along-route timing copy for NWS (and timeline) alerts — distance ahead, ETA, expiry, relevance.
 */

import { formatDurationMinutesMaybe } from "../ui/formatEta";

const METERS_PER_MILE = 1609.344;

export const ROUTE_ALERT_RELEVANCE_OVER_BEFORE = "Likely over before you reach it";
export const ROUTE_ALERT_RELEVANCE_STILL_ACTIVE = "Expected still active when you arrive";
export const ROUTE_ALERT_RELEVANCE_ENDING_AROUND = "May be ending around when you arrive";
export const ROUTE_ALERT_RELEVANCE_DEVELOPING = "Developing — likely active when you arrive";
export const ROUTE_ALERT_RELEVANCE_AFTER_PASS = "May begin after you pass";

/** Promote to the advisory top strip when enter ETA is within this many minutes. */
export const ROUTE_ALERT_IMMINENT_ENTER_MIN = 45;

export type RouteAlertTimingInput = {
  startMeters: number;
  endMeters: number;
  userAlongMeters: number;
  totalMeters: number;
  planEtaMinutes: number | null;
  driveEtaMinutes?: number | null;
  expiresIso?: string | null;
  /** NWS onset / effective — when the hazard is expected to begin. */
  onsetIso?: string | null;
  /** false → corridor buffer only, route line does not cross polygon */
  crossesRoute?: boolean;
};

export type RouteAlertTiming = {
  aheadMeters: number;
  enterMin: number | null;
  exitMin: number | null;
  /** Prominent along-route position — e.g. "31 mi ahead", "Now". */
  locationLine: string;
  /** ETA, zone length, expiry, relevance — secondary to {@link locationLine}. */
  timingDetail: string | null;
  /** Full single-line copy (location + detail). */
  timingLine: string;
  relevanceNote: string | null;
  passed: boolean;
  inside: boolean;
  /** True when the driver should see a red urgent row above the hazard graph. */
  promoteToTop: boolean;
  /** Warning expires before driver ETA — hide from map / progress strip. */
  staleBeforeArrival: boolean;
  /** Hazard onset is after now but overlaps driver arrival window. */
  developingLater: boolean;
  developingNote: string | null;
};

export function fmtMi(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return "0 mi";
  const mi = meters / METERS_PER_MILE;
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

export function fmtMin(min: number | null | undefined): string | null {
  return formatDurationMinutesMaybe(min);
}

export function fmtExpires(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function expiryRelevanceNote(
  expiresIso: string | null | undefined,
  enterMin: number | null,
  nowMs: number
): string | null {
  if (!expiresIso || enterMin == null) return null;
  const exp = Date.parse(expiresIso);
  if (!Number.isFinite(exp)) return null;
  const arriveMs = nowMs + enterMin * 60_000;
  if (exp <= arriveMs - 3 * 60_000) return ROUTE_ALERT_RELEVANCE_OVER_BEFORE;
  if (exp <= arriveMs + 20 * 60_000) return ROUTE_ALERT_RELEVANCE_ENDING_AROUND;
  return ROUTE_ALERT_RELEVANCE_STILL_ACTIVE;
}

/** Onset after now but driver arrival overlaps the expected active window. */
export function developingLaterNote(
  onsetIso: string | null | undefined,
  enterMin: number | null,
  expiresIso: string | null | undefined,
  nowMs: number = Date.now()
): string | null {
  if (!onsetIso || enterMin == null) return null;
  const onset = Date.parse(onsetIso);
  if (!Number.isFinite(onset)) return null;
  if (onset <= nowMs + 2 * 60_000) return null;

  const arriveMs = nowMs + enterMin * 60_000;
  if (arriveMs < onset - 8 * 60_000) return null;

  if (arriveMs < onset) return ROUTE_ALERT_RELEVANCE_AFTER_PASS;

  if (expiresIso) {
    const exp = Date.parse(expiresIso);
    if (Number.isFinite(exp) && exp <= arriveMs - 3 * 60_000) return null;
  }

  return ROUTE_ALERT_RELEVANCE_DEVELOPING;
}

/** Build the standard timing / relevance line for an alert band on the route. */
export function formatRouteAlertTiming(opts: RouteAlertTimingInput): RouteAlertTiming {
  const nowMs = Date.now();
  const {
    startMeters,
    endMeters,
    userAlongMeters,
    totalMeters,
    planEtaMinutes,
    driveEtaMinutes = null,
    expiresIso,
    onsetIso,
    crossesRoute = true,
  } = opts;

  const passed = endMeters <= userAlongMeters;
  const inside = userAlongMeters >= startMeters && userAlongMeters < endMeters;
  const lengthMeters = Math.max(0, endMeters - startMeters);
  const isPoint = lengthMeters < 50;
  const aheadMeters = Math.max(0, startMeters - userAlongMeters);
  const aheadMi = fmtMi(aheadMeters);
  const lengthMi = !isPoint ? fmtMi(lengthMeters) : null;
  const expiresLabel = fmtExpires(expiresIso);

  const remainingM = Math.max(0, totalMeters - userAlongMeters);
  const effectiveEta =
    driveEtaMinutes != null && Number.isFinite(driveEtaMinutes)
      ? driveEtaMinutes
      : planEtaMinutes != null && Number.isFinite(planEtaMinutes) && totalMeters > 0
        ? planEtaMinutes * (remainingM / totalMeters)
        : null;

  const etaForM = (m: number): number | null => {
    if (effectiveEta == null || remainingM <= 0) return null;
    const ahead = Math.max(0, m - userAlongMeters);
    if (ahead <= 0) return 0;
    return effectiveEta * (ahead / remainingM);
  };

  const enterMin = etaForM(startMeters);
  const exitMin = etaForM(endMeters);
  const enterLabel = fmtMin(enterMin);
  const exitLabel = fmtMin(exitMin);
  const developingNote = developingLaterNote(onsetIso, enterMin, expiresIso, nowMs);
  const developingLater = developingNote === ROUTE_ALERT_RELEVANCE_DEVELOPING;
  const rel = expiryRelevanceNote(expiresIso, enterMin, nowMs);
  const staleBeforeArrival = rel === ROUTE_ALERT_RELEVANCE_OVER_BEFORE;

  let locationLine: string;
  const detailParts: string[] = [];

  if (passed) {
    locationLine = "Passed on your route";
  } else if (!crossesRoute) {
    locationLine = `${aheadMi} nearby`;
    detailParts.push("Along your route corridor");
    if (expiresLabel) detailParts.push(`exp ${expiresLabel}`);
  } else if (inside) {
    locationLine = "Now";
    if (!isPoint) detailParts.push(`Exits in ${exitLabel ?? "—"}`);
    if (expiresLabel) detailParts.push(`exp ${expiresLabel}`);
  } else if (isPoint) {
    locationLine = `${aheadMi} ahead`;
    if (enterLabel) detailParts.push(`~${enterLabel} drive`);
    if (expiresLabel) detailParts.push(`exp ${expiresLabel}`);
  } else {
    locationLine = `${aheadMi} ahead`;
    if (enterLabel) detailParts.push(`enter in ~${enterLabel}`);
    if (lengthMi) detailParts.push(`${lengthMi} zone`);
    if (expiresLabel) detailParts.push(`exp ${expiresLabel}`);
  }

  let timingDetail = detailParts.length ? detailParts.join(" · ") : null;
  const relevanceNote = passed
    ? null
    : developingLater && developingNote
      ? developingNote
      : rel;
  if (relevanceNote && !passed) {
    timingDetail = timingDetail ? `${timingDetail} · ${relevanceNote}` : relevanceNote;
  }

  const timingLine =
    passed || !timingDetail ? locationLine : `${locationLine} · ${timingDetail}`;

  const promoteToTop =
    !passed &&
    !staleBeforeArrival &&
    crossesRoute &&
    (developingLater ||
      relevanceNote === ROUTE_ALERT_RELEVANCE_STILL_ACTIVE ||
      relevanceNote === ROUTE_ALERT_RELEVANCE_ENDING_AROUND) &&
    (inside || (enterMin != null && enterMin <= ROUTE_ALERT_IMMINENT_ENTER_MIN));

  return {
    aheadMeters,
    enterMin,
    exitMin,
    locationLine,
    timingDetail,
    timingLine,
    relevanceNote: passed ? null : relevanceNote,
    passed,
    inside,
    promoteToTop,
    staleBeforeArrival,
    developingLater,
    developingNote: passed ? null : developingNote,
  };
}

/** At-your-position alerts (no route band) always surface above the graph. */
export function promoteAtPositionAlertToTop(): RouteAlertTiming {
  return {
    aheadMeters: 0,
    enterMin: 0,
    exitMin: null,
    locationLine: "Now",
    timingDetail: "At your position",
    timingLine: "At your position now",
    relevanceNote: null,
    passed: false,
    inside: true,
    promoteToTop: true,
    staleBeforeArrival: false,
    developingLater: false,
    developingNote: null,
  };
}

export function isAlertExpired(iso: string | null | undefined, nowMs = Date.now()): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t <= nowMs;
}

/** Map + progress strip: skip alerts that expire before the driver arrives. */
export function alertShowsOnDriveMap(timing: RouteAlertTiming): boolean {
  return !timing.passed && !timing.staleBeforeArrival;
}

/** Progress strip + route halo — serious items only, ETA-relevant. */
export function alertShowsOnProgressStrip(
  timing: RouteAlertTiming,
  severity: "info" | "caution" | "serious" | "avoid"
): boolean {
  if (timing.passed || timing.staleBeforeArrival) return false;
  return severity === "serious" || severity === "avoid";
}
