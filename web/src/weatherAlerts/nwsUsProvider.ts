/**
 * US-only: NOAA / National Weather Service active alerts (api.weather.gov).
 * Requires a descriptive User-Agent (see NWS API terms).
 * Future: add `EuMeteoProvider` etc. behind the same NormalizedWeatherAlert shape.
 */

import { getWebEnv } from "../config/env";
import type { LngLat } from "../nav/types";
import { pointAlongPolyline } from "../ui/geometryAlong";
import { polylineBbox, bboxIntersects } from "./geometryOverlap";
import { extractPolygonalGeometry } from "./nwsGeometry";
import type { NormalizedWeatherAlert, WeatherAlertFetchResult, WeatherAlertProviderId } from "./types";
import { NWS_TEST_ALERT, NWS_TEST_ALERT_ENABLED } from "./nwsTestAlert";
import {
  MAX_UGC_ZONE_RESOLVE_ALERTS,
  resolveGeometryForUgcBackedAlerts,
} from "./nwsWatchZoneGeometry";
import { nwsMapKindFromEvent } from "./nwsMapKind";
import { nwsApiRequestHeaders } from "./nwsClientHeaders";

/**
 * Do not use `limit=` — NWS returns 400 ("limit is not recognized").
 * Do not use `message_type=alert` alone: most ongoing warnings are re-sent as `messageType=Update`;
 * that filter drops the majority of active polygon geometry (~2/3 of features when tested).
 */
function nwsActiveAlertsUrl(): string {
  const base = getWebEnv().nwsApiBase.replace(/\/$/, "");
  return `${base}/alerts/active?status=actual`;
}

type NwsFeature = GeoJSON.Feature<GeoJSON.Geometry | null, Record<string, unknown>>;

function normalizeFeature(f: NwsFeature, index: number): NormalizedWeatherAlert | null {
  const p = f.properties ?? {};
  const id = typeof p.id === "string" ? p.id : `nws-${index}`;
  const headline = typeof p.headline === "string" ? p.headline : "Weather alert";
  const event = typeof p.event === "string" ? p.event : "Alert";
  const description = typeof p.description === "string" ? p.description : "";
  const severity = typeof p.severity === "string" ? p.severity : "Unknown";
  const urgency = typeof p.urgency === "string" ? p.urgency : "Unknown";
  const certainty = typeof p.certainty === "string" ? p.certainty : "Unknown";
  const ends = typeof p.ends === "string" ? p.ends : null;
  const areaDesc = typeof p.areaDesc === "string" ? p.areaDesc : "";

  const geometry = extractPolygonalGeometry(f.geometry ?? null);

  return {
    id,
    regionCode: "US",
    providerId: "nws-us" as WeatherAlertProviderId,
    headline,
    event,
    description,
    severity,
    urgency,
    certainty,
    ends,
    geometry,
    areaDesc,
  };
}

function featureBBox(g: GeoJSON.Polygon | GeoJSON.MultiPolygon): {
  west: number;
  south: number;
  east: number;
  north: number;
} | null {
  const coords: GeoJSON.Position[] =
    g.type === "Polygon"
      ? g.coordinates.flat()
      : g.coordinates.flatMap((poly) => poly.flat());
  if (coords.length < 3) return null;
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
  return { west, south, east, north };
}

function alertIntersectsCorridor(
  a: NormalizedWeatherAlert,
  corridor: { west: number; south: number; east: number; north: number },
  pad: number,
  extraWestPad: number = 0
): boolean {
  if (!a.geometry) {
    return false;
  }
  const ab = featureBBox(a.geometry);
  if (!ab) return false;
  const box = {
    west: corridor.west - pad - extraWestPad,
    south: corridor.south - pad,
    east: corridor.east + pad,
    north: corridor.north + pad,
  };
  return bboxIntersects(ab, box);
}

const NWS_FETCH_TIMEOUT_MS = 22_000;
const NWS_RETRY_DELAY_MS = 3_000;
const NWS_MAX_RETRIES = 3;

/** Avoid hammering NWS with 8–12 parallel `?point=` calls (rate limits + flaky mobile). */
const NWS_POINT_FETCH_CONCURRENCY = 2;
const NWS_POINT_INTER_BATCH_MS = 120;

const NWS_PAD_DEG = 0.9;
/** Wider on the upwind (west) side: synoptic weather and storm motion often approach from the west. */
const NWS_CORRIDOR_EXTRA_WEST_DEG = 0.5;
const NWS_UPWIND_SAMPLE_LNG_OFFSET_DEG = 0.45;

