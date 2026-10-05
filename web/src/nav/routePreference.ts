/**
 * The choice sticks. The drawn line does not.
 * Fastest stays the fastest practical path from where the driver is.
 * Alternate is a different path that still makes progress — about 15% at most.
 */

export type RoutingPreference = "fastest" | "alternate";

/** A good alternate in the field notes was ~9% slower. A wander at ~40% is thrown away. */
export const ALTERNATE_MAX_DURATION_FACTOR = 1.15;
export const ALTERNATE_MAX_DISTANCE_FACTOR = 1.15;

export function routeFitsAlternateCap(input: {
  etaMinutes: number;
  distanceM: number;
  mainEtaMinutes: number;
  mainDistanceM: number;
}): boolean {
  const mainEta = input.mainEtaMinutes;
  const mainDist = input.mainDistanceM;
  if (!(mainEta > 0) || !(mainDist > 0)) return false;
  if (!(input.etaMinutes > 0) || !(input.distanceM > 0)) return false;
  if (input.etaMinutes > mainEta * ALTERNATE_MAX_DURATION_FACTOR) return false;
  if (input.distanceM > mainDist * ALTERNATE_MAX_DISTANCE_FACTOR) return false;
  return true;
}

/** What the driver picked. A later replan must not infer this from a live ETA. */
export function routingPreferenceForLockedRoute(
  route: { id?: string | null; role?: string | null; label?: string | null } | null | undefined
): RoutingPreference {
  if (!route) return "fastest";
  const label = (route.label ?? "").toLowerCase();
  if (label.includes("alternate")) return "alternate";
  if (route.role === "hazardSmart" || route.role === "balanced") return "alternate";
  if (route.id === "r-b" || route.id === "r-c") return "alternate";
  return "fastest";
}
