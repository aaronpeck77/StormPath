import type { RouteTurnStep } from "./types";

/**
 * Map each ORS step to [start,end) along the route polyline (meters), scaled so the
 * last step ends at `routeLengthMeters` (ORS step distances often drift from polyline length).
 */
export function turnStepAlongBounds(
  turnSteps: RouteTurnStep[],
  routeLengthMeters: number
): { start: number[]; end: number[] } {
  const n = turnSteps.length;
  const start: number[] = new Array(n);
  const end: number[] = new Array(n);
  if (n === 0) return { start, end };

  const hasLens = turnSteps.some((s) => typeof s.distanceM === "number" && s.distanceM! > 0);
  let rawEnds: number[];
  if (!hasLens && routeLengthMeters > 0) {
    const seg = routeLengthMeters / n;
    rawEnds = Array.from({ length: n }, (_, i) => (i + 1) * seg);
  } else {
    let cum = 0;
    rawEnds = [];
    for (let i = 0; i < n; i++) {
      const len = turnSteps[i]!.distanceM ?? 0;
      const span = len > 0 ? len : 80;
      cum += span;
      rawEnds.push(cum);
    }
  }
  const rawTotal = rawEnds[rawEnds.length - 1]! || 1;
  const scale = routeLengthMeters > 0 ? routeLengthMeters / rawTotal : 1;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    start[i] = prev;
    end[i] = rawEnds[i]! * scale;
    prev = end[i]!;
  }
  return { start, end };
}

/**
 * Active maneuver index: first step whose cumulative polyline end is still ahead of the vehicle.
 * When `userAlong` reaches/passes `end[i]`, that maneuver is done — the next instruction is step i+1.
 * No speed-based lookahead; transitions follow polyline progress only (past previous step end).
 */
export function activeTurnStepIndexAlong(endAlong: number[], userAlongMeters: number): number {
  if (!endAlong.length) return 0;
  const n = endAlong.length;
  for (let i = 0; i < n; i++) {
    if (userAlongMeters < endAlong[i]!) return i;
  }
  return n - 1;
}

/** Meters remaining until the end of the current maneuver (along-route). */
export function metersToCurrentStepEnd(
  endAlong: number[],
  activeIndex: number,
  userAlongMeters: number
): number {
  const e = endAlong[activeIndex];
  if (e == null) return 0;
  return Math.max(0, e - userAlongMeters);
}

/**
 * Meters from the current position along the route to where step `stepIndex` begins
 * (i.e. where that step’s maneuver applies). Used for “distance to” a specific upcoming step.
 */
export function metersToStepStart(
  startAlong: number[],
  stepIndex: number,
  userAlongMeters: number
): number {
  const s = startAlong[stepIndex];
  if (s == null) return 0;
  return Math.max(0, s - userAlongMeters);
}
