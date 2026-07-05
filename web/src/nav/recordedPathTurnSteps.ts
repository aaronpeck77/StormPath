import { headingDeltaDegrees } from "./forwardRoutePick";
import { haversineMeters, initialBearingDegrees, polylineLengthMeters } from "./routeGeometry";
import type { LngLat, RouteTurnStep } from "./types";

const TURN_THRESHOLD_DEG = 32;
const MIN_LEG_M = 35;
const MAX_STEPS = 28;

function signedBearingDelta(fromDeg: number, toDeg: number): number {
  let d = (toDeg - fromDeg) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

function instructionForSignedDelta(deg: number): string {
  const a = Math.abs(deg);
  if (a > 150) return "Make a U-turn";
  const side = deg < 0 ? "left" : "right";
  if (a >= 70) return `Turn sharp ${side}`;
  if (a >= TURN_THRESHOLD_DEG) return `Turn ${side}`;
  return "Continue";
}

/**
 * Turn-by-turn from a GPS trace — no Mapbox Directions call. Used for recorded / learned paths
 * so replay works offline and without implying a missing API key.
 */
export function buildTurnStepsFromRecordedGeometry(geometry: LngLat[]): RouteTurnStep[] {
  if (geometry.length < 2) {
    return [{ instruction: "Follow your recorded path" }];
  }

  const totalM = polylineLengthMeters(geometry);
  const maneuverAtM: { alongM: number; instruction: string }[] = [];

  let along = 0;
  for (let i = 1; i < geometry.length - 1; i++) {
    const prev = geometry[i - 1]!;
    const cur = geometry[i]!;
    const next = geometry[i + 1]!;
    const legIn = haversineMeters(prev, cur);
    const legOut = haversineMeters(cur, next);
    along += legIn;
    if (legIn < MIN_LEG_M || legOut < MIN_LEG_M) continue;

    const bearIn = initialBearingDegrees(prev, cur);
    const bearOut = initialBearingDegrees(cur, next);
    const delta = signedBearingDelta(bearIn, bearOut);
    if (headingDeltaDegrees(bearIn, bearOut) < TURN_THRESHOLD_DEG) continue;

    const instruction = instructionForSignedDelta(delta);
    if (instruction === "Continue") continue;

    const last = maneuverAtM[maneuverAtM.length - 1];
    if (last && along - last.alongM < MIN_LEG_M) {
      last.alongM = along;
      last.instruction = instruction;
      continue;
    }
    maneuverAtM.push({ alongM: along, instruction });
  }

  if (maneuverAtM.length > MAX_STEPS - 2) {
    const stride = Math.ceil(maneuverAtM.length / (MAX_STEPS - 2));
    const thinned = maneuverAtM.filter((_, idx) => idx % stride === 0);
    maneuverAtM.length = 0;
    maneuverAtM.push(...thinned);
  }

  const steps: RouteTurnStep[] = [
    {
      instruction: "Follow your recorded path",
      distanceM: maneuverAtM[0]?.alongM ?? totalM,
      maneuverType: "depart",
    },
  ];

  for (let i = 0; i < maneuverAtM.length; i++) {
    const m = maneuverAtM[i]!;
    const nextM = maneuverAtM[i + 1]?.alongM ?? totalM;
    steps.push({
      instruction: m.instruction,
      distanceM: Math.max(MIN_LEG_M, nextM - m.alongM),
      maneuverType: "turn",
      maneuverModifier: m.instruction.includes("left")
        ? "left"
        : m.instruction.includes("right")
          ? "right"
          : m.instruction.includes("U-turn")
            ? "uturn"
            : undefined,
    });
  }

  steps.push({
    instruction: "Arrive at destination",
    distanceM: Math.max(0, totalM - (maneuverAtM[maneuverAtM.length - 1]?.alongM ?? 0)),
    maneuverType: "arrive",
  });

  return steps;
}
