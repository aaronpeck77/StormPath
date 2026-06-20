import type { LngLat } from "../nav/types";
import type { RouteForecast } from "./tomorrowIo";
import { safeStorage } from "../storage/safeStorage";

const LS_ROUTE_FORECAST = "stormpath-route-corridor-forecast-v1";
const LS_ROUTE_OW_OVERLAY = "stormpath-route-ow-overlay-v1";
const MAX_ROUTE_ENTRIES = 6;

export const STALE_ROUTE_FORECAST_NOTE =
  "Live refresh paused — showing your last forecast for this direction.";
export const QUOTA_NO_ROUTE_FORECAST_NOTE =
  "Weather API quota reached — no saved forecast for this direction yet.";

type StoredRouteForecast = {
  routeSig: string;
  /** Origin → destination (direction matters; reverse trip is a different key). */
  directedSig: string;
  forecast: RouteForecast;
  savedAt: number;
};

type StoredOwOverlay = {
  geomKey: string;
  legId: string;
  headline: string;
  precipHint: number;
  samples?: { t: number; precipHint: number; headline: string }[];
  savedAt: number;
};

/** Same signature as {@link useTomorrowRouteForecast} — keep in sync. */
export function corridorRouteSig(geometry: LngLat[]): string {
  if (!geometry.length) return "";
  return `${corridorDirectedSig(geometry)}_${geometry.length}`;
}

/** Ordered origin → destination (no vertex count). */
export function corridorDirectedSig(geometry: LngLat[]): string {
  if (!geometry.length) return "";
  const s = geometry;
  return `${s[0]?.[0]?.toFixed(3)},${s[0]?.[1]?.toFixed(3)}_${s[s.length - 1]?.[0]?.toFixed(3)},${s[s.length - 1]?.[1]?.toFixed(3)}`;
}

/** @deprecated Use {@link corridorDirectedSig}. */
export function corridorEndpointSig(routeSig: string): string {
  const idx = routeSig.lastIndexOf("_");
  return idx > 0 ? routeSig.slice(0, idx) : routeSig;
}

export function corridorReverseDirectedSig(directedSig: string): string {
  const idx = directedSig.indexOf("_");
  if (idx <= 0) return directedSig;
  const origin = directedSig.slice(0, idx);
  const dest = directedSig.slice(idx + 1);
  return `${dest}_${origin}`;
}

function lngLatDist2(lngLat: LngLat, lat: number, lng: number): number {
  const dx = lngLat[0] - lng;
  const dy = lngLat[1] - lat;
  return dx * dx + dy * dy;
}

/** Cached intervals must sit near route start/end — blocks reverse-trip reuse. */
export function forecastCorridorMatchesDirection(
  forecast: RouteForecast,
  geometry: LngLat[]
): boolean {
  if (geometry.length < 2 || !forecast.intervals.length) return false;
  const start = geometry[0]!;
  const end = geometry[geometry.length - 1]!;
  const first = forecast.intervals[0]!;
  const last = forecast.intervals[forecast.intervals.length - 1]!;

  const dFirstStart = lngLatDist2(start, first.lat, first.lng);
  const dFirstEnd = lngLatDist2(end, first.lat, first.lng);
  const dLastEnd = lngLatDist2(end, last.lat, last.lng);
  const dLastStart = lngLatDist2(start, last.lat, last.lng);

  return dFirstStart <= dFirstEnd && dLastEnd <= dLastStart;
}

function readRouteForecastEntries(): StoredRouteForecast[] {
  const parsed = safeStorage.getJson<StoredRouteForecast[] | null>(LS_ROUTE_FORECAST, null);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (e) =>
      e &&
      typeof e.routeSig === "string" &&
      typeof e.directedSig === "string" &&
      e.forecast &&
      Array.isArray(e.forecast.intervals)
  );
}

function writeRouteForecastEntries(entries: StoredRouteForecast[]): void {
  safeStorage.setJson(LS_ROUTE_FORECAST, entries.slice(0, MAX_ROUTE_ENTRIES));
}

function acceptCachedForecast(
  forecast: RouteForecast,
  geometry: LngLat[] | null | undefined
): RouteForecast | null {
  if (!forecast.intervals.length) return null;
  if (geometry?.length && !forecastCorridorMatchesDirection(forecast, geometry)) return null;
  return forecast;
}

/**
 * Last good corridor forecast for this route: exact shape, then same direction
 * (reroute) — never the reverse trip (B→A cache for A→B).
 */
export function readRouteForecastCache(
  routeSig: string,
  geometry?: LngLat[] | null
): RouteForecast | null {
  if (!routeSig) return null;
  const directed = corridorEndpointSig(routeSig);
  const reverseDirected = corridorReverseDirectedSig(directed);
  const entries = readRouteForecastEntries();

  const exact = entries.find((e) => e.routeSig === routeSig);
  if (exact) {
    return acceptCachedForecast(exact.forecast, geometry);
  }

  const sameDirection = entries.find(
    (e) => e.directedSig === directed && e.directedSig !== reverseDirected
  );
  if (sameDirection) {
    return acceptCachedForecast(sameDirection.forecast, geometry);
  }

  return null;
}

export function writeRouteForecastCache(
  routeSig: string,
  forecast: RouteForecast,
  geometry?: LngLat[] | null
): void {
  if (!routeSig || !forecast.intervals.length) return;
  if (geometry?.length && !forecastCorridorMatchesDirection(forecast, geometry)) return;

  const entry: StoredRouteForecast = {
    routeSig,
    directedSig: corridorEndpointSig(routeSig),
    forecast,
    savedAt: Date.now(),
  };
  const rest = readRouteForecastEntries().filter(
    (e) => e.routeSig !== routeSig && e.directedSig !== entry.directedSig
  );
  writeRouteForecastEntries([entry, ...rest]);
}

function readOwOverlayEntries(): StoredOwOverlay[] {
  const parsed = safeStorage.getJson<StoredOwOverlay[] | null>(LS_ROUTE_OW_OVERLAY, null);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((e) => e && typeof e.geomKey === "string" && typeof e.legId === "string");
}

function writeOwOverlayEntries(entries: StoredOwOverlay[]): void {
  safeStorage.setJson(LS_ROUTE_OW_OVERLAY, entries.slice(0, MAX_ROUTE_ENTRIES));
}

export function readRouteOwOverlayCache(
  geomKey: string
): Omit<StoredOwOverlay, "geomKey" | "savedAt"> | null {
  if (!geomKey) return null;
  const hit = readOwOverlayEntries().find((e) => e.geomKey === geomKey);
  if (!hit) return null;
  return {
    legId: hit.legId,
    headline: hit.headline,
    precipHint: hit.precipHint,
    samples: hit.samples,
  };
}

export function writeRouteOwOverlayCache(
  geomKey: string,
  legId: string,
  overlay: { headline: string; precipHint: number; samples?: StoredOwOverlay["samples"] }
): void {
  if (!geomKey || !legId) return;
  if (!overlay.headline.trim() && !overlay.samples?.length && overlay.precipHint <= 0) return;
  const entry: StoredOwOverlay = { geomKey, legId, savedAt: Date.now(), ...overlay };
  const rest = readOwOverlayEntries().filter((e) => e.geomKey !== geomKey);
  writeOwOverlayEntries([entry, ...rest]);
}
