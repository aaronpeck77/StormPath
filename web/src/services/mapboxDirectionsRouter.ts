import type { LngLat, NavRoute, RouteTurnStep, TripPlan } from "../nav/types";
import { detectRouteTollsFromLegs } from "../nav/detectRouteTolls";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";
import {
  computeRadarBypassWaypointCandidates,
  computeStormAvoidanceWaypointVariants,
  dedupeWaypointCandidates,
  STORM_AVOIDANCE_MAX_ETA_FACTOR,
} from "../nav/stormAvoidanceWaypoint";
import {
  closestAlongRouteMeters,
  cumulativeLengthToVertex,
  haversineMeters,
  polylineLengthMeters,
  subsamplePolylineVertexBudget,
} from "../nav/routeGeometry";
import { shortenTurnInstruction } from "../nav/turnInstructionShort";
import {
  fetchWithTimeout,
  isAbortError,
  isFetchTimeoutError,
  isRetryableFetchError,
  isRetryableHttpStatus,
  MAPBOX_DIRECTIONS_TIMEOUT_MS,
} from "../utils/fetchResilient";
import { rainViewerPrecipTileUrlTemplate } from "./rainViewerRadar";
import { RADAR_PRIMARY_PRECIP_GATE, sampleRadarMosaicMaxAlongPolyline } from "./radarPolylineIntensity";

type MbCoord = [number, number];

type MbIncident = {
  id?: string;
  type?: string;
  description?: string;
  long_description?: string;
  impact?: string;
  sub_type?: string;
  lanes_blocked?: string[];
  num_lanes_blocked?: number;
  affected_road_names?: string[];
  geometry_index_start?: number;
  geometry_index_end?: number;
  south?: number;
  west?: number;
  north?: number;
  east?: number;
};

type DirectionsResponse = {
  code?: string;
  message?: string;
  routes?: {
    duration?: number;
    duration_typical?: number;
    distance?: number;
    geometry?: { type?: string; coordinates?: MbCoord[] };
    legs?: {
      steps?: {
        maneuver?: {
          instruction?: string;
          type?: string;
          modifier?: string;
        };
        name?: string;
        /** Road number per Mapbox (e.g. I 72, US 36) — prefer over long `name` for shields. */
        ref?: string;
        distance?: number;
        intersections?: {
          geometry_index?: number;
          classes?: string[];
          toll_collection?: { name?: string; type?: string };
        }[];
      }[];
      incidents?: MbIncident[];
      annotation?: {
        closure?: boolean[];
      };
    }[];
  }[];
};

/**
 * Mapbox returns HTTP 403 + "Forbidden" when the **public** token’s URL allow-list does not include
 * the page origin (common on a phone: Netlify URL vs LAN dev URL). Secret tokens also 403 from the browser.
 */
function mapboxDirectionsErrorFromResponse(
  res: Response,
  data: DirectionsResponse
): Error {
  const detail = (data.message ?? data.code ?? res.statusText ?? "unknown").trim();
  const status = res.status;
  if (status === 403 || /forbidden/i.test(detail)) {
    return new Error(
      "Mapbox blocked routing (403). Open mapbox.com → Account → Tokens → your public token → " +
        "URL restrictions: add this site’s exact origin (e.g. https://*.netlify.app/* or your custom domain). " +
        "If you open the app from your PC’s LAN IP (http://192.168.x.x:5173), add that URL too."
    );
  }
  if (status === 401) {
    return new Error(
      "Mapbox token rejected (401). Check VITE_MAPBOX_TOKEN — use a **public** token with Directions + Geocoding scopes."
    );
  }
  return new Error(`Mapbox Directions ${status}: ${detail}`);
}

/** Mapbox can return thousands of micro-steps on cross-country legs — enough for any US drive. */
const MAX_TURN_STEPS = 5000;

/** Mapbox `exclude` query — motorway and toll can be combined. */
type DirectionsFetchExclude = {
  excludeMotorway?: boolean;
  excludeToll?: boolean;
};

function directionsExcludeParam(opts: DirectionsFetchExclude): string | undefined {
  const parts: string[] = [];
  if (opts.excludeMotorway) parts.push("motorway");
  if (opts.excludeToll) parts.push("toll");
  return parts.length > 0 ? parts.join(",") : undefined;
}

type DirectionsFetchOpts = DirectionsFetchExclude & {
  alternatives: boolean;
  includeDetails?: boolean;
};

