/** World bounds — no pan restriction. */
export const WORLD_BOUNDS: [[number, number], [number, number]] = [
  [-180, -85],
  [180, 85],
];

/** Alias kept for existing imports — now covers the whole world. */
export const NORTH_AMERICA_BOUNDS = WORLD_BOUNDS;

/** Returns true for any valid world coordinate. Kept for call-site compatibility. */
export function lngLatInNorthAmerica(_lng: number, _lat: number): boolean {
  return true;
}
