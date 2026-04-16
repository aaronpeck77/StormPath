/**
 * Same clock window as {@link DriveMap} streets vs dark-v11 — used to style chrome when the basemap is night.
 */
export function isMapBasemapDaytime(): boolean {
  const h = new Date().getHours();
  return h >= 6 && h < 19;
}
