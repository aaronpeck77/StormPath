import type { LngLat, NavRoute, RouteTurnStep, TripPlan } from "../nav/types";
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
        intersections?: { geometry_index?: number }[];
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

/** Cross-country `overview=full` lines are huge; keep the nav/map payload small. */
const MAX_STORED_GEOMETRY_VERTICES = 3500;
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
  };
}

async function fetchMapboxDirections(
  accessToken: string,
  start: LngLat,
  end: LngLat,
  opts: { alternatives: boolean; excludeMotorway: boolean; includeDetails?: boolean },
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
  if (opts.excludeMotorway) url.searchParams.set("exclude", "motorway");

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
 * Up to 3 traffic-aware routes:
 * - **Main** — fastest typical path (major roads when faster).
 * - **No interstate** — `exclude=motorway` when available, else next-best alternate.
 * - **No town** — prefers fewer turns / arterial feel, while capping ETA inflation.
 *
 * For short in-town trips, we intentionally return only A/B (speed-focused) to keep choices quick.
 *
 * Latency: long trips can take several seconds per Directions call. We **always** complete the
 * primary `alternatives=true` request first and build A/B/C from that pool when possible. When a
 * second `exclude=motorway` call is needed, Plus builds start it **in parallel** with the primary
 * (then abort it if the primary already yielded enough alternates), so worst-case latency is
 * ~max(primary, secondary) instead of primary+secondary.
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
  }
): Promise<NavRoute[]> {
  const signal = opts?.signal;
  const allowLocalTripThirdRoute = Boolean(opts?.allowLocalTripThirdRoute);
  const preferThreeRoutes = Boolean(opts?.preferThreeRoutes);
  const includeDetails = opts?.includeDetails !== false;
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
    return primaryOnly;
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
    return out.slice(0, Math.min(2, out.length));
  }
  if (out.length >= 2 && (!preferThreeRoutes || out.length >= 3)) {
    secondaryAbort?.abort();
    return out;
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
  return out;
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
