/**
 * Many NWS products return `geometry: null` in alerts/active GeoJSON but list `affectedZones`
 * (forecast/county/fire zones) → fetch zone polygons for map + overlap.
 * Previously only convective watches/warnings were resolved, so Freeze Watch, Red Flag Warning,
 * winter, fire, flood, etc. never drew even when active.
 */

import { rankNwsSeverity } from "./geometryOverlap";
import type { NormalizedWeatherAlert } from "./types";
import { extractPolygonalGeometry, mergePolygonalParts } from "./nwsGeometry";
import { stateCodesTouchingCorridorBbox } from "./usStateBBox";
import { nwsApiRequestHeaders } from "./nwsClientHeaders";
import { nwsHttpGet } from "./nwsHttpGet";

/** Prefer resolving these first when over the per-refresh cap (same as old narrow list). */
const NWS_CONVECTIVE_PRIORITY_EVENTS = new Set([
  "Tornado Watch",
  "Severe Thunderstorm Watch",
  "Tornado Warning",
  "Severe Thunderstorm Warning",
]);

/** Max alerts to resolve via zone fetches per refresh (dedupes zone URLs across alerts). */
export const MAX_UGC_ZONE_RESOLVE_ALERTS = 150;

type NwsFeature = GeoJSON.Feature<GeoJSON.Geometry | null, Record<string, unknown>>;

function zoneUrlForFetch(original: string, nwsApiBase: string): string {
  const base = nwsApiBase.replace(/\/$/, "");
  const prefix = "https://api.weather.gov/";
  if (original.startsWith("https://api.weather.gov/")) {
    return `${base}/${original.slice(prefix.length)}`;
  }
  return original;
}

function extractAffectedZoneUrls(f: NwsFeature): string[] {
  const z = f.properties?.affectedZones;
  if (!Array.isArray(z)) return [];
  return z.filter((u): u is string => typeof u === "string" && u.length > 0);
}

function extractUgcCodes(f: NwsFeature): string[] {
  const geo = f.properties?.geocode as { UGC?: unknown } | undefined;
  const fromGeocode = geo?.UGC;
  if (Array.isArray(fromGeocode)) {
    return fromGeocode.filter((x): x is string => typeof x === "string" && x.length > 0);
  }
  return extractAffectedZoneUrls(f)
    .map((u) => {
      const m = u.match(/\/zones\/(?:county|forecast|fire|public)\/([A-Za-z0-9]+)\/?$/i);
      return m?.[1] ?? "";
    })
    .filter(Boolean);
}

/** First two letters of NWS UGC (e.g. TXC173 → TX, ILZ014 → IL). */
function ugcStateCodes(ugcList: string[]): Set<string> {
  const s = new Set<string>();
  for (const c of ugcList) {
    if (c.length >= 2 && /^[A-Z]{2}/i.test(c)) {
      s.add(c.slice(0, 2).toUpperCase());
    }
  }
  return s;
}

function setsIntersect(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) {
    if (b.has(x)) return true;
  }
  return false;
}

const ZONE_FETCH_TIMEOUT_MS = 10_000;

