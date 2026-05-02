import type { Map, MapSourceDataEvent, RasterTileSource } from "mapbox-gl";
import { RAINVIEWER_RADAR_MAX_ZOOM } from "../services/rainViewerRadar";

/** Legacy single-buffer ids (removed when using dual buffer). */
const LEGACY_RADAR_SOURCE = "rainviewer-radar";
const LEGACY_RADAR_LAYER = "rainviewer-radar-layer";

const RADAR_SOURCE_A = "rainviewer-radar-a";
const RADAR_SOURCE_B = "rainviewer-radar-b";
const RADAR_LAYER_A = "rainviewer-radar-layer-a";
const RADAR_LAYER_B = "rainviewer-radar-layer-b";

/**
 * Opacity for the visible radar layer. Hidden layer stays at 0 during A/B crossfade.
 * @see RainViewer color `2` + options `1_1` (smoothed + snow) in rainViewerRadar.tileUrlFromHostAndPath
 */
export const RAINVIEWER_RADAR_VISIBLE_OPACITY = 0.62;

/**
 * Crossfade duration between dual raster layers (ms). Uses layer opacity, not Mapbox tile fade,
 * so per-tile fade is set to 0 on both layers.
 */
export const RAINVIEWER_RADAR_CROSSFADE_MS = 380;

/** Legacy: crossfade when only one source and tile URLs change (unused by animated dual path). */
export const RAINVIEWER_RASTER_FADE_MS = 520;

function firstRouteLineBeforeId(map: Map): string | undefined {
  for (const l of map.getStyle().layers ?? []) {
    if (l.id.startsWith("route-") && l.id.endsWith("-line")) return l.id;
  }
  return undefined;
}

function firstSymbolBeforeId(map: Map): string | undefined {
  for (const l of map.getStyle().layers ?? []) {
    if (l.type === "symbol") return l.id;
  }
  return undefined;
}

function insertBeforeId(map: Map): string | undefined {
  return firstRouteLineBeforeId(map) ?? firstSymbolBeforeId(map);
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

function addRasterPair(
  map: Map,
  sourceId: string,
  layerId: string,
  tileUrlTemplate: string,
  opacity: number,
  beforeId: string | undefined
): void {
  map.addSource(sourceId, {
    type: "raster",
    tiles: [tileUrlTemplate],
    tileSize: 256,
    maxzoom: RAINVIEWER_RADAR_MAX_ZOOM,
    attribution:
      'Radar © <a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer">RainViewer</a>',
  });
  map.addLayer(
    {
      id: layerId,
      type: "raster",
      source: sourceId,
      paint: {
        "raster-opacity": opacity,
        "raster-fade-duration": 0,
      },
    },
    beforeId
  );
}

/**
 * Two stacked raster sources. Layer B is above A. Initialize both to the same frame so the stack is valid.
 */
export function ensureRainViewerRadarDual(map: Map, initialTileUrlTemplate: string): void {
  removeLegacyIfPresent(map);
  const beforeId = insertBeforeId(map);

  if (!map.getSource(RADAR_SOURCE_A)) {
    addRasterPair(map, RADAR_SOURCE_A, RADAR_LAYER_A, initialTileUrlTemplate, RAINVIEWER_RADAR_VISIBLE_OPACITY, beforeId);
    addRasterPair(map, RADAR_SOURCE_B, RADAR_LAYER_B, initialTileUrlTemplate, 0, beforeId);
    return;
  }

  const a = map.getSource(RADAR_SOURCE_A) as RasterTileSource | undefined;
  const b = map.getSource(RADAR_SOURCE_B) as RasterTileSource | undefined;
  if (a && typeof a.setTiles === "function") a.setTiles([initialTileUrlTemplate]);
  if (b && typeof b.setTiles === "function") b.setTiles([initialTileUrlTemplate]);
  map.setPaintProperty(RADAR_LAYER_A, "raster-opacity", RAINVIEWER_RADAR_VISIBLE_OPACITY);
  map.setPaintProperty(RADAR_LAYER_B, "raster-opacity", 0);
}

export function setRainViewerRadarTilesOnSource(
  map: Map,
  which: "a" | "b",
  tileUrlTemplate: string
): void {
  const id = which === "a" ? RADAR_SOURCE_A : RADAR_SOURCE_B;
  const src = map.getSource(id) as RasterTileSource | undefined;
  if (src && typeof src.setTiles === "function") src.setTiles([tileUrlTemplate]);
}

export function setRainViewerRadarDualOpacity(map: Map, opacityA: number, opacityB: number): void {
  if (map.getLayer(RADAR_LAYER_A)) map.setPaintProperty(RADAR_LAYER_A, "raster-opacity", opacityA);
  if (map.getLayer(RADAR_LAYER_B)) map.setPaintProperty(RADAR_LAYER_B, "raster-opacity", opacityB);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** After setTiles, wait until Mapbox finishes fetching (or timeout). Uses `sourcedata` for earlier resolve than `idle` alone. */
export function waitForRainViewerSideLoaded(
  map: Map,
  which: "a" | "b",
  timeoutMs: number
): Promise<void> {
  const sourceId = which === "a" ? RADAR_SOURCE_A : RADAR_SOURCE_B;
  return new Promise((resolve) => {
    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      map.off("idle", onIdle);
      map.off("sourcedata", onSourceData);
      clearTimeout(t);
      resolve();
    };
    const tryResolve = () => {
      try {
        if (map.getSource(sourceId) && map.isSourceLoaded(sourceId)) cleanup();
      } catch {
        cleanup();
      }
    };
    const onIdle = () => tryResolve();
    const onSourceData = (e: MapSourceDataEvent) => {
      if (e.sourceId === sourceId) tryResolve();
    };
    const t = setTimeout(cleanup, timeoutMs);
    map.on("idle", onIdle);
    map.on("sourcedata", onSourceData);
    map.triggerRepaint();
    queueMicrotask(tryResolve);
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
      const t = Math.min(1, (now - start) / durationMs);
      const e = easeInOutCubic(t);
      const oa = from.a + (to.a - from.a) * e;
      const ob = from.b + (to.b - from.b) * e;
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
 * Keeps layer under route lines, above basemap.
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
  const beforeId = insertBeforeId(map);
  map.addLayer(
    {
      id: LEGACY_RADAR_LAYER,
      type: "raster",
      source: LEGACY_RADAR_SOURCE,
      paint: {
        "raster-opacity": RAINVIEWER_RADAR_VISIBLE_OPACITY,
        "raster-fade-duration": RAINVIEWER_RASTER_FADE_MS,
      },
    },
    beforeId
  );
}

/** @deprecated Prefer ensureRainViewerRadar — avoids flicker when updating frames */
export function addRainViewerRadar(map: Map, tileUrlTemplate: string): void {
  removeRainViewerRadar(map);
  ensureRainViewerRadar(map, tileUrlTemplate);
}
