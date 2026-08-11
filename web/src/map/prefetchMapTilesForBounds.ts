import type { CorridorBounds } from "./routeCorridorPreload";

/** Zooms that matter for Drive follow without downloading a state atlas. */
const DEFAULT_ZOOMS = [11, 12, 13] as const;
/** Hard cap per warm pass — keeps Mapbox + radio load bounded in weak signal. */
const DEFAULT_MAX_TILES = 72;

function lngToTileX(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}

function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  const n = 2 ** z;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
}

function clampTile(n: number, z: number): number {
  const max = 2 ** z - 1;
  return Math.max(0, Math.min(max, n));
}

export type PrefetchTilesResult = "done" | "aborted" | "failed" | "skipped";

/**
 * HTTP-prefetch Mapbox vector tiles for a bounds box without moving the Drive camera.
 * Fills the browser/WebKit HTTP cache so weak-signal stretches keep drawing longer.
 */
export async function prefetchMapTilesForBounds(
  bounds: CorridorBounds,
  accessToken: string,
  opts?: {
    shouldAbort?: () => boolean;
    zooms?: readonly number[];
    maxTiles?: number;
    /** Skip terrain DEM tiles (lite / data saver). */
    includeTerrain?: boolean;
  }
): Promise<PrefetchTilesResult> {
  const token = accessToken.trim();
  if (!token) return "skipped";
  if (typeof fetch !== "function") return "failed";

  const [[west, south], [east, north]] = bounds;
  if (
    !Number.isFinite(west) ||
    !Number.isFinite(south) ||
    !Number.isFinite(east) ||
    !Number.isFinite(north) ||
    east <= west ||
    north <= south
  ) {
    return "failed";
  }

  const zooms = opts?.zooms ?? DEFAULT_ZOOMS;
  const maxTiles = opts?.maxTiles ?? DEFAULT_MAX_TILES;
  const includeTerrain = opts?.includeTerrain !== false;
  const shouldAbort = opts?.shouldAbort ?? (() => false);

  const urls: string[] = [];
  for (const z of zooms) {
    if (shouldAbort()) return "aborted";
    const x0 = clampTile(lngToTileX(west, z), z);
    const x1 = clampTile(lngToTileX(east, z), z);
    const y0 = clampTile(latToTileY(north, z), z); // north → smaller y
    const y1 = clampTile(latToTileY(south, z), z);
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        urls.push(
          `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/${z}/${x}/${y}.vector.pbf?access_token=${encodeURIComponent(token)}`
        );
        if (includeTerrain) {
          urls.push(
            `https://api.mapbox.com/v4/mapbox.mapbox-terrain-dem-v1/${z}/${x}/${y}.webp?access_token=${encodeURIComponent(token)}`
          );
        }
        if (urls.length >= maxTiles) break;
      }
      if (urls.length >= maxTiles) break;
    }
    if (urls.length >= maxTiles) break;
  }

  if (urls.length === 0) return "failed";

  let fetched = 0;
  for (const url of urls) {
    if (shouldAbort()) return "aborted";
    try {
      await fetch(url, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        cache: "force-cache",
        ...( { priority: "low" } as RequestInit),
      });
      fetched += 1;
    } catch {
      /* weak radio — keep going; partial cache still helps */
    }
    /* Pace so we don't saturate a dying LTE link. */
    if (fetched % 6 === 0) {
      await new Promise((r) => window.setTimeout(r, 40));
    }
  }

  return fetched > 0 ? "done" : "failed";
}
