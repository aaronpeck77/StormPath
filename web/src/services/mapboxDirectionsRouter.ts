import {
  DRIVE_FORWARD_BEARING_TOLERANCE_DEG,
  pickBestForwardRoute,
} from "../nav/forwardRoutePick";
import type { LngLat, MapboxRouteIncident, NavRoute, PostedSpeedSample, RouteTurnStep, TripPlan } from "../nav/types";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";
import { detectRouteTollsFromLegs } from "../nav/detectRouteTolls";
import {
  closestAlongRouteMeters,
  cumulativeLengthToVertex,
  estimateRoadDistanceM,
  normalizeStoredRouteGeometry,
  routeCorridorOverlapFraction,
  routesEffectivelySame,
  subsamplePolylineVertexBudget,
} from "../nav/routeGeometry";
import {
  dedupePostedSpeedSamples,
  mapboxMaxSpeedToMph,
} from "../nav/postedSpeed";
import { isUltraLongTripRoute } from "../utils/dataSaver";
import { parseExitNumberFromStep, shortenTurnInstruction } from "../nav/turnInstructionShort";
import {
  loadActivitySamples,
  type ActivitySample,
} from "../frequentRoutes/activitySamples";
import {
  routeTrailOverlapScore,
  TRAIL_ROUTE_MIN_OVERLAP,
} from "../frequentRoutes/trailRouteOverlap";
import {
  fetchWithTimeout,
  isAbortError,
  isFetchTimeoutError,
  isRetryableFetchError,
  isRetryableHttpStatus,
  MAPBOX_DIRECTIONS_TIMEOUT_MS,
} from "../utils/fetchResilient";

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
        geometry?: { type?: string; coordinates?: MbCoord[] };
        maneuver?: {
          instruction?: string;
          type?: string;
          modifier?: string;
          /** Roundabout / rotary exit index when present */
          exit?: number | string;
        };
        name?: string;
        /** Road number per Mapbox (e.g. I 72, US 36) — prefer over long `name` for shields. */
        ref?: string;
        /** Exit number(s) or names — when Mapbox has them */
        exits?: string;
        /** Highway destination signs (e.g. "Springfield") */
        destinations?: string;
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
        maxspeed?: unknown[];
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
  /** Mapbox `overview=simplified` — fewer vertices on cross-country legs. */
  simplifiedOverview?: boolean;
  /** Start-point heading (degrees) for `bearings=` when replanning from GPS. */
  bearingDeg?: number | null;
  /** Mapbox bearing tolerance (degrees); default 45. */
  bearingToleranceDeg?: number;
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
      const mv = step.maneuver;
      const exits = typeof step.exits === "string" ? step.exits : undefined;
      const destinations = typeof step.destinations === "string" ? step.destinations : undefined;
      const exitNumber =
        parseExitNumberFromStep(rawInstr, exits, mv?.exit) ?? undefined;
      const instr = shortenTurnInstruction(rawInstr, name, ref, {
        exits,
        maneuverExit: mv?.exit,
        destinations,
        maneuverType: typeof mv?.type === "string" ? mv.type : undefined,
      });
      out.push({
        instruction: instr,
        distanceM: typeof step.distance === "number" ? step.distance : undefined,
        maneuverType: typeof mv?.type === "string" ? mv.type : undefined,
        maneuverModifier: typeof mv?.modifier === "string" ? mv.modifier : undefined,
        exitNumber,
      });
    }
  }
  if (out.length === 0) {
    out.push({ instruction: "Follow line to destination" });
  }
  return out;
}

/** O(200) per side — corridor overlap / same-shape checks only (not map display). */
const GEOM_COMPARE_MAX_VERTICES = 200;

/**
 * True when two Mapbox options are too alike to offer as A/B.
 * Prefer keeping Mapbox alternates: shared highway legs are OK if ETA or distance
 * meaningfully differs, or if corridor overlap is not near-identical.
 */
