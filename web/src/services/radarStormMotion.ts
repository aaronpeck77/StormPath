/**
 * Storm-motion arrows from RainViewer frame pairs (cross-correlation) with optional NWS fallback.
 * Arrows are omitted unless direction confidence is high; mph is omitted unless speed is reliable.
 */

import { haversineMeters, initialBearingDegrees } from "../nav/routeGeometry";
import type { LngLat } from "../nav/types";
import { formatEtaDuration } from "../ui/formatEta";
import {
  buildEchoGrid,
  estimateMotionByCrossCorrelation,
  GRID_SCAN_STEP,
  type CrossCorrMotionEstimate,
} from "./radarEchoCrossCorr";
import {
  echoIntensityFromRgba,
  fetchRadarTileRgba,
  RADAR_MOSAIC_SAMPLE_ZOOM,
  stormCoreIntensityFromRgba,
  tileXY,
} from "./radarPolylineIntensity";
import { tileUrlFromHostAndPath } from "./rainViewerRadar";
import { isRainViewerRateLimited } from "./rainViewerTileFetch";

export type MapBounds = { west: number; south: number; east: number; north: number };

export type RadarStormMotion = {
  lng: number;
  lat: number;
  bearingDeg: number;
  /** Omitted from the map label when null (direction-only arrow). */
  speedMph: number | null;
  intensity: number;
  minutesToArrive: number | null;
};

const MOTION_ZOOM = RADAR_MOSAIC_SAMPLE_ZOOM;
const CORE_SEED = 0.58;
const CORE_PEAK_MIN = 0.68;
const CLUSTER_DEG = 0.11;
const MAX_CELLS = 3;
const MIN_SPEED_MPH = 8;
const MIN_SHIFT_M = 3500;
export const RADAR_STORM_MAX_SPEED_MPH = 55;
const MAX_BBOX_SPAN_DEG = 5.5;
const COARSE_STEP = 14;
const MIN_DIRECTION_CONFIDENCE = 0.54;
const MIN_SPEED_CONFIDENCE = 0.62;

function clampBounds(b: MapBounds): MapBounds {
  const spanLng = b.east - b.west;
  const spanLat = b.north - b.south;
  if (spanLng <= MAX_BBOX_SPAN_DEG && spanLat <= MAX_BBOX_SPAN_DEG) return b;
  const cx = (b.west + b.east) / 2;
  const cy = (b.south + b.north) / 2;
  const h = Math.min(spanLng, MAX_BBOX_SPAN_DEG) / 2;
  const v = Math.min(spanLat, MAX_BBOX_SPAN_DEG) / 2;
  return { west: cx - h, east: cx + h, south: cy - v, north: cy + v };
}

export function intersectBounds(a: MapBounds, b: MapBounds): MapBounds | null {
  const west = Math.max(a.west, b.west);
  const south = Math.max(a.south, b.south);
  const east = Math.min(a.east, b.east);
  const north = Math.min(a.north, b.north);
  if (west >= east || south >= north) return null;
  return { west, south, east, north };
}

export function boundsFromGeometry(geometry: LngLat[], padDeg = 0.42): MapBounds | null {
  if (geometry.length < 1) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of geometry) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return clampBounds({
    west: west - padDeg,
    east: east + padDeg,
    south: south - padDeg,
    north: north + padDeg,
  });
}

function lngLatFromTilePixel(z: number, x: number, y: number, px: number, py: number): LngLat {
  const n = 2 ** z;
  const lng = ((x + px / 256) / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / 256)) / n)));
  const lat = (latRad * 180) / Math.PI;
  return [lng, lat];
}

export type PeakCell = { peakLng: number; peakLat: number; peak: number };

function clusterKey(lng: number, lat: number): string {
  const k = 1 / CLUSTER_DEG;
  return `${Math.floor(lng * k)}:${Math.floor(lat * k)}`;
}

function tileRange(bounds: MapBounds, z: number): { xMin: number; xMax: number; yMin: number; yMax: number } {
  const n = 2 ** z;
  return {
    xMin: Math.floor(((bounds.west + 180) / 360) * n),
    xMax: Math.floor(((bounds.east + 180) / 360) * n),
    yMin: Math.floor(
      ((1 -
        Math.log(Math.tan((bounds.north * Math.PI) / 180) + 1 / Math.cos((bounds.north * Math.PI) / 180)) /
          Math.PI) /
        2) *
        n
    ),
    yMax: Math.floor(
      ((1 -
        Math.log(Math.tan((bounds.south * Math.PI) / 180) + 1 / Math.cos((bounds.south * Math.PI) / 180)) /
          Math.PI) /
        2) *
        n
    ),
  };
}