function parseSteps(route: NonNullable<DirectionsResponse["routes"]>[0]): RouteTurnStep[] {
  const out: RouteTurnStep[] = [];
  legLoop: for (const leg of route.legs ?? []) {
    for (const step of leg.steps ?? []) {
      if (out.length >= MAX_TURN_STEPS) break legLoop;
      const rawInstr =
        (typeof step.maneuver?.instruction === "string" && step.maneuver.instruction.trim()) ||
        (typeof step.name === "string" && step.name.trim()) ||
        "";
      if (!rawInstr) continue;
      const name = typeof step.name === "string" ? step.name : undefined;
      const ref = typeof step.ref === "string" ? step.ref : undefined;
      const instr = shortenTurnInstruction(rawInstr, name, ref);
      const mv = step.maneuver;
      out.push({
        instruction: instr,
        distanceM: typeof step.distance === "number" ? step.distance : undefined,
        maneuverType: typeof mv?.type === "string" ? mv.type : undefined,
        maneuverModifier: typeof mv?.modifier === "string" ? mv.modifier : undefined,
      });
    }
  }
  if (out.length === 0) {
    out.push({ instruction: "Follow line to destination" });
  }
  return out;
}

function geometryNearlySame(a: LngLat[], b: LngLat[]): boolean {
  if (a.length < 2 || b.length < 2) return false;
  if (haversineMeters(a[0]!, b[0]!) > 45) return false;
  if (haversineMeters(a[a.length - 1]!, b[b.length - 1]!) > 45) return false;
  const la = polylineLengthMeters(a);
  const lb = polylineLengthMeters(b);
  if (la < 15 || lb < 15) return false;
  /* Slightly looser than before so Mapbox “alternatives” that share most of the path still show as A/B/C. */
  return Math.abs(la - lb) / Math.max(la, lb) < 0.011;
}

/**
 * Cross-country `overview=full` lines are huge; keep payload bounded, but preserve enough vertices
 * so rendered turns stay attached to real roads on long interstate drives (esp. TestFlight/native).
 */
const MAX_STORED_GEOMETRY_VERTICES = 12000;
const GEOM_COMPARE_MAX_VERTICES = 200;

function rescaledNoticeAlongMeters(
  along: (number | undefined)[] | undefined,
  full: LngLat[],
  out: LngLat[]
): (number | undefined)[] | undefined {
  if (!along) return along;
  const fLen = polylineLengthMeters(full);
  const oLen = polylineLengthMeters(out);
  if (fLen < 1e-3 || oLen < 1e-3) return along;
  const s = oLen / fLen;
  return along.map((m) =>
    m != null && Number.isFinite(m) && m >= 0 ? m * s : m
  );
}

/** O(200) per side — for mergePools only (don’t use full 10k+ vertex lines). */
function sameRouteShapeLine(a: LngLat[], b: LngLat[]): boolean {
  if (a.length < 2 || b.length < 2) return false;
  return geometryNearlySame(
    a.length > GEOM_COMPARE_MAX_VERTICES
      ? subsamplePolylineVertexBudget(a, GEOM_COMPARE_MAX_VERTICES)
      : a,
    b.length > GEOM_COMPARE_MAX_VERTICES
      ? subsamplePolylineVertexBudget(b, GEOM_COMPARE_MAX_VERTICES)
      : b
  );
}

/**
 * Spaced samples along the raw API coordinate list — avoids O(N) map copy when only checking if
 * two options are the same shape (merge A/B/C).
 */
function coordsToLightLine(coords: MbCoord[], maxPoints: number): LngLat[] {
  if (coords.length < 2) return [];
  if (coords.length <= maxPoints) {
    return coords.map(([lng, lat]) => [lng, lat] as LngLat);
  }
  const last = coords.length - 1;
  const out: LngLat[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const t = maxPoints === 1 ? 0 : i / (maxPoints - 1);
    const idx = Math.min(last, Math.round(t * last));
    const c = coords[idx]!;
    out.push([c[0]!, c[1]!]);
  }
  const deduped: LngLat[] = [];
  for (const p of out) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev[0] === p[0] && prev[1] === p[1]) continue;
    deduped.push(p);
  }
  if (deduped.length >= 2) return deduped;
  const a = coords[0]!;
  const b = coords[last]!;
  return [
    [a[0]!, a[1]!] as LngLat,
    [b[0]!, b[1]!] as LngLat,
  ];
}

