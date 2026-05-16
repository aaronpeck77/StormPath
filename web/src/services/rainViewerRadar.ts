/**
 * RainViewer public API — precipitation radar tiles (no API key).
 * @see https://www.rainviewer.com/api.html
 * @see https://www.rainviewer.com/api/weather-maps-api.html (max zoom 7 — higher z returns error tiles)
 */
const MANIFEST = "https://api.rainviewer.com/public/weather-maps.json";

/** RainViewer only serves z=0..7; Mapbox must overzoom above that or tiles show “zoom level not supported”. */
export const RAINVIEWER_RADAR_MAX_ZOOM = 7;

/** Animate only the last 30 minutes of observed radar (~3 frames). */
export const RAINVIEWER_LOOP_PAST_WINDOW_SEC = 30 * 60;

/**
 * Very short pause at each frame before the blend begins.
 * With only ~3 frames per 30-min window, the long crossfade IS the animation —
 * radar appears to flow continuously rather than snap between snapshots.
 */
export const RAINVIEWER_ANIMATION_DWELL_MS = 100;

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
  /** Limit `radar.past` to frames at or after `now - pastWindowSec` (default {@link RAINVIEWER_LOOP_PAST_WINDOW_SEC}). */
  pastWindowSec?: number;
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
function filterPastFramesByWindow(
  frames: RainViewerRadarFrame[],
  windowSec: number
): RainViewerRadarFrame[] {
  if (!frames.length) return frames;
  const latest = frames[frames.length - 1]!.time;
  const cutoff = latest - windowSec;
  const inWindow = frames.filter((f) => f.time >= cutoff);
  return inWindow.length >= 2 ? inWindow : frames.slice(-Math.min(frames.length, 2));
}

export async function fetchRainViewerRadarFrames(
  opts?: FetchRainViewerRadarOptions
): Promise<RainViewerRadarPack | null> {
  const includeNowcast = opts?.includeNowcast ?? false;
  const pastWindowSec = opts?.pastWindowSec ?? RAINVIEWER_LOOP_PAST_WINDOW_SEC;
  const res = await fetch(MANIFEST);
  if (!res.ok) return null;
  const data = (await res.json()) as Manifest;
  const host = normalizeHost(data.host ?? "https://tilecache.rainviewer.com");
  const pastRaw = data.radar?.past ?? [];
  const pastSorted: RainViewerRadarFrame[] = [];
  for (const f of pastRaw) {
    if (f.path != null && f.time != null) pastSorted.push({ time: f.time, path: f.path });
  }
  pastSorted.sort((a, b) => a.time - b.time);
  const past = filterPastFramesByWindow(pastSorted, pastWindowSec);
  const merged: RainViewerRadarFrame[] = [];
  for (const f of past) {
    merged.push(f);
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
