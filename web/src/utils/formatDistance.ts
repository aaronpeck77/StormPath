import { roadUsesMiles } from "./displayUnits";

/** Short distance for UI chips (search, toolbar, banners). */
export function formatDistanceShort(meters: number | null, useMiles: boolean): string {
  if (meters == null || !Number.isFinite(meters) || meters < 0) return "";
  if (useMiles) {
    const miles = meters / 1609.344;
    if (miles < 0.1) return `${Math.round(meters * 3.28084)} ft`;
    if (miles < 10) return `${miles.toFixed(1)} mi`;
    return `${Math.round(miles)} mi`;
  }
  if (meters < 950) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/** Miles in the US and the UK. Kilometers everywhere else, including Ireland. */
export function useMilesForLngLat(lngLat: [number, number] | null | undefined): boolean {
  return roadUsesMiles(lngLat);
}
