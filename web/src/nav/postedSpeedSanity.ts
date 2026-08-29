import type { NavRoute, RouteTurnStep } from "./types";
import { postedSpeedMphAt } from "./postedSpeed";

/** Road kind for posted-limit sanity caps (finer than rejoin highway/city). */
export type SpeedLimitRoadKind =
  | "interstate"
  | "us_state"
  | "county_arterial"
  | "local"
  | "unknown";

/**
 * Soft ceiling for absurd OSM/Mapbox values only — not a guess of the real limit.
 * Kept loose so we do not invent a lower Lim when Mapbox is already in a normal range.
 */
export const SPEED_LIMIT_CLASS_CAP_MPH: Record<SpeedLimitRoadKind, number> = {
  interstate: 85,
  us_state: 75,
  county_arterial: 70,
  local: 55,
  unknown: 85,
};

const POSTED_BUCKETS_MPH = [25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80] as const;

const INTERSTATE_RE =
  /\b(interstate|I[-\s]?\d{1,3}\b)\b/i;
const US_RE = /\b(U\.?\s*S\.?\s*|US)\s*\d{1,3}\b/i;
const STATE_RE =
  /\b((IL|IN|MO|IA|WI|KY|TN|AR|OH|MI)\s*\d{1,3}|state\s*route\s*\d|sr\s*\d{1,3}|il\s*route\s*\d)\b/i;
const COUNTY_ARTERIAL_RE =
  /\b(county\s*(highway|hwy|road|rd)|co\.?\s*(hwy|rd)|township|farm\s*to\s*market|fm\s*\d)\b/i;
const GENERIC_HIGHWAY_RE =
  /\b(freeway|expressway|turnpike|parkway|hwy\.?|highway|fwy\.?|motorway)\b/i;

function cumulativeStepEnds(steps: RouteTurnStep[]): number[] {
  const ends: number[] = [];
  let m = 0;
  for (const s of steps) {
    m += s.distanceM != null && Number.isFinite(s.distanceM) ? Math.max(0, s.distanceM) : 0;
    ends.push(m);
  }
  return ends;
}

function stepAtAlong(steps: RouteTurnStep[], alongM: number): RouteTurnStep | undefined {
  if (!steps.length) return undefined;
  const ends = cumulativeStepEnds(steps);
  for (let i = 0; i < ends.length; i++) {
    if (alongM <= ends[i]! + 1) return steps[i];
  }
  return steps[steps.length - 1];
}

function stepText(step: RouteTurnStep | undefined): string {
  if (!step) return "";
  return [step.roadRef, step.roadName, step.instruction, step.maneuverType, step.maneuverModifier]
    .filter(Boolean)
    .join(" ");
}

export function speedLimitRoadKindAt(route: NavRoute | undefined, alongM: number): SpeedLimitRoadKind {
  if (!route) return "unknown";
  const step = stepAtAlong(route.turnSteps ?? [], alongM);
  const text = stepText(step);
  if (INTERSTATE_RE.test(text)) return "interstate";
  if (US_RE.test(text) || STATE_RE.test(text)) return "us_state";
  if (COUNTY_ARTERIAL_RE.test(text)) return "county_arterial";
  if (GENERIC_HIGHWAY_RE.test(text)) return "county_arterial";
  if (step) return "local";
  return "unknown";
}

/** Snap down to a common US posted-limit bucket (never up). */
export function snapDownToPostedBucket(mph: number): number {
  const rounded = Math.round(mph);
  let best: number = POSTED_BUCKETS_MPH[0]!;
  for (const b of POSTED_BUCKETS_MPH) {
    if (b <= rounded) best = b;
    else break;
  }
  return best;
}

export type SanitizePostedSpeedInput = {
  mapboxMph: number | null;
  /**
   * @deprecated Ignored — cruise-based down-nudges made Lim follow traffic speed,
   * not the posted sign. Kept optional so call sites can drop it gradually.
   */
  cruiseMph?: number | null;
  roadKind: SpeedLimitRoadKind;
};

/**
 * Light sanity on Mapbox posted limit.
 * Never invents a limit when Mapbox has none. Never raises Mapbox's value.
 * Does not use GPS cruise speed (that made Lim wrong in congestion).
 */
export function sanitizePostedSpeedMph(input: SanitizePostedSpeedInput): number | null {
  const { mapboxMph, roadKind } = input;
  if (mapboxMph == null || !Number.isFinite(mapboxMph) || mapboxMph <= 0) return null;

  const classCap = SPEED_LIMIT_CLASS_CAP_MPH[roadKind];
  return Math.min(Math.round(mapboxMph), classCap);
}

/** Mapbox sample at alongM, then road-class absurdity cap only. */
export function displayedPostedSpeedMph(opts: {
  route: NavRoute | undefined;
  alongMeters: number;
  cruiseMph?: number | null;
}): number | null {
  const mapboxMph = postedSpeedMphAt(opts.route, opts.alongMeters);
  const roadKind = speedLimitRoadKindAt(opts.route, opts.alongMeters);
  return sanitizePostedSpeedMph({
    mapboxMph,
    roadKind,
  });
}