/** North America bounds (matches mapRegion) — used only for NWS `point=` range checks and legacy browse. */
const NA_BROWSE_CORRIDOR = { west: -175, south: 15, east: -48, north: 72 };

/** Along active routes, use several small `?point=` requests instead of one national dump. */
const ROUTE_POINT_SAMPLE_COUNT = 8;

/** Browse: grid of `?point=` calls inside the visible area (fast vs national `alerts/active`). */
const BROWSE_VIEWPORT_GRID_POINTS = 12;

/** Above this, point sampling misses too much — fall back to national browse. */
const BROWSE_VIEWPORT_MAX_LAT_SPAN_DEG = 24;
const BROWSE_VIEWPORT_MAX_LNG_SPAN_DEG = 42;

/**
 * Browse (no route): national `alerts/active` is already large; cap UGC zone follow-ups so the
 * first paint lands faster. Route-corridor mode keeps the full cap for overlap accuracy.
 */
const NWS_BROWSE_MAX_UGC_ZONE_ALERTS = 48;

async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  retries = NWS_MAX_RETRIES
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), NWS_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) return res;
      if (res.status === 429 && attempt < retries) {
        const ra = res.headers.get("Retry-After");
        const sec = ra ? parseInt(ra, 10) : NaN;
        const fromHeader = Number.isFinite(sec) && sec > 0 ? sec * 1000 : NWS_RETRY_DELAY_MS * (attempt + 1);
        await new Promise((r) => setTimeout(r, Math.min(fromHeader, 30_000)));
        continue;
      }
      if (res.status >= 500 && attempt < retries) {
        lastError = new Error(`NWS ${res.status}`);
        await new Promise((r) => setTimeout(r, NWS_RETRY_DELAY_MS * (attempt + 1)));
        continue;
      }
      // 4xx is usually a malformed request or policy rejection. NWS returns a useful JSON "problem" body.
      if (res.status >= 400 && res.status < 500) {
        let body = "";
        try {
          body = (await res.text())?.trim?.() ?? "";
        } catch {
          /* ignore */
        }
        const tail = body ? ` — ${body.slice(0, 220)}` : "";
        throw new Error(`NWS request rejected (${res.status})${tail}`);
      }
      throw new Error(`NWS server error (${res.status}). Try again shortly.`);
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof DOMException && e.name === "AbortError") {
        lastError = new Error("NWS request timed out — the weather service may be slow.");
      } else if (e instanceof TypeError) {
        // Failed to fetch — DNS, TLS, dropped cell, CORS, or ad/vpn blocking; not always "user offline".
        lastError = new Error(
          "Could not reach the NWS service. Try Wi‑Fi, wait a moment, or try again. Heavy traffic to the public weather API is sometimes throttled."
        );
      } else {
        lastError = e;
      }
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, NWS_RETRY_DELAY_MS * (attempt + 1)));
        continue;
      }
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error(
    "Could not reach the NWS service. Try Wi‑Fi, wait a moment, or try again. Heavy traffic to the public weather API is sometimes throttled."
  );
}

function sampleLngLatAlongRoute(route: LngLat[], maxPoints: number): LngLat[] {
  if (route.length === 0) return [];
  if (route.length <= maxPoints) return [...route];
  const last = route.length - 1;
  const out: LngLat[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const t = maxPoints === 1 ? 0 : i / (maxPoints - 1);
    const idx = Math.min(last, Math.round(t * last));
    out.push(route[idx]!);
  }
  const deduped: LngLat[] = [];
  for (const p of out) {
    if (deduped.some((q) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!) < 0.0004)) continue;
    deduped.push(p);
  }
  return deduped.length ? deduped : out;
}

function mergeDedupePointSamples(sets: LngLat[][]): LngLat[] {
  const out: LngLat[] = [];
  for (const set of sets) {
    for (const p of set) {
      if (out.some((q) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!) < 0.0004)) continue;
      out.push(p);
    }
  }
  return out;
}

function upwindProbeSamplesOffRoute(route: LngLat[]): LngLat[] {
  if (route.length < 2) return [];
  const at = [0.22, 0.5, 0.78] as const;
  const out: LngLat[] = [];
  for (const t of at) {
    const p = pointAlongPolyline(route, t);
    if (p) out.push([p[0]! - NWS_UPWIND_SAMPLE_LNG_OFFSET_DEG, p[1]!] as LngLat);
  }
  return out;
}

