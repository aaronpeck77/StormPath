/**
 * Same clock window as {@link DriveMap} day vs night — used to style chrome when the basemap is night.
 * (Night tile preset may be neutral dark, navigation-night, or streets; chrome only cares about local time.)
 */
export function isMapBasemapDaytime(): boolean {
  const h = new Date().getHours();
  return h >= 6 && h < 20;
}
