import {
  formatRouteAlertTiming,
  fmtMin,
  ROUTE_ALERT_RELEVANCE_DEVELOPING,
  ROUTE_ALERT_RELEVANCE_ENDING_AROUND,
  ROUTE_ALERT_RELEVANCE_OVER_BEFORE,
  ROUTE_ALERT_RELEVANCE_STILL_ACTIVE,
} from "./routeAlertTiming";
import type { RouteImpact, RouteImpactAction, RouteImpactCategory } from "./routeImpacts";
import { compareRouteImpactPriority } from "./routeImpacts";

/** Will this hazard matter when the driver reaches it? */
export type HazardArrivalVerdictKind =
  | "affects_you"
  | "may_pass"
  | "uncertain"
  | "persistent"
  | "heads_up_only";

export type HazardArrivalVerdict = {
  kind: HazardArrivalVerdictKind;
  /** Primary driver line — leads headlines and advisory preview. */
  line: string;
  suppressFromDriveMap: boolean;
  suppressFromProgressStrip: boolean;
  /** Downgrade reroute prompts when the hazard may not matter. */
  softenDriverAction: boolean;
};

export type ApplyArrivalVerdictsOpts = {
  impacts: RouteImpact[];
  userAlongM: number;
  totalMeters: number;
  planEtaMinutes: number | null | undefined;
  driveEtaMinutes?: number | null;
};

const INCIDENT_MAY_CLEAR_MIN = 55;
const INCIDENT_UNCERTAIN_MIN = 30;
const TRAFFIC_MAY_CLEAR_MIN = 50;
const FORECAST_AFFECTS_MAX_MIN = 180;

function etaAtMeters(
  meters: number,
  userAlongM: number,
  totalM: number,
  planEtaMinutes: number | null | undefined,
  driveEtaMinutes: number | null | undefined
): number | null {
  if (totalM <= 0) return null;
  const remainingM = Math.max(0, totalM - userAlongM);
  const effectiveEta =
    driveEtaMinutes != null && Number.isFinite(driveEtaMinutes)
      ? driveEtaMinutes
      : planEtaMinutes != null && Number.isFinite(planEtaMinutes)
        ? planEtaMinutes * (remainingM / totalM)
        : null;
  if (effectiveEta == null) return null;
  const ahead = Math.max(0, meters - userAlongM);
  if (ahead <= 0) return 0;
  if (remainingM <= 0) return null;
  return effectiveEta * (ahead / remainingM);
}

function etaLabel(min: number | null): string | null {
  const fmt = fmtMin(min);
  return fmt ? `~${fmt}` : null;
}

