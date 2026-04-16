import type { LngLat, NavRoute, RouteTurnStep, TripPlan } from "../nav/types";
import {
  closestAlongRouteMeters,
  cumulativeLengthToVertex,
  haversineMeters,
  polylineLengthMeters,
} from "../nav/routeGeometry";
import { shortenTurnInstruction } from "../nav/turnInstructionShort";

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

function parseSteps(route: NonNullable<DirectionsResponse["routes"]>[0]): RouteTurnStep[] {
  const out: RouteTurnStep[] = [];
  for (const leg of route.legs ?? []) {
    for (const step of leg.steps ?? []) {
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

  return {
    id,
    role,
    label,
    geometry,
    baseEtaMinutes: Math.max(1, durSec / 60),
    turnSteps: parseSteps(r),
    routeNotices: notices.length ? notices : undefined,
    routeNoticeAlongMeters: notices.length ? noticeAlong : undefined,
  };
}

async function fetchMapboxDirections(
  accessToken: string,
  start: LngLat,
  end: LngLat,
  opts: { alternatives: boolean; excludeMotorway: boolean }
): Promise<DirectionsResponse> {
  const o = `${start[0].toFixed(5)},${start[1].toFixed(5)}`;
  const d = `${end[0].toFixed(5)},${end[1].toFixed(5)}`;
  const url = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${o};${d}`
  );
  url.searchParams.set("access_token", accessToken);
  if (opts.alternatives) url.searchParams.set("alternatives", "true");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("overview", "full");
  url.searchParams.set("steps", "true");
  url.searchParams.set("annotations", "closure");
  if (opts.excludeMotorway) url.searchParams.set("exclude", "motorway");

  const res = await fetch(url.toString());
  const data = (await res.json()) as DirectionsResponse;

  if (!res.ok || (data.code && data.code !== "Ok")) {
    throw new Error(
      `Mapbox Directions ${res.status}: ${data.message ?? data.code ?? "unknown error"}`
    );
  }
  return data;
}

function sortRoutesByDurationAsc(
  routes: NonNullable<DirectionsResponse["routes"]>
): NonNullable<DirectionsResponse["routes"]> {
  return [...routes]
    .filter((r) => r.geometry?.coordinates?.length && r.duration != null && Number.isFinite(r.duration))
    .sort((a, b) => (a.duration ?? 0) - (b.duration ?? 0));
}

function sortRoutesByDurationDesc(
  routes: NonNullable<DirectionsResponse["routes"]>
): NonNullable<DirectionsResponse["routes"]> {
  return [...routes]
    .filter((r) => r.geometry?.coordinates?.length && r.duration != null && Number.isFinite(r.duration))
    .sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
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
 * - **Scenic** — longest distinct option (often more local / scenic vs Main).
 *
 * Latency: long trips can take several seconds per Directions call. We **always** complete the
 * primary `alternatives=true` request first and build A/B/C from that pool when possible. The
 * exclude-motorway request runs only if we still need another distinct leg (usually a single-route
 * response), so typical multi-alternative responses avoid a second round-trip entirely.
 */
export async function collectMapboxRouteVariants(
  accessToken: string,
  start: LngLat,
  end: LngLat
): Promise<NavRoute[]> {
  const MAX_SCENIC_DURATION_FACTOR = 1.35;

  const primaryData = await fetchMapboxDirections(accessToken, start, end, {
    alternatives: true,
    excludeMotorway: false,
  });

  const primarySorted = sortRoutesByDurationAsc(primaryData.routes ?? []);

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
        const coords = r.geometry?.coordinates;
        if (!coords?.length) return false;
        const g = coords.map(([lng, lat]) => [lng, lat] as LngLat);
        return !geometryNearlySame(g, navA.geometry);
      }) ?? primarySorted[1];

    if (bRaw) {
      const navB = routeFromDirectionsApi(bRaw, "r-b", "hazardSmart", "No interstate");
      if (navB && !geometryNearlySame(navB.geometry, navA.geometry)) {
        out.push(navB);
      }
    }

    const mergedRaw = [...primarySorted, ...noMwSorted];
    const usedGeoms: LngLat[][] = [navA.geometry];
    if (out[1]) usedGeoms.push(out[1].geometry);

    const scenicMaxDur = (aRaw.duration ?? 0) * MAX_SCENIC_DURATION_FACTOR;
    const cRaw = sortRoutesByDurationDesc(mergedRaw).find((r) => {
      if (typeof r.duration === "number" && scenicMaxDur > 0 && r.duration > scenicMaxDur) return false;
      const coords = r.geometry?.coordinates;
      if (!coords?.length) return false;
      const g = coords.map(([lng, lat]) => [lng, lat] as LngLat);
      return !usedGeoms.some((ug) => geometryNearlySame(ug, g));
    });

    if (cRaw) {
      const navC = routeFromDirectionsApi(cRaw, "r-c", "balanced", "Scenic");
      if (navC && !out.some((existing) => geometryNearlySame(existing.geometry, navC.geometry))) {
        out.push(navC);
      }
    }

    return out;
  };

  /* Fast path: alternates in the first response often yield 2–3 routes with zero extra HTTP. */
  let out = mergePools([]);
  if (out.length >= 2) {
    return out;
  }

  /* Rare: only one drivable path in the first response — fetch no-motorway variants to split B/C. */
  let noMwSorted: NonNullable<DirectionsResponse["routes"]> = [];
  try {
    const noMwData = await fetchMapboxDirections(accessToken, start, end, {
      alternatives: true,
      excludeMotorway: true,
    });
    noMwSorted = sortRoutesByDurationAsc(noMwData.routes ?? []);
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
 * Build A/B/C trip from Mapbox Directions. Falls through to the same `TripPlan` shape
 * so App.tsx can use it as a drop-in replacement for `buildTripFromOpenRoute`.
 */
export async function buildTripFromMapbox(
  accessToken: string,
  start: LngLat,
  end: LngLat,
  labels: { origin: string; destination: string } = {
    origin: "Start",
    destination: "Destination",
  }
): Promise<BuildTripFromMapboxResult> {
  const routes = await collectMapboxRouteVariants(accessToken, start, end);

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
