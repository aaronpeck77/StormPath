/**
 * Estimate storm-cell motion from two consecutive RainViewer radar mosaics.
 * Arrows anchor on **red / white cell cores** (not green fringe or cluster centroids).
 */

import { haversineMeters, initialBearingDegrees } from "../nav/routeGeometry";
import type { LngLat } from "../nav/types";
import {
  fetchRadarTileRgba,
  RADAR_MOSAIC_SAMPLE_ZOOM,
  stormCoreIntensityFromRgba,
  tileXY,
} from "./radarPolylineIntensity";
import { tileUrlFromHostAndPath } from "./rainViewerRadar";

export type MapBounds = { west: number; south: number; east: number; north: number };

export type RadarStormMotion = {
  lng: number;
  lat: number;
  bearingDeg: number;
  speedMph: number;
  intensity: number;
  minutesToArrive: number | null;
};

const MOTION_ZOOM = RADAR_MOSAIC_SAMPLE_ZOOM;
/** Minimum core score to participate in clustering (excludes most green/yellow fringe). */
const CORE_SEED = 0.58;
/** Only emit arrows for true cell cores (red+ or white). */
const CORE_PEAK_MIN = 0.68;
const CLUSTER_DEG = 0.11;
const MAX_CELLS = 3;
const MIN_SPEED_MPH = 8;
const MIN_SHIFT_M = 1800;
const MAX_SHIFT_M = 95_000;
const MAX_BBOX_SPAN_DEG = 5.5;
const COARSE_STEP = 14;
const FINE_STEP = 6;
const LOCAL_MAX_RADIUS_DEG = 0.09;

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

function coreAt(rgba: Uint8ClampedArray, px: number, py: number): number {
  const idx = (py * 256 + px) * 4;
  return stormCoreIntensityFromRgba(rgba[idx] ?? 0, rgba[idx + 1] ?? 0, rgba[idx + 2] ?? 0, rgba[idx + 3] ?? 0);
}

type PeakCell = {
  peakLng: number;
  peakLat: number;
  peak: number;
};

type Cluster = PeakCell;

function clusterKey(lng: number, lat: number): string {
  const k = 1 / CLUSTER_DEG;
  return `${Math.floor(lng * k)}:${Math.floor(lat * k)}`;
}

/** Keep the single strongest core pixel per cluster bucket — never average toward green fringe. */
function upsertCluster(map: Map<string, Cluster>, lng: number, lat: number, intensity: number): void {
  const key = clusterKey(lng, lat);
  const prev = map.get(key);
  if (!prev || intensity > prev.peak) {
    map.set(key, { peakLng: lng, peakLat: lat, peak: intensity });
  }
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

function scanTileCoarse(
  rgba: Uint8ClampedArray,
  z: number,
  x: number,
  y: number,
  bounds: MapBounds,
  step: number,
  minCore: number,
  clusters: Map<string, Cluster>
): void {
  for (let py = 0; py < 256; py += step) {
    for (let px = 0; px < 256; px += step) {
      const inten = coreAt(rgba, px, py);
      if (inten < minCore) continue;
      const [lng, lat] = lngLatFromTilePixel(z, x, y, px, py);
      if (lng < bounds.west || lng > bounds.east || lat < bounds.south || lat > bounds.north) continue;
      upsertCluster(clusters, lng, lat, inten);
    }
  }
}

async function scanFramePeaks(
  urlTemplate: string,
  z: number,
  bounds: MapBounds,
  minCore: number
): Promise<Map<string, Cluster>> {
  const { xMin, xMax, yMin, yMax } = tileRange(bounds, z);
  const clusters = new Map<string, Cluster>();
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      const url = urlTemplate.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
      const rgba = await loadTileRgba(url);
      if (!rgba) continue;
      scanTileCoarse(rgba, z, x, y, bounds, COARSE_STEP, minCore, clusters);
    }
  }
  return clusters;
}

/** Refine peak to the brightest core pixel near the coarse maximum. */
async function refinePeak(
  urlTemplate: string,
  z: number,
  seed: PeakCell
): Promise<PeakCell> {
  const { x, y } = tileXY(seed.peakLng, seed.peakLat, z);
  let best = { ...seed };
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const url = urlTemplate.replace("{z}", String(z)).replace("{x}", String(x + dx)).replace("{y}", String(y + dy));
      const rgba = await loadTileRgba(url);
      if (!rgba) continue;
      for (let py = 0; py < 256; py += FINE_STEP) {
        for (let px = 0; px < 256; px += FINE_STEP) {
          const [lng, lat] = lngLatFromTilePixel(z, x + dx, y + dy, px, py);
          if (
            Math.abs(lng - seed.peakLng) > LOCAL_MAX_RADIUS_DEG ||
            Math.abs(lat - seed.peakLat) > LOCAL_MAX_RADIUS_DEG
          ) {
            continue;
          }
          const inten = coreAt(rgba, px, py);
          if (inten > best.peak) {
            best = { peakLng: lng, peakLat: lat, peak: inten };
          }
        }
      }
    }
  }
  return best;
}

