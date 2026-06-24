import type { LngLat } from "../nav/types";
import {
  fetchRainViewerRadarFrames,
  RAINVIEWER_RADAR_MAX_ZOOM,
  tileUrlFromHostAndPath,
  type FetchRainViewerRadarOptions,
} from "./rainViewerRadar";
import {
  buildTomorrowIoRadarFrames,
  canUseTomorrowIoMapRasterTiles,
  isInTomorrowIoUsPrecipRegion,
  TOMORROW_IO_ANIMATION_FRAME_COUNT,
  TOMORROW_IO_RADAR_MAX_ZOOM,
  tomorrowIoTileUrlFromFrame,
  verifyTomorrowIoRadarTileAccess,
} from "./tomorrowIoRadarTiles";

export type RadarMapProvider = "tomorrow_io" | "rainviewer";

export type RadarMapFrame = { time: number; path: string };

export type RadarMapPack = {
  provider: RadarMapProvider;
  host: string;
  frames: RadarMapFrame[];
  maxZoom: number;
  attribution: string;
};

export type RadarFrameHudMeta = {
  provider: RadarMapProvider;
  index: number;
  total: number;
  oldestUtcSec: number;
  newestUtcSec: number;
};

const TIO_ATTRIBUTION =
  'Precipitation © <a href="https://www.tomorrow.io/" target="_blank" rel="noreferrer">Tomorrow.io</a>';
const RV_ATTRIBUTION =
  'Radar © <a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer">RainViewer</a>';

export function radarMapProviderForCenter(
  center: LngLat | null | undefined,
  tomorrowIoApiKey: string | null | undefined
): RadarMapProvider {
  if (!tomorrowIoApiKey?.trim() || !center) return "rainviewer";
  const [lng, lat] = center;
  return isInTomorrowIoUsPrecipRegion(lng, lat) ? "tomorrow_io" : "rainviewer";
}

export async function resolveRadarMapPack(
  center: LngLat | null | undefined,
  tomorrowIoApiKey: string | null | undefined,
  opts?: FetchRainViewerRadarOptions & { forceRainViewer?: boolean }
): Promise<RadarMapPack | null> {
  const provider = opts?.forceRainViewer
    ? "rainviewer"
    : radarMapProviderForCenter(center, tomorrowIoApiKey);
  if (provider === "tomorrow_io" && tomorrowIoApiKey?.trim() && canUseTomorrowIoMapRasterTiles()) {
    const tilesOk = await verifyTomorrowIoRadarTileAccess(tomorrowIoApiKey);
    if (tilesOk) {
      return {
        provider: "tomorrow_io",
        host: "",
        frames: buildTomorrowIoRadarFrames(),
        maxZoom: TOMORROW_IO_RADAR_MAX_ZOOM,
        attribution: TIO_ATTRIBUTION,
      };
    }
  }

  const { forceRainViewer: _force, mapAnimation: _mapAnim, ...rvOpts } = opts ?? {};
  const pack = await fetchRainViewerRadarFrames({
    ...rvOpts,
    mapAnimation: opts?.mapAnimation ?? !opts?.forceRainViewer,
  });
  if (!pack?.frames.length) return null;
  return {
    provider: "rainviewer",
    host: pack.host,
    frames: pack.frames.map((f) => ({ time: f.time, path: f.path })),
    maxZoom: RAINVIEWER_RADAR_MAX_ZOOM,
    attribution: RV_ATTRIBUTION,
  };
}

export function radarTileUrlForFrame(
  pack: RadarMapPack,
  frame: RadarMapFrame,
  tomorrowIoApiKey?: string | null
): string {
  if (pack.provider === "tomorrow_io") {
    const key = tomorrowIoApiKey?.trim();
    if (!key) return "";
    return tomorrowIoTileUrlFromFrame(key, frame.path);
  }
  return tileUrlFromHostAndPath(pack.host, frame.path);
}

export function nearestRadarFrameByTimeMs(
  frames: readonly RadarMapFrame[],
  targetMs: number
): RadarMapFrame {
  let best = frames[0]!;
  let bestDiff = Math.abs(best.time * 1000 - targetMs);
  for (const f of frames) {
    const diff = Math.abs(f.time * 1000 - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = f;
    }
  }
  return best;
}

export function animationCellsForPack(pack: RadarMapPack): RadarMapFrame[] {
  if (pack.provider === "tomorrow_io") {
    return pack.frames.length > TOMORROW_IO_ANIMATION_FRAME_COUNT
      ? pack.frames.slice(-TOMORROW_IO_ANIMATION_FRAME_COUNT)
      : pack.frames;
  }
  /* RainViewer: up to 6 recent ~10-min mosaics inside the map animation window. */
  return pack.frames.length > 1 ? pack.frames.slice(-6) : pack.frames;
}
