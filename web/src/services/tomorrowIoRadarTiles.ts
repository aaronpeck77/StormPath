/**
 * Tomorrow.io map tiles — US precipitation intensity (higher zoom than RainViewer).
 * @see https://docs.tomorrow.io/docs/tiles
 */

import { Capacitor, CapacitorHttp } from "@capacitor/core";

export const TOMORROW_IO_RADAR_MAX_ZOOM = 10;
export const TOMORROW_IO_PRECIP_FIELD = "precipitationIntensity";

/** US map animation: 5-min steps × 12 frames ≈ 55 min replay, then loop. */
export const TOMORROW_IO_ANIMATION_FRAME_COUNT = 12;
export const TOMORROW_IO_ANIMATION_STEP_MIN = 5;
/** No dwell — crossfades chain back-to-back for continuous motion. */
export const TOMORROW_IO_ANIMATION_DWELL_MS = 0;
export const TOMORROW_IO_ANIMATION_CROSSFADE_MS = 2200;

const TOMORROW_IO_TILE_API = "https://api.tomorrow.io/v4/map/tile";
const DEFAULT_TOMORROW_IO_TILE_PROXY_URL =
  "https://stormpath2.netlify.app/.netlify/functions/tomorrow-io-tile";
const DEV_TILE_PROXY_PREFIX = "/tomorrow-io-tiles";

export type TomorrowIoRadarFrame = { time: number; path: string };

function alignUtcToStepMin(ms: number, stepMin: number): Date {
  const d = new Date(ms);
  d.setUTCSeconds(0, 0);
  d.setUTCMilliseconds(0);
  d.setUTCMinutes(Math.floor(d.getUTCMinutes() / stepMin) * stepMin);
  return d;
}

/** CONUS + Alaska + Hawaii — primary US driving coverage. */
export function isInTomorrowIoUsPrecipRegion(lng: number, lat: number): boolean {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  if (lng >= -170 && lng <= -129 && lat >= 51 && lat <= 72) return true;
  if (lng >= -161 && lng <= -154 && lat >= 18 && lat <= 23) return true;
  if (lng >= -125 && lng <= -66 && lat >= 24 && lat <= 50) return true;
  return false;
}

/**
 * Base URL for Mapbox raster tile templates (no trailing slash).
 * Native Capacitor uses a CORS-friendly proxy — WKWebView blocks direct api.tomorrow.io.
 */
export function resolveTomorrowIoMapTileBase(): string {
  if (Capacitor.isNativePlatform()) {
    const custom = (import.meta.env.VITE_TOMORROW_IO_TILE_PROXY_URL as string | undefined)?.trim();
    return (custom || DEFAULT_TOMORROW_IO_TILE_PROXY_URL).replace(/\/$/, "");
  }
  if (import.meta.env.DEV) return DEV_TILE_PROXY_PREFIX;
  if (typeof window !== "undefined" && window.location.origin.startsWith("http")) {
    return `${window.location.origin}/.netlify/functions/tomorrow-io-tile`;
  }
  return TOMORROW_IO_TILE_API;
}

/** Mapbox raster template — `{z}` / `{x}` / `{y}` placeholders. */
export function tomorrowIoPrecipTileUrlTemplate(apiKey: string, timestampIso: string): string {
  const ts =
    timestampIso === "now" ? "now" : timestampIso.replace(/:/g, "%3A");
  const base = resolveTomorrowIoMapTileBase();
  if (base === TOMORROW_IO_TILE_API) {
    return `${base}/{z}/{x}/{y}/${TOMORROW_IO_PRECIP_FIELD}/${ts}.png?apikey=${encodeURIComponent(apiKey)}`;
  }
  return `${base}/{z}/{x}/{y}/${TOMORROW_IO_PRECIP_FIELD}/${ts}.png?apikey=${encodeURIComponent(apiKey)}`;
}

/** Observed precip frames for animation (5-min steps; US supports up to ~6 h history). */
export function buildTomorrowIoRadarFrames(opts?: {
  windowMin?: number;
  stepMin?: number;
}): TomorrowIoRadarFrame[] {
  const stepMin = Math.max(5, opts?.stepMin ?? TOMORROW_IO_ANIMATION_STEP_MIN);
  const defaultWindow =
    (TOMORROW_IO_ANIMATION_FRAME_COUNT - 1) * stepMin + stepMin;
  const windowMin = Math.min(360, Math.max(10, opts?.windowMin ?? defaultWindow));
  const nowMs = alignUtcToStepMin(Date.now(), stepMin).getTime();
  const frames: TomorrowIoRadarFrame[] = [];
  for (let offset = windowMin; offset >= 0; offset -= stepMin) {
    const d = new Date(nowMs - offset * 60_000);
    const iso = d.toISOString().replace(/\.\d{3}Z$/, "Z");
    frames.push({ time: Math.floor(d.getTime() / 1000), path: iso });
  }
  return frames;
}

export function tomorrowIoTileUrlFromFrame(apiKey: string, timestampIso: string): string {
  return tomorrowIoPrecipTileUrlTemplate(apiKey, timestampIso);
}

/** True when Mapbox can load Tomorrow.io raster tiles on this platform. */
export function canUseTomorrowIoMapRasterTiles(): boolean {
  if (!Capacitor.isNativePlatform()) return true;
  return Boolean(resolveTomorrowIoMapTileBase());
}

let tileProbeCache: { key: string; ok: boolean } | null = null;

async function probeTileUrl(url: string): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      const hr = await CapacitorHttp.request({
        url,
        method: "GET",
        connectTimeout: 12_000,
        readTimeout: 12_000,
        responseType: "blob",
      });
      return hr.status >= 200 && hr.status < 300;
    } catch {
      return false;
    }
  }
  try {
    const res = await fetch(url, { method: "GET", cache: "no-store", mode: "cors" });
    return res.ok;
  } catch {
    return false;
  }
}

/** Sample tile fetch — uses the same URL template Mapbox raster sources load. */
export async function verifyTomorrowIoRadarTileAccess(apiKey: string): Promise<boolean> {
  const key = apiKey.trim();
  if (!key || !canUseTomorrowIoMapRasterTiles()) return false;
  if (tileProbeCache?.key === key) return tileProbeCache.ok;

  const template = tomorrowIoPrecipTileUrlTemplate(key, "now");
  const url = template.replace("{z}", "4").replace("{x}", "14").replace("{y}", "6");
  const ok = await probeTileUrl(url);
  tileProbeCache = { key, ok };
  return ok;
}

export function resetTomorrowIoRadarTileProbeCache(): void {
  tileProbeCache = null;
}
