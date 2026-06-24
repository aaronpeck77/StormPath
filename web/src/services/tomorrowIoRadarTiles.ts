/**
 * Tomorrow.io map tiles — US precipitation intensity (higher zoom than RainViewer).
 * @see https://docs.tomorrow.io/docs/tiles
 */

import { Capacitor } from "@capacitor/core";

export const TOMORROW_IO_RADAR_MAX_ZOOM = 10;
export const TOMORROW_IO_PRECIP_FIELD = "precipitationIntensity";

/** US map animation: 5-min steps × 12 frames ≈ 55 min replay, then loop. */
export const TOMORROW_IO_ANIMATION_FRAME_COUNT = 12;
export const TOMORROW_IO_ANIMATION_STEP_MIN = 5;
export const TOMORROW_IO_ANIMATION_DWELL_MS = 1200;
export const TOMORROW_IO_ANIMATION_CROSSFADE_MS = 1800;

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

/** Mapbox raster template — `{z}` / `{x}` / `{y}` placeholders. */
export function tomorrowIoPrecipTileUrlTemplate(apiKey: string, timestampIso: string): string {
  const ts =
    timestampIso === "now" ? "now" : timestampIso.replace(/:/g, "%3A");
  return `https://api.tomorrow.io/v4/map/tile/{z}/{x}/{y}/${TOMORROW_IO_PRECIP_FIELD}/${ts}.png?apikey=${encodeURIComponent(apiKey)}`;
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

/**
 * Mapbox GL loads raster tiles through the WebView fetch stack. On Capacitor iOS/Android,
 * api.tomorrow.io is blocked by WKWebView CORS (same constraint as timelines in tomorrowIo.ts).
 * Forecast APIs use CapacitorHttp; map tiles cannot — use RainViewer on native instead.
 */
export function canUseTomorrowIoMapRasterTiles(): boolean {
  return !Capacitor.isNativePlatform();
}

let tileProbeCache: { key: string; ok: boolean } | null = null;

/** Sample tile fetch — mirrors Mapbox raster loading (browser fetch, not CapacitorHttp). */
export async function verifyTomorrowIoRadarTileAccess(apiKey: string): Promise<boolean> {
  const key = apiKey.trim();
  if (!key || !canUseTomorrowIoMapRasterTiles()) return false;
  if (tileProbeCache?.key === key) return tileProbeCache.ok;

  const template = tomorrowIoPrecipTileUrlTemplate(key, "now");
  const url = template.replace("{z}", "4").replace("{x}", "14").replace("{y}", "6");
  let ok = false;
  try {
    const res = await fetch(url, { method: "GET", cache: "no-store", mode: "cors" });
    ok = res.ok;
  } catch {
    ok = false;
  }
  tileProbeCache = { key, ok };
  return ok;
}

export function resetTomorrowIoRadarTileProbeCache(): void {
  tileProbeCache = null;
}