/** Active alerts affecting a single lat/lng — small payload vs. national `alerts/active`. */
async function fetchNwsFeaturesAtPoint(
  lat: number,
  lng: number,
  userAgent: string
): Promise<NwsFeature[]> {
  // Guard against malformed points (or swapped [lat,lng]) so a single bad coord
  // doesn’t break the entire route-corridor NWS fetch with a 400.
  const normalize = (aLat: number, aLng: number): { lat: number; lng: number } | null => {
    let la = aLat;
    let lo = aLng;
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;

    const inLatLngRange = (xLat: number, xLng: number) =>
      Number.isFinite(xLat) && Number.isFinite(xLng) && Math.abs(xLat) <= 90 && Math.abs(xLng) <= 180;

    const inNwsCoverage = (xLat: number, xLng: number) =>
      xLng >= NA_BROWSE_CORRIDOR.west &&
      xLng <= NA_BROWSE_CORRIDOR.east &&
      xLat >= NA_BROWSE_CORRIDOR.south &&
      xLat <= NA_BROWSE_CORRIDOR.north;

    // If lat/lng are swapped but still within numeric bounds, NWS will reject as "out of bounds".
    // Prefer the version that lands inside our North America corridor.
    if (inLatLngRange(la, lo) && !inNwsCoverage(la, lo) && inLatLngRange(lo, la) && inNwsCoverage(lo, la)) {
      const t = la;
      la = lo;
      lo = t;
    }

    // If latitude is out-of-range but longitude is plausible as latitude, swap.
    if (Math.abs(la) > 90 && Math.abs(lo) <= 90) {
      const t = la;
      la = lo;
      lo = t;
    }

    if (!inLatLngRange(la, lo)) return null;
    if (!inNwsCoverage(la, lo)) return null;
    return { lat: la, lng: lo };
  };

  const p = normalize(lat, lng);
  if (!p) return [];

  const base = getWebEnv().nwsApiBase.replace(/\/$/, "");
  const url = `${base}/alerts/active?point=${p.lat},${p.lng}`;
  const res = await fetchWithRetry(url, nwsApiRequestHeaders(userAgent));
  const data = (await res.json()) as GeoJSON.FeatureCollection;
  return (data.features ?? []) as NwsFeature[];
}

function featureDedupeKey(f: NwsFeature, index: number): string {
  const p = f.properties ?? {};
  if (typeof p.id === "string" && p.id.length > 0) return p.id;
  return `nws-fallback-${index}`;
}

export type NwsBrowseBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type BuildNwsResultOptions = {
  maxUgcZoneAlerts?: number;
  /**
   * Extra padding (degrees) on the **west** side of the corridor box only, on top of `padDeg`.
   * Improves overlap with upwind systems without widening the full NA browse.
   */
  corridorExtraWestPadDeg?: number;
  /** Fires after inline NWS polygons are known, before zone-URL geometry resolution (UGC tail). */
  onBeforeUgc?: (partial: WeatherAlertFetchResult) => void;
};

function clampBoundsToNorthAmerica(b: NwsBrowseBounds): NwsBrowseBounds {
  return {
    west: Math.max(b.west, NA_BROWSE_CORRIDOR.west),
    east: Math.min(b.east, NA_BROWSE_CORRIDOR.east),
    south: Math.max(b.south, NA_BROWSE_CORRIDOR.south),
    north: Math.min(b.north, NA_BROWSE_CORRIDOR.north),
  };
}

/** ~regional box around the user when the map has not reported bounds yet. */
export function nwsBrowseBoundsAroundLngLat(lng: number, lat: number, padDeg = 2.8): NwsBrowseBounds {
  return clampBoundsToNorthAmerica({
    west: lng - padDeg,
    east: lng + padDeg,
    south: lat - padDeg,
    north: lat + padDeg,
  });
}

function boundsLookSane(b: NwsBrowseBounds): boolean {
  const { west, south, east, north } = b;
  if (![west, south, east, north].every((x) => Number.isFinite(x))) return false;
  if (east <= west || north <= south) return false;
  if (north - south > 50 || east - west > 120) return false;
  return true;
}

function viewportSuitsPointGrid(b: NwsBrowseBounds): boolean {
  const lat = b.north - b.south;
  const lng = b.east - b.west;
  return (
    lat >= 0.02 &&
    lng >= 0.02 &&
    lat <= BROWSE_VIEWPORT_MAX_LAT_SPAN_DEG &&
    lng <= BROWSE_VIEWPORT_MAX_LNG_SPAN_DEG
  );
}

