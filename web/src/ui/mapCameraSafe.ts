import type { LngLatBounds, Map } from "mapbox-gl";
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

export function readMapLngLat(value: unknown): LngLat | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const lng = value[0];
    const lat = value[1];
    if (typeof lng !== "number" || typeof lat !== "number") return null;
    if (!isValidLngLat(lng, lat)) return null;
    return [lng, lat];
  }
  if (typeof value === "object") {
    const o = value as { lng?: unknown; lat?: unknown };
    const lng = o.lng;
    const lat = o.lat;
    if (typeof lng !== "number" || typeof lat !== "number") return null;
    if (!isValidLngLat(lng, lat)) return null;
    return [lng, lat];
  }
  return null;
}

/** setLngLat on markers/popups — skip when coords are missing (Mapbox throws `e.lng` internally). */
export function safeSetMapLngLat(
  target: { setLngLat(lngLat: LngLat): unknown },
  lngLat: unknown
): boolean {
  const coord = readMapLngLat(lngLat);
  if (!coord) return false;
  try {
    target.setLngLat(coord);
    return true;
  } catch {
    return false;
  }
}

function normalizeCenter(center: LngLatLike | null | undefined): LngLat | null {
  return readMapLngLat(center);
}

/** Cancel in-flight ease/fly/fit so a new camera command does not corrupt Mapbox internal state. */
export function stopMapCamera(map: Map): void {
  if (!isMapUsable(map)) return;
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

/** False after `map.remove()` or when the container is detached (Capacitor view swaps). */
export function isMapUsable(map: Map | null | undefined): boolean {
  if (!map) return false;
  try {
    return Boolean(map.getContainer()?.isConnected);
  } catch {
    return false;
  }
}

/** Style loaded and container still attached — required before camera / worker RPC calls. */
function isMapReadyForCamera(map: Map | null | undefined): map is Map {
  if (!map || !isMapUsable(map)) return false;
  try {
    return map.isStyleLoaded();
  } catch {
    return false;
  }
}

export function setMapCanvasCursor(map: Map | null | undefined, cursor: string): void {
  if (!isMapUsable(map)) return;
  try {
    const canvas = getMapCanvas(map);
    if (canvas?.style) canvas.style.cursor = cursor;
  } catch {
    /* map mid-teardown or style reload */
  }
}

export function flattenMapCamera(map: Map | null | undefined): boolean {
  if (!map || !isMapUsable(map)) return false;
  try {
    if (map.getPitch() <= 0.25 && Math.abs(map.getBearing()) <= 0.25) return true;
    stopMapCamera(map);
    map.easeTo({ pitch: 0, bearing: 0, duration: 420, essential: true });
    return true;
  } catch {
    return false;
  }
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
  if (!isMapReadyForCamera(map)) return false;
  try {
    stopMapCamera(map);
    let next = options;
    if (options.center !== undefined && options.center !== null) {
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

/** Follow-camera nudge (duration 0) — must not call {@link stopMapCamera} or it kills active touch pan/zoom. */
export function safePanToCenter(map: Map, options: EaseToOptions): boolean {
  if (!isMapReadyForCamera(map)) return false;
  try {
    let next: EaseToOptions = { ...options, duration: 0, essential: true };
    if (options.center !== undefined && options.center !== null) {
      const center = normalizeCenter(options.center);
      if (!center) return false;
      next = { ...next, center };
    }
    map.easeTo(next);
    return true;
  } catch {
    return false;
  }
}

export function safeFlyTo(map: Map, options: FlyToOptions): boolean {
  if (!isMapReadyForCamera(map)) return false;
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
  if (!isMapReadyForCamera(map)) return false;
  try {
    if (bounds.isEmpty()) return false;
    stopMapCamera(map);
    map.fitBounds(bounds, options);
    return true;
  } catch {
    return false;
  }
}
