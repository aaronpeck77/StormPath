import mapboxgl from "../mapboxCapacitorWorker";
import type { LngLat } from "../nav/types";

const MIN_PULL_PX = 18;
/** Extra grab room so a finger can catch a zoomed-out trip line. */
const HIT_PAD_PX = 22;

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
  const container = map.getCanvasContainer();
  let pointerId: number | null = null;
  let suppressClick = false;
  let grab: LngLat | null = null;
  let grabPx: { x: number; y: number } | null = null;
  let lastPx: { x: number; y: number } | null = null;
  let last: LngLat | null = null;
  let marker: mapboxgl.Marker | null = null;

  const block = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const pointAt = (event: PointerEvent) => {
    const rect = container.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const endDrag = (commit: boolean) => {
    if (pointerId == null) return;
    const id = pointerId;
    pointerId = null;
    if (container.hasPointerCapture(id)) container.releasePointerCapture(id);
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

  const onDown = (event: PointerEvent) => {
    if (pointerId != null) {
      endDrag(false);
      return;
    }
    suppressClick = false;
    if (event.button !== 0) return;
    const point = pointAt(event);
    if (!hitRouteLine(map, point)) return;
    block(event);
    pointerId = event.pointerId;
    suppressClick = true;
    container.setPointerCapture(pointerId);
    grab = toLngLat(map.unproject([point.x, point.y]));
    grabPx = point;
    lastPx = point;
    last = grab;
    marker = new mapboxgl.Marker({ color: "#f59e0b" }).setLngLat(grab).addTo(map);
  };

  const onMove = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    block(event);
    lastPx = pointAt(event);
    last = toLngLat(map.unproject([lastPx.x, lastPx.y]));
    marker?.setLngLat(last);
  };
  const onUp = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    onMove(event);
    endDrag(true);
  };
  const onCancel = () => endDrag(false);
  const onLegacyGesture = (event: Event) => {
    if (pointerId != null || suppressClick) block(event);
  };
  const onClick = (event: Event) => {
    if (suppressClick) block(event);
    suppressClick = false;
  };
  const options = { capture: true, passive: false };
  container.addEventListener("pointerdown", onDown, options);
  container.addEventListener("pointermove", onMove, options);
  container.addEventListener("pointerup", onUp, options);
  container.addEventListener("pointercancel", onCancel, options);
  container.addEventListener("lostpointercapture", onCancel, options);
  container.addEventListener("click", onClick, options);
  const legacyEvents = ["touchstart", "touchmove", "touchend", "mousedown", "mousemove", "mouseup"];
  for (const name of legacyEvents) container.addEventListener(name, onLegacyGesture, options);

  return () => {
    endDrag(false);
    container.removeEventListener("pointerdown", onDown, options);
    container.removeEventListener("pointermove", onMove, options);
    container.removeEventListener("pointerup", onUp, options);
    container.removeEventListener("pointercancel", onCancel, options);
    container.removeEventListener("lostpointercapture", onCancel, options);
    container.removeEventListener("click", onClick, options);
    for (const name of legacyEvents) container.removeEventListener(name, onLegacyGesture, options);
  };
}