function nwsVerdict(
  _impact: RouteImpact,
  timing: ReturnType<typeof formatRouteAlertTiming>,
  coarsePreview: boolean
): HazardArrivalVerdict {
  if (timing.passed) {
    return {
      kind: "may_pass",
      line: "Already behind you",
      suppressFromDriveMap: true,
      suppressFromProgressStrip: true,
      softenDriverAction: true,
    };
  }
  if (timing.staleBeforeArrival || timing.relevanceNote === ROUTE_ALERT_RELEVANCE_OVER_BEFORE) {
    return {
      kind: "may_pass",
      line: "Likely over before you reach it",
      suppressFromDriveMap: true,
      suppressFromProgressStrip: true,
      softenDriverAction: true,
    };
  }
  if (timing.developingNote === ROUTE_ALERT_RELEVANCE_DEVELOPING || timing.developingLater) {
    const eta = etaLabel(timing.enterMin);
    return {
      kind: "uncertain",
      line: eta ? `Developing — may affect you around ${eta}` : "Developing — may affect you on arrival",
      suppressFromDriveMap: false,
      suppressFromProgressStrip: false,
      softenDriverAction: false,
    };
  }
  if (timing.relevanceNote === ROUTE_ALERT_RELEVANCE_ENDING_AROUND) {
    const eta = etaLabel(timing.enterMin);
    return {
      kind: "uncertain",
      line: eta ? `May be ending around ${eta}` : "May be ending when you arrive",
      suppressFromDriveMap: false,
      suppressFromProgressStrip: false,
      softenDriverAction: true,
    };
  }
  if (coarsePreview && (timing.enterMin ?? 0) > 90) {
    return {
      kind: "heads_up_only",
      line: "Distant — watch timing as you drive",
      suppressFromDriveMap: true,
      suppressFromProgressStrip: true,
      softenDriverAction: true,
    };
  }
  if (timing.inside) {
    return {
      kind: "affects_you",
      line: "Affecting you now",
      suppressFromDriveMap: false,
      suppressFromProgressStrip: false,
      softenDriverAction: false,
    };
  }
  const eta = etaLabel(timing.enterMin);
  if (timing.relevanceNote === ROUTE_ALERT_RELEVANCE_STILL_ACTIVE) {
    return {
      kind: "affects_you",
      line: eta ? `Still active when you arrive (${eta})` : "Still active when you arrive",
      suppressFromDriveMap: false,
      suppressFromProgressStrip: false,
      softenDriverAction: false,
    };
  }
  return {
    kind: "uncertain",
    line: eta ? `Possible when you arrive (${eta})` : "Possible along your route",
    suppressFromDriveMap: false,
    suppressFromProgressStrip: false,
    softenDriverAction: true,
  };
}

function roadVerdict(
  impact: RouteImpact,
  etaMin: number | null,
  blocks: boolean
): HazardArrivalVerdict {
  const eta = etaLabel(etaMin);
  const category = impact.category;

  if (category === "construction" || category === "closure") {
    return {
      kind: "persistent",
      line: eta ? `Expect this when you arrive (${eta})` : "Expect this when you arrive",
      suppressFromDriveMap: false,
      suppressFromProgressStrip: false,
      softenDriverAction: false,
    };
  }

  if (category === "traffic") {
    if (etaMin != null && etaMin >= TRAFFIC_MAY_CLEAR_MIN && !blocks) {
      return {
        kind: "may_pass",
        line: eta ? `Jam may clear before you arrive (${eta})` : "Jam may clear before you arrive",
        suppressFromDriveMap: true,
        suppressFromProgressStrip: true,
        softenDriverAction: true,
      };
    }
    return {
      kind: "affects_you",
      line: eta ? `Likely still there when you arrive (${eta})` : "Traffic affecting your route",
      suppressFromDriveMap: false,
      suppressFromProgressStrip: false,
      softenDriverAction: false,
    };
  }

  if (category === "incident") {
    if (blocks) {
      return {
        kind: "affects_you",
        line: eta ? `Blocking road when you arrive (${eta})` : "Blocking road ahead",
        suppressFromDriveMap: false,
        suppressFromProgressStrip: false,
        softenDriverAction: false,
      };
    }
    if (etaMin != null && etaMin >= INCIDENT_MAY_CLEAR_MIN) {
      return {
        kind: "may_pass",
        line: eta ? `May clear before you arrive (${eta})` : "May clear before you arrive",
        suppressFromDriveMap: true,
        suppressFromProgressStrip: true,
        softenDriverAction: true,
      };
    }
    if (etaMin != null && etaMin >= INCIDENT_UNCERTAIN_MIN) {
      return {
        kind: "uncertain",
        line: eta ? `Cleanup may finish before ${eta}` : "Cleanup timing uncertain",
        suppressFromDriveMap: false,
        suppressFromProgressStrip: false,
        softenDriverAction: true,
      };
    }
    return {
      kind: "affects_you",
      line: eta ? `Likely still there (${eta})` : "Incident ahead",
      suppressFromDriveMap: false,
      suppressFromProgressStrip: false,
      softenDriverAction: false,
    };
  }

  return {
    kind: "uncertain",
    line: eta ? `Possible when you arrive (${eta})` : "Possible ahead",
    suppressFromDriveMap: false,
    suppressFromProgressStrip: false,
    softenDriverAction: true,
  };
}

