import { pointAtAlongMeters } from "../nav/routeGeometry";
import { arrivalTimeMsAtAlongMeters } from "../nav/routeForecastTimeline";
import type { LngLat } from "../nav/types";
import { formatCoordsAreaLabel } from "../utils/forecastDisplay";
import { formatDistanceShort } from "../utils/formatDistance";
import { isAstronomicalNightAt, sunTimesAt, formatSolarLocalTime } from "./solarDayNight";

export type RouteSunEvent = {
  fraction: number;
  alongMeters: number;
  kind: "sunset" | "sunrise";
  /** Local sunset/sunrise at this coordinate (SunCalc, UTC ms). */
  eventMs: number;
  lat: number;
  lng: number;
};

type RouteSunContext = {
  geometry: LngLat[];
  totalMeters: number;
  userAlongMeters: number;
  planEtaMinutes: number;
  driveEtaMinutes: number | null;
  nowMs: number;
};

const MIN_SEGMENTS = 96;
const MAX_SEGMENTS = 320;
const METERS_PER_SEGMENT = 18_000;
const REFINE_ITERATIONS = 22;

function estimateFullRouteEtaMinutes(totalMeters: number): number {
  if (totalMeters <= 0) return 60;
  return (totalMeters / 1609.344 / 55) * 60;
}

function resolvePlanEtaMinutes(opts: {
  totalMeters: number;
  userAlongMeters: number;
  planEtaMinutes: number | null;
  driveEtaMinutes?: number | null;
}): number {
  const { totalMeters, userAlongMeters, planEtaMinutes, driveEtaMinutes = null } = opts;
  if (planEtaMinutes != null && Number.isFinite(planEtaMinutes)) return planEtaMinutes;
  if (
    driveEtaMinutes != null &&
    Number.isFinite(driveEtaMinutes) &&
    totalMeters > userAlongMeters
  ) {
    return driveEtaMinutes * (totalMeters / Math.max(1, totalMeters - userAlongMeters));
  }
  return estimateFullRouteEtaMinutes(totalMeters);
}

function segmentCountForRoute(totalMeters: number): number {
  return Math.min(MAX_SEGMENTS, Math.max(MIN_SEGMENTS, Math.ceil(totalMeters / METERS_PER_SEGMENT)));
}

export { segmentCountForRoute };

function buildRouteSunContext(opts: {
  geometry: LngLat[];
  totalMeters: number;
  userAlongMeters: number;
  planEtaMinutes: number | null;
  driveEtaMinutes?: number | null;
  nowMs?: number;
}): RouteSunContext | null {
  const { geometry, totalMeters, userAlongMeters, driveEtaMinutes = null } = opts;
  if (geometry.length < 2 || totalMeters <= 0) return null;
  return {
    geometry,
    totalMeters,
    userAlongMeters,
    planEtaMinutes: resolvePlanEtaMinutes(opts),
    driveEtaMinutes,
    nowMs: opts.nowMs ?? Date.now(),
  };
}

function arrivalMsAtFraction(ctx: RouteSunContext, fraction: number): number | null {
  return arrivalTimeMsAtAlongMeters(fraction * ctx.totalMeters, {
    totalMeters: ctx.totalMeters,
    userAlongMeters: ctx.userAlongMeters,
    planEtaMinutes: ctx.planEtaMinutes,
    driveEtaMinutes: ctx.driveEtaMinutes,
    nowMs: ctx.nowMs,
  });
}

function isNightAtFraction(ctx: RouteSunContext, fraction: number): boolean | null {
  const alongM = fraction * ctx.totalMeters;
  const arrivalMs = arrivalMsAtFraction(ctx, fraction);
  if (arrivalMs == null) return null;
  const [lng, lat] = pointAtAlongMeters(ctx.geometry, alongM);
  return isAstronomicalNightAt(lat, lng, arrivalMs);
}

function refineCrossing(
  ctx: RouteSunContext,
  lo: number,
  hi: number,
  toNight: boolean
): number {
  let low = lo;
  let high = hi;
  for (let i = 0; i < REFINE_ITERATIONS; i++) {
    const mid = (low + high) / 2;
    const night = isNightAtFraction(ctx, mid);
    if (night == null) break;
    if (toNight) {
      if (night) high = mid;
      else low = mid;
    } else if (night) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}

function sunEventMsAt(
  lat: number,
  lng: number,
  kind: RouteSunEvent["kind"],
  referenceMs: number
): number | null {
  const sun = sunTimesAt(lat, lng, new Date(referenceMs));
  if (!sun) return null;
  return kind === "sunset" ? sun.sunsetMs : sun.sunriseMs;
}

/**
 * Where along the route (fraction, lat/lng, local time) you cross sunset or sunrise.
 * Accounts for changing sun times and time zones as you move — e.g. westbound IL → CA.
 */
export function buildRouteSunEvents(opts: {
  geometry: LngLat[];
  totalMeters: number;
  userAlongMeters: number;
  planEtaMinutes: number | null;
  driveEtaMinutes?: number | null;
  nowMs?: number;
}): RouteSunEvent[] {
  const ctx = buildRouteSunContext(opts);
  if (!ctx) return [];

  const segments = segmentCountForRoute(ctx.totalMeters);
  const samples: { fraction: number; night: boolean }[] = [];

  for (let i = 0; i < segments; i++) {
    const fraction = (i + 0.5) / segments;
    const night = isNightAtFraction(ctx, fraction);
    if (night == null) continue;
    samples.push({ fraction, night });
  }
  if (samples.length < 2) return [];

  const events: RouteSunEvent[] = [];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]!;
    const curr = samples[i]!;
    if (prev.night === curr.night) continue;

    const kind: RouteSunEvent["kind"] = !prev.night && curr.night ? "sunset" : "sunrise";
    const lo = prev.fraction;
    const hi = curr.fraction;
    const fraction = refineCrossing(ctx, lo - 1 / segments, hi + 1 / segments, kind === "sunset");
    const alongM = fraction * ctx.totalMeters;
    const arrivalMs = arrivalMsAtFraction(ctx, fraction) ?? ctx.nowMs;
    const [lng, lat] = pointAtAlongMeters(ctx.geometry, alongM);
    const eventMs = sunEventMsAt(lat, lng, kind, arrivalMs);
    if (eventMs == null) continue;

    events.push({ fraction, alongMeters: alongM, kind, eventMs, lat, lng });
  }

  return events;
}

export function routeSunEventsToTransitions(
  events: RouteSunEvent[]
): { fraction: number; kind: RouteSunEvent["kind"] }[] {
  return events.map((e) => ({ fraction: e.fraction, kind: e.kind }));
}

export function formatRouteSunEventLocation(
  event: RouteSunEvent,
  userAlongMeters: number,
  useMiles: boolean
): string {
  const ahead = event.alongMeters - userAlongMeters;
  if (ahead > 800) {
    const dist = formatDistanceShort(ahead, useMiles);
    if (dist) return `${dist} ahead`;
  }
  return formatCoordsAreaLabel(event.lat, event.lng);
}

export function routeSunEventAxisLabel(
  event: RouteSunEvent,
  userAlongMeters: number,
  useMiles: boolean
): { title: string; time: string; place: string } {
  return {
    title: event.kind === "sunset" ? "Sunset" : "Sunrise",
    time: formatSolarLocalTime(event.eventMs, event.lat, event.lng),
    place: formatRouteSunEventLocation(event, userAlongMeters, useMiles),
  };
}
