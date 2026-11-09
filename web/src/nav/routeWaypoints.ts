import type { LngLat } from "./types";

/** One optional intermediate stop before the final destination. */
export type TripStop = {
  lngLat: LngLat;
  label: string;
};

/** Optional intermediate stops before the final destination. The nav pipeline
 * (activeViaIndex, remainingViaStops, arrival advance) is array-based end to
 * end; Mapbox Directions accepts far more than this. 4 covers pickup → drop →
 * rest/fuel → final without turning one trip into a delivery manifest. */
export const MAX_VIA_STOPS = 4;

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
  const stops = viaStops.map((s) => s.label.trim()).filter(Boolean);
  if (stops.length === 0) return fin;
  return `${stops.join(" → ")} → ${fin}`;
}