/** Prior frame: brightest core in search disk (not mass-weighted centroid). */
async function findPriorPeak(
  urlTemplate: string,
  z: number,
  nearLng: number,
  nearLat: number,
  radiusDeg: number
): Promise<PeakCell | null> {
  const { x, y } = tileXY(nearLng, nearLat, z);
  let best: PeakCell | null = null;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const url = urlTemplate.replace("{z}", String(z)).replace("{x}", String(x + dx)).replace("{y}", String(y + dy));
      const rgba = await loadTileRgba(url);
      if (!rgba) continue;
      for (let py = 0; py < 256; py += FINE_STEP) {
        for (let px = 0; px < 256; px += FINE_STEP) {
          const [lng, lat] = lngLatFromTilePixel(z, x + dx, y + dy, px, py);
          if (Math.abs(lng - nearLng) > radiusDeg || Math.abs(lat - nearLat) > radiusDeg) continue;
          const inten = coreAt(rgba, px, py);
          if (inten < CORE_SEED * 0.85) continue;
          if (!best || inten > best.peak) {
            best = { peakLng: lng, peakLat: lat, peak: inten };
          }
        }
      }
    }
  }
  return best;
}

/** Drop peaks sitting on fringe: must beat neighbors in a small ring. */
async function isLocalCoreMaximum(urlTemplate: string, z: number, peak: PeakCell): Promise<boolean> {
  const ring = [0.04, 0.055, 0.07];
  const center = peak.peak;
  for (const d of ring) {
    for (let a = 0; a < 8; a++) {
      const bearing = a * 45;
      const R = 6371000;
      const dist = d * (Math.PI / 180) * R;
      const b = (bearing * Math.PI) / 180;
      const lat1 = (peak.peakLat * Math.PI) / 180;
      const lng1 = (peak.peakLng * Math.PI) / 180;
      const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dist / R) + Math.cos(lat1) * Math.sin(dist / R) * Math.cos(b));
      const lng2 =
        lng1 +
        Math.atan2(Math.sin(b) * Math.sin(dist / R) * Math.cos(lat1), Math.cos(dist / R) - Math.sin(lat1) * Math.sin(lat2));
      const lng = (lng2 * 180) / Math.PI;
      const lat = (lat2 * 180) / Math.PI;
      const { x, y, px, py } = tileXY(lng, lat, z);
      const url = urlTemplate.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
      const rgba = await loadTileRgba(url);
      if (!rgba) continue;
      if (coreAt(rgba, px, py) >= center - 0.04) return false;
    }
  }
  return true;
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
  const spd = `${Math.round(m.speedMph)} mph ${dir}`;
  if (m.minutesToArrive != null && m.minutesToArrive < 180) {
    return `${spd} · ~${m.minutesToArrive} min`;
  }
  return spd;
}

export async function computeRadarStormMotions(
  boundsIn: MapBounds,
  host: string,
  frameOlder: { path: string; time: number },
  frameNewer: { path: string; time: number },
  opts?: { referenceLngLat?: LngLat | null; signal?: AbortSignal }
): Promise<RadarStormMotion[]> {
  tileRgbaCache.clear();
  const bounds = clampBounds(boundsIn);
  const dtSec = Math.max(120, frameNewer.time - frameOlder.time);
  if (dtSec <= 0) return [];

  const urlOlder = tileUrlFromHostAndPath(host, frameOlder.path);
  const urlNewer = tileUrlFromHostAndPath(host, frameNewer.path);
  const z = MOTION_ZOOM;

  if (opts?.signal?.aborted) return [];

  const coarse = await scanFramePeaks(urlNewer, z, bounds, CORE_SEED);
  const ranked = [...coarse.values()].sort((a, b) => b.peak - a.peak).slice(0, 12);
  const out: RadarStormMotion[] = [];

  for (const seed of ranked) {
    if (opts?.signal?.aborted) return out;
    if (out.length >= MAX_CELLS) break;

    let peak = await refinePeak(urlNewer, z, seed);
    if (peak.peak < CORE_PEAK_MIN) continue;
    if (!(await isLocalCoreMaximum(urlNewer, z, peak))) continue;

    const prior = await findPriorPeak(urlOlder, z, peak.peakLng, peak.peakLat, 0.36);
    if (!prior || prior.peak < CORE_SEED * 0.9) continue;

    const from: LngLat = [prior.peakLng, prior.peakLat];
    const to: LngLat = [peak.peakLng, peak.peakLat];
    const shiftM = haversineMeters(from, to);
    if (shiftM < MIN_SHIFT_M || shiftM > MAX_SHIFT_M) continue;

    const speedMph = (shiftM / dtSec) * 2.23694;
    if (speedMph < MIN_SPEED_MPH || speedMph > 95) continue;

    const bearingDeg = initialBearingDegrees(from, to);
    const minutesToArrive = opts?.referenceLngLat
      ? approachMinutes(to, bearingDeg, speedMph, opts.referenceLngLat)
      : null;

    const tooClose = out.some(
      (m) => haversineMeters([m.lng, m.lat], to) < 28_000
    );
    if (tooClose) continue;

    out.push({
      lng: peak.peakLng,
      lat: peak.peakLat,
      bearingDeg,
      speedMph,
      intensity: peak.peak,
      minutesToArrive,
    });
  }

  return out;
}