async function fetchZonePolygon(
  url: string,
  userAgent: string
): Promise<GeoJSON.Polygon | GeoJSON.MultiPolygon | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ZONE_FETCH_TIMEOUT_MS);
  try {
    const res = await nwsHttpGet(url, nwsApiRequestHeaders(userAgent), {
      signal: ctrl.signal,
      connectTimeout: ZONE_FETCH_TIMEOUT_MS,
      readTimeout: ZONE_FETCH_TIMEOUT_MS,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as GeoJSON.Feature;
    if (data.type !== "Feature" || !data.geometry) return null;
    return extractPolygonalGeometry(data.geometry);
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function alertIntersectsCorridor(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  corridor: { west: number; south: number; east: number; north: number },
  padDeg: number,
  extraWestPad: number = 0
): boolean {
  const coords: GeoJSON.Position[] =
    geometry.type === "Polygon"
      ? geometry.coordinates.flat()
      : geometry.coordinates.flatMap((poly) => poly.flat());
  if (coords.length < 3) return false;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const p of coords) {
    const lng = p[0]!;
    const lat = p[1]!;
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  const ab = { west, south, east, north };
  const w = corridor.west - padDeg - extraWestPad;
  const s = corridor.south - padDeg;
  const e = corridor.east + padDeg;
  const n = corridor.north + padDeg;
  return !(ab.east < w || ab.west > e || ab.north < s || ab.south > n);
}

export async function resolveGeometryForUgcBackedAlerts(
  items: { raw: NwsFeature; alert: NormalizedWeatherAlert }[],
  corridor: { west: number; south: number; east: number; north: number },
  corridorPadDeg: number,
  nwsApiBase: string,
  userAgent: string,
  maxAlerts: number = MAX_UGC_ZONE_RESOLVE_ALERTS,
  /** Extra padding on the west side for upwind NWS context (see {@link nwsUsProvider}). */
  corridorExtraWestPad: number = 0
): Promise<Map<string, GeoJSON.Polygon | GeoJSON.MultiPolygon>> {
  const out = new Map<string, GeoJSON.Polygon | GeoJSON.MultiPolygon>();

  const ext = corridorPadDeg + 2.5;
  const [cw, cs, ce, cn] = [
    corridor.west - ext - corridorExtraWestPad,
    corridor.south - ext,
    corridor.east + ext,
    corridor.north + ext,
  ];
  const corridorStates = stateCodesTouchingCorridorBbox({ west: cw, south: cs, east: ce, north: cn });

  const candidates: { raw: NwsFeature; alert: NormalizedWeatherAlert; urls: string[] }[] = [];

  for (const { raw, alert } of items) {
    if (alert.geometry) continue;
    const urls = extractAffectedZoneUrls(raw).map((u) => zoneUrlForFetch(u, nwsApiBase));
    if (!urls.length) continue;
    const watchStates = ugcStateCodes(extractUgcCodes(raw));
    if (watchStates.size && !setsIntersect(watchStates, corridorStates)) continue;
    candidates.push({ raw, alert, urls });
  }

  candidates.sort((a, b) => {
    const pri = (e: string) => (NWS_CONVECTIVE_PRIORITY_EVENTS.has(e) ? 1 : 0);
    const d = pri(b.alert.event) - pri(a.alert.event);
    if (d !== 0) return d;
    return rankNwsSeverity(b.alert.severity) - rankNwsSeverity(a.alert.severity);
  });

  const capped = candidates.slice(0, maxAlerts);
  const toResolve: { alert: NormalizedWeatherAlert; urls: string[] }[] = capped.map((c) => ({
    alert: c.alert,
    urls: c.urls,
  }));

  if (!toResolve.length) return out;

  const uniqueUrls = [...new Set(toResolve.flatMap((t) => t.urls))];
  const cache = new Map<string, GeoJSON.Polygon | GeoJSON.MultiPolygon | null>();
  const chunkSize = 4;
  for (let i = 0; i < uniqueUrls.length; i += chunkSize) {
    const chunk = uniqueUrls.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (url) => {
        if (cache.has(url)) return;
        const g = await fetchZonePolygon(url, userAgent);
        cache.set(url, g);
      })
    );
    if (i + chunkSize < uniqueUrls.length) {
      await new Promise((r) => setTimeout(r, 80));
    }
  }

  for (const { alert, urls } of toResolve) {
    const parts: (GeoJSON.Polygon | GeoJSON.MultiPolygon)[] = [];
    for (const url of urls) {
      const g = cache.get(url);
      if (g) parts.push(g);
    }
    const merged = mergePolygonalParts(parts);
    if (!merged) continue;
    if (!alertIntersectsCorridor(merged, corridor, corridorPadDeg, corridorExtraWestPad)) continue;
    out.set(alert.id, merged);
  }

  return out;
}
