import type { Map, MapSourceDataEvent, RasterTileSource } from "mapbox-gl";
import { RAINVIEWER_RADAR_MAX_ZOOM } from "../services/rainViewerRadar";
import type { RadarMapProvider } from "../services/radarMapPack";
import { noteRainViewerRateLimit } from "../services/rainViewerTileFetch";

const mapsWithRainViewerErrorFilter = new WeakSet<Map>();
const radarTileProviderByMap = new WeakMap<Map, RadarMapProvider>();

export function setRadarMapTileProvider(map: Map, provider: RadarMapProvider): void {
  radarTileProviderByMap.set(map, provider);
}

/** Legacy single-buffer ids (removed when using dual buffer). */
const LEGACY_RADAR_SOURCE = "rainviewer-radar";
const LEGACY_RADAR_LAYER = "rainviewer-radar-layer";

const RADAR_SOURCE_A = "rainviewer-radar-a";
const RADAR_SOURCE_B = "rainviewer-radar-b";
const RADAR_LAYER_A = "rainviewer-radar-layer-a";
const RADAR_LAYER_B = "rainviewer-radar-layer-b";

/**
 * Opacity for the visible radar layer (under basemap roads).
 * Kept moderate so yellow–green fringe does not read as severe storm cores.
 */
export const RAINVIEWER_RADAR_VISIBLE_OPACITY = 0.58;

/** Mute palette saturation/contrast so StormPath matches calmer consumer radar apps. */
export const RAINVIEWER_RADAR_RASTER_PAINT = {
  "raster-saturation": -0.22,
  "raster-contrast": -0.14,
  "raster-brightness-max": 0.8,
} as const;

export const RAINVIEWER_RADAR_LAYER_A = RADAR_LAYER_A;

/**
 * Target duration for one full radar history → now sweep (then loop).
 * ~3.6s gives ~300ms/frame on a 12-frame pack — still snappy, smoother blends.
 */
export const RADAR_ANIMATION_LOOP_MS = 3600;

/** Floor / ceiling per-frame crossfade so 2-frame packs aren't sluggish and dense packs don't flash. */
export const RADAR_ANIMATION_FRAME_MS_MIN = 160;
export const RADAR_ANIMATION_FRAME_MS_MAX = 480;

/**
 * Per-frame crossfade so {@link cellCount} frames complete in ~{@link RADAR_ANIMATION_LOOP_MS}.
 */
export function radarAnimationCrossfadeMs(cellCount: number): number {
  const n = Math.max(2, Math.floor(cellCount));
  const raw = Math.round(RADAR_ANIMATION_LOOP_MS / n);
  return Math.max(RADAR_ANIMATION_FRAME_MS_MIN, Math.min(RADAR_ANIMATION_FRAME_MS_MAX, raw));
}

/**
 * Legacy default crossfade (cinematic pace). Prefer {@link radarAnimationCrossfadeMs} for the live loop.
 */
export const RAINVIEWER_RADAR_CROSSFADE_MS = 3200;

/** Subtle tile fade on the hidden buffer while prewarming — reduces pop-in before opacity crossfade. */
export const RAINVIEWER_RADAR_PREWARM_TILE_FADE_MS = 180;

/** Legacy: crossfade when only one source and tile URLs change (unused by animated dual path). */
export const RAINVIEWER_RASTER_FADE_MS = 520;

/** Cosine ease 0→1 — softens start/end without the long “pause” of ease-in-out cubic. */
export function radarCrossfadeProgress(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return 0.5 - 0.5 * Math.cos(x * Math.PI);
}

function isStormPathLayerId(id: string): boolean {
  return (
    id.startsWith("route-") ||
    id.includes("rainviewer") ||
    id.startsWith("weather-alerts") ||
    id === "3d-buildings"
  );
}

/** First Mapbox road line layer — radar is inserted here so streets render on top. */
function firstBasemapRoadLineBeforeId(map: Map): string | undefined {
  for (const l of map.getStyle()?.layers ?? []) {
    if (l.type !== "line") continue;
    if (isStormPathLayerId(l.id)) continue;
    const src = "source" in l ? (l as { source?: string }).source : undefined;
    const sourceLayer =
      "source-layer" in l ? (l as { "source-layer"?: string })["source-layer"] : undefined;
    if (src === "composite" && sourceLayer === "road") return l.id;
  }
  return undefined;
}

function firstSymbolBeforeId(map: Map): string | undefined {
  for (const l of map.getStyle()?.layers ?? []) {
    if (l.type === "symbol" && !isStormPathLayerId(l.id)) return l.id;
  }
  return undefined;
}