function sampleGridLngLat(bounds: NwsBrowseBounds, targetCount: number): LngLat[] {
  const cols = Math.max(2, Math.ceil(Math.sqrt(targetCount * 1.25)));
  const rows = Math.max(2, Math.ceil(targetCount / cols));
  const out: LngLat[] = [];
  for (let r = 0; r < rows && out.length < targetCount; r++) {
    for (let c = 0; c < cols && out.length < targetCount; c++) {
      const fx = cols === 1 ? 0.5 : c / (cols - 1);
      const fy = rows === 1 ? 0.5 : r / (rows - 1);
      const lng = bounds.west + fx * (bounds.east - bounds.west);
      const lat = bounds.south + fy * (bounds.north - bounds.south);
      out.push([lng, lat]);
    }
  }
  return out;
}

async function mergeNwsPointSamples(
  samples: LngLat[],
  userAgent: string
): Promise<NwsFeature[]> {
  // Filter malformed points before issuing requests.
  const validSamples = samples.filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
  if (validSamples.length === 0) return [];

  // Do not let one bad point (400, transient NWS hiccup, etc.) blank the entire route’s alert set.
  // Throttle: many parallel point requests can trigger 429s or "Failed to fetch" on mobile.
  const pointResults: NwsFeature[][] = [];
  for (let i = 0; i < validSamples.length; i += NWS_POINT_FETCH_CONCURRENCY) {
    const batch = validSamples.slice(i, i + NWS_POINT_FETCH_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(([lng, lat]) => fetchNwsFeaturesAtPoint(lat, lng, userAgent))
    );
    for (const s of settled) {
      if (s.status === "fulfilled") pointResults.push(s.value);
    }
    if (i + NWS_POINT_FETCH_CONCURRENCY < validSamples.length) {
      await new Promise((r) => setTimeout(r, NWS_POINT_INTER_BATCH_MS));
    }
  }
  const merged = new Map<string, NwsFeature>();
  let idx = 0;
  for (const feats of pointResults) {
    for (const f of feats) {
      const key = featureDedupeKey(f, idx++);
      if (!merged.has(key)) merged.set(key, f);
    }
  }
  return [...merged.values()];
}

async function fetchNwsActiveAlertsFeatures(userAgent: string): Promise<NwsFeature[]> {
  const res = await fetchWithRetry(nwsActiveAlertsUrl(), nwsApiRequestHeaders(userAgent));
  const data = (await res.json()) as GeoJSON.FeatureCollection;
  return (data.features ?? []) as NwsFeature[];
}

async function buildResultFromRawFeatures(
  features: NwsFeature[],
  corridor: { west: number; south: number; east: number; north: number },
  userAgent: string,
  padDeg: number,
  options?: BuildNwsResultOptions
): Promise<WeatherAlertFetchResult> {
  const maxUgc = options?.maxUgcZoneAlerts ?? MAX_UGC_ZONE_RESOLVE_ALERTS;
  const extraWest = options?.corridorExtraWestPadDeg ?? 0;
  const normalized: NormalizedWeatherAlert[] = [];
  const mapFeatures: GeoJSON.Feature[] = [];
  const ugcCandidates: { raw: NwsFeature; alert: NormalizedWeatherAlert }[] = [];

  features.forEach((f, i) => {
    const a = normalizeFeature(f, i);
    if (!a) return;
    if (a.geometry) {
      if (!alertIntersectsCorridor(a, corridor, padDeg, extraWest)) return;
      normalized.push(a);
      mapFeatures.push({
        type: "Feature",
        id: a.id,
        properties: {
          id: a.id,
          event: a.event,
          headline: a.headline,
          severity: a.severity,
          kind: nwsMapKindFromEvent(a.event),
        },
        geometry: a.geometry,
      });
    } else {
      ugcCandidates.push({ raw: f, alert: a });
    }
  });

  if (options?.onBeforeUgc && mapFeatures.length > 0) {
    options.onBeforeUgc({
      alerts: [...normalized],
      mapGeoJson: { type: "FeatureCollection", features: [...mapFeatures] },
    });
  }

  const nwsBase = getWebEnv().nwsApiBase.replace(/\/$/, "");
  const resolvedGeoms = await resolveGeometryForUgcBackedAlerts(
    ugcCandidates,
    corridor,
    padDeg,
    nwsBase,
    userAgent,
    maxUgc,
    extraWest
  );

  for (const { alert } of ugcCandidates) {
    const geometry = resolvedGeoms.get(alert.id);
    if (!geometry) continue;
    const merged: NormalizedWeatherAlert = { ...alert, geometry };
    normalized.push(merged);
    mapFeatures.push({
      type: "Feature",
      id: merged.id,
      properties: {
        id: merged.id,
        event: merged.event,
        headline: merged.headline,
        severity: merged.severity,
        kind: nwsMapKindFromEvent(merged.event),
      },
      geometry,
    });
  }

  if (
    NWS_TEST_ALERT_ENABLED &&
    NWS_TEST_ALERT.geometry &&
    alertIntersectsCorridor(NWS_TEST_ALERT, corridor, padDeg, extraWest) &&
    !normalized.some((a) => a.id === NWS_TEST_ALERT.id)
  ) {
    normalized.push(NWS_TEST_ALERT);
    mapFeatures.push({
      type: "Feature",
      id: NWS_TEST_ALERT.id,
      properties: {
        id: NWS_TEST_ALERT.id,
        event: NWS_TEST_ALERT.event,
        headline: NWS_TEST_ALERT.headline,
        severity: NWS_TEST_ALERT.severity,
        kind: nwsMapKindFromEvent(NWS_TEST_ALERT.event),
      },
      geometry: NWS_TEST_ALERT.geometry,
    });
  }

  return {
    alerts: normalized,
    mapGeoJson: { type: "FeatureCollection", features: mapFeatures },
  };
}

