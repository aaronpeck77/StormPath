import { pointAtAlongMeters } from "../nav/routeGeometry";
import { arrivalTimeMsAtAlongMeters } from "../nav/routeForecastTimeline";
import type { LngLat } from "../nav/types";
import { isNightAt } from "./solarDayNight";

export type FractionBand = { start: number; end: number };

const ROUTE_SAMPLE_COUNT = 48;

/** Merge adjacent night samples into horizontal bands (fraction 0–1). */
export function mergeNightSamples(
  samples: { start: number; end: number; night: boolean }[]
): FractionBand[] {
  const bands: FractionBand[] = [];
  for (const sample of samples) {
    if (!sample.night) continue;
    const prev = bands[bands.length - 1];
    if (prev && Math.abs(prev.end - sample.start) < 0.001) {
      prev.end = sample.end;
    } else {
      bands.push({ start: sample.start, end: sample.end });
    }
  }
  return bands.filter((b) => b.end > b.start + 0.002);
}

/**
 * Night segments along the route axis (0 = start, 1 = destination).
 * Each sample uses local sun time at the point you reach that part of the drive.
 */
export function buildRouteChartNightBands(opts: {
  geometry: LngLat[];
  totalMeters: number;
  userAlongMeters: number;
  planEtaMinutes: number | null;
  driveEtaMinutes?: number | null;
  nowMs?: number;
  segments?: number;
}): FractionBand[] {
  const {
    geometry,
    totalMeters,
    userAlongMeters,
    planEtaMinutes,
    driveEtaMinutes = null,
    nowMs = Date.now(),
    segments = ROUTE_SAMPLE_COUNT,
  } = opts;
  if (geometry.length < 2 || totalMeters <= 0 || segments < 4) return [];

  const samples: { start: number; end: number; night: boolean }[] = [];
  for (let i = 0; i < segments; i++) {
    const start = i / segments;
    const end = (i + 1) / segments;
    const fraction = (start + end) / 2;
    const alongM = fraction * totalMeters;
    const arrivalMs = arrivalTimeMsAtAlongMeters(alongM, {
      totalMeters,
      userAlongMeters,
      planEtaMinutes,
      driveEtaMinutes,
      nowMs,
    });
    if (arrivalMs == null) return [];
    const [lng, lat] = pointAtAlongMeters(geometry, alongM);
    samples.push({ start, end, night: isNightAt(lat, lng, arrivalMs) });
  }
  return mergeNightSamples(samples);
}

/** Night bands over a fixed location timeline (0–1 across `durationMs`). */
export function buildLocalNightBands(opts: {
  lat: number;
  lng: number;
  startMs?: number;
  durationMs: number;
  segments?: number;
}): FractionBand[] {
  const {
    lat,
    lng,
    startMs = Date.now(),
    durationMs,
    segments = 48,
  } = opts;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || durationMs <= 0) return [];

  const samples: { start: number; end: number; night: boolean }[] = [];
  for (let i = 0; i < segments; i++) {
    const start = i / segments;
    const end = (i + 1) / segments;
    const timeMs = startMs + ((start + end) / 2) * durationMs;
    samples.push({ start, end, night: isNightAt(lat, lng, timeMs) });
  }
  return mergeNightSamples(samples);
}