/** Anchor radar under basemap roads (labels + route lines stay above). */
function radarInsertBeforeId(map: Map): string | undefined {
  return firstBasemapRoadLineBeforeId(map) ?? firstSymbolBeforeId(map);
}

/** Re-stack radar under Mapbox road lines after style or overlay changes. */
export function positionRainViewerRadarUnderRoads(map: Map): void {
  const beforeId = radarInsertBeforeId(map);
  if (!beforeId) return;
  for (const id of [RADAR_LAYER_A, RADAR_LAYER_B, LEGACY_RADAR_LAYER]) {
    if (!map.getLayer(id)) continue;
    try {
      map.moveLayer(id, beforeId);
    } catch {
      /* style race */
    }
  }
}

function removeLegacyIfPresent(map: Map): void {
  if (map.getLayer(LEGACY_RADAR_LAYER)) map.removeLayer(LEGACY_RADAR_LAYER);
  if (map.getSource(LEGACY_RADAR_SOURCE)) map.removeSource(LEGACY_RADAR_SOURCE);
}

/** Remove all RainViewer radar sources/layers (legacy + dual). */
export function removeRainViewerRadar(map: Map): void {
  removeLegacyIfPresent(map);
  if (map.getLayer(RADAR_LAYER_A)) map.removeLayer(RADAR_LAYER_A);
  if (map.getLayer(RADAR_LAYER_B)) map.removeLayer(RADAR_LAYER_B);
  if (map.getSource(RADAR_SOURCE_A)) map.removeSource(RADAR_SOURCE_A);
  if (map.getSource(RADAR_SOURCE_B)) map.removeSource(RADAR_SOURCE_B);
  radarTileProviderByMap.delete(map);
}

/** Swap tiles without tearing down the source (legacy single-layer animation). */
export function setRainViewerRadarTiles(map: Map, tileUrlTemplate: string): void {
  const src = map.getSource(LEGACY_RADAR_SOURCE) as RasterTileSource | undefined;
  if (src && typeof src.setTiles === "function") {
    src.setTiles([tileUrlTemplate]);
  }
}

export function setRainViewerRadarFadeMs(map: Map, ms: number = RAINVIEWER_RASTER_FADE_MS): void {
  if (map.getLayer(LEGACY_RADAR_LAYER)) {
    map.setPaintProperty(LEGACY_RADAR_LAYER, "raster-fade-duration", ms);
  }
}

/** Throttle Mapbox tile errors so a RainViewer burst does not spam the console or trigger GL retries. */
function installRainViewerMapErrorFilter(map: Map): void {
  if (mapsWithRainViewerErrorFilter.has(map)) return;
  mapsWithRainViewerErrorFilter.add(map);
  let lastWarnAt = 0;
  map.on("error", (e) => {
    const src = (e as { sourceId?: string }).sourceId ?? "";
    if (!src.includes("rainviewer")) return;
    if (radarTileProviderByMap.get(map) === "tomorrow_io") return;
    noteRainViewerRateLimit();
    setRainViewerRadarLayersVisible(map, false);
    if (Date.now() - lastWarnAt < 45_000) return;
    lastWarnAt = Date.now();
    if (import.meta.env.DEV) {
      console.warn(
        "[RainViewer] Some radar tiles failed to load (often rate limit or out-of-coverage). " +
          "Pausing animation ~90s; map radar may look patchy until then."
      );
    }
  });
}

/** Hide/show raster layers without removing sources (stops tile fetch storms while rate limited). */
export function setRainViewerRadarLayersVisible(map: Map, visible: boolean): void {
  const vis = visible ? "visible" : "none";
  for (const id of [RADAR_LAYER_A, RADAR_LAYER_B, LEGACY_RADAR_LAYER]) {
    if (!map.getLayer(id)) continue;
    try {
      map.setLayoutProperty(id, "visibility", vis);
    } catch {
      /* style race */
    }
  }
}

function addRasterPair(
  map: Map,
  sourceId: string,
  layerId: string,
  tileUrlTemplate: string,
  opacity: number,
  beforeId: string | undefined,
  maxZoom: number,
  attribution: string
): void {
  installRainViewerMapErrorFilter(map);
  map.addSource(sourceId, {
    type: "raster",
    tiles: [tileUrlTemplate],
    tileSize: 256,
    volatile: true,
    minzoom: 3,
    maxzoom: maxZoom,
    attribution,
  });
  map.addLayer(
    {
      id: layerId,
      type: "raster",
      source: sourceId,
      paint: {
        "raster-opacity": opacity,
        "raster-fade-duration": 0,
        ...RAINVIEWER_RADAR_RASTER_PAINT,
      },
    },
    beforeId
  );
}

