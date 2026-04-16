/**
 * RainViewer public API — precipitation radar tiles (no API key).
 * @see https://www.rainviewer.com/api.html
 * @see https://www.rainviewer.com/api/weather-maps-api.html (max zoom 7 — higher z returns error tiles)
 */
const MANIFEST = "https://api.rainviewer.com/public/weather-maps.json";

/** RainViewer only serves z=0..7; Mapbox must overzoom above that or tiles show “zoom level not supported”. */
export const RAINVIEWER_RADAR_MAX_ZOOM = 7;

/**
 * Pause after each opacity crossfade before advancing to the next frame (ms).
 * Total time per step ≈ RAINVIEWER_RADAR_CROSSFADE_MS + this value.
 * @see mapRadarLayer RAINVIEWER_RADAR_CROSSFADE_MS
 */
export const RAINVIEWER_ANIMATION_DWELL_MS = 420;

type Manifest = {
  host?: string;
  radar?: {
    past?: { time?: number; path?: string }[];
    nowcast?: { time?: number; path?: string }[];
  };
};

export type RainViewerRadarFrame = { time: number; path: string };

export type RainViewerRadarPack = {
  host: string;
  frames: RainViewerRadarFrame[];
};

export type FetchRainViewerRadarOptions = {
  /**
   * Include `radar.nowcast` (short-term forecast tiles; timestamps are often **ahead of now**).
   * Default false: only `radar.past` (~2 h of observed composite), which matches “what just happened” / latest available mosaic.
   */
  includeNowcast?: boolean;
};

function normalizeHost(h: string): string {
  return h.replace(/\/$/, "");
}

/** Full tile URL template for Mapbox raster source. */
export function tileUrlFromHostAndPath(host: string, path: string): string {
  return `${normalizeHost(host)}${path}/256/{z}/{x}/{y}/2/1_1.png`;
}

/**
 * Past frames (~10 min steps) for observed composite radar.
 * Optionally append nowcast (forecast) frames — those use **future** `time` values and confuse “current” displays.
 * Refresh the manifest periodically for newer mosaics (not sub-minute “live”).
 */
export async function fetchRainViewerRadarFrames(
  opts?: FetchRainViewerRadarOptions
): Promise<RainViewerRadarPack | null> {
  const includeNowcast = opts?.includeNowcast ?? false;
  const res = await fetch(MANIFEST);
  if (!res.ok) return null;
  const data = (await res.json()) as Manifest;
  const host = normalizeHost(data.host ?? "https://tilecache.rainviewer.com");
  const past = data.radar?.past ?? [];
  const merged: RainViewerRadarFrame[] = [];
  for (const f of past) {
    if (f.path != null && f.time != null) merged.push({ time: f.time, path: f.path });
  }
  if (includeNowcast) {
    const nowcast = data.radar?.nowcast ?? [];
    for (const f of nowcast) {
      if (f.path != null && f.time != null) merged.push({ time: f.time, path: f.path });
    }
  }
  if (!merged.length) return null;
  merged.sort((a, b) => a.time - b.time);
  const seen = new Set<string>();
  const deduped = merged.filter((f) => {
    if (seen.has(f.path)) return false;
    seen.add(f.path);
    return true;
  });
  return { host, frames: deduped };
}

/** Latest **observed** past frame only (static overlay, no animation). */
export async function rainViewerPrecipTileUrlTemplate(): Promise<string | null> {
  const pack = await fetchRainViewerRadarFrames({ includeNowcast: false });
  if (!pack?.frames.length) return null;
  const last = pack.frames[pack.frames.length - 1]!;
  return tileUrlFromHostAndPath(pack.host, last.path);
}