function routeFromDirectionsApi(
  r: NonNullable<DirectionsResponse["routes"]>[0],
  id: string,
  role: NavRoute["role"],
  label: string
): NavRoute | null {
  const coords = r.geometry?.coordinates;
  if (!coords?.length || r.geometry?.type !== "LineString") return null;
  const geometry = coords.map(([lng, lat]) => [lng, lat] as LngLat);
  const durSec = r.duration;
  if (durSec == null || !Number.isFinite(durSec)) return null;

  const { texts: notices, alongMeters: noticeAlong } = collectRouteNoticesWithAlong(r, geometry);
  const tollInfo = detectRouteTollsFromLegs(r.legs);
  const displayGeometry =
    geometry.length > MAX_STORED_GEOMETRY_VERTICES
      ? subsamplePolylineVertexBudget(geometry, MAX_STORED_GEOMETRY_VERTICES)
      : geometry;
  const alongForDisplay = rescaledNoticeAlongMeters(noticeAlong, geometry, displayGeometry);

  return {
    id,
    role,
    label,
    geometry: displayGeometry,
    baseEtaMinutes: Math.max(1, durSec / 60),
    turnSteps: parseSteps(r),
    routeNotices: notices.length ? notices : undefined,
    routeNoticeAlongMeters: notices.length ? alongForDisplay : undefined,
    hasTolls: tollInfo.hasTolls || undefined,
    tollLabels: tollInfo.tollLabels.length ? tollInfo.tollLabels : undefined,
  };
}

async function fetchMapboxDirections(
  accessToken: string,
  start: LngLat,
  end: LngLat,
  opts: DirectionsFetchOpts,
  signal?: AbortSignal
): Promise<DirectionsResponse> {
  const o = `${start[0].toFixed(5)},${start[1].toFixed(5)}`;
  const d = `${end[0].toFixed(5)},${end[1].toFixed(5)}`;
  const url = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${o};${d}`
  );
  url.searchParams.set("access_token", accessToken);
  if (opts.alternatives) url.searchParams.set("alternatives", "true");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("overview", opts.includeDetails === false ? "simplified" : "full");
  url.searchParams.set("steps", opts.includeDetails === false ? "false" : "true");
  if (opts.includeDetails !== false) {
    url.searchParams.set("annotations", "closure");
  }
  const exclude = directionsExcludeParam(opts);
  if (exclude) url.searchParams.set("exclude", exclude);

  let lastHttp: { res: Response; data: DirectionsResponse } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const res = await fetchWithTimeout({
        input: url.toString(),
        init: { method: "GET" },
        timeoutMs: MAPBOX_DIRECTIONS_TIMEOUT_MS,
        externalSignal: signal,
      });
      const data = (await res.json()) as DirectionsResponse;
      if (!res.ok || (data.code && data.code !== "Ok")) {
        lastHttp = { res, data };
        if (attempt === 0 && isRetryableHttpStatus(res.status)) {
          await new Promise<void>((r) => setTimeout(r, 550));
          continue;
        }
        throw mapboxDirectionsErrorFromResponse(res, data);
      }
      return data;
    } catch (e) {
      if (isAbortError(e) || isFetchTimeoutError(e)) throw e;
      if (attempt === 0 && isRetryableFetchError(e)) {
        await new Promise<void>((r) => setTimeout(r, 550));
        continue;
      }
      throw e;
    }
  }
  if (lastHttp) throw mapboxDirectionsErrorFromResponse(lastHttp.res, lastHttp.data);
  throw new Error("Mapbox Directions: request failed");
}

/** Multi-stop Directions request (`start;via;…;end`). Single route — used for storm waypoint legs. */
async function fetchMapboxDirectionsThrough(
  accessToken: string,
  coords: LngLat[],
  opts: DirectionsFetchOpts,
  signal?: AbortSignal
): Promise<DirectionsResponse> {
  if (coords.length < 2) throw new Error("Mapbox Directions: need at least two coordinates");
  const coordStr = coords.map((c) => `${c[0].toFixed(5)},${c[1].toFixed(5)}`).join(";");
  const url = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coordStr}`
  );
  url.searchParams.set("access_token", accessToken);
  if (opts.alternatives) url.searchParams.set("alternatives", "true");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("overview", opts.includeDetails === false ? "simplified" : "full");
  url.searchParams.set("steps", opts.includeDetails === false ? "false" : "true");
  if (opts.includeDetails !== false) {
    url.searchParams.set("annotations", "closure");
  }
  const exclude = directionsExcludeParam(opts);
  if (exclude) url.searchParams.set("exclude", exclude);

  let lastHttp: { res: Response; data: DirectionsResponse } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const res = await fetchWithTimeout({
        input: url.toString(),
        init: { method: "GET" },
        timeoutMs: MAPBOX_DIRECTIONS_TIMEOUT_MS,
        externalSignal: signal,
      });
      const data = (await res.json()) as DirectionsResponse;
      if (!res.ok || (data.code && data.code !== "Ok")) {
        lastHttp = { res, data };
        if (attempt === 0 && isRetryableHttpStatus(res.status)) {
          await new Promise<void>((r) => setTimeout(r, 550));
          continue;
        }
        throw mapboxDirectionsErrorFromResponse(res, data);
      }
      return data;
    } catch (e) {
      if (isAbortError(e) || isFetchTimeoutError(e)) throw e;
      if (attempt === 0 && isRetryableFetchError(e)) {
        await new Promise<void>((r) => setTimeout(r, 550));
        continue;
      }
      throw e;
    }
  }
  if (lastHttp) throw mapboxDirectionsErrorFromResponse(lastHttp.res, lastHttp.data);
  throw new Error("Mapbox Directions: request failed");
}