/**
 * Two stacked raster sources. Layer B is above A. Initialize both to the same frame so the stack is valid.
 */
export function ensureRainViewerRadarDual(
  map: Map,
  initialTileUrlTemplate: string,
  visibleOpacity: number = RAINVIEWER_RADAR_VISIBLE_OPACITY,
  opts?: { maxZoom?: number; attribution?: string; recreate?: boolean }
): void {
  if (opts?.recreate) removeRainViewerRadar(map);
  removeLegacyIfPresent(map);
  installRainViewerMapErrorFilter(map);
  const beforeId = radarInsertBeforeId(map);
  const maxZoom = opts?.maxZoom ?? RAINVIEWER_RADAR_MAX_ZOOM;
  const attribution =
    opts?.attribution ??
    'Radar © <a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer">RainViewer</a>';

  if (!map.getSource(RADAR_SOURCE_A)) {
    addRasterPair(
      map,
      RADAR_SOURCE_A,
      RADAR_LAYER_A,
      initialTileUrlTemplate,
      visibleOpacity,
      beforeId,
      maxZoom,
      attribution
    );
    addRasterPair(map, RADAR_SOURCE_B, RADAR_LAYER_B, initialTileUrlTemplate, 0, beforeId, maxZoom, attribution);
    positionRainViewerRadarUnderRoads(map);
    return;
  }

  const a = map.getSource(RADAR_SOURCE_A) as RasterTileSource | undefined;
  const b = map.getSource(RADAR_SOURCE_B) as RasterTileSource | undefined;
  if (a && typeof a.setTiles === "function") a.setTiles([initialTileUrlTemplate]);
  if (b && typeof b.setTiles === "function") b.setTiles([initialTileUrlTemplate]);
  positionRainViewerRadarUnderRoads(map);
  map.setPaintProperty(RADAR_LAYER_A, "raster-opacity", visibleOpacity);
  map.setPaintProperty(RADAR_LAYER_B, "raster-opacity", 0);
}

const pendingTileSwap: Record<"a" | "b", boolean> = { a: false, b: false };

export function setRainViewerRadarTilesOnSource(
  map: Map,
  which: "a" | "b",
  tileUrlTemplate: string,
  /** Optional tile fade while the hidden buffer loads (defaults to prewarm constant). */
  tileFadeMs: number = RAINVIEWER_RADAR_PREWARM_TILE_FADE_MS
): void {
  const id = which === "a" ? RADAR_SOURCE_A : RADAR_SOURCE_B;
  const layerId = which === "a" ? RADAR_LAYER_A : RADAR_LAYER_B;
  const src = map.getSource(id) as RasterTileSource | undefined;
  if (src && typeof src.setTiles === "function") {
    pendingTileSwap[which] = true;
    if (map.getLayer(layerId)) {
      map.setPaintProperty(
        layerId,
        "raster-fade-duration",
        Math.max(0, Math.min(400, Math.round(tileFadeMs)))
      );
    }
    src.setTiles([tileUrlTemplate]);
  }
}

export function setRainViewerRadarDualOpacity(map: Map, opacityA: number, opacityB: number): void {
  if (map.getLayer(RADAR_LAYER_A)) map.setPaintProperty(RADAR_LAYER_A, "raster-opacity", opacityA);
  if (map.getLayer(RADAR_LAYER_B)) map.setPaintProperty(RADAR_LAYER_B, "raster-opacity", opacityB);
}

/**
 * After setTiles, wait until viewport tiles for this side are fetched and painted (or timeout).
 * `isSourceLoaded` alone can stay true from the *previous* frame — require a fresh `content` event.
 */