function routesTooSimilarForAlternate(
  aLine: LngLat[],
  bLine: LngLat[],
  aDurS: number | null | undefined,
  bDurS: number | null | undefined,
  aDistM: number | null | undefined,
  bDistM: number | null | undefined
): boolean {
  const aDur = typeof aDurS === "number" && Number.isFinite(aDurS) ? aDurS : null;
  const bDur = typeof bDurS === "number" && Number.isFinite(bDurS) ? bDurS : null;
  if (aDur != null && bDur != null && aDur > 0) {
    const dAbs = Math.abs(aDur - bDur);
    const dRel = dAbs / aDur;
    if (dAbs >= 90 || dRel >= 0.05) return false;
  }
  const aDist = typeof aDistM === "number" && Number.isFinite(aDistM) ? aDistM : null;
  const bDist = typeof bDistM === "number" && Number.isFinite(bDistM) ? bDistM : null;
  if (aDist != null && bDist != null && aDist > 0) {
    const dAbs = Math.abs(aDist - bDist);
    const dRel = dAbs / aDist;
    if (dAbs >= 800 || dRel >= 0.05) return false;
  }
  return routesEffectivelySame(aLine, bLine, 0.97);
}

function sameRouteShapeLine(a: LngLat[], b: LngLat[]): boolean {
  const aLite =
    a.length > GEOM_COMPARE_MAX_VERTICES
      ? subsamplePolylineVertexBudget(a, GEOM_COMPARE_MAX_VERTICES)
      : a;
  const bLite =
    b.length > GEOM_COMPARE_MAX_VERTICES
      ? subsamplePolylineVertexBudget(b, GEOM_COMPARE_MAX_VERTICES)
      : b;
  return routesEffectivelySame(aLite, bLite);
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

type MbRoute = NonNullable<DirectionsResponse["routes"]>[number];

function mbRouteLightLine(r: MbRoute): LngLat[] | null {
  const c = r.geometry?.coordinates;
  if (!c?.length) return null;
  return coordsToLightLine(c, GEOM_COMPARE_MAX_VERTICES);
}

function pickMbRouteByTrail(
  candidates: MbRoute[],
  samples: ActivitySample[],
  excludeLines: LngLat[][] = []
): MbRoute | undefined {
  let best: MbRoute | undefined;
  let bestScore = -1;
  for (const r of candidates) {
    const line = mbRouteLightLine(r);
    if (!line || line.length < 2) continue;
    if (excludeLines.some((ex) => sameRouteShapeLine(ex, line))) continue;
    const score = routeTrailOverlapScore(line, samples);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return bestScore >= TRAIL_ROUTE_MIN_OVERLAP ? best : undefined;
}

function appendLineCoords(out: LngLat[], coords: MbCoord[]): void {
  for (const c of coords) {
    const lng = c[0];
    const lat = c[1];
    if (lng == null || lat == null || !Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const pt: LngLat = [lng, lat];
    const prev = out[out.length - 1];
    if (prev && prev[0] === pt[0] && prev[1] === pt[1]) continue;
    out.push(pt);
  }
}

/** Step-level Mapbox geometries follow the road graph; overview polylines can chord across curves. */
export function geometryFromDirectionsSteps(r: MbRoute): LngLat[] | null {
  const out: LngLat[] = [];
  for (const leg of r.legs ?? []) {
    for (const step of leg.steps ?? []) {
      const geom = step.geometry;
      const coords = geom?.coordinates;
      if (geom?.type !== "LineString" || !coords?.length) continue;
      appendLineCoords(out, coords);
    }
  }
  return out.length >= 2 ? out : null;
}

function buildPostedSpeedSamples(
  legs: NonNullable<NonNullable<DirectionsResponse["routes"]>[0]["legs"]>,
  geometry: LngLat[],
  legStarts: number[] | null
): PostedSpeedSample[] | undefined {
  const raw: PostedSpeedSample[] = [];
  for (let li = 0; li < legs.length; li++) {
    const maxspeed = legs[li]?.annotation?.maxspeed;
    if (!maxspeed?.length) continue;
    let base: number | undefined;
    if (legStarts && legStarts[li] != null) {
      base = legStarts[li]!;
    } else if (legs.length === 1) {
      base = 0;
    } else {
      continue;
    }
    for (let s = 0; s < maxspeed.length; s++) {
      const mph = mapboxMaxSpeedToMph(maxspeed[s]);
      if (mph == null) continue;
      const vi = Math.max(0, Math.min(geometry.length - 1, base + s));
      raw.push({ alongMeters: cumulativeLengthToVertex(geometry, vi), mph });
    }
  }
  if (!raw.length) return undefined;
  raw.sort((a, b) => a.alongMeters - b.alongMeters);
  const deduped = dedupePostedSpeedSamples(raw);
  return deduped.length ? deduped : undefined;
}

function routeFromDirectionsApi(
  r: NonNullable<DirectionsResponse["routes"]>[0],
  id: string,
  role: NavRoute["role"],
  label: string,
  opts?: { skipGeometryNormalize?: boolean }
): NavRoute | null {
  const coords = r.geometry?.coordinates;
  if (!coords?.length || r.geometry?.type !== "LineString") return null;
  const overview = coords.map(([lng, lat]) => [lng, lat] as LngLat);
  const rawGeometry = geometryFromDirectionsSteps(r) ?? overview;
  const legs = r.legs ?? [];
  const legStarts = computeLegStartIndices(legs);
  const postedSpeedSamples = buildPostedSpeedSamples(legs, rawGeometry, legStarts);
  const geometry = opts?.skipGeometryNormalize
    ? rawGeometry
    : normalizeStoredRouteGeometry(rawGeometry);
  const durSec = r.duration;
  if (durSec == null || !Number.isFinite(durSec)) return null;

  const { texts: notices, alongMeters: noticeAlong, incidents: mapboxIncidents } =
    collectRouteIncidentsWithAlong(r, geometry);
  const tollInfo = detectRouteTollsFromLegs(r.legs);

  return {
    id,
    role,
    label,
    geometry,
    baseEtaMinutes: Math.max(1, durSec / 60),
    turnSteps: parseSteps(r),
    routeNotices: notices.length ? notices : undefined,
    routeNoticeAlongMeters: notices.length ? noticeAlong : undefined,
    mapboxIncidents: mapboxIncidents.length ? mapboxIncidents : undefined,
    hasTolls: tollInfo.hasTolls || undefined,
    tollLabels: tollInfo.tollLabels.length ? tollInfo.tollLabels : undefined,
    postedSpeedSamples,
  };
}

function applyDirectionsQueryParams(url: URL, opts: DirectionsFetchOpts): void {
  if (opts.alternatives) url.searchParams.set("alternatives", "true");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set(
    "overview",
    opts.simplifiedOverview || opts.includeDetails === false ? "simplified" : "full"
  );
  url.searchParams.set("steps", opts.includeDetails === false ? "false" : "true");
  if (opts.includeDetails !== false) {
    url.searchParams.set("annotations", "closure,maxspeed");
  }
  const exclude = directionsExcludeParam(opts);
  if (exclude) url.searchParams.set("exclude", exclude);
  if (opts.bearingDeg != null && Number.isFinite(opts.bearingDeg)) {
    const tol = Math.round(opts.bearingToleranceDeg ?? 45);
    url.searchParams.set("bearings", `${Math.round(opts.bearingDeg)},${tol};`);
    url.searchParams.set("approaches", "curb;");
  }
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
  applyDirectionsQueryParams(url, opts);

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
  applyDirectionsQueryParams(url, opts);

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

function incidentTypeLabel(typeLbl: string): string {
  switch (typeLbl) {
    case "construction":
      return "Construction";
    case "accident":
      return "Accident";
    case "congestion":
      return "Congestion";
    case "disabled_vehicle":
      return "Disabled vehicle";
    case "lane_restriction":
      return "Lane restriction";
    case "road_closure":
      return "Road closure";
    default:
      return typeLbl ? typeLbl.replace(/_/g, " ") : "Incident";
  }
}

function formatIncidentNotice(inc: MapboxRouteIncident): string {
  const prefix = incidentTypeLabel(inc.type);
  const impact =
    inc.impact && inc.impact !== "unknown"
      ? ` (${inc.impact} impact)`
      : "";
  const roads = inc.affectedRoadNames?.filter(Boolean).join(", ");
  const lanes =
    inc.numLanesBlocked != null && inc.numLanesBlocked > 0
      ? ` — ${inc.numLanesBlocked} lane${inc.numLanesBlocked === 1 ? "" : "s"} blocked`
      : inc.lanesBlocked?.length
        ? ` — ${inc.lanesBlocked.join(", ")} blocked`
        : "";
  return [prefix + impact, roads ? `on ${roads}` : "", inc.description, lanes]
    .filter(Boolean)
    .join(" — ");
}

function collectRouteIncidentsWithAlong(
  route: NonNullable<DirectionsResponse["routes"]>[0],
  geometry: LngLat[]
): { incidents: MapboxRouteIncident[]; texts: string[]; alongMeters: (number | undefined)[] } {
  const incidents: MapboxRouteIncident[] = [];
  const texts: string[] = [];
  const alongMeters: (number | undefined)[] = [];
  const push = (inc: MapboxRouteIncident) => {
    incidents.push(inc);
    texts.push(formatIncidentNotice(inc));
    alongMeters.push(inc.alongMeters);
  };

  const legs = route.legs ?? [];
  const legStarts = computeLegStartIndices(legs);

  const hasClosure = legs.some((l) => l.annotation?.closure?.some((c) => c === true));
  if (hasClosure) {
    push({
      type: "road_closure",
      impact: "major",
      description: "Road closure on this route — check for detours or construction.",
      alongMeters: firstClosureAlongMeters(legs, geometry, legStarts),
    });
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

      const typeLbl = inc.type ?? "";
      const roads = inc.affected_road_names?.filter(Boolean);
      const structured: MapboxRouteIncident = {
        type: typeLbl || "incident",
        impact: typeof inc.impact === "string" ? inc.impact : undefined,
        description: desc,
        alongMeters: alongForIncident(geometry, li, legStarts, inc),
        affectedRoadNames: roads?.length ? roads : undefined,
        numLanesBlocked:
          typeof inc.num_lanes_blocked === "number" ? inc.num_lanes_blocked : undefined,
        lanesBlocked: inc.lanes_blocked?.filter(Boolean),
      };
      push(structured);
    }
  }

  return { incidents, texts, alongMeters };
}

/**
 * Up to 2 traffic-aware routes from Mapbox (alternatives + `exclude=motorway`).
 *
 * - **A (`fastest`)** — Main · fastest (may use interstates).
 * - **B (`hazardSmart`)** — No interstate · Mapbox `exclude=motorway` when a distinct shape exists.
 *
 * Cap via `maxRoutes`: Basic = 1 (single Directions call), Plus = 2 (primary + no-interstate).
 * Ultra-long stays Main-only.
 *
 * Primary `alternatives=true` runs in parallel with `exclude=motorway` when `maxRoutes >= 2`.
 */
async function fetchDirectionsPrimary(
  accessToken: string,
  start: LngLat,
  end: LngLat,
  via: LngLat[] | undefined,
  opts: DirectionsFetchOpts,
  signal?: AbortSignal
): Promise<DirectionsResponse> {
  if (via?.length) {
    return fetchMapboxDirectionsThrough(accessToken, [start, ...via, end], opts, signal);
  }
  return fetchMapboxDirections(accessToken, start, end, opts, signal);
}

export async function collectMapboxRouteVariants(
  accessToken: string,
  start: LngLat,
  end: LngLat,
  opts?: {
    signal?: AbortSignal;
    /** Intermediate stops between start and end (Mapbox via points). */
    via?: LngLat[];
    /**
     * Max legs to return / fetch for.
     * `1` = Main only (one Directions call). `2` = A/B (primary + no-interstate).
     * `3` reserved for legacy Country drive — unused while Plus is capped at 2.
     */
    maxRoutes?: number;
    allowLocalTripThirdRoute?: boolean;
    preferThreeRoutes?: boolean;
    includeDetails?: boolean;
    /** Reserved — storm alerts no longer reshape leg C (Country drive uses Mapbox backroads). */
    stormAlerts?: NormalizedWeatherAlert[];
    /** Reserved — radar no longer reshapes leg C. */
    radarAvoidanceEnabled?: boolean;
    /** Primary Directions request uses `exclude=toll` (toll-free replan). */
    excludeToll?: boolean;
    /** Plus + learn: prefer alternates that overlap the on-device activity trail. */
    trailRoutePersonalization?: boolean;
    /** Navigation snap / stay-on-road: one route from GPS; optional backroads when learn is on. */
    singleRouteFromPosition?: boolean;
    /** With singleRouteFromPosition: avoid motorways (country-road preference). */
    preferBackroads?: boolean;
    /** With singleRouteFromPosition: constrain start heading (reduces spurious U-turn replans). */
    bearingDeg?: number | null;
    /** Prefer fastest route that departs in front of the driver (not an immediate U-turn). */
    forwardFirst?: boolean;
    /** Skip storm/radar leg-C refinement (fast first paint; refine in background). */
    skipStormLegRefinement?: boolean;
    /** Off-route rejoin shuffle — odd passes prefer motorway-excluded alternates for different B/C. */
    rejoinShufflePass?: number;
  }
): Promise<NavRoute[]> {
  const signal = opts?.signal;
  const via = opts?.via?.filter((c) => c?.length === 2) ?? [];
  const hasVia = via.length > 0;
  const allowLocalTripThirdRoute = Boolean(opts?.allowLocalTripThirdRoute);
  const preferThreeRoutes = Boolean(opts?.preferThreeRoutes);
  const includeDetails = opts?.includeDetails !== false;
  const excludeToll = Boolean(opts?.excludeToll);
  const trailSamples: ActivitySample[] | null = opts?.trailRoutePersonalization
    ? loadActivitySamples()
    : null;
  const shuffleMotorways = (opts?.rejoinShufflePass ?? 0) % 2 === 1;

  const estTripM = estimateRoadDistanceM(start, end, hasVia ? via : undefined);
  const ultraLongTrip = isUltraLongTripRoute(estTripM);
  /**
   * Quota-aware caps: Basic = 1 Directions call, Plus = A/B (2 calls).
   * Legacy preferThreeRoutes still maps to 3 when maxRoutes is omitted.
   */
  const maxRoutes = Math.max(
    1,
    Math.min(
      3,
      Math.floor(
        opts?.maxRoutes ??
          (preferThreeRoutes || allowLocalTripThirdRoute ? 3 : 2)
      )
    )
  );
  const wantMultiRoute = !ultraLongTrip && maxRoutes >= 2;
  const effectivePreferThree = wantMultiRoute && maxRoutes >= 3;
  const effectiveAllowThird = effectivePreferThree && allowLocalTripThirdRoute;
  /** Always request full Mapbox geometry — simplified overview cuts corners off the road network. */
  const simplifiedOverview = false;

  if (opts?.singleRouteFromPosition) {
    const bearing =
      opts.bearingDeg != null && Number.isFinite(opts.bearingDeg) ? opts.bearingDeg : null;
    const forwardFirst = Boolean(opts.forwardFirst && bearing != null);
    const data = await fetchDirectionsPrimary(
      accessToken,
      start,
      end,
      hasVia ? via : undefined,
      {
        alternatives: forwardFirst,
        excludeMotorway: Boolean(opts.preferBackroads),
        excludeToll,
        includeDetails,
        simplifiedOverview,
        bearingDeg: bearing,
        bearingToleranceDeg: forwardFirst ? DRIVE_FORWARD_BEARING_TOLERANCE_DEG : undefined,
      },
      signal
    );
    const sorted = sortRoutesByDurationAsc(data.routes ?? []);
    const navRoutes: NavRoute[] = [];
    for (const raw of sorted) {
      const nav = routeFromDirectionsApi(raw, "r-a", "fastest", "Main", {
        skipGeometryNormalize: true,
      });
      if (nav) navRoutes.push(nav);
    }
    if (!navRoutes.length) return [];
    const picked = forwardFirst
      ? pickBestForwardRoute(navRoutes, start, bearing) ?? navRoutes[0]!
      : navRoutes[0]!;
    return [picked];
  }

  /** Leg C should stay a reasonable drive — not a long scenic detour. */
  const MAX_C_ROUTE_DURATION_FACTOR = 1.3;
  const MAX_C_ROUTE_DISTANCE_FACTOR = 1.35;

  type MbRoutes = NonNullable<DirectionsResponse["routes"]>;
  const abortSignalAny = (
    AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }
  ).any;

  let secondaryAbort: AbortController | null = null;
  let secondaryP: Promise<DirectionsResponse> | null = null;
  /** Always fetch no-interstate in parallel on normal trips — this is often the only distinct B. */
  if (wantMultiRoute) {
    secondaryAbort = new AbortController();
    const secSig =
      signal && typeof abortSignalAny === "function"
        ? abortSignalAny([signal, secondaryAbort.signal])
        : secondaryAbort.signal;
    secondaryP = fetchDirectionsPrimary(
      accessToken,
      start,
      end,
      hasVia ? via : undefined,
      { alternatives: true, excludeMotorway: true, includeDetails, simplifiedOverview },
      secSig
    ).catch(() => ({ routes: [] as MbRoutes }));
  }

  const primaryData = await fetchDirectionsPrimary(
    accessToken,
    start,
    end,
    hasVia ? via : undefined,
    {
      alternatives: wantMultiRoute,
      excludeMotorway: shuffleMotorways,
      excludeToll,
      includeDetails,
      simplifiedOverview,
      bearingDeg: opts?.bearingDeg,
    },
    signal
  );

  const primarySorted = sortRoutesByDurationAsc(primaryData.routes ?? []);

  const targetPrimaryCount = maxRoutes;

  if (ultraLongTrip || maxRoutes <= 1) {
    secondaryAbort?.abort();
    const aRaw = primarySorted[0];
    if (!aRaw) return [];
    const navA = routeFromDirectionsApi(aRaw, "r-a", "fastest", "Main");
    return navA ? [navA] : [];
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

    const isPreferredAlternate = (r: MbRoute): boolean => {
      const line = mbRouteLightLine(r);
      if (!line) return false;
      return !routesTooSimilarForAlternate(
        navA.geometry,
        line,
        aRaw.duration,
        r.duration,
        aRaw.distance,
        r.distance
      );
    };

    const softNoMw = noMwSorted.filter(isPreferredAlternate);
    let bRaw: MbRoute | undefined =
      (trailSamples
        ? pickMbRouteByTrail(softNoMw, trailSamples, [navA.geometry])
        : undefined) ?? softNoMw[0];

    if (!bRaw) {
      bRaw = primarySorted.slice(1).find(isPreferredAlternate);
    }

    /**
     * Always surface a second option when Mapbox (or no-interstate) returned one.
     * Soft filters above are preferred; last resort keeps any non-identical shape so
     * the cycle control is not stuck on Main-only.
     */
    if (!bRaw) {
      bRaw =
        primarySorted.slice(1).find((r) => {
          const line = mbRouteLightLine(r);
          return Boolean(line) && !sameRouteShapeLine(line!, navA.geometry);
        }) ??
        noMwSorted.find((r) => {
          const line = mbRouteLightLine(r);
          return Boolean(line) && !sameRouteShapeLine(line!, navA.geometry);
        }) ??
        primarySorted[1] ??
        noMwSorted[0];
    }

    if (bRaw) {
      const fromNoMw = noMwSorted.includes(bRaw);
      const navB = routeFromDirectionsApi(
        bRaw,
        "r-b",
        fromNoMw ? "hazardSmart" : "balanced",
        fromNoMw ? "No interstate" : "Alternate"
      );
      if (navB) {
        const identical = sameRouteShapeLine(navA.geometry, navB.geometry);
        /* Keep Mapbox's own alternate even when corridors mostly overlap; skip true clones. */
        if (!identical || bRaw === primarySorted[1]) {
          out.push(navB);
        }
      }
    }

    if (!effectivePreferThree || !effectiveAllowThird) {
      return out;
    }

    const mergedRaw = [...primarySorted, ...noMwSorted];
    const usedForDistinct: LngLat[][] = [navA.geometry];
    if (out[1]) usedForDistinct.push(out[1].geometry);

    const cMaxDur = (aRaw.duration ?? 0) * MAX_C_ROUTE_DURATION_FACTOR;
    const aDistM = Math.max(1, aRaw.distance ?? 1);
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
    const distanceFactor = (r: NonNullable<DirectionsResponse["routes"]>[0]): number =>
      Math.max(1, (r.distance ?? aDistM) / aDistM);
    const trailBias = (r: NonNullable<DirectionsResponse["routes"]>[0]): number => {
      if (!trailSamples) return 0;
      const line = mbRouteLightLine(r);
      return line ? routeTrailOverlapScore(line, trailSamples) * 0.35 : 0;
    };
    const overlapPenalty = (line: LngLat[]): number => {
      let maxOv = 0;
      for (const ug of usedForDistinct) {
        maxOv = Math.max(maxOv, routeCorridorOverlapFraction(line, ug));
      }
      if (maxOv >= 0.93) return 2.5;
      if (maxOv >= 0.88) return 0.3;
      if (maxOv <= 0.72) return -0.1;
      return 0;
    };
    const isNoMotorwayRoute = (r: NonNullable<DirectionsResponse["routes"]>[0]): boolean =>
      noMwSorted.includes(r);
    const cPickScore = (
      r: NonNullable<DirectionsResponse["routes"]>[0],
      line: LngLat[]
    ): number =>
      durationFactor(r) * 0.38 +
      distanceFactor(r) * 0.18 +
      turnDensityPerKm(r) * 0.28 +
      overlapPenalty(line) +
      (isNoMotorwayRoute(r) ? -0.34 : 0) -
      trailBias(r);

    const cEligible = (r: NonNullable<DirectionsResponse["routes"]>[0]): boolean => {
      if (typeof r.duration === "number" && cMaxDur > 0 && r.duration > cMaxDur) return false;
      if (
        typeof r.distance === "number" &&
        aDistM > 0 &&
        r.distance > aDistM * MAX_C_ROUTE_DISTANCE_FACTOR
      ) {
        return false;
      }
      const c = r.geometry?.coordinates;
      if (!c?.length) return false;
      const gLight = coordsToLightLine(c, GEOM_COMPARE_MAX_VERTICES);
      return !usedForDistinct.some((ug) => routesEffectivelySame(ug, gLight));
    };

    const noMwPool = noMwSorted.filter(cEligible);
    const cPool = noMwPool.length ? noMwPool : mergedRaw.filter(cEligible);
    const cRaw = cPool.sort((x, y) => {
      const xLine = mbRouteLightLine(x);
      const yLine = mbRouteLightLine(y);
      if (!xLine || !yLine) return 0;
      return cPickScore(x, xLine) - cPickScore(y, yLine);
    })[0];

    if (cRaw) {
      const navC = routeFromDirectionsApi(cRaw, "r-c", "balanced", "Country drive");
      if (navC && !out.some((existing) => sameRouteShapeLine(existing.geometry, navC.geometry))) {
        out.push(navC);
      }
    }

    return out;
  };

  let noMwSorted: MbRoutes = [];
  try {
    if (secondaryP) {
      const noMwData = await secondaryP;
      noMwSorted = sortRoutesByDurationAsc(noMwData.routes ?? []);
    } else if (wantMultiRoute) {
      const noMwData = await fetchDirectionsPrimary(
        accessToken,
        start,
        end,
        hasVia ? via : undefined,
        {
          alternatives: true,
          excludeMotorway: true,
          includeDetails,
          simplifiedOverview,
        },
        signal
      );
      noMwSorted = sortRoutesByDurationAsc(noMwData.routes ?? []);
    }
  } catch {
    /* keep empty — B/C fall back to primary alternates only */
  }

  const out = mergePools(noMwSorted);
  return out.slice(0, Math.min(targetPrimaryCount, out.length));
}

export type BuildTripFromMapboxResult = {
  plan: TripPlan;
  routeDestination: LngLat;
  routeStart: LngLat;
  snapNotice?: string;
};

/**
 * Build a trip from Mapbox Directions (same `TripPlan` shape as the mock router).
 * Route count is capped by `opts.maxRoutes` (Basic 1 / Plus 2).
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
    via?: LngLat[];
    maxRoutes?: number;
    allowLocalTripThirdRoute?: boolean;
    preferThreeRoutes?: boolean;
    includeDetails?: boolean;
    stormAlerts?: NormalizedWeatherAlert[];
    radarAvoidanceEnabled?: boolean;
    excludeToll?: boolean;
    trailRoutePersonalization?: boolean;
    singleRouteFromPosition?: boolean;
    skipStormLegRefinement?: boolean;
    rejoinShufflePass?: number;
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
