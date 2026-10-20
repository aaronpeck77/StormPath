import { METERS_PER_MILE } from "./constants";

/**
 * How far ahead a hazard banner may speak. Interstate speed wants about six minutes,
 * clamped between 5 and 8 miles. This is the warning distance, not a jam hop.
 */
export function earlyApproachMaxMetersForSpeed(speedMps: number | null): number {
  const fallback = 5 * METERS_PER_MILE;
  const cap = 8 * METERS_PER_MILE;
  if (!speedMps || speedMps <= 0) return fallback;
  return Math.min(cap, Math.max(fallback, speedMps * 360));
}