export function waitForRainViewerSideLoaded(
  map: Map,
  which: "a" | "b",
  timeoutMs: number
): Promise<void> {
  const sourceId = which === "a" ? RADAR_SOURCE_A : RADAR_SOURCE_B;
  const layerId = which === "a" ? RADAR_LAYER_A : RADAR_LAYER_B;
  return new Promise((resolve) => {
    let finished = false;
    let sawNewContent = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      map.off("idle", onIdle);
      map.off("sourcedata", onSourceData);
      clearTimeout(t);
      if (map.getLayer(layerId)) {
        try {
          map.setPaintProperty(layerId, "raster-fade-duration", 0);
        } catch {
          /* style race */
        }
      }
      pendingTileSwap[which] = false;
      resolve();
    };
    const tilesReady = (): boolean => {
      try {
        if (!map.getSource(sourceId) || !map.isSourceLoaded(sourceId)) return false;
        if (pendingTileSwap[which] && !sawNewContent) return false;
        const areTilesLoaded = (map as Map & { areTilesLoaded?: () => boolean }).areTilesLoaded;
        if (typeof areTilesLoaded === "function" && !areTilesLoaded.call(map)) return false;
        return true;
      } catch {
        return true;
      }
    };
    const tryResolve = () => {
      if (tilesReady()) cleanup();
    };
    const onIdle = () => tryResolve();
    const onSourceData = (e: MapSourceDataEvent) => {
      if (e.sourceId !== sourceId) return;
      if (e.sourceDataType === "content" || e.tile) {
        sawNewContent = true;
        pendingTileSwap[which] = false;
      }
      tryResolve();
    };
    const t = setTimeout(cleanup, timeoutMs);
    map.on("idle", onIdle);
    map.on("sourcedata", onSourceData);
    map.triggerRepaint();
  });
}

export function animateRainViewerDualCrossfade(
  map: Map,
  from: { a: number; b: number },
  to: { a: number; b: number },
  durationMs: number
): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    /*
     * Full A↔B swap: equal-power (sin/cos) keeps mid-blend brightness steadier than
     * linear opacity (which dips at t=0.5). Partial fades still use cosine-eased lerp.
     */
    const fullSwap =
      Math.abs(from.a - to.b) < 0.02 &&
      Math.abs(from.b - to.a) < 0.02 &&
      Math.abs(from.a - from.b) > 0.05;
    const peak = Math.max(from.a, from.b, to.a, to.b);

    const tick = (now: number) => {
      try {
        if (!map.getStyle?.()) {
          resolve();
          return;
        }
      } catch {
        resolve();
        return;
      }
      const t = Math.min(1, (now - start) / Math.max(1, durationMs));
      const e = radarCrossfadeProgress(t);
      let oa: number;
      let ob: number;
      if (fullSwap && peak > 0) {
        const halfPi = Math.PI / 2;
        const leavingIsA = from.a >= from.b;
        if (leavingIsA) {
          oa = peak * Math.cos(e * halfPi);
          ob = peak * Math.sin(e * halfPi);
        } else {
          oa = peak * Math.sin(e * halfPi);
          ob = peak * Math.cos(e * halfPi);
        }
      } else {
        oa = Math.max(0, Math.min(1, from.a + (to.a - from.a) * e));
        ob = Math.max(0, Math.min(1, from.b + (to.b - from.b) * e));
      }
      setRainViewerRadarDualOpacity(map, oa, ob);
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}

export type RainViewerRadarTopLayer = "a" | "b";

/**
 * Create raster source + layer once, or update tiles if source already exists.
 * Keeps layer under basemap roads; route lines and labels stay above.
 * @deprecated For animation, use ensureRainViewerRadarDual + setRainViewerRadarTilesOnSource + opacity crossfade.
 */
export function ensureRainViewerRadar(map: Map, tileUrlTemplate: string): void {
  if (map.getSource(LEGACY_RADAR_SOURCE)) {
    setRainViewerRadarTiles(map, tileUrlTemplate);
    return;
  }

  map.addSource(LEGACY_RADAR_SOURCE, {
    type: "raster",
    tiles: [tileUrlTemplate],
    tileSize: 256,
    maxzoom: RAINVIEWER_RADAR_MAX_ZOOM,
    attribution:
      'Radar © <a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer">RainViewer</a>',
  });
  const beforeId = radarInsertBeforeId(map);
  map.addLayer(
    {
      id: LEGACY_RADAR_LAYER,
      type: "raster",
      source: LEGACY_RADAR_SOURCE,
      paint: {
        "raster-opacity": RAINVIEWER_RADAR_VISIBLE_OPACITY,
        "raster-fade-duration": RAINVIEWER_RASTER_FADE_MS,
        ...RAINVIEWER_RADAR_RASTER_PAINT,
      },
    },
    beforeId
  );
  positionRainViewerRadarUnderRoads(map);
}

/** @deprecated Prefer ensureRainViewerRadar — avoids flicker when updating frames */
export function addRainViewerRadar(map: Map, tileUrlTemplate: string): void {
  removeRainViewerRadar(map);
  ensureRainViewerRadar(map, tileUrlTemplate);
}
