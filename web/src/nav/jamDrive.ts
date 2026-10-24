import { METERS_PER_MILE } from "./constants";
import { planJamHop, type JamHopPlan } from "./jamHopPlan";
import { polylineLengthMeters } from "./routeGeometry";
import type { LngLat, RouteTurnStep } from "./types";

const SEVERE = 80;
const MIN_RUN_M = METERS_PER_MILE;
/** Don't nag about a backup farther than this — it's ~an hour away, not "ahead". */
export const JAM_HOP_LOOKAHEAD_M = 5 * METERS_PER_MILE;

export type JamStretch = { tailMeters: number; clearMeters: number };

/**
 * First severe run on the locked line that still has road ahead of the car.
 * Values are Mapbox congestion_numeric samples spread evenly along the route.
 * 80 and above is the slow stretch. A run has to cover about a mile, or one
 * coarse sample that itself covers a mile.
 */
export function jamStretchAhead(
  values: (number | null)[] | null | undefined,
  totalMeters: number,
  userAlongMeters: number
): JamStretch | null {
  if (!values?.length || !(totalMeters > 0)) return null;
  const n = values.length;
  let runStart: number | null = null;
  for (let i = 0; i <= n; i++) {
    const severe = i < n && typeof values[i] === "number" && (values[i] as number) >= SEVERE;
    if (severe && runStart == null) runStart = i;
    if (!severe && runStart != null) {
      const stretch = stretchIfLongEnough(runStart, i, n, totalMeters, userAlongMeters);
      if (stretch) return stretch;
      runStart = null;
    }
  }
  return null;
}

function stretchIfLongEnough(
  start: number,
  end: number,
  count: number,
  totalMeters: number,
  userAlongMeters: number
): JamStretch | null {
  const tailMeters = (start / count) * totalMeters;
  const clearMeters = (end / count) * totalMeters;
  const span = clearMeters - tailMeters;
  const segmentMeters = totalMeters / count;
  const longEnough = span >= MIN_RUN_M || (end - start >= 2 && span >= 800) || segmentMeters >= MIN_RUN_M;
  if (!longEnough) return null;
  if (clearMeters <= userAlongMeters + 200) return null;
  return { tailMeters, clearMeters };
}

/** Along-route meters where an exit maneuver starts. The maneuver is the start of that step. */
export function exitsAlongSteps(
  steps: Pick<RouteTurnStep, "distanceM" | "maneuverType" | "exitNumber">[]
): number[] {
  let along = 0;
  const exits: number[] = [];
  for (const step of steps) {
    const type = (step.maneuverType ?? "").toLowerCase();
    const isExit = Boolean(step.exitNumber?.trim()) || type === "off ramp" || type === "exit";
    if (isExit) exits.push(along);
    along += step.distanceM && step.distanceM > 0 ? step.distanceM : 0;
  }
  return exits;
}

export type JamHopOffer = Extract<JamHopPlan, { ok: true }> & {
  title: string;
  hint: string;
  /** Along-route meters where the backup starts / the highway moves again. */
  tailMeters: number;
  clearMeters: number;
};

/** Dismiss key buckets the stretch itself — speed-derived leaveBy jitter can't un-dismiss it. */
export function jamHopDismissKey(offer: Pick<JamHopOffer, "tailMeters" | "clearMeters">): string {
  return `${Math.round(offer.tailMeters / 800)}:${Math.round(offer.clearMeters / 800)}`;
}

/** Live drive inputs to the new hop. Returns nothing when the stretch or the rules say stay. */
export function jamHopOffer(opts: {
  line: LngLat[] | null | undefined;
  userAlongMeters: number;
  speedMps: number | null;
  congestion: (number | null)[] | null | undefined;
  steps: Pick<RouteTurnStep, "distanceM" | "maneuverType" | "exitNumber">[];
}): JamHopOffer | null {
  const line = opts.line;
  if (!line || line.length < 2) return null;
  const total = polylineLengthMeters(line);
  const stretch = jamStretchAhead(opts.congestion, total, opts.userAlongMeters);
  if (!stretch) return null;
  /* Not yet in the queue and the tail is more than the lookahead away → too early. */
  if (
    stretch.tailMeters > opts.userAlongMeters &&
    stretch.tailMeters - opts.userAlongMeters > JAM_HOP_LOOKAHEAD_M
  ) {
    return null;
  }
  const plan = planJamHop({
    line,
    userAlongMeters: opts.userAlongMeters,
    tailMeters: stretch.tailMeters,
    clearMeters: stretch.clearMeters,
    speedMps: opts.speedMps,
    exitsMeters: exitsAlongSteps(opts.steps),
  });
  if (!plan.ok) return null;
  return {
    ...plan,
    tailMeters: stretch.tailMeters,
    clearMeters: stretch.clearMeters,
    ...offerCopy(plan, stretch.tailMeters - opts.userAlongMeters, opts.userAlongMeters),
  };
}

function offerCopy(
  plan: Extract<JamHopPlan, { ok: true }>,
  metersAhead: number,
  userAlongMeters: number
): { title: string; hint: string } {
  const fmtMi = (meters: number): string => {
    const miles = Math.max(0.1, meters / METERS_PER_MILE);
    return miles < 10 ? miles.toFixed(1) : `${Math.round(miles)}`;
  };
  if (plan.fromQueue && !plan.canTakeNow) {
    return {
      title: "Backup continues past the next exit",
      hint: `About ${fmtMi(plan.leaveByMeters - userAlongMeters)} miles. Stay on the highway until it is close.`,
    };
  }
  if (plan.fromQueue) {
    return {
      title: "Next exit is close",
      hint: "The backup runs past it. Take the exit and rejoin the same highway after the jam.",
    };
  }
  return {
    title: `Backup ahead · ${fmtMi(metersAhead)} mi`,
    hint: "Leave before the slow stretch and rejoin the same highway after it.",
  };
}
