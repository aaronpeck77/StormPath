import type { LngLat } from "./types";

/** One optional intermediate stop before the final destination. */
export type TripStop = {
  lngLat: LngLat;
  label: string;
};

export const MAX_VIA_STOPS = 1;

/** Ordered coords for Mapbox Directions: origin → vias → final. */
export function buildDirectionsCoords(
  origin: LngLat,
  viaStops: TripStop[],
  finalDest: LngLat
): LngLat[] {
  return [origin, ...viaStops.map((s) => s.lngLat), finalDest];
}

/** GPS puck is navigating toward this point (next via, or final destination). */
export function currentNavTarget(
  viaStops: TripStop[],
  activeViaIndex: number,
  finalDest: LngLat | null
): LngLat | null {
  if (!finalDest) return null;
  if (activeViaIndex < viaStops.length) return viaStops[activeViaIndex]!.lngLat;
  return finalDest;
}

/** Vias not yet visited — used when rerouting mid-trip. */
export function remainingViaStops(viaStops: TripStop[], activeViaIndex: number): TripStop[] {
  return viaStops.slice(Math.max(0, activeViaIndex));
}

export function formatTripDestinationLabel(viaStops: TripStop[], finalLabel: string): string {
  const fin = finalLabel.trim() || "Destination";
  const stop = viaStops[0]?.label.trim();
  if (!stop) return fin;
  return `${stop} → ${fin}`;
}
