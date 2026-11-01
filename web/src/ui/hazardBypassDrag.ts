import mapboxgl from "../mapboxCapacitorWorker";
import type { LngLat } from "../nav/types";

const MIN_PULL_PX = 18;
/** Extra grab room so a finger can catch a zoomed-out trip line. */
const HIT_PAD_PX = 22;

type MapPointEvent = {
  point: { x: number; y: number };
  lngLat: { lng: number; lat: number };
  originalEvent?: Event;
};

function hitRouteLine(map: mapboxgl.Map, point: { x: number; y: number }): boolean {
  const layers =
    map
      .getStyle()
      ?.layers?.map((layer) => layer.id)
      .filter((id) => id.startsWith("route-") && id.endsWith("-line-hit") && map.getLayer(id)) ?? [];
  if (layers.length === 0) return false;
  try {
    return (
      map.queryRenderedFeatures(
        [
          [point.x - HIT_PAD_PX, point.y - HIT_PAD_PX],
          [point.x + HIT_PAD_PX, point.y + HIT_PAD_PX],
        ],
        { layers }
      ).length > 0
    );
  } catch {
    return false;
  }
}

function toLngLat(lngLat: { lng: number; lat: number }): LngLat {
  return [lngLat.lng, lngLat.lat];
}

/**
 * Finger down on the route line, drag, let go.
 * The map stays still while the finger is down. Release reports both ends of the pull.
 */
export function attachHazardRouteDrag(
  map: mapboxgl.Map,
  onPull: (grab: LngLat, release: LngLat) => void
): () => void {
  let dragging = false;
  let grab: LngLat | null = null;
  let grabPx: { x: number; y: number } | null = null;
  let lastPx: { x: number; y: number } | null = null;
  let last: LngLat | null = null;
  let marker: mapboxgl.Marker | null = null;

  const endDrag = (commit: boolean) => {
    if (!dragging) return;
    dragging = false;
    map.dragPan.enable();
    marker?.remove();
    marker = null;
    const moved =
      grabPx && lastPx ? Math.hypot(lastPx.x - grabPx.x, lastPx.y - grabPx.y) : 0;
    if (commit && grab && last && moved >= MIN_PULL_PX) onPull(grab, last);
    grab = null;
    grabPx = null;
    lastPx = null;
    last = null;
  };

  const onDown = (event: MapPointEvent) => {
    const touches = (event.originalEvent as TouchEvent | undefined)?.touches?.length ?? 0;
    if (touches > 1) {
      endDrag(false);
      return;
    }
    if (!hitRouteLine(map, event.point)) return;
    dragging = true;
    grab = toLngLat(event.lngLat);
    grabPx = { x: event.point.x, y: event.point.y };
    lastPx = grabPx;
    last = grab;
    map.dragPan.disable();
    marker = new mapboxgl.Marker({ color: "#f59e0b" }).setLngLat(grab).addTo(map);
  };

  const onMove = (event: MapPointEvent) => {
    if (!dragging) return;
    last = toLngLat(event.lngLat);
    lastPx = { x: event.point.x, y: event.point.y };
    marker?.setLngLat(last);
  };

  const onUp = () => endDrag(true);

  map.on("mousedown", onDown as (ev: mapboxgl.MapMouseEvent) => void);
  map.on("touchstart", onDown as (ev: mapboxgl.MapTouchEvent) => void);
  map.on("mousemove", onMove as (ev: mapboxgl.MapMouseEvent) => void);
  map.on("touchmove", onMove as (ev: mapboxgl.MapTouchEvent) => void);
  map.on("mouseup", onUp);
  map.on("touchend", onUp);

  return () => {
    endDrag(false);
    map.off("mousedown", onDown as (ev: mapboxgl.MapMouseEvent) => void);
    map.off("touchstart", onDown as (ev: mapboxgl.MapTouchEvent) => void);
    map.off("mousemove", onMove as (ev: mapboxgl.MapMouseEvent) => void);
    map.off("touchmove", onMove as (ev: mapboxgl.MapTouchEvent) => void);
    map.off("mouseup", onUp);
    map.off("touchend", onUp);
  };
}