const tileRgbaCache = new Map<string, Promise<Uint8ClampedArray | null>>();

function loadTileRgba(url: string): Promise<Uint8ClampedArray | null> {
  let p = tileRgbaCache.get(url);
  if (!p) {
    p = fetchRadarTileRgba(url);
    tileRgbaCache.set(url, p);
    void p.finally(() => {
      window.setTimeout(() => tileRgbaCache.delete(url), 120_000);
    });
  }
  return p;
}

function intensitySampleFromTiles(
  tileMap: Map<string, Uint8ClampedArray>,
  z: number,
  lng: number,
  lat: number,
  useCore: boolean
): number {
  const { x, y, px, py } = tileXY(lng, lat, z);
  const rgba = tileMap.get(`${x}/${y}`);
  if (!rgba) return 0;
  const idx = (py * 256 + px) * 4;
  const r = rgba[idx] ?? 0;
  const g = rgba[idx + 1] ?? 0;
  const b = rgba[idx + 2] ?? 0;
  const a = rgba[idx + 3] ?? 0;
  return useCore ? stormCoreIntensityFromRgba(r, g, b, a) : echoIntensityFromRgba(r, g, b, a);
}

async function loadTilesInBounds(
  urlTemplate: string,
  z: number,
  bounds: MapBounds
): Promise<Map<string, Uint8ClampedArray>> {
  const { xMin, xMax, yMin, yMax } = tileRange(bounds, z);
  const tileMap = new Map<string, Uint8ClampedArray>();
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      const url = urlTemplate.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
      const rgba = await loadTileRgba(url);
      if (rgba) tileMap.set(`${x}/${y}`, rgba);
    }
  }
  return tileMap;
}

async function buildFrameEchoGrid(
  z: number,
  bounds: MapBounds,
  tileMap: Map<string, Uint8ClampedArray>
) {
  return buildEchoGrid(bounds, (lng, lat) => intensitySampleFromTiles(tileMap, z, lng, lat, false));
}

async function findStrongCoreAnchors(
  z: number,
  bounds: MapBounds,
  tileMap: Map<string, Uint8ClampedArray>
): Promise<PeakCell[]> {
  const clusters = new Map<string, PeakCell>();
  const { xMin, xMax, yMin, yMax } = tileRange(bounds, z);
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      const rgba = tileMap.get(`${x}/${y}`);
      if (!rgba) continue;
      for (let py = 0; py < 256; py += COARSE_STEP) {
        for (let px = 0; px < 256; px += COARSE_STEP) {
          const idx = (py * 256 + px) * 4;
          const inten = stormCoreIntensityFromRgba(
            rgba[idx] ?? 0,
            rgba[idx + 1] ?? 0,
            rgba[idx + 2] ?? 0,
            rgba[idx + 3] ?? 0
          );
          if (inten < CORE_PEAK_MIN) continue;
          const [lng, lat] = lngLatFromTilePixel(z, x, y, px, py);
          if (lng < bounds.west || lng > bounds.east || lat < bounds.south || lat > bounds.north) continue;
          const key = clusterKey(lng, lat);
          const prev = clusters.get(key);
          if (!prev || inten > prev.peak) {
            clusters.set(key, { peakLng: lng, peakLat: lat, peak: inten });
          }
        }
      }
    }
  }
  return [...clusters.values()].sort((a, b) => b.peak - a.peak);
}

/** NWS StormMotion from an active alert overlapping the sample box (authoritative when present). */
export function nwsStormMotionInBounds(
  alerts: GeoJSON.FeatureCollection | null | undefined,
  bounds: MapBounds
): { bearingDeg: number; speedMph: number } | null {
  if (!alerts?.features?.length) return null;
  const cx = (bounds.west + bounds.east) / 2;
  const cy = (bounds.south + bounds.north) / 2;

  for (const f of alerts.features) {
    const props = f.properties as Record<string, unknown> | null;
    if (!props) continue;
    const motionDeg = props.motionDeg;
    const motionMph = props.motionMph;
    if (typeof motionDeg !== "number" || typeof motionMph !== "number") continue;
    if (motionMph < MIN_SPEED_MPH) continue;

    const g = f.geometry;
    if (!g) continue;
    if (g.type === "Polygon") {
      const ring = g.coordinates[0];
      if (!ring?.length) continue;
      let west = Infinity;
      let east = -Infinity;
      let south = Infinity;
      let north = -Infinity;
      for (const c of ring) {
        west = Math.min(west, c[0]!);
        east = Math.max(east, c[0]!);
        south = Math.min(south, c[1]!);
        north = Math.max(north, c[1]!);
      }
      if (cx < west || cx > east || cy < south || cy > north) continue;
    }
    return { bearingDeg: motionDeg, speedMph: motionMph };
  }
  return null;
}

