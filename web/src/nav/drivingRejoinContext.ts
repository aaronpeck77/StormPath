import { METERS_PER_MILE } from "./constants";
import { haversineMeters, pointAtAlongMeters, polylineLengthMeters } from "./routeGeometry";
import type { LngLat, NavRoute, RouteTurnStep } from "./types";

const MI = METERS_PER_MILE;

/** Minimum time on surface streets before leaving highway-through mode (ms). */
export const DRIVING_CONTEXT_HYSTERESIS_MS = 22_000;

export type TripRouteRole = "through" | "local";
export type RoadNetworkClass = "highway" | "city_streets" | "unknown";
export type DrivingRejoinMode = "manual" | "auto_local";

export type DrivingRejoinContext = {
  mode: DrivingRejoinMode;
  roadClass: RoadNetworkClass;
  tripRole: TripRouteRole;
  /** True when the destination is off the through-corridor (local arrival/departure). */
  localPhase: boolean;
  /** Short label for debug / optional UI chip. */
  summary: string;
};

const HIGHWAY_INSTR =
  /\b(interstate|I[-\s]?\d{1,3}\b|US\s*\d{1,3}\b|U\.?\s*S\.?\s*\d{1,3}|freeway|expressway|turnpike|parkway|hwy\.?|highway|fwy\.?|motorway|state route\s*\d|sr\s*\d|route\s*\d{2,3})\b/i;

function cumulativeStepEnds(steps: RouteTurnStep[]): number[] {
  const ends: number[] = [];
  let m = 0;
  for (const s of steps) {
    m += s.distanceM != null && Number.isFinite(s.distanceM) ? Math.max(0, s.distanceM) : 0;
    ends.push(m);
  }
  return ends;
}

function stepIndexAtAlong(steps: RouteTurnStep[], alongM: number): number {
  if (!steps.length) return -1;
  const ends = cumulativeStepEnds(steps);
  for (let i = 0; i < ends.length; i++) {
    if (alongM <= ends[i]! + 1) return i;
  }
  return ends.length - 1;
}

function isHighwayStep(step: RouteTurnStep | undefined): boolean {
  if (!step) return false;
  const text = `${step.instruction} ${step.maneuverType ?? ""} ${step.maneuverModifier ?? ""}`;
  if (HIGHWAY_INSTR.test(text)) return true;
  const d = step.distanceM ?? 0;
  return d >= 1_800;
}

export function roadClassAtAlong(route: NavRoute, alongM: number): RoadNetworkClass {
  const steps = route.turnSteps;
  if (!steps?.length) {
    const geom = route.geometry;
    if (geom.length < 2) return "unknown";
    const total = polylineLengthMeters(geom);
    const a = Math.max(0, Math.min(total, alongM));
    const b = Math.min(total, a + Math.min(800, total * 0.02));
    const p0 = pointAtAlongMeters(geom, a);
    const p1 = pointAtAlongMeters(geom, Math.max(b, a + 40));
    const segM = haversineMeters(p0, p1);
    return segM >= 700 ? "highway" : "city_streets";
  }
  const idx = stepIndexAtAlong(steps, alongM);
  const step = steps[Math.max(0, idx)]!;
  return isHighwayStep(step) ? "highway" : "city_streets";
}

export function classifyTripRouteRole(opts: {
  totalM: number;
  remainingM: number;
  destLngLat: LngLat | null;
  routeGeometry: LngLat[];
}): TripRouteRole {
  const { totalM, remainingM, destLngLat, routeGeometry } = opts;
  if (totalM <= 0) return "local";
  if (totalM < 28 * MI) return "local";
  if (remainingM > 45 * MI && totalM > 55 * MI) return "through";

  if (destLngLat && routeGeometry.length >= 2) {
    const end = routeGeometry[routeGeometry.length - 1]!;
    const destOffCorridorM = haversineMeters(destLngLat, end);
    const nearEnd = remainingM < Math.min(12 * MI, totalM * 0.22);
    if (nearEnd && destOffCorridorM > 650) return "local";
  }

  if (remainingM < 18 * MI) return "local";
  return "through";
}

/**
 * Manual rejoin on highways (including through cities). Auto local rejoin on city-level
 * roads when the trip is local or you are in the local approach phase off the freeway.
 */
export function resolveDrivingRejoinContext(opts: {
  guidanceRoute: NavRoute;
  userAlongM: number;
  destLngLat: LngLat | null;
  /** When set, overrides instantaneous road read (hysteresis after leaving highway). */
  latchedRoadClass?: RoadNetworkClass | null;
}): DrivingRejoinContext {
  const geom = opts.guidanceRoute.geometry;
  const totalM = polylineLengthMeters(geom);
  const alongM = Math.max(0, Math.min(totalM, opts.userAlongM));
  const remainingM = Math.max(0, totalM - alongM);

  const instantRoad = roadClassAtAlong(opts.guidanceRoute, alongM);
  const roadClass =
    instantRoad === "highway"
      ? "highway"
      : opts.latchedRoadClass === "highway"
        ? "highway"
        : instantRoad;

  const tripRole = classifyTripRouteRole({
    totalM,
    remainingM,
    destLngLat: opts.destLngLat,
    routeGeometry: geom,
  });

  const localPhase =
    tripRole === "local" ||
    (roadClass === "city_streets" && remainingM < Math.min(35 * MI, totalM * 0.4));

  const autoEligible =
    roadClass === "city_streets" && (tripRole === "local" || localPhase);

  const mode: DrivingRejoinMode = autoEligible ? "auto_local" : "manual";

  const summary =
    mode === "auto_local"
      ? "City streets — auto rejoin"
      : roadClass === "highway"
        ? tripRole === "through"
          ? "Highway — your route stays locked"
          : "Highway — manual rejoin until exit"
        : "Open road — manual rejoin";

  return { mode, roadClass, tripRole, localPhase, summary };
}

export function shouldLatchHighwayAfterSurface(
  previous: RoadNetworkClass,
  instant: RoadNetworkClass,
  lastSurfaceAtMs: number | null,
  nowMs: number
): boolean {
  if (instant === "highway") return false;
  if (previous !== "highway") return false;
  if (lastSurfaceAtMs == null) return true;
  return nowMs - lastSurfaceAtMs < DRIVING_CONTEXT_HYSTERESIS_MS;
}
