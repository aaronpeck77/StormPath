import type { RouteTurnStep } from "./types";
import { metersToStepStart } from "./turnStepAlong";

/**
 * While farther than this from a minor upcoming maneuver, the banner may skip it and
 * show the following maneuver with distance to *that* maneuver (reduces “bear right…” for miles).
 */
const LOOKAHEAD_SKIP_MIN_M = 800;

function isSkippableBannerManeuver(s: RouteTurnStep): boolean {
  const t = (s.maneuverType ?? "").toLowerCase();
  const m = (s.maneuverModifier ?? "").toLowerCase();
  if (t === "arrive" || t === "arrive destination") return false;
  if (t === "depart") return false;
  if (
    t === "merge" ||
    t === "fork" ||
    t === "off ramp" ||
    t === "ramp" ||
    t === "exit" ||
    t === "roundabout" ||
    t === "rotary"
  ) {
    return false;
  }
  if (t === "continue" || t === "new name" || t === "notification") return true;
  if (t === "turn" || t === "end of road") {
    if (m.includes("slight left") || m.includes("slight right")) return true;
  }
  if (s.type === 6) return true;
  const instr = (s.instruction ?? "").toLowerCase();
  if (/\b(bear|slight)\s+(left|right)\b/.test(instr)) return true;
  return false;
}

/**
 * Primary banner step and remaining distance to that maneuver’s start along the route.
 * Starts at the step after `activeTurnIndex`, then skips minor maneuvers while still far away.
 */
export function bannerPrimaryStepIndex(
  steps: RouteTurnStep[],
  activeTurnIndex: number,
  startAlong: number[],
  userAlongMeters: number
): { primaryIndex: number; metersToPrimaryManeuver: number } {
  const n = steps.length;
  if (n === 0) return { primaryIndex: 0, metersToPrimaryManeuver: 0 };
  let j = Math.min(n - 1, activeTurnIndex + 1);
  while (true) {
    const dist = metersToStepStart(startAlong, j, userAlongMeters);
    if (j >= n - 1) {
      return { primaryIndex: j, metersToPrimaryManeuver: dist };
    }
    const step = steps[j]!;
    if (!isSkippableBannerManeuver(step) || dist <= LOOKAHEAD_SKIP_MIN_M) {
      return { primaryIndex: j, metersToPrimaryManeuver: dist };
    }
    j++;
  }
}
