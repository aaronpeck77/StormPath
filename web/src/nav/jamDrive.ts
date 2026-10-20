import { METERS_PER_MILE } from "./constants";
import { planJamHop, type JamHopPlan } from "./jamHopPlan";
import { polylineLengthMeters } from "./routeGeometry";
import type { LngLat, RouteTurnStep } from "./types";

const SEVERE = 80;
const MIN_RUN_M = METERS_PER_MILE;

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
};

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
  const plan = planJamHop({
    line,
    userAlongMeters: opts.userAlongMeters,
    tailMeters: stretch.tailMeters,
    clearMeters: stretch.clearMeters,
    speedMps: opts.speedMps,
    exitsMeters: exitsAlongSteps(opts.steps),
  });
  if (!plan.ok) return null;
  return { ...plan, ...offerCopy(plan, opts.userAlongMeters) };
}

function offerCopy(plan: Extract<JamHopPlan, { ok: true }>, userAlongMeters: number): { title: string; hint: string } {
  if (plan.fromQueue && !plan.canTakeNow) {
    const miles = Math.max(0.1, (plan.leaveByMeters - userAlongMeters) / METERS_PER_MILE);
    return {
      title: "Backup continues past the next exit",
      hint: `About ${miles < 10 ? miles.toFixed(1) : Math.round(miles)} miles. Stay on the highway until it is close.`,
    };
  }
  if (plan.fromQueue) {
    return {
      title: "Next exit is close",
      hint: "The backup runs past it. Take the exit and rejoin the same highway after the jam.",
    };
  }
  return {
    title: "Backup ahead on this highway",
    hint: "Leave before the slow stretch and rejoin the same highway after it.",
  };
}