/**
 * Replace leg **C** (`r-c`) with a storm‑safer polyline: try multiple lateral waypoints (NWS-informed plus
 * generic bypass offsets), fetch Directions for each, then prefer the path whose RainViewer mosaic echo
 * peak along the polyline is lowest (warm reds rank highest). Falls back to first successful polygon
 * waypoint when tiles are unavailable.
 */
async function finalizeStormAvoidanceThirdLeg(
  accessToken: string,
  start: LngLat,
  end: LngLat,
  routes: NavRoute[],
  stormAlerts: NormalizedWeatherAlert[] | undefined,
  radarAvoidanceEnabled: boolean,
  signal: AbortSignal | undefined,
  preferThreeRoutes: boolean,
  includeDetails: boolean
): Promise<NavRoute[]> {
  if (!preferThreeRoutes || routes.length < 2) return routes;

  const polygonWps =
    stormAlerts?.length ? computeStormAvoidanceWaypointVariants(start, end, stormAlerts) : [];

  let tileTemplate: string | null = null;
  if (polygonWps.length > 0 || radarAvoidanceEnabled) {
    tileTemplate = await rainViewerPrecipTileUrlTemplate().catch(() => null);
    if (signal?.aborted) return routes;
  }

  let precipAlongPrimary = 0;
  const primaryGeom = routes[0]?.geometry;
  if (tileTemplate && primaryGeom && primaryGeom.length >= 2) {
    precipAlongPrimary = await sampleRadarMosaicMaxAlongPolyline(primaryGeom, tileTemplate, signal);
    if (signal?.aborted) return routes;
  }

  const strongPrecipOnPrimary =
    tileTemplate != null && precipAlongPrimary >= RADAR_PRIMARY_PRECIP_GATE;

  let waypointCandidates = [...polygonWps];
  if (
    waypointCandidates.length < 8 &&
    (polygonWps.length > 0 || (radarAvoidanceEnabled && strongPrecipOnPrimary))
  ) {
    waypointCandidates.push(...computeRadarBypassWaypointCandidates(start, end));
  }
  waypointCandidates = dedupeWaypointCandidates(waypointCandidates, 2500).slice(0, 8);

  if (!waypointCandidates.length) return routes;

  const primaryEta = routes[0]!.baseEtaMinutes;
  const tieRadar = tileTemplate != null;

  let bestRoute: NavRoute | null = null;
  let bestRadarMax = Number.POSITIVE_INFINITY;
  let bestEta = Number.POSITIVE_INFINITY;

  for (const wp of waypointCandidates) {
    if (signal?.aborted) return routes;

    let data: DirectionsResponse;
    try {
      data = await fetchMapboxDirectionsThrough(
        accessToken,
        [start, wp, end],
        { alternatives: false, excludeMotorway: false, includeDetails },
        signal
      );
    } catch {
      continue;
    }

    const raw = sortRoutesByDurationAsc(data.routes ?? [])[0];
    if (!raw?.geometry?.coordinates?.length) continue;

    const navStorm = routeFromDirectionsApi(raw, "r-c", "balanced", "Storm safer");
    if (!navStorm) continue;

    if (
      primaryEta > 0 &&
      navStorm.baseEtaMinutes > primaryEta * STORM_AVOIDANCE_MAX_ETA_FACTOR
    ) {
      continue;
    }

    let duplicateShape = false;
    for (const existing of routes) {
      if (sameRouteShapeLine(navStorm.geometry, existing.geometry)) {
        duplicateShape = true;
        break;
      }
    }
    if (duplicateShape) continue;

    let radarMax = 0;
    if (tieRadar && navStorm.geometry?.length) {
      radarMax = await sampleRadarMosaicMaxAlongPolyline(navStorm.geometry, tileTemplate!, signal);
      if (signal?.aborted) return routes;
    }

    if (!tieRadar) {
      bestRoute = navStorm;
      break;
    }

    const better =
      radarMax < bestRadarMax - 1e-9 ||
      (Math.abs(radarMax - bestRadarMax) < 1e-9 && navStorm.baseEtaMinutes < bestEta - 1e-9);

    if (better) {
      bestRoute = navStorm;
      bestRadarMax = radarMax;
      bestEta = navStorm.baseEtaMinutes;
    }
  }

  if (!bestRoute) return routes;

  const navStorm = bestRoute;

  const out = [...routes];
  if (out.length >= 3) {
    out[2] = navStorm;
  } else if (out.length === 2) {
    out.push(navStorm);
  }
  return out;
}

