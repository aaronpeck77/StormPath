import mapboxgl from "../mapboxCapacitorWorker";
import { isMapUsable } from "../ui/mapCameraSafe";

const WARM_ZOOM_LEVELS = [10, 11, 12, 13] as const;
const STEP_IDLE_MS = 140;
const IDLE_TIMEOUT_MS = 12_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function waitMapIdle(map: mapboxgl.Map): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (!map.isMoving()) {
        resolve();
        return;
      }
      const timer = window.setTimeout(() => {
        map.off("idle", onIdle);
        resolve();
      }, IDLE_TIMEOUT_MS);
      const onIdle = () => {
        window.clearTimeout(timer);
        map.off("idle", onIdle);
        resolve();
      };
      map.once("idle", onIdle);
    } catch {
      resolve();
    }
  });
}

export type MapCacheWarmResult = "done" | "aborted" | "failed";

/**
 * Low-priority camera passes over a region so Mapbox GL fills its HTTP / WebKit tile cache.
 * Restores the prior camera when finished or aborted.
 */
export async function warmMapTilesForBounds(
  map: mapboxgl.Map,
  bounds: [[number, number], [number, number]],
  shouldAbort: () => boolean
): Promise<MapCacheWarmResult> {
  if (!isMapUsable(map)) return "failed";
  try {
    if (!map.isStyleLoaded()) return "failed";
  } catch {
    return "failed";
  }

  const box = new mapboxgl.LngLatBounds(bounds[0], bounds[1]);
  if (box.isEmpty()) return "failed";

  let savedCenter: mapboxgl.LngLat;
  let savedZoom: number;
  let savedBearing: number;
  let savedPitch: number;
  try {
    savedCenter = map.getCenter();
    savedZoom = map.getZoom();
    savedBearing = map.getBearing();
    savedPitch = map.getPitch();
  } catch {
    return "failed";
  }

  const restore = () => {
    try {
      if (!isMapUsable(map)) return;
      map.jumpTo({
        center: savedCenter,
        zoom: savedZoom,
        bearing: savedBearing,
        pitch: savedPitch,
      });
    } catch {
      /* map disposed */
    }
  };

  try {
    for (const maxZoom of WARM_ZOOM_LEVELS) {
      if (shouldAbort()) {
        restore();
        return "aborted";
      }
      map.fitBounds(box, {
        padding: 28,
        maxZoom,
        duration: 0,
        pitch: 0,
        bearing: 0,
        essential: true,
      });
      await waitMapIdle(map);
      if (shouldAbort()) {
        restore();
        return "aborted";
      }
      await sleep(STEP_IDLE_MS);
    }
  } catch {
    restore();
    return "failed";
  }

  restore();
  await waitMapIdle(map);
  return "done";
}
