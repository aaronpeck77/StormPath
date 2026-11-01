import type { LngLat } from "./types";
import type { TripStop } from "./routeWaypoints";

/** Two pulls per trip. A third would need another pass. */
export const HAZARD_BYPASS_MAX_PULLS = 2;

const BEND_LABELS = ["Hazard bend", "Hazard bend 2"] as const;

export function isHazardBendLabel(label: string): boolean {
  return label === BEND_LABELS[0] || label === BEND_LABELS[1];
}

export function hazardBendCount(vias: TripStop[]): number {
  return vias.reduce((n, stop) => n + (isHazardBendLabel(stop.label) ? 1 : 0), 0);
}

export function nextHazardBendLabel(vias: TripStop[]): string | null {
  if (hazardBendCount(vias) >= HAZARD_BYPASS_MAX_PULLS) return null;
  return BEND_LABELS.find((label) => !vias.some((stop) => stop.label === label)) ?? null;
}

/** Stops that were on the trip before any hazard pull. Cancel restores this list. */
export function baselineWithoutBends(vias: TripStop[]): TripStop[] {
  return vias
    .filter((stop) => !isHazardBendLabel(stop.label))
    .map((stop) => ({ label: stop.label, lngLat: [stop.lngLat[0], stop.lngLat[1]] as LngLat }));
}

/**
 * Active-via index once hazard bends are stripped.
 * Passed real stops still count. A bend the car was aiming at does not.
 */
export function activeIndexWithoutBends(vias: TripStop[], activeViaIndex: number): number {
  let index = 0;
  const limit = Math.max(0, Math.min(activeViaIndex, vias.length));
  for (let i = 0; i < limit; i++) {
    if (!isHazardBendLabel(vias[i]!.label)) index += 1;
  }
  return index;
}

export function nearestVertexIndex(line: LngLat[], point: LngLat): number {
  if (line.length === 0) return 0;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < line.length; i++) {
    const dx = line[i]![0] - point[0];
    const dy = line[i]![1] - point[1];
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Insert on the leg under the finger: before the next stop if the grab is
 * still ahead of it, otherwise after every remaining stop and before the destination.
 */
export function pullInsertIndex(
  vias: TripStop[],
  activeViaIndex: number,
  route: LngLat[],
  grab: LngLat
): number {
  const start = Math.max(0, Math.min(activeViaIndex, vias.length));
  if (route.length < 2) return vias.length;
  const grabAt = nearestVertexIndex(route, grab);
  for (let i = start; i < vias.length; i++) {
    const viaAt = nearestVertexIndex(route, vias[i]!.lngLat);
    if (viaAt > grabAt) return i;
  }
  return vias.length;
}

export function viasWithPull(
  vias: TripStop[],
  activeViaIndex: number,
  route: LngLat[],
  grab: LngLat,
  release: LngLat
): TripStop[] | null {
  const label = nextHazardBendLabel(vias);
  if (!label) return null;
  const at = pullInsertIndex(vias, activeViaIndex, route, grab);
  const pull: TripStop = { label, lngLat: [release[0], release[1]] };
  return [...vias.slice(0, at), pull, ...vias.slice(at)];
}

export function viasWithoutPull(
  vias: TripStop[],
  label: string
): { vias: TripStop[]; removedIndex: number } | null {
  const removedIndex = vias.findIndex((stop) => stop.label === label);
  if (removedIndex < 0) return null;
  return {
    removedIndex,
    vias: vias.filter((_, i) => i !== removedIndex),
  };
}

/** Drop the active index by one when the removed stop was already behind the puck. */
export function activeIndexAfterPullRemoved(activeViaIndex: number, removedIndex: number): number {
  if (removedIndex < activeViaIndex) return Math.max(0, activeViaIndex - 1);
  return activeViaIndex;
}
