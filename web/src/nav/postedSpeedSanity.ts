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

/**
 * Class fallback used only when Mapbox has no `maxspeed` for the segment.
 *
 * Averaged from five state codes / driver manuals (Sept 2026):
 *   rural interstate — IL 70, MO 70, IN 70, OH 70, KY 65  → 69, call it 70
 *   US / state route — IL 55 (65 four-lane divided), MO 60 (55 lettered),
 *                      IN 55 (60 rural divided), OH 55 (60 two-lane designated),
 *                      KY 55  → ~56, held at 55 so a divided-highway guess
 *                      never reads above the two-lane statute
 *   county / township — 55 in all five
 *   city surface street — IL 30, MO ~30, IN 30, OH 25 (35 on state routes),
 *                      KY 35  → ~31, held at 30
 *
 * Never used to raise or replace a real Mapbox value, and always surfaced to the
 * driver as an estimate. Urban interstates run 55–65, so this can read high in a
 * metro; the sign on the post is the only limit that counts.
 */
export const SPEED_LIMIT_CLASS_ESTIMATE_MPH: Record<SpeedLimitRoadKind, number | null> = {
  interstate: 70,
  us_state: 55,
  county_arterial: 55,
  local: 30,
  unknown: null,
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

export type PostedSpeedDisplay = {
  mph: number | null;
  /** True when the number came from the road-class table, not Mapbox data. */
  classEstimate: boolean;
};

/**
 * Limit for the Lim / Limit readout: Mapbox's value when it exists, otherwise the
 * road-class average. The caller must show `classEstimate` differently and must not
 * drive an over-speed warning off it.
 */
export function postedSpeedForDisplay(opts: {
  route: NavRoute | undefined;
  alongMeters: number;
}): PostedSpeedDisplay {
  const mapboxMph = displayedPostedSpeedMph(opts);
  if (mapboxMph != null) return { mph: mapboxMph, classEstimate: false };

  const roadKind = speedLimitRoadKindAt(opts.route, opts.alongMeters);
  const guess = SPEED_LIMIT_CLASS_ESTIMATE_MPH[roadKind];
  if (guess == null) return { mph: null, classEstimate: false };
  return { mph: guess, classEstimate: true };
}
