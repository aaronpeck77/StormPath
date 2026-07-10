/**
 * Estimate bulk radar echo motion via normalized 2-D cross-correlation between mosaics.
 * More reliable than tracking individual cell peaks on training squall lines.
 */

import { initialBearingDegrees } from "../nav/routeGeometry";
import type { LngLat } from "../nav/types";

export type EchoGridBounds = { west: number; south: number; east: number; north: number };

export type EchoGrid = {
  west: number;
  south: number;
  cellDeg: number;
  cols: number;
  rows: number;
  values: Float32Array;
};

export type CrossCorrMotionEstimate = {
  bearingDeg: number;
  speedMph: number;
  shiftM: number;
  correlation: number;
  peakRatio: number;
  /** 0–1 — high enough to draw a direction arrow */
  directionConfidence: number;
  /** 0–1 — high enough to print mph on the label */
  speedConfidence: number;
};

const GRID_CELL_DEG = 0.042;
const GRID_SCAN_STEP = 10;
const MIN_ECHO_FOR_GRID = 0.1;
const MIN_CORR = 0.34;
const MIN_PEAK_RATIO = 1.28;
const MIN_SPEED_CORR = 0.44;
const MIN_SPEED_PEAK_RATIO = 1.48;

function metersPerDegree(lat: number): { lng: number; lat: number } {
  const latRad = (lat * Math.PI) / 180;
  const mLat = 111_320;
  return { lng: mLat * Math.cos(latRad), lat: mLat };
}

export function buildEchoGrid(bounds: EchoGridBounds, sampleIntensity: (lng: number, lat: number) => number): EchoGrid {
  const cols = Math.max(4, Math.ceil((bounds.east - bounds.west) / GRID_CELL_DEG));
  const rows = Math.max(4, Math.ceil((bounds.north - bounds.south) / GRID_CELL_DEG));
  const values = new Float32Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const lng = bounds.west + (col + 0.5) * GRID_CELL_DEG;
      const lat = bounds.south + (row + 0.5) * GRID_CELL_DEG;
      let peak = 0;
      const half = GRID_CELL_DEG * 0.42;
      for (let sy = -1; sy <= 1; sy++) {
        for (let sx = -1; sx <= 1; sx++) {
          peak = Math.max(peak, sampleIntensity(lng + sx * half, lat + sy * half));
        }
      }
      values[row * cols + col] = peak;
    }
  }
  return { west: bounds.west, south: bounds.south, cellDeg: GRID_CELL_DEG, cols, rows, values };
}

function gridStats(grid: EchoGrid): { mass: number; cells: number } {
  let mass = 0;
  let cells = 0;
  for (const v of grid.values) {
    if (v >= MIN_ECHO_FOR_GRID) {
      mass += v;
      cells++;
    }
  }
  return { mass, cells };
}

function corrAtShift(
  older: EchoGrid,
  newer: EchoGrid,
  dCol: number,
  dRow: number
): { corr: number; n: number } {
  let sumAB = 0;
  let sumA2 = 0;
  let sumB2 = 0;
  let n = 0;
  const { cols, rows } = older;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const c2 = col + dCol;
      const r2 = row + dRow;
      if (c2 < 0 || c2 >= cols || r2 < 0 || r2 >= rows) continue;
      const a = older.values[row * cols + col]!;
      const b = newer.values[r2 * cols + c2]!;
      if (a < MIN_ECHO_FOR_GRID && b < MIN_ECHO_FOR_GRID) continue;
      sumAB += a * b;
      sumA2 += a * a;
      sumB2 += b * b;
      n++;
    }
  }
  if (n < 24) return { corr: 0, n };
  const denom = Math.sqrt(sumA2 * sumB2);
  if (denom < 1e-6) return { corr: 0, n };
  return { corr: sumAB / denom, n };
}

export function estimateMotionByCrossCorrelation(
  older: EchoGrid,
  newer: EchoGrid,
  dtSec: number,
  maxSpeedMph: number,
  minShiftM: number
): CrossCorrMotionEstimate | null {
  if (older.cols !== newer.cols || older.rows !== newer.rows) return null;
  const oldStats = gridStats(older);
  const newStats = gridStats(newer);
  if (oldStats.cells < 18 || newStats.cells < 18 || oldStats.mass < 2.2 || newStats.mass < 2.2) {
    return null;
  }

  const latMid = newer.south + ((newer.rows - 1) * newer.cellDeg) / 2;
  const mDeg = metersPerDegree(latMid);
  const maxShiftM = Math.min(95_000, dtSec * maxSpeedMph * 0.44704);
  const maxDCol = Math.ceil(maxShiftM / (newer.cellDeg * mDeg.lng));
  const maxDRow = Math.ceil(maxShiftM / (newer.cellDeg * mDeg.lat));

  type Hit = { dCol: number; dRow: number; corr: number };
  const hits: Hit[] = [];
  for (let dCol = -maxDCol; dCol <= maxDCol; dCol++) {
    for (let dRow = -maxDRow; dRow <= maxDRow; dRow++) {
      const { corr, n } = corrAtShift(older, newer, dCol, dRow);
      if (n < 24 || corr < MIN_CORR * 0.85) continue;
      hits.push({ dCol, dRow, corr });
    }
  }
  if (!hits.length) return null;

  hits.sort((a, b) => b.corr - a.corr);
  const best = hits[0]!;
  const second = hits[1]?.corr ?? 0;
  const peakRatio = second > 0.01 ? best.corr / second : best.corr / MIN_CORR;

  const eastM = best.dCol * newer.cellDeg * mDeg.lng;
  const northM = best.dRow * newer.cellDeg * mDeg.lat;
  const shiftM = Math.hypot(eastM, northM);
  if (shiftM < minShiftM || shiftM > maxShiftM) return null;

  const speedMph = (shiftM / dtSec) * 2.23694;
  if (speedMph < 8 || speedMph > maxSpeedMph) return null;

  const centerLng = newer.west + (newer.cols * newer.cellDeg) / 2;
  const centerLat = newer.south + (newer.rows * newer.cellDeg) / 2;
  const from: LngLat = [centerLng, centerLat];
  const dLng = eastM / mDeg.lng;
  const dLat = northM / mDeg.lat;
  const to: LngLat = [centerLng + dLng, centerLat + dLat];
  const bearingDeg = initialBearingDegrees(from, to);

  const corrNorm = Math.min(1, Math.max(0, (best.corr - MIN_CORR) / (0.72 - MIN_CORR)));
  const ratioNorm = Math.min(1, Math.max(0, (peakRatio - MIN_PEAK_RATIO) / 1.4));
  const shiftNorm = Math.min(1, shiftM / (minShiftM * 2.4));
  const directionConfidence = corrNorm * 0.5 + ratioNorm * 0.35 + shiftNorm * 0.15;

  const speedConfidence =
    best.corr >= MIN_SPEED_CORR && peakRatio >= MIN_SPEED_PEAK_RATIO && directionConfidence >= 0.58
      ? Math.min(1, directionConfidence * (best.corr / MIN_SPEED_CORR) * 0.85)
      : Math.min(0.45, directionConfidence * 0.5);

  if (best.corr < MIN_CORR || peakRatio < MIN_PEAK_RATIO || directionConfidence < 0.52) return null;

  return {
    bearingDeg,
    speedMph,
    shiftM,
    correlation: best.corr,
    peakRatio,
    directionConfidence,
    speedConfidence,
  };
}

export { GRID_SCAN_STEP, MIN_ECHO_FOR_GRID };
