/**
 * Along-route timing copy for NWS (and timeline) alerts — distance ahead, ETA, expiry, relevance.
 */

const METERS_PER_MILE = 1609.344;

export type RouteAlertTimingInput = {
  startMeters: number;
  endMeters: number;
  userAlongMeters: number;
  totalMeters: number;
  planEtaMinutes: number | null;
  driveEtaMinutes?: number | null;
  expiresIso?: string | null;
  /** false → corridor buffer only, route line does not cross polygon */
  crossesRoute?: boolean;
};

/** Promote to the advisory top strip when enter ETA is within this many minutes. */
export const ROUTE_ALERT_IMMINENT_ENTER_MIN = 45;

export type RouteAlertTiming = {
  aheadMeters: number;
  enterMin: number | null;
  exitMin: number | null;
  timingLine: string;
  relevanceNote: string | null;
  passed: boolean;
  inside: boolean;
  /** True when the driver should see a red urgent row above the hazard graph. */
  promoteToTop: boolean;
};

export function fmtMi(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return "0 mi";
  const mi = meters / METERS_PER_MILE;
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

export function fmtMin(min: number | null | undefined): string | null {
  if (min == null || !Number.isFinite(min) || min < 0) return null;
  if (min < 1) return "now";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
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

function relevanceNote(expiresIso: string | null | undefined, enterMin: number | null): string | null {
  if (!expiresIso || enterMin == null) return null;
  const exp = Date.parse(expiresIso);
  if (!Number.isFinite(exp)) return null;
  const arriveMs = Date.now() + enterMin * 60_000;
  /* Warning ends well before driver reaches the zone. */
  if (exp <= arriveMs - 3 * 60_000) return "Likely over before you reach it";
  if (exp <= arriveMs + 20 * 60_000) return "May be ending around when you arrive";
  return "Expected still active when you arrive";
}

/** Build the standard timing / relevance line for an alert band on the route. */
export function formatRouteAlertTiming(opts: RouteAlertTimingInput): RouteAlertTiming {
  const {
    startMeters,
    endMeters,
    userAlongMeters,
    totalMeters,
    planEtaMinutes,
    driveEtaMinutes = null,
    expiresIso,
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
  const rel = relevanceNote(expiresIso, enterMin);

  let timingLine: string;
  if (passed) {
    timingLine = "Passed on your route";
  } else if (!crossesRoute) {
    timingLine = `Nearby · ${aheadMi} down your route${expiresLabel ? ` · exp ${expiresLabel}` : ""}`;
  } else if (inside) {
    timingLine = isPoint
      ? `At this point on your route now${expiresLabel ? ` · exp ${expiresLabel}` : ""}`
      : `In this zone now · exits in ${exitLabel ?? "—"}${expiresLabel ? ` · exp ${expiresLabel}` : ""}`;
  } else if (isPoint) {
    timingLine = enterLabel
      ? `${aheadMi} ahead · ~${enterLabel} drive${expiresLabel ? ` · exp ${expiresLabel}` : ""}`
      : `${aheadMi} ahead${expiresLabel ? ` · exp ${expiresLabel}` : ""}`;
  } else {
    timingLine = enterLabel
      ? `${aheadMi} ahead · enter in ~${enterLabel} · ${lengthMi} zone${expiresLabel ? ` · exp ${expiresLabel}` : ""}`
      : `${aheadMi} ahead · ${lengthMi} zone${expiresLabel ? ` · exp ${expiresLabel}` : ""}`;
  }

  if (rel && !passed) {
    timingLine = `${timingLine} · ${rel}`;
  }

  const promoteToTop =
    !passed &&
    crossesRoute &&
    rel !== "Likely over before you reach it" &&
    (inside || (enterMin != null && enterMin <= ROUTE_ALERT_IMMINENT_ENTER_MIN));

  return {
    aheadMeters,
    enterMin,
    exitMin,
    timingLine,
    relevanceNote: passed ? null : rel,
    passed,
    inside,
    promoteToTop,
  };
}

/** At-your-position alerts (no route band) always surface above the graph. */
export function promoteAtPositionAlertToTop(): RouteAlertTiming {
  return {
    aheadMeters: 0,
    enterMin: 0,
    exitMin: null,
    timingLine: "At your position now",
    relevanceNote: null,
    passed: false,
    inside: true,
    promoteToTop: true,
  };
}

export function isAlertExpired(iso: string | null | undefined, nowMs = Date.now()): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t <= nowMs;
}