function approachMinutes(
  cell: LngLat,
  bearingDeg: number,
  speedMph: number,
  reference: LngLat
): number | null {
  if (speedMph < MIN_SPEED_MPH) return null;
  const toRefBearing = initialBearingDegrees(cell, reference);
  const diff = Math.abs(((bearingDeg - toRefBearing + 540) % 360) - 180);
  if (diff > 55) return null;
  const distM = haversineMeters(cell, reference);
  const speedMps = speedMph * 0.44704;
  if (speedMps < 2) return null;
  return Math.max(1, Math.round(distM / speedMps / 60));
}

function cardinalLabel(bearingDeg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(bearingDeg / 45) % 8]!;
}

export function formatRadarMotionLabel(m: RadarStormMotion): string {
  const dir = cardinalLabel(m.bearingDeg);
  if (m.speedMph != null && m.speedMph >= MIN_SPEED_MPH) {
    const spd = `${Math.round(m.speedMph)} mph ${dir}`;
    if (m.minutesToArrive != null && m.minutesToArrive < 180) {
      return `${spd} · ~${formatEtaDuration(m.minutesToArrive)}`;
    }
    return spd;
  }
  return `→ ${dir}`;
}

type MotionVector = {
  bearingDeg: number;
  speedMph: number;
  speedConfidence: number;
  directionConfidence: number;
  source: "nws" | "crosscorr";
};

function motionFromCrossCorr(estimate: CrossCorrMotionEstimate): MotionVector {
  return {
    bearingDeg: estimate.bearingDeg,
    speedMph: estimate.speedMph,
    speedConfidence: estimate.speedConfidence,
    directionConfidence: estimate.directionConfidence,
    source: "crosscorr",
  };
}

export async function computeRadarStormMotions(
  boundsIn: MapBounds,
  host: string,
  frameOlder: { path: string; time: number },
  frameNewer: { path: string; time: number },
  opts?: {
    referenceLngLat?: LngLat | null;
    weatherAlerts?: GeoJSON.FeatureCollection | null;
    signal?: AbortSignal;
  }
): Promise<RadarStormMotion[]> {
  if (isRainViewerRateLimited()) return [];
  const bounds = clampBounds(boundsIn);
  const dtSec = Math.max(300, frameNewer.time - frameOlder.time);
  if (dtSec <= 0) return [];

  const urlOlder = tileUrlFromHostAndPath(host, frameOlder.path);
  const urlNewer = tileUrlFromHostAndPath(host, frameNewer.path);
  const z = MOTION_ZOOM;

  if (opts?.signal?.aborted) return [];

  const nws = nwsStormMotionInBounds(opts?.weatherAlerts, bounds);

  const [olderTiles, newerTiles] = await Promise.all([
    loadTilesInBounds(urlOlder, z, bounds),
    loadTilesInBounds(urlNewer, z, bounds),
  ]);
  if (opts?.signal?.aborted) return [];

  let motion: MotionVector | null = null;

  if (nws) {
    motion = {
      bearingDeg: nws.bearingDeg,
      speedMph: nws.speedMph,
      speedConfidence: 1,
      directionConfidence: 1,
      source: "nws",
    };
  } else {
    const [olderGrid, newerGrid] = await Promise.all([
      buildFrameEchoGrid(z, bounds, olderTiles),
      buildFrameEchoGrid(z, bounds, newerTiles),
    ]);
    const estimate = estimateMotionByCrossCorrelation(
      olderGrid,
      newerGrid,
      dtSec,
      RADAR_STORM_MAX_SPEED_MPH,
      MIN_SHIFT_M
    );
    if (estimate && estimate.directionConfidence >= MIN_DIRECTION_CONFIDENCE) {
      motion = motionFromCrossCorr(estimate);
    }
  }

  if (!motion || motion.directionConfidence < MIN_DIRECTION_CONFIDENCE) return [];

  const anchors = await findStrongCoreAnchors(z, bounds, newerTiles);
  const ranked = anchors.slice(0, MAX_CELLS * 2);
  if (!ranked.length) return [];

  const showSpeed = motion.speedConfidence >= MIN_SPEED_CONFIDENCE;
  const speedMph = showSpeed ? motion.speedMph : null;
  const out: RadarStormMotion[] = [];

  for (const peak of ranked) {
    if (out.length >= MAX_CELLS) break;
    const to: LngLat = [peak.peakLng, peak.peakLat];
    const tooClose = out.some((m) => haversineMeters([m.lng, m.lat], to) < 22_000);
    if (tooClose) continue;

    out.push({
      lng: peak.peakLng,
      lat: peak.peakLat,
      bearingDeg: motion.bearingDeg,
      speedMph,
      intensity: peak.peak,
      minutesToArrive:
        speedMph != null && opts?.referenceLngLat
          ? approachMinutes(to, motion.bearingDeg, speedMph, opts.referenceLngLat)
          : null,
    });
  }

  return out;
}