/**
 * Fetch active US alerts and keep those whose bbox intersects an expanded corridor around the route.
 * Uses several `alerts/active?point=` calls along the polyline (small responses) instead of one national feed.
 */
export async function fetchNwsAlertsForRouteCorridor(
  route: LngLat[],
  userAgent: string,
  buildOptions?: BuildNwsResultOptions
): Promise<WeatherAlertFetchResult> {
  const corridor = polylineBbox(route);
  if (!corridor) {
    return { alerts: [], mapGeoJson: { type: "FeatureCollection", features: [] } };
  }

  const along = sampleLngLatAlongRoute(route, ROUTE_POINT_SAMPLE_COUNT);
  const upwind = upwindProbeSamplesOffRoute(route);
  const samples = mergeDedupePointSamples([upwind, along]);
  const features = await mergeNwsPointSamples(samples, userAgent);
  // Fallback: if point sampling yields nothing (or NWS rejects some points), fetch the active feed and
  // filter down to just corridor-intersecting alerts. Heavier, but avoids “no polygons” on known storm routes.
  const effective = features.length ? features : await fetchNwsActiveAlertsFeatures(userAgent);
  const routeOpts: BuildNwsResultOptions = {
    corridorExtraWestPadDeg: NWS_CORRIDOR_EXTRA_WEST_DEG,
    ...buildOptions,
  };
  return buildResultFromRawFeatures(effective, corridor, userAgent, NWS_PAD_DEG, routeOpts);
}

/**
 * Browse without a planned route: small `?point=` grid inside the map viewport (or similar bounds).
 * Falls back to {@link fetchNwsAlertsForNorthAmericaBrowse} when the area is too large for sampling.
 */
export async function fetchNwsAlertsForBrowseViewport(
  bounds: NwsBrowseBounds,
  userAgent: string,
  buildOptions?: BuildNwsResultOptions
): Promise<WeatherAlertFetchResult> {
  const b = clampBoundsToNorthAmerica(bounds);
  if (!boundsLookSane(b) || !viewportSuitsPointGrid(b)) {
    return fetchNwsAlertsForNorthAmericaBrowse(userAgent, buildOptions);
  }
  const samples = sampleGridLngLat(b, BROWSE_VIEWPORT_GRID_POINTS);
  const features = await mergeNwsPointSamples(samples, userAgent);
  return buildResultFromRawFeatures(features, b, userAgent, NWS_PAD_DEG, {
    maxUgcZoneAlerts: NWS_BROWSE_MAX_UGC_ZONE_ALERTS,
    ...buildOptions,
  });
}

/**
 * No planned route: one national fetch filtered to North America — fallback when the viewport is huge
 * or bounds are unavailable.
 */
export async function fetchNwsAlertsForNorthAmericaBrowse(
  userAgent: string,
  buildOptions?: BuildNwsResultOptions
): Promise<WeatherAlertFetchResult> {
  const res = await fetchWithRetry(nwsActiveAlertsUrl(), nwsApiRequestHeaders(userAgent));
  const data = (await res.json()) as GeoJSON.FeatureCollection;
  const features = (data.features ?? []) as NwsFeature[];
  return buildResultFromRawFeatures(features, NA_BROWSE_CORRIDOR, userAgent, NWS_PAD_DEG, {
    maxUgcZoneAlerts: NWS_BROWSE_MAX_UGC_ZONE_ALERTS,
    ...buildOptions,
  });
}
