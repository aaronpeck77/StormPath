import { pointAtAlongMeters } from "../nav/routeGeometry";
import { arrivalTimeMsAtAlongMeters } from "../nav/routeForecastTimeline";
import type { LngLat } from "../nav/types";
import { isAstronomicalNightAt, isNightAt } from "./solarDayNight";
import { buildRouteSunEvents, routeSunEventsToTransitions, segmentCountForRoute } from "./routeSunEvents";

export type FractionBand = { start: number; end: number };

export type NightTransition = { fraction: number; kind: "sunset" | "sunrise" };

type NightSample = { start: number; end: number; night: boolean };

/** Merge adjacent night samples into horizontal bands (fraction 0–1). */
export function mergeNightSamples(samples: NightSample[]): FractionBand[] {
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

/** Vertical markers where sunset or sunrise occurs along the route axis. */
export function findNightTransitions(samples: NightSample[]): NightTransition[] {
  const transitions: NightTransition[] = [];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]!;
    const curr = samples[i]!;
    if (!prev.night && curr.night) {
      transitions.push({ fraction: prev.end, kind: "sunset" });
    } else if (prev.night && !curr.night) {
      transitions.push({ fraction: prev.end, kind: "sunrise" });
    }
  }
  return transitions;
}

function buildRouteNightSamples(opts: {
  geometry: LngLat[];
  totalMeters: number;
  userAlongMeters: number;
  planEtaMinutes: number | null;
  driveEtaMinutes?: number | null;
  nowMs?: number;
  segments?: number;
}): NightSample[] {
  const {
    geometry,
    totalMeters,
    userAlongMeters,
    planEtaMinutes,
    driveEtaMinutes = null,
    nowMs = Date.now(),
    segments = segmentCountForRoute(totalMeters),
  } = opts;
  if (geometry.length < 2 || totalMeters <= 0 || segments < 4) return [];

  const resolvedPlanEta =
    planEtaMinutes ??
    (driveEtaMinutes != null &&
    Number.isFinite(driveEtaMinutes) &&
    totalMeters > userAlongMeters
      ? driveEtaMinutes * (totalMeters / Math.max(1, totalMeters - userAlongMeters))
      : estimateFullRouteEtaMinutes(totalMeters));

  const samples: NightSample[] = [];
  for (let i = 0; i < segments; i++) {
    const start = i / segments;
    const end = (i + 1) / segments;
    const fraction = (start + end) / 2;
    const alongM = fraction * totalMeters;
    const arrivalMs = arrivalTimeMsAtAlongMeters(alongM, {
      totalMeters,
      userAlongMeters,
      planEtaMinutes: resolvedPlanEta,
      driveEtaMinutes,
      nowMs,
    });
    if (arrivalMs == null) continue;
    const [lng, lat] = pointAtAlongMeters(geometry, alongM);
    samples.push({ start, end, night: isAstronomicalNightAt(lat, lng, arrivalMs) });
  }
  return samples;
}

/** ~55 mph corridor estimate when plan/drive ETA is not wired yet. */
function estimateFullRouteEtaMinutes(totalMeters: number): number {
  if (totalMeters <= 0) return 60;
  return (totalMeters / 1609.344 / 55) * 60;
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
  return mergeNightSamples(buildRouteNightSamples(opts));
}

/** Sunset/sunrise boundaries along the route for vertical chart markers. */
export function buildRouteNightTransitions(opts: {
  geometry: LngLat[];
  totalMeters: number;
  userAlongMeters: number;
  planEtaMinutes: number | null;
  driveEtaMinutes?: number | null;
  nowMs?: number;
  segments?: number;
}): NightTransition[] {
  void opts.segments;
  return routeSunEventsToTransitions(buildRouteSunEvents(opts));
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

  const samples: NightSample[] = [];
  for (let i = 0; i < segments; i++) {
    const start = i / segments;
    const end = (i + 1) / segments;
    const timeMs = startMs + ((start + end) / 2) * durationMs;
    samples.push({ start, end, night: isNightAt(lat, lng, timeMs) });
  }
  return mergeNightSamples(samples);
}
