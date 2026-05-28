import type { LngLat as MapLngLat, LngLatBounds, Map } from "mapbox-gl";
import type { LngLat } from "../nav/types";

type EaseToOptions = Parameters<Map["easeTo"]>[0];
type FlyToOptions = Parameters<Map["flyTo"]>[0];
type FitBoundsOptions = Parameters<Map["fitBounds"]>[1];
type LngLatLike = NonNullable<Parameters<Map["easeTo"]>[0]["center"]>;

/** Finite lng/lat within normal WGS84 range — skip before Mapbox camera/bounds calls. */
export function isValidLngLat(lng: unknown, lat: unknown): lng is number {
  return (
    typeof lng === "number" &&
    typeof lat === "number" &&
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    Math.abs(lng) <= 180 &&
    Math.abs(lat) <= 90
  );
}

export function isValidLngLatPair(coord: LngLat | null | undefined): coord is LngLat {
  if (!coord || coord.length < 2) return false;
  return isValidLngLat(coord[0], coord[1]);
}

function normalizeCenter(center: LngLatLike): LngLat | null {
  if (Array.isArray(center)) {
    const lng = center[0];
    const lat = center[1];
    return isValidLngLat(lng, lat) ? [lng, lat] : null;
  }
  const lng = (center as MapLngLat).lng;
  const lat = (center as MapLngLat).lat;
  return isValidLngLat(lng, lat) ? [lng, lat] : null;
}

/** Cancel in-flight ease/fly/fit so a new camera command does not corrupt Mapbox internal state. */
export function stopMapCamera(map: Map): void {
  try {
    map.stop();
  } catch {
    /* map disposed */
  }
}

export function getMapCanvas(map: Map | null | undefined): HTMLCanvasElement | null {
  if (!map) return null;
  try {
    return map.getCanvas() ?? null;
  } catch {
    return null;
  }
}

export function setMapCanvasCursor(map: Map | null | undefined, cursor: string): void {
  const canvas = getMapCanvas(map);
  if (canvas) canvas.style.cursor = cursor;
}

export function safeExtendBounds(b: LngLatBounds, coord: LngLat | null | undefined): void {
  if (!isValidLngLatPair(coord)) return;
  try {
    b.extend(coord);
  } catch {
    /* invalid bounds state */
  }
}

export function safeEaseTo(map: Map, options: EaseToOptions): boolean {
  try {
    stopMapCamera(map);
    let next = options;
    if (options.center !== undefined) {
      const center = normalizeCenter(options.center);
      if (!center) return false;
      next = { ...options, center };
    }
    map.easeTo(next);
    return true;
  } catch {
    return false;
  }
}

export function safeFlyTo(map: Map, options: FlyToOptions): boolean {
  try {
    stopMapCamera(map);
    if (options.center === undefined) return false;
    const center = normalizeCenter(options.center);
    if (!center) return false;
    map.flyTo({ ...options, center });
    return true;
  } catch {
    return false;
  }
}

export function safeFitBounds(
  map: Map,
  bounds: LngLatBounds,
  options?: FitBoundsOptions
): boolean {
  try {
    if (bounds.isEmpty()) return false;
    stopMapCamera(map);
    map.fitBounds(bounds, options);
    return true;
  } catch {
    return false;
  }
}