// --- legacy exports kept for unit tests ---
export const maxPlausibleShiftMeters = (dtSec: number) =>
  Math.min(95_000, dtSec * RADAR_STORM_MAX_SPEED_MPH * 0.44704);

export function bearingSeparationDeg(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

export function computeRegionalStormMotion(
  olderPeaks: PeakCell[],
  newerPeaks: PeakCell[],
  dtSec: number
): { bearingDeg: number; speedMph: number; shiftM: number } | null {
  let wOld = 0;
  let wNew = 0;
  let lngOld = 0;
  let latOld = 0;
  let lngNew = 0;
  let latNew = 0;
  for (const p of olderPeaks) {
    if (p.peak < CORE_SEED) continue;
    const w = (p.peak - CORE_SEED) ** 2;
    wOld += w;
    lngOld += p.peakLng * w;
    latOld += p.peakLat * w;
  }
  for (const p of newerPeaks) {
    if (p.peak < CORE_SEED) continue;
    const w = (p.peak - CORE_SEED) ** 2;
    wNew += w;
    lngNew += p.peakLng * w;
    latNew += p.peakLat * w;
  }
  if (wOld < 1e-8 || wNew < 1e-8) return null;
  const from: LngLat = [lngOld / wOld, latOld / wOld];
  const to: LngLat = [lngNew / wNew, latNew / wNew];
  const shiftM = haversineMeters(from, to);
  if (shiftM < MIN_SHIFT_M) return null;
  const speedMph = (shiftM / dtSec) * 2.23694;
  if (speedMph < MIN_SPEED_MPH || speedMph > RADAR_STORM_MAX_SPEED_MPH) return null;
  return { bearingDeg: initialBearingDegrees(from, to), speedMph, shiftM };
}

export function matchStormPeakPairs(
  newerPeaks: PeakCell[],
  olderPeaks: PeakCell[],
  dtSec: number,
  regionalBearingDeg: number | null = null
) {
  type Match = {
    newer: PeakCell;
    older: PeakCell;
    bearingDeg: number;
    speedMph: number;
    shiftM: number;
    score: number;
  };
  const cands: Match[] = [];
  for (const newer of newerPeaks) {
    if (newer.peak < CORE_PEAK_MIN) continue;
    for (const older of olderPeaks) {
      if (older.peak < CORE_SEED * 0.9) continue;
      const from: LngLat = [older.peakLng, older.peakLat];
      const to: LngLat = [newer.peakLng, newer.peakLat];
      const shiftM = haversineMeters(from, to);
      const maxShift = maxPlausibleShiftMeters(dtSec);
      if (shiftM < MIN_SHIFT_M || shiftM > maxShift) continue;
      const speedMph = (shiftM / dtSec) * 2.23694;
      if (speedMph < MIN_SPEED_MPH || speedMph > RADAR_STORM_MAX_SPEED_MPH) continue;
      const bearingDeg = initialBearingDegrees(from, to);
      if (regionalBearingDeg != null && bearingSeparationDeg(bearingDeg, regionalBearingDeg) > 55) {
        continue;
      }
      const distNorm = 1 - shiftM / maxShift;
      const intenNorm = 1 - Math.abs(newer.peak - older.peak) / 0.24;
      cands.push({ newer, older, bearingDeg, speedMph, shiftM, score: distNorm * 0.78 + intenNorm * 0.22 });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const usedN = new Set<string>();
  const usedO = new Set<string>();
  const out: { newer: PeakCell; older: PeakCell; bearingDeg: number; speedMph: number; shiftM: number }[] = [];
  for (const c of cands) {
    const nk = clusterKey(c.newer.peakLng, c.newer.peakLat);
    const ok = clusterKey(c.older.peakLng, c.older.peakLat);
    if (usedN.has(nk) || usedO.has(ok)) continue;
    usedN.add(nk);
    usedO.add(ok);
    out.push(c);
  }
  return out;
}

export { GRID_SCAN_STEP };
