/** Map pan limits + geocode result filter: US, Canada, Alaska, nearby waters */
export const NORTH_AMERICA_BOUNDS: [[number, number], [number, number]] = [
  [-175, 15],
  [-48, 72],
];

export function lngLatInNorthAmerica(lng: number, lat: number): boolean {
  const [[w, s], [e, n]] = NORTH_AMERICA_BOUNDS;
  return lng >= w && lng <= e && lat >= s && lat <= n;
}
