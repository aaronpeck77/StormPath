/**
 * Offline zoom clamp for the web map.
 *
 * The IndexedDB tile cache only stores z≤13 (OFFLINE_MAX_STORED_ZOOM). While offline
 * (or while the radio is being held as unreliable) we cap the map's max zoom at
 * {@link OFFLINE_CLAMP_MAX_ZOOM} — high enough that the saved z13 vector tiles still
 * render crisply via GL's overzoom, low enough that the camera can never drift into
 * z14+ where nothing exists on disk and the map would go blank. GL applies maxZoom
 * to every camera move (follow-cam included) automatically.
 */
export const OFFLINE_CLAMP_MAX_ZOOM = 13.9;

export function offlineMaxZoom(input: {
  isOnline: boolean;
  holdLastGoodMap: boolean;
  normalMaxZoom: number;
}): number {
  const { isOnline, holdLastGoodMap, normalMaxZoom } = input;
  if (!isOnline || holdLastGoodMap) {
    return Math.min(normalMaxZoom, OFFLINE_CLAMP_MAX_ZOOM);
  }
  return normalMaxZoom;
}