function weatherForecastVerdict(impact: RouteImpact, etaMin: number | null): HazardArrivalVerdict {
  const eta = etaLabel(etaMin);
  if (etaMin != null && etaMin > FORECAST_AFFECTS_MAX_MIN) {
    return {
      kind: "heads_up_only",
      line: eta ? `Forecast ${eta} ahead — timing may shift` : "Forecast along route",
      suppressFromDriveMap: true,
      suppressFromProgressStrip: true,
      softenDriverAction: true,
    };
  }
  if (impact.severity === "avoid" || impact.severity === "serious") {
    return {
      kind: "affects_you",
      line: eta ? `Expected when you arrive (${eta})` : "Expected on your route",
      suppressFromDriveMap: false,
      suppressFromProgressStrip: false,
      softenDriverAction: false,
    };
  }
  return {
    kind: "uncertain",
    line: eta ? `Possible when you arrive (${eta})` : "Possible along route",
    suppressFromDriveMap: false,
    suppressFromProgressStrip: false,
    softenDriverAction: true,
  };
}

function blocksPath(impact: RouteImpact): boolean {
  return (
    impact.severity === "avoid" ||
    impact.driverAction === "rerouteRecommended" ||
    /block|closure|closed/i.test(impact.driverHeadline)
  );
}

export function computeHazardArrivalVerdict(
  impact: RouteImpact,
  opts: Omit<ApplyArrivalVerdictsOpts, "impacts">
): HazardArrivalVerdict {
  const etaMin =
    impact.etaAheadMinutes ??
    etaAtMeters(
      impact.startMeters,
      opts.userAlongM,
      opts.totalMeters,
      opts.planEtaMinutes,
      opts.driveEtaMinutes
    );

  if (impact.source === "nws") {
    const timing = formatRouteAlertTiming({
      startMeters: impact.startMeters,
      endMeters: impact.endMeters,
      userAlongMeters: opts.userAlongM,
      totalMeters: opts.totalMeters,
      planEtaMinutes: opts.planEtaMinutes ?? null,
      driveEtaMinutes: opts.driveEtaMinutes,
      expiresIso: impact.hazardExpiresIso,
      onsetIso: impact.hazardOnsetIso,
      crossesRoute: impact.crossesRoute !== false,
    });
    return nwsVerdict(impact, timing, Boolean(impact.coarsePreview));
  }

  if (
    impact.category === "traffic" ||
    impact.category === "closure" ||
    impact.category === "incident" ||
    impact.category === "construction"
  ) {
    return roadVerdict(impact, etaMin, blocksPath(impact));
  }

  if (
    impact.source === "tomorrowIo" ||
    impact.category === "winter" ||
    impact.category === "wind" ||
    impact.category === "visibility" ||
    impact.category === "flooding"
  ) {
    return weatherForecastVerdict(impact, etaMin);
  }

  if (impact.source === "radar") {
    return {
      kind: "heads_up_only",
      line: "Radar echo now — check timing as you drive",
      suppressFromDriveMap: true,
      suppressFromProgressStrip: true,
      softenDriverAction: true,
    };
  }

  return {
    kind: "uncertain",
    line: etaLabel(etaMin) ? `Possible at ${etaLabel(etaMin)}` : "Possible ahead",
    suppressFromDriveMap: false,
    suppressFromProgressStrip: false,
    softenDriverAction: true,
  };
}

function softenAction(action: RouteImpactAction): RouteImpactAction {
  if (action === "rerouteRecommended") return "rerouteAvailable";
  if (action === "rerouteAvailable") return "slow";
  if (action === "prepare") return "watch";
  return action;
}

