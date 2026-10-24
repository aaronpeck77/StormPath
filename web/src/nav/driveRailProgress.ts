/**
 * Fraction along the trip for the side-rail puck (0–1).
 * The line's own along-meters wins when it is ahead. The odometer wins when that
 * along snaps back to the start, so the puck keeps moving after a corridor replace.
 */
export function driveRailProgressFraction(input: {
  totalM: number;
  userAlongM: number;
  tripOdometerM?: number;
  tripRelative?: boolean;
}): number {
  const totalM = input.totalM;
  if (!(totalM > 0)) return 0;
  const userAlong = Number.isFinite(input.userAlongM) ? Math.max(0, input.userAlongM) : 0;
  const polylineProgress = Math.min(1, Math.max(0, userAlong / totalM));
  const tripOdometerM =
    input.tripOdometerM != null && Number.isFinite(input.tripOdometerM)
      ? Math.max(0, input.tripOdometerM)
      : 0;
  if (!input.tripRelative || tripOdometerM <= 2) return polylineProgress;
  const remainingM = Math.max(0, totalM - userAlong);
  const denom = tripOdometerM + remainingM;
  if (denom <= 1) return polylineProgress;
  const tripProgress = Math.min(1, Math.max(0, tripOdometerM / denom));
  return Math.max(polylineProgress, tripProgress);
}
