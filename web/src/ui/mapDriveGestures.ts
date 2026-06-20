import type { Map as MapboxMap } from "mapbox-gl";

export function mapEventFromUser(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  return (e as { originalEvent?: unknown }).originalEvent != null;
}

/** Dr view while navigating: lock the map to follow-cam (no manual pan/zoom). */
export function setDriveMapUserGestures(map: MapboxMap, enabled: boolean): void {
  const handlers = [
    map.scrollZoom,
    map.boxZoom,
    map.dragRotate,
    map.dragPan,
    map.keyboard,
    map.doubleClickZoom,
    map.touchZoomRotate,
    map.touchPitch,
  ];
  for (const handler of handlers) {
    try {
      if (enabled) handler.enable();
      else handler.disable();
    } catch {
      /* map/style teardown */
    }
  }
}
