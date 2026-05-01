import type { RouteImpact, RouteImpactCategory } from "./routeImpacts";

const MI = 1609.344;
/** Ignore corridor marks right under the puck; look a bit forward. */
const AHEAD_MIN_M = 80;

function fmtMi(m: number): string {
  if (m < 0) return "0 mi";
  const mi = m / MI;
  if (mi < 0.2) return "<0.2 mi";
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}

/** Rounded total minutes as `0 hr 45 min` or `1 hr 12 min` (always hours + minutes). */
export function formatMinutesAsHoursMinutes(totalMinutes: number): string {
  const total = Math.max(1, Math.round(totalMinutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h} hr ${m} min`;
}

function etaAheadLabel(distM: number, totalM: number, planEtaMinutes: number | null | undefined): string | null {
  if (planEtaMinutes == null || !Number.isFinite(planEtaMinutes) || totalM <= 0) return null;
  const t = Math.max(0, Math.min(1, distM / totalM));
  const mins = Math.max(1, Math.round(planEtaMinutes * t));
  return `~${formatMinutesAsHoursMinutes(mins)}`;
}

export type DriveAheadKind = "nws" | "traffic" | "road" | "weather" | "none";

/**
 * Reflectivity-style urgency: red (extreme) → orange → yellow → green (rain) → blue (ice/winter)
 * → clear (no flagged hazard ahead).
 */
export type DriveAheadRadarTier = "clear" | "blue" | "green" | "yellow" | "orange" | "red";

export type DriveAheadLine = {
  text: string;
  kind: DriveAheadKind;
  radarTier: DriveAheadRadarTier;
};

/* ─── Impact-based drive-ahead builder ─────────────────────────── */

function impactKind(category: RouteImpactCategory): DriveAheadKind {
  switch (category) {
    case "weather":
    case "winter":
    case "wind":
    case "flooding":
    case "visibility":
      return "weather";
    case "traffic":
      return "traffic";
    case "closure":
    case "incident":
    case "construction":
      return "road";
    default:
      return "road";
  }
}

function impactRadarTier(impact: RouteImpact): DriveAheadRadarTier {
  if (impact.severity === "avoid") return "red";
  if (impact.severity === "serious") {
    if (impact.category === "winter" || impact.category === "flooding") return "blue";
    return "orange";
  }
  if (impact.severity === "caution") return "yellow";
  return "green";
}

function impactPriorityForAhead(impact: RouteImpact): number {
  let pri = 0;
  if (impact.driverAction === "rerouteRecommended") pri += 5;
  else if (impact.driverAction === "rerouteAvailable") pri += 3;
  if (impact.severity === "avoid") pri += 5;
  else if (impact.severity === "serious") pri += 3;
  else if (impact.severity === "caution") pri += 1;
  if (impact.category === "closure" || impact.category === "incident") pri += 1;
  return pri;
}

/** Mapbox traffic without a segment anchor is “low” — do not treat it as a precise ahead hazard. */
function includeImpactForDriveAheadSpatial(i: RouteImpact): boolean {
  if (i.source !== "mapboxTraffic") return true;
  if (i.confidence !== "low") return true;
  return i.driverAction === "rerouteRecommended";
}

function fmtImpactHeadline(i: RouteImpact, distanceM: number, planEtaMinutes: number | null | undefined, totalM: number): string {
  const head = i.driverHeadline;
  const eta = etaAheadLabel(distanceM, totalM, planEtaMinutes);
  const dist = fmtMi(distanceM);
  if (eta) return `${head} · ${dist} (${eta})`;
  return `${head} · ${dist} ahead`;
}

/**
 * Build the glanceable “Road Ahead” line directly from the unified `RouteImpact[]`.
 * Prefers impacts the driver should act on (reroute-recommended), then nearest serious / caution.
 */
export function buildDriveRouteAheadFromImpacts(opts: {
  impacts: RouteImpact[];
  totalMeters: number;
  userAlongM: number;
  planEtaMinutes: number | null | undefined;
}): DriveAheadLine | null {
  const { impacts, totalMeters, userAlongM, planEtaMinutes } = opts;
  if (totalMeters <= 1 || !Number.isFinite(userAlongM)) return null;

  /** Impact whose band currently covers the driver. */
  const inside = impacts.find(
    (i) =>
      i.startMeters <= userAlongM + 12 &&
      i.endMeters >= userAlongM - 12 &&
      i.endMeters > i.startMeters
  );
  if (inside) {
    return {
      text: `${inside.driverHeadline} — in this segment`,
      kind: impactKind(inside.category),
      radarTier: impactRadarTier(inside),
    };
  }

  type Cand = { impact: RouteImpact; distM: number; pri: number };
  const cands: Cand[] = [];
  for (const i of impacts) {
    if (!includeImpactForDriveAheadSpatial(i)) continue;
    const ahead = i.distanceAheadMeters;
    if (ahead == null || ahead <= AHEAD_MIN_M * 0.5) continue;
    cands.push({ impact: i, distM: ahead, pri: impactPriorityForAhead(i) });
  }

  if (cands.length === 0) {
    return { text: "Ahead — no flagged hazards on your line", kind: "none", radarTier: "clear" };
  }

  cands.sort((a, b) => (a.distM !== b.distM ? a.distM - b.distM : b.pri - a.pri));
  const top = cands[0]!;
  return {
    text: fmtImpactHeadline(top.impact, top.distM, planEtaMinutes, totalMeters),
    kind: impactKind(top.impact.category),
    radarTier: impactRadarTier(top.impact),
  };
}

const BRIEF_MAX = 62;

export function formatDriveAheadBrief(line: DriveAheadLine): string {
  if (line.kind === "none") {
    return "Ahead: no flagged hazards";
  }
  if (line.text.includes("in this segment")) {
    return "NWS — on this segment";
  }
  let s = line.text.replace(/\s*\(~[^)]+\)\s*/g, " ").replace(/\s+/g, " ").trim();
  if (s.length <= BRIEF_MAX) return s;
  return `${s.slice(0, BRIEF_MAX - 1)}…`;
}
