import type { LngLat } from "../nav/types";
import {
  fetchRainViewerRadarFrames,
  RAINVIEWER_RADAR_MAX_ZOOM,
  tileUrlFromHostAndPath,
  type FetchRainViewerRadarOptions,
  type RainViewerTileUrlKind,
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

export type RadarMapProvider = "tomorrow_io" | "rainviewer" | "hybrid";

export type RadarMapFrame = {
  time: number;
  path: string;
  /** Per-frame tile source when a pack mixes providers (US hybrid: TIO past + RV nowcast). */
  tileProvider?: "tomorrow_io" | "rainviewer";
};

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
const HYBRID_ATTRIBUTION = `${TIO_ATTRIBUTION} · short-term forecast ${RV_ATTRIBUTION}`;

/** Max RainViewer nowcast steps appended after Tomorrow.io past replay (US hybrid map). */
const HYBRID_NOWCAST_FRAME_CAP = 4;

/** US TIO/hybrid vs global RainViewer — for map pan provider switches. */
export function radarMapRegionProvider(
  provider: RadarMapProvider | ""
): "tomorrow_io" | "rainviewer" {
  return provider === "rainviewer" ? "rainviewer" : "tomorrow_io";
}
export function radarMapProviderForCenter(
  center: LngLat | null | undefined,
  tomorrowIoApiKey: string | null | undefined
): RadarMapProvider {
  if (!tomorrowIoApiKey?.trim() || !center) return "rainviewer";
  const [lng, lat] = center;
  return isInTomorrowIoUsPrecipRegion(lng, lat) ? "tomorrow_io" : "rainviewer";
}

export function tileProviderForFrame(
  pack: RadarMapPack,
  frame: RadarMapFrame
): "tomorrow_io" | "rainviewer" {
  if (frame.tileProvider) return frame.tileProvider;
  if (pack.provider === "rainviewer") return "rainviewer";
  return "tomorrow_io";
}

export function packIncludesFutureNowcast(pack: RadarMapPack): boolean {
  const nowSec = Math.floor(Date.now() / 1000);
  return pack.frames.some((f) => tileProviderForFrame(pack, f) === "rainviewer" && f.time > nowSec);
}

async function appendRainViewerNowcastToTioPack(
  tioFrames: RadarMapFrame[],
  mapAnimation: boolean
): Promise<RadarMapPack | null> {
  if (!tioFrames.length) return null;
  const rvNowcast = await fetchRainViewerRadarFrames({
    nowcastOnly: true,
    mapAnimation,
  });
  const latestTioSec = tioFrames[tioFrames.length - 1]!.time;
  const nowcastFrames: RadarMapFrame[] = (rvNowcast?.frames ?? [])
    .filter((f) => f.time > latestTioSec)
    .map((f) => ({ time: f.time, path: f.path, tileProvider: "rainviewer" as const }));
  if (!nowcastFrames.length) {
    return {
      provider: "tomorrow_io",
      host: "",
      frames: tioFrames,
      maxZoom: TOMORROW_IO_RADAR_MAX_ZOOM,
      attribution: TIO_ATTRIBUTION,
    };
  }
  return {
    provider: "hybrid",
    host: rvNowcast?.host ?? "",
    frames: [
      ...tioFrames.map((f) => ({ ...f, tileProvider: "tomorrow_io" as const })),
      ...nowcastFrames,
    ],
    maxZoom: TOMORROW_IO_RADAR_MAX_ZOOM,
    attribution: HYBRID_ATTRIBUTION,
  };
}

export async function resolveRadarMapPack(
  center: LngLat | null | undefined,
  tomorrowIoApiKey: string | null | undefined,
  opts?: FetchRainViewerRadarOptions & {
    forceRainViewer?: boolean;
    /**
     * Opt into US Tomorrow.io precip tiles (route intensity sampling).
     * Map overlay should omit this — TIO’s hot scale fights StormPath’s soft custom ramp.
     */
    allowTomorrowIoMapTiles?: boolean;
  }
): Promise<RadarMapPack | null> {
  const mapAnimation = opts?.mapAnimation ?? !opts?.forceRainViewer;
  const provider =
    opts?.forceRainViewer || !opts?.allowTomorrowIoMapTiles
      ? "rainviewer"
      : radarMapProviderForCenter(center, tomorrowIoApiKey);
  if (provider === "tomorrow_io" && tomorrowIoApiKey?.trim() && canUseTomorrowIoMapRasterTiles()) {
    const tilesOk = await verifyTomorrowIoRadarTileAccess(tomorrowIoApiKey);
    if (tilesOk) {
      const tioFrames = buildTomorrowIoRadarFrames().map((f) => ({
        time: f.time,
        path: f.path,
      }));
      if (mapAnimation) {
        return appendRainViewerNowcastToTioPack(tioFrames, mapAnimation);
      }
      return {
        provider: "tomorrow_io",
        host: "",
        frames: tioFrames,
        maxZoom: TOMORROW_IO_RADAR_MAX_ZOOM,
        attribution: TIO_ATTRIBUTION,
      };
    }
  }

  const {
    forceRainViewer: _force,
    mapAnimation: _mapAnim,
    allowTomorrowIoMapTiles: _allowTio,
    ...rvOpts
  } = opts ?? {};
  const pack = await fetchRainViewerRadarFrames({
    ...rvOpts,
    includeNowcast: rvOpts.includeNowcast ?? mapAnimation,
    mapAnimation,
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
  tomorrowIoApiKey?: string | null,
  /** Map overlay uses a softer palette; sampling keeps Universal Blue for intensity decode. */
  kind: RainViewerTileUrlKind = "map"
): string {
  const tileProvider = tileProviderForFrame(pack, frame);
  if (tileProvider === "tomorrow_io") {
    const key = tomorrowIoApiKey?.trim();
    if (!key) return "";
    return tomorrowIoTileUrlFromFrame(key, frame.path);
  }
  return tileUrlFromHostAndPath(pack.host, frame.path, kind);
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
  if (pack.provider === "hybrid" || packIncludesFutureNowcast(pack)) {
    const tioCells =
      pack.frames.filter((f) => tileProviderForFrame(pack, f) === "tomorrow_io").length >
      TOMORROW_IO_ANIMATION_FRAME_COUNT
        ? pack.frames
            .filter((f) => tileProviderForFrame(pack, f) === "tomorrow_io")
            .slice(-TOMORROW_IO_ANIMATION_FRAME_COUNT)
        : pack.frames.filter((f) => tileProviderForFrame(pack, f) === "tomorrow_io");
    const nowcastCells = pack.frames.filter((f) => tileProviderForFrame(pack, f) === "rainviewer");
    const cappedNowcast =
      nowcastCells.length > HYBRID_NOWCAST_FRAME_CAP
        ? nowcastCells.slice(0, HYBRID_NOWCAST_FRAME_CAP)
        : nowcastCells;
    return [...tioCells, ...cappedNowcast];
  }
  if (pack.provider === "tomorrow_io") {
    return pack.frames.length > TOMORROW_IO_ANIMATION_FRAME_COUNT
      ? pack.frames.slice(-TOMORROW_IO_ANIMATION_FRAME_COUNT)
      : pack.frames;
  }
  /* RainViewer: past + nowcast mosaics in the animation window (capped for tile budget). */
  const maxRvFrames = 10;
  if (pack.frames.length <= 1) return pack.frames;
  return pack.frames.length > maxRvFrames
    ? pack.frames.slice(-maxRvFrames)
    : pack.frames;
}
