/** World bounds — no pan restriction. */
export const WORLD_BOUNDS: [[number, number], [number, number]] = [
  [-180, -85],
  [180, 85],
];

/** Returns true for any valid world coordinate. Kept for call-site compatibility. */
export function lngLatInNorthAmerica(_lng: number, _lat: number): boolean {
  return true;
}