function sortRoutesByDurationAsc(
  routes: NonNullable<DirectionsResponse["routes"]>
): NonNullable<DirectionsResponse["routes"]> {
  return [...routes]
    .filter((r) => r.geometry?.coordinates?.length && r.duration != null && Number.isFinite(r.duration))
    .sort((a, b) => (a.duration ?? 0) - (b.duration ?? 0));
}

function maxGeometryIndexInLeg(leg: {
  steps?: { intersections?: { geometry_index?: number }[] }[];
}): number | null {
  let max = -1;
  for (const step of leg.steps ?? []) {
    for (const ix of step.intersections ?? []) {
      const g = ix.geometry_index;
      if (typeof g === "number" && g > max) max = g;
    }
  }
  return max >= 0 ? max : null;
}

/** Map leg-local geometry indices to indices in the full route LineString. */
function computeLegStartIndices(
  legs: NonNullable<NonNullable<DirectionsResponse["routes"]>[0]["legs"]>
): number[] | null {
  if (legs.length <= 1) return [0];
  const starts: number[] = [0];
  for (let i = 0; i < legs.length - 1; i++) {
    const mx = maxGeometryIndexInLeg(legs[i]!);
    if (mx == null) return null;
    starts.push(starts[i]! + mx);
  }
  return starts;
}

function alongForIncident(
  geometry: LngLat[],
  legIndex: number,
  legStarts: number[] | null,
  inc: MbIncident
): number | undefined {
  const { south, north, west, east } = inc;
  if (
    typeof south === "number" &&
    typeof north === "number" &&
    typeof west === "number" &&
    typeof east === "number"
  ) {
    const lng = (west + east) / 2;
    const lat = (south + north) / 2;
    return closestAlongRouteMeters([lng, lat], geometry).alongMeters;
  }
  const gis = inc.geometry_index_start;
  if (typeof gis !== "number" || !geometry.length) return undefined;
  const base = legStarts?.[legIndex];
  if (base == null) return undefined;
  const vi = Math.max(0, Math.min(geometry.length - 1, base + gis));
  return cumulativeLengthToVertex(geometry, vi);
}

function firstClosureAlongMeters(
  legs: NonNullable<NonNullable<DirectionsResponse["routes"]>[0]["legs"]>,
  geometry: LngLat[],
  legStarts: number[] | null
): number | undefined {
  for (let li = 0; li < legs.length; li++) {
    const closure = legs[li]?.annotation?.closure;
    if (!closure?.length) continue;
    let base: number | undefined;
    if (legStarts && legStarts[li] != null) {
      base = legStarts[li]!;
    } else if (legs.length === 1) {
      base = 0;
    } else {
      continue;
    }
    for (let s = 0; s < closure.length; s++) {
      if (closure[s]) {
        const vi = Math.max(0, Math.min(geometry.length - 1, base + s));
        return cumulativeLengthToVertex(geometry, vi);
      }
    }
  }
  return undefined;
}

