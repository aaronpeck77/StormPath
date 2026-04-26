import type { LngLat, RouteTurnStep } from "../nav/types";
import { shortenTurnInstruction } from "../nav/turnInstructionShort";
import { fetchWithTimeout, MAPBOX_DIRECTIONS_TIMEOUT_MS } from "../utils/fetchResilient";

type MbCoord = [number, number];

type DirectionsResponse = {
  code?: string;
  message?: string;
  routes?: {
    duration?: number;
    distance?: number;
    geometry?: { type?: string; coordinates?: MbCoord[] };
    legs?: {
      steps?: {
        maneuver?: { instruction?: string; type?: string; modifier?: string };
        name?: string;
        ref?: string;
        distance?: number;
      }[];
    }[];
  }[];
};

export type MapboxTrafficAltRoute = {
  durationMinutes: number;
  distanceMeters: number;
  geometry: LngLat[];
  turnSteps: RouteTurnStep[];
};

function parseSteps(route: NonNullable<DirectionsResponse["routes"]>[0]): RouteTurnStep[] {
  const out: RouteTurnStep[] = [];
  const legs = route.legs ?? [];
  for (const leg of legs) {
    const steps = leg.steps ?? [];
    for (const step of steps) {
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

/**
 * Live traffic-aware routes from current position to destination (Mapbox may return multiple geometries).
 * Used for “bypass” when congestion is detected ahead — not a guaranteed exit/rejoin interstate path.
 */
export async function fetchMapboxTrafficAlternatives(
  accessToken: string,
  origin: LngLat,
  dest: LngLat
): Promise<MapboxTrafficAltRoute[] | null> {
  const o = `${origin[0].toFixed(5)},${origin[1].toFixed(5)}`;
  const d = `${dest[0].toFixed(5)},${dest[1].toFixed(5)}`;
  const url = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${o};${d}`
  );
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("alternatives", "true");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("overview", "full");
  url.searchParams.set("steps", "true");

  let res: Response;
  try {
    res = await fetchWithTimeout({
      input: url.toString(),
      init: { method: "GET" },
      timeoutMs: MAPBOX_DIRECTIONS_TIMEOUT_MS,
    });
  } catch {
    return null;
  }
  const data = (await res.json()) as DirectionsResponse;

  if (!res.ok) {
    console.warn("[bypass] Mapbox Directions", res.status, data.message ?? data.code ?? "");
    return null;
  }
  if (data.code && data.code !== "Ok") {
    console.warn("[bypass] Mapbox Directions", data.code, data.message ?? "");
    return null;
  }

  const raw = data.routes ?? [];
  const parsed: MapboxTrafficAltRoute[] = [];
  for (const r of raw) {
    const coords = r.geometry?.coordinates;
    if (!coords?.length || r.geometry?.type !== "LineString") continue;
    const geometry = coords.map(([lng, lat]) => [lng, lat] as LngLat);
    const durSec = r.duration;
    if (durSec == null || !Number.isFinite(durSec)) continue;
    parsed.push({
      durationMinutes: durSec / 60,
      distanceMeters: typeof r.distance === "number" ? r.distance : 0,
      geometry,
      turnSteps: parseSteps(r),
    });
  }
  if (!parsed.length) return null;
  return parsed;
}

/**
 * Surgical bypass: exit→rejoin via side roads only (exclude=motorway).
 * Forces Mapbox onto surface streets so the driver gets off the highway, bypasses the jam,
 * and gets back on after the holdup.
 */
export async function fetchMapboxSurgicalBypass(
  accessToken: string,
  exitPoint: LngLat,
  rejoinPoint: LngLat
): Promise<MapboxTrafficAltRoute | null> {
  const o = `${exitPoint[0].toFixed(5)},${exitPoint[1].toFixed(5)}`;
  const d = `${rejoinPoint[0].toFixed(5)},${rejoinPoint[1].toFixed(5)}`;
  const url = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${o};${d}`
  );
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("alternatives", "false");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("overview", "full");
  url.searchParams.set("steps", "true");
  url.searchParams.set("exclude", "motorway");

  let res: Response;
  try {
    res = await fetchWithTimeout({
      input: url.toString(),
      init: { method: "GET" },
      timeoutMs: MAPBOX_DIRECTIONS_TIMEOUT_MS,
    });
  } catch {
    return null;
  }
  const data = (await res.json()) as DirectionsResponse;

  if (!res.ok) {
    console.warn("[surgical] Mapbox Directions", res.status, data.message ?? data.code ?? "");
    return null;
  }
  if (data.code && data.code !== "Ok") {
    console.warn("[surgical] Mapbox Directions", data.code, data.message ?? "");
    return null;
  }

  const r = data.routes?.[0];
  const coords = r?.geometry?.coordinates;
  if (!coords?.length || r?.geometry?.type !== "LineString") return null;
  const geometry = coords.map(([lng, lat]) => [lng, lat] as LngLat);
  const durSec = r.duration;
  if (durSec == null || !Number.isFinite(durSec)) return null;
  return {
    durationMinutes: durSec / 60,
    distanceMeters: typeof r.distance === "number" ? r.distance : 0,
    geometry,
    turnSteps: parseSteps(r),
  };
}

/**
 * Single best traffic-aware route (current → destination). Same road network as the map traffic layer;
 * use when the ORS polyline no longer matches drivable roads (closures, etc.).
 */
export async function fetchMapboxDrivingTrafficRoute(
  accessToken: string,
  origin: LngLat,
  dest: LngLat
): Promise<MapboxTrafficAltRoute | null> {
  const o = `${origin[0].toFixed(5)},${origin[1].toFixed(5)}`;
  const d = `${dest[0].toFixed(5)},${dest[1].toFixed(5)}`;
  const url = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${o};${d}`
  );
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("alternatives", "false");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("overview", "full");
  url.searchParams.set("steps", "true");

  let res: Response;
  try {
    res = await fetchWithTimeout({
      input: url.toString(),
      init: { method: "GET" },
      timeoutMs: MAPBOX_DIRECTIONS_TIMEOUT_MS,
    });
  } catch {
    return null;
  }
  const data = (await res.json()) as DirectionsResponse;

  if (!res.ok) {
    console.warn("[mb-route] Mapbox Directions", res.status, data.message ?? data.code ?? "");
    return null;
  }
  if (data.code && data.code !== "Ok") {
    console.warn("[mb-route] Mapbox Directions", data.code, data.message ?? "");
    return null;
  }

  const r = data.routes?.[0];
  const coords = r?.geometry?.coordinates;
  if (!coords?.length || r?.geometry?.type !== "LineString") return null;
  const geometry = coords.map(([lng, lat]) => [lng, lat] as LngLat);
  const durSec = r.duration;
  if (durSec == null || !Number.isFinite(durSec)) return null;
  return {
    durationMinutes: durSec / 60,
    distanceMeters: typeof r.distance === "number" ? r.distance : 0,
    geometry,
    turnSteps: parseSteps(r),
  };
}