export function headlineWithArrivalVerdict(headline: string, verdictLine: string): string {
  const base = headline.trim();
  const v = verdictLine.trim();
  if (!v) return base;
  if (base.toLowerCase().startsWith(v.toLowerCase())) return base;
  return `${v} · ${base}`;
}

/** Attach ETA-at-arrival verdicts and refresh headlines for every route impact. */
export function applyArrivalVerdictsToImpacts(opts: ApplyArrivalVerdictsOpts): RouteImpact[] {
  const ctx = {
    userAlongM: opts.userAlongM,
    totalMeters: opts.totalMeters,
    planEtaMinutes: opts.planEtaMinutes,
    driveEtaMinutes: opts.driveEtaMinutes,
  };

  return opts.impacts.map((impact) => {
    const verdict = computeHazardArrivalVerdict(impact, ctx);
    let driverAction = impact.driverAction;
    if (verdict.softenDriverAction) {
      driverAction = softenAction(driverAction);
    }
    return {
      ...impact,
      arrivalVerdict: verdict.kind,
      arrivalVerdictLine: verdict.line,
      suppressFromDriveMap: verdict.suppressFromDriveMap,
      suppressFromProgressStrip: verdict.suppressFromProgressStrip,
      driverHeadline: headlineWithArrivalVerdict(impact.driverHeadline, verdict.line),
      driverAction,
    };
  });
}

const AFFECTS_KINDS = new Set<HazardArrivalVerdictKind>([
  "affects_you",
  "persistent",
  "uncertain",
]);

export function impactAffectsDriverAtArrival(impact: RouteImpact): boolean {
  if (impact.suppressFromDriveMap) return false;
  if (impact.arrivalVerdict) return AFFECTS_KINDS.has(impact.arrivalVerdict);
  return impact.severity === "serious" || impact.severity === "avoid";
}

export type NextHazardAffectingYou = {
  impact: RouteImpact;
  headline: string;
};

/** Nearest hazard that will likely matter when the driver arrives. */
export function pickNextHazardAffectingYou(impacts: RouteImpact[]): NextHazardAffectingYou | null {
  let best: RouteImpact | null = null;
  let bestAhead = Infinity;

  for (const i of impacts) {
    if (i.endMeters <= 0 && (i.distanceAheadMeters ?? 0) <= 0) continue;
    if (!impactAffectsDriverAtArrival(i)) continue;
    if (i.arrivalVerdict === "heads_up_only" || i.arrivalVerdict === "may_pass") continue;
    const ahead = i.distanceAheadMeters ?? Math.max(0, i.startMeters - 0);
    if (ahead <= 0 && i.arrivalVerdict !== "affects_you") continue;
    if (ahead >= bestAhead) continue;
    bestAhead = ahead;
    best = i;
  }

  if (!best) return null;
  return {
    impact: best,
    headline: best.driverHeadline,
  };
}

/** Plain one-liner for advisory preview / drive status. */
export function nextHazardAffectingYouLine(impacts: RouteImpact[]): string | null {
  const pick = pickNextHazardAffectingYou(impacts);
  return pick?.headline ?? null;
}

export function sortImpactsByArrivalPriority(impacts: RouteImpact[]): RouteImpact[] {
  return [...impacts].sort((a, b) => {
    const aAffects = impactAffectsDriverAtArrival(a);
    const bAffects = impactAffectsDriverAtArrival(b);
    if (aAffects !== bAffects) return aAffects ? -1 : 1;
    const da = a.distanceAheadMeters ?? a.alongMeters;
    const db = b.distanceAheadMeters ?? b.alongMeters;
    if (da !== db) return da - db;
    return compareRouteImpactPriority(a, b);
  });
}

export function categoryPersistenceLabel(category: RouteImpactCategory): string {
  switch (category) {
    case "construction":
    case "closure":
      return "persistent";
    case "incident":
    case "traffic":
      return "may_clear";
    default:
      return "timed";
  }
}