function collectRouteNoticesWithAlong(
  route: NonNullable<DirectionsResponse["routes"]>[0],
  geometry: LngLat[]
): { texts: string[]; alongMeters: (number | undefined)[] } {
  const texts: string[] = [];
  const alongMeters: (number | undefined)[] = [];
  const push = (text: string, along?: number) => {
    texts.push(text);
    alongMeters.push(along);
  };

  const legs = route.legs ?? [];
  const legStarts = computeLegStartIndices(legs);

  const hasClosure = legs.some((l) => l.annotation?.closure?.some((c) => c === true));
  if (hasClosure) {
    push(
      "Road closure on this route — check for detours or construction.",
      firstClosureAlongMeters(legs, geometry, legStarts)
    );
  }

  const seen = new Set<string>();
  for (let li = 0; li < legs.length; li++) {
    for (const inc of legs[li]!.incidents ?? []) {
      const desc =
        inc.long_description?.trim() ||
        inc.description?.trim() ||
        "";
      if (!desc || seen.has(desc)) continue;
      seen.add(desc);

      const roads = inc.affected_road_names?.filter(Boolean).join(", ");
      const typeLbl = inc.type ?? "";
      const prefix =
        typeLbl === "construction"
          ? "Construction"
          : typeLbl === "accident"
            ? "Accident"
            : typeLbl === "congestion"
              ? "Congestion"
              : typeLbl === "disabled_vehicle"
                ? "Disabled vehicle"
                : typeLbl === "lane_restriction"
                  ? "Lane restriction"
                  : typeLbl === "road_closure"
                    ? "Road closure"
                    : typeLbl;

      const line = [prefix, roads ? `on ${roads}` : "", desc]
        .filter(Boolean)
        .join(" — ");
      push(line, alongForIncident(geometry, li, legStarts, inc));
    }
  }

  return { texts, alongMeters };
}

/**
 * Up to 3 traffic-aware routes from Mapbox (alternatives + optional `exclude=motorway`).
 *
 * ### Product intent (weather — not fully wired yet)
 * Storms are **soft** preferences: we surface safer paths when geometry differs, but routes must
 * stay reasonable (bounded ETA vs fastest). **Closures, incidents, and severe traffic blocks** from
 * Mapbox are **hard** barriers — Directions already biases away when annotated; we still report what’s left.
 *
 * - **A (`fastest`)** — Time-optimal among returned variants; carries full hazard / NWS / radar
 *   reporting even if it cuts through weather. Driver chooses knowingly.
 * - **B (`hazardSmart`)** — Medium-risk corridor: prefer avoiding motorways when Mapbox gives a
 *   distinct non-interstate shape; future: allow motorway **only** if modeled storm exposure drops
 *   by ~half vs staying off interstate (compare per-leg mosaic / advisory stress).
 * - **C (`balanced`)** — Among waypoint-detoured candidates within an ETA budget vs A, prefers **lower
 *   RainViewer echo intensity** along the snapped polyline (strong reds rank worst). NWS polygons seed lateral
 *   waypoint variants; generic corridor offsets fill the candidate list when mosaic shows meaningful precip.
 *
 * ### Storm / radar avoidance on leg C (`radarAvoidanceEnabled` + Plus three-route builds)
 * Leg **C** may be replaced after scoring several `start → waypoint → end` Directions results: waypoints come
 * from NWS-informed lateral offsets (`stormAvoidanceWaypoint.ts`) plus optional perpendicular bypass offsets when
 * the fastest route crosses heavy mosaic echoes and Storm mode is on.
 * ETA must stay within {@link STORM_AVOIDANCE_MAX_ETA_FACTOR} of the fastest returned leg — soft cap.
 * Mapbox still respects closures/incidents from live traffic annotations on each candidate request.
 *
 * ### Earlier behaviour (legs A/B and baseline C)
 * Roles were assigned from **duration sort + motorway exclusion + turn-density scoring**, not from
 * live storm polygons alone.
 *
 * For short in-town trips we return only A/B (speed-focused).
 *
 * ### Latency
 * Primary `alternatives=true` completes first; Plus may start `exclude=motorway` in parallel.
 */
export async function collectMapboxRouteVariants(
  accessToken: string,
  start: LngLat,
  end: LngLat,
  opts?: {
    signal?: AbortSignal;
    allowLocalTripThirdRoute?: boolean;
    preferThreeRoutes?: boolean;
    includeDetails?: boolean;
    /** Active NWS alerts near the corridor — informs lateral waypoint variants for leg C. */
    stormAlerts?: NormalizedWeatherAlert[];
    /** Plus + Storm: refine leg C using RainViewer mosaic (prefer paths that avoid strong echoes). */
    radarAvoidanceEnabled?: boolean;
    /** Primary Directions request uses `exclude=toll` (toll-free replan). */
    excludeToll?: boolean;
  }
): Promise<NavRoute[]> {
  const signal = opts?.signal;
  const stormAlerts = opts?.stormAlerts;
  const radarAvoidanceEnabled = Boolean(opts?.radarAvoidanceEnabled);
  const allowLocalTripThirdRoute = Boolean(opts?.allowLocalTripThirdRoute);
  const preferThreeRoutes = Boolean(opts?.preferThreeRoutes);
  const includeDetails = opts?.includeDetails !== false;
  const excludeToll = Boolean(opts?.excludeToll);
  const MAX_NO_TOWN_DURATION_FACTOR = 1.6;
  const LOCAL_TRIP_MAX_DISTANCE_M = 18_000;
  const LOCAL_TRIP_MAX_DURATION_S = 22 * 60;

  type MbRoutes = NonNullable<DirectionsResponse["routes"]>;
  const abortSignalAny = (
    AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }
  ).any;
  const canSpecSecondary =
    preferThreeRoutes &&
    allowLocalTripThirdRoute &&
    typeof abortSignalAny === "function";

  let secondaryAbort: AbortController | null = null;
  let secondaryP: Promise<DirectionsResponse> | null = null;
  if (canSpecSecondary) {
    secondaryAbort = new AbortController();
    const secSig = signal ? abortSignalAny([signal, secondaryAbort.signal]) : secondaryAbort.signal;
    secondaryP = fetchMapboxDirections(
      accessToken,
      start,
      end,
      { alternatives: true, excludeMotorway: true, includeDetails },
      secSig
    ).catch((e) => {
      if (isAbortError(e)) return { routes: [] as MbRoutes };
      return { routes: [] as MbRoutes };
    });
  }

  const primaryData = await fetchMapboxDirections(accessToken, start, end, {
    alternatives: true,
    excludeMotorway: false,
    excludeToll,
    includeDetails,
  }, signal);

  const primarySorted = sortRoutesByDurationAsc(primaryData.routes ?? []);

  const targetPrimaryCount = preferThreeRoutes ? 3 : 2;
  const primaryOnly = primarySorted
    .slice(0, targetPrimaryCount)
    .map((r, i) =>
      routeFromDirectionsApi(
        r,
        `r-${String.fromCharCode(97 + i)}`,
        i === 0 ? "fastest" : i === 1 ? "hazardSmart" : "balanced",
        i === 0 ? "Main" : i === 1 ? "Alternate" : "Third route"
      )
    )
    .filter((r): r is NavRoute => r != null);
  /*
   * First paint wins: if Mapbox already gave enough alternatives in the primary call, return them.
   * Do not block route view on no-motorway / no-town refinement; traffic/weather/enrichment happens later.
   */
  if (primaryOnly.length >= targetPrimaryCount) {
    secondaryAbort?.abort();
    return finalizeStormAvoidanceThirdLeg(
      accessToken,
      start,
      end,
      primaryOnly,
      stormAlerts,
      radarAvoidanceEnabled,
      signal,
      preferThreeRoutes,
      includeDetails
    );
  }

  const mergePools = (
    noMwSorted: NonNullable<DirectionsResponse["routes"]>
  ): NavRoute[] => {
    const out: NavRoute[] = [];

    const aRaw = primarySorted[0];
    if (!aRaw) return [];

    const navA = routeFromDirectionsApi(aRaw, "r-a", "fastest", "Main");
    if (!navA) return [];
    out.push(navA);

    const bRaw =
      noMwSorted.find((r) => {
        const c = r.geometry?.coordinates;
        if (!c?.length) return false;
        const gLight = coordsToLightLine(c, GEOM_COMPARE_MAX_VERTICES);
        return !sameRouteShapeLine(gLight, navA.geometry);
      }) ?? primarySorted[1];

    if (bRaw) {
      const navB = routeFromDirectionsApi(bRaw, "r-b", "hazardSmart", "No interstate");
      if (navB && !sameRouteShapeLine(navB.geometry, navA.geometry)) {
        out.push(navB);
      }
    }

    const mergedRaw = [...primarySorted, ...noMwSorted];
    const usedForDistinct: LngLat[][] = [navA.geometry];
    if (out[1]) usedForDistinct.push(out[1].geometry);

    const noTownMaxDur = (aRaw.duration ?? 0) * MAX_NO_TOWN_DURATION_FACTOR;
    const routeStepCount = (r: NonNullable<DirectionsResponse["routes"]>[0]): number =>
      (r.legs ?? []).reduce((n, leg) => n + (leg.steps?.length ?? 0), 0);
    const turnDensityPerKm = (r: NonNullable<DirectionsResponse["routes"]>[0]): number => {
      const km = Math.max(0.6, (r.distance ?? 0) / 1000);
      return routeStepCount(r) / km;
    };
    const durationFactor = (r: NonNullable<DirectionsResponse["routes"]>[0]): number => {
      const aDur = Math.max(1, aRaw.duration ?? 1);
      return Math.max(1, (r.duration ?? aDur) / aDur);
    };
    const noTownScore = (r: NonNullable<DirectionsResponse["routes"]>[0]): number =>
      turnDensityPerKm(r) * 0.78 + durationFactor(r) * 0.22;

    const cRaw = [...mergedRaw]
      .filter((r) => {
        if (typeof r.duration === "number" && noTownMaxDur > 0 && r.duration > noTownMaxDur) return false;
        const c = r.geometry?.coordinates;
        if (!c?.length) return false;
        const gLight = coordsToLightLine(c, GEOM_COMPARE_MAX_VERTICES);
        return !usedForDistinct.some((ug) => sameRouteShapeLine(ug, gLight));
      })
      .sort((x, y) => noTownScore(x) - noTownScore(y))[0];

    if (cRaw) {
      const navC = routeFromDirectionsApi(cRaw, "r-c", "balanced", "No town");
      if (navC && !out.some((existing) => sameRouteShapeLine(existing.geometry, navC.geometry))) {
        out.push(navC);
      }
    }

    return out;
  };

  /* Fast path: alternates in the first response often yield 2–3 routes with zero extra HTTP. */
  let out = mergePools([]);
  const straightLineM = haversineMeters(start, end);
  const aDurationS = primarySorted[0]?.duration ?? Number.POSITIVE_INFINITY;
  const localTrip = straightLineM <= LOCAL_TRIP_MAX_DISTANCE_M || aDurationS <= LOCAL_TRIP_MAX_DURATION_S;
  if (localTrip && !allowLocalTripThirdRoute) {
    secondaryAbort?.abort();
    const sliced = out.slice(0, Math.min(2, out.length));
    return finalizeStormAvoidanceThirdLeg(
      accessToken,
      start,
      end,
      sliced,
      stormAlerts,
      radarAvoidanceEnabled,
      signal,
      preferThreeRoutes,
      includeDetails
    );
  }
  if (out.length >= 2 && (!preferThreeRoutes || out.length >= 3)) {
    secondaryAbort?.abort();
    return finalizeStormAvoidanceThirdLeg(
      accessToken,
      start,
      end,
      out,
      stormAlerts,
      radarAvoidanceEnabled,
      signal,
      preferThreeRoutes,
      includeDetails
    );
  }

  /* Rare: only one drivable path in the first response — merge no-motorway variants to split B/C. */
  let noMwSorted: MbRoutes = [];
  try {
    if (secondaryP) {
      const noMwData = await secondaryP;
      noMwSorted = sortRoutesByDurationAsc(noMwData.routes ?? []);
    } else {
      const noMwData = await fetchMapboxDirections(accessToken, start, end, {
        alternatives: true,
        excludeMotorway: true,
        includeDetails,
      }, signal);
      noMwSorted = sortRoutesByDurationAsc(noMwData.routes ?? []);
    }
  } catch {
    /* keep empty — return whatever merge produced */
  }

  out = mergePools(noMwSorted);
  return finalizeStormAvoidanceThirdLeg(
    accessToken,
    start,
    end,
    out,
    stormAlerts,
    radarAvoidanceEnabled,
    signal,
    preferThreeRoutes,
    includeDetails
  );
}

export type BuildTripFromMapboxResult = {
  plan: TripPlan;
  routeDestination: LngLat;
  routeStart: LngLat;
  snapNotice?: string;
};

/**
 * Build A/B/C trip from Mapbox Directions (same `TripPlan` shape as the mock router).
 */
export async function buildTripFromMapbox(
  accessToken: string,
  start: LngLat,
  end: LngLat,
  labels: { origin: string; destination: string } = {
    origin: "Start",
    destination: "Destination",
  },
  opts?: {
    signal?: AbortSignal;
    allowLocalTripThirdRoute?: boolean;
    preferThreeRoutes?: boolean;
    includeDetails?: boolean;
    stormAlerts?: NormalizedWeatherAlert[];
    radarAvoidanceEnabled?: boolean;
    excludeToll?: boolean;
  }
): Promise<BuildTripFromMapboxResult> {
  const routes = await collectMapboxRouteVariants(accessToken, start, end, opts);

  if (routes.length === 0) {
    throw new Error(
      "Could not build a driving route — try a point closer to a public road."
    );
  }

  return {
    plan: {
      originLabel: labels.origin,
      destinationLabel: labels.destination,
      routes,
    },
    routeDestination: end,
    routeStart: start,
  };
}
