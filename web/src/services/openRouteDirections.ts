import type { LngLat, NavRoute, RouteTurnStep, TripPlan } from "../nav/types";
import { haversineMeters, polylineLengthMeters } from "../nav/routeGeometry";
import { shortenTurnInstruction } from "../nav/turnInstructionShort";
import { snapPointToRoutableRoad } from "./openRouteSnap";

const ORS_URL = "https://api.openrouteservice.org/v2/directions/driving-car/geojson";

type OrsBody = {
  preference?: string;
  options?: { avoid_features?: string[]; avoid_polygons?: GeoJSON.Polygon | GeoJSON.MultiPolygon };
};

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

type OrsParsed = {
  geometry: LngLat[];
  durationSec: number;
  turnSteps: RouteTurnStep[];
  routeNotices: string[];
};

function parseOrsFeature(data: unknown): OrsParsed | null {
  if (!data || typeof data !== "object") return null;
  const fc = data as { features?: unknown[] };
  const f = fc.features?.[0] as
    | {
        geometry?: { type?: string; coordinates?: LngLat[] };
        properties?: {
          summary?: { duration?: number };
          segments?: { steps?: unknown[] }[];
          warnings?: unknown;
        };
      }
    | undefined;
  if (!f?.geometry?.coordinates?.length || f.geometry.type !== "LineString") return null;
  const durationSec = f.properties?.summary?.duration ?? 0;

  const turnSteps: RouteTurnStep[] = [];
  const segments = f.properties?.segments;
  if (Array.isArray(segments)) {
    for (const seg of segments) {
      const steps = seg?.steps;
      if (!Array.isArray(steps)) continue;
      for (const raw of steps) {
        if (!raw || typeof raw !== "object") continue;
        const step = raw as {
          instruction?: string;
          distance?: number;
          type?: number;
        };
        const text = typeof step.instruction === "string" ? stripHtml(step.instruction) : "";
        if (!text) continue;
        turnSteps.push({
          instruction: shortenTurnInstruction(text),
          distanceM: typeof step.distance === "number" ? step.distance : undefined,
          type: typeof step.type === "number" ? step.type : undefined,
        });
      }
    }
  }

  const routeNotices: string[] = [];
  const w = f.properties?.warnings;
  if (Array.isArray(w)) {
    for (const item of w) {
      if (typeof item === "string" && item.trim()) routeNotices.push(item.trim());
      else if (item && typeof item === "object" && "message" in item) {
        const m = (item as { message?: string }).message;
        if (typeof m === "string" && m.trim()) routeNotices.push(m.trim());
      }
    }
  }

  return {
    geometry: f.geometry.coordinates,
    durationSec,
    turnSteps,
    routeNotices,
  };
}

async function fetchOrsVariant(
  apiKey: string,
  start: LngLat,
  end: LngLat,
  body: OrsBody
): Promise<OrsParsed | null> {
  const res = await fetch(ORS_URL, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      coordinates: [start, end],
      units: "m",
      instructions: true,
      language: "en",
      preference: body.preference,
      options: body.options,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ORS ${res.status}: ${text.slice(0, 200)}`);
  }
  return parseOrsFeature(await res.json());
}

export async function fetchOrsAvoidPolygonsShortest(
  apiKey: string,
  start: LngLat,
  end: LngLat,
  avoidPolygons: GeoJSON.Polygon | GeoJSON.MultiPolygon
): Promise<OrsParsed | null> {
  return fetchOrsVariant(apiKey, start, end, {
    preference: "shortest",
    options: { avoid_polygons: avoidPolygons },
  });
}

const ORS_VARIANTS: { id: string; role: NavRoute["role"]; label: string; body: OrsBody }[] = [
  { id: "r-a", role: "fastest", label: "Main", body: { preference: "fastest" } },
  {
    id: "r-b",
    role: "hazardSmart",
    label: "No interstate",
    body: { preference: "recommended", options: { avoid_features: ["highways"] } },
  },
  {
    id: "r-c",
    role: "balanced",
    label: "Scenic",
    body: { preference: "shortest" },
  },
];

/** ORS “shortest” / “recommended” often matches “fastest” — skip duplicate overlays. */
function geometryNearlySameAsExisting(candidate: LngLat[], existing: LngLat[]): boolean {
  if (candidate.length < 2 || existing.length < 2) return false;
  if (haversineMeters(candidate[0]!, existing[0]!) > 35) return false;
  if (haversineMeters(candidate[candidate.length - 1]!, existing[existing.length - 1]!) > 35) {
    return false;
  }
  const lc = polylineLengthMeters(candidate);
  const le = polylineLengthMeters(existing);
  if (lc < 15 || le < 15) return false;
  /* Tight match only: ORS “shortest”/“recommended” often differ slightly in length but are visually distinct. */
  return Math.abs(lc - le) / Math.max(lc, le) < 0.006;
}

/** Raw A/B/C legs from ORS (no snap-retry wrapper). Exported for alternate-only refresh while navigating. */
export async function collectRouteVariants(apiKey: string, start: LngLat, end: LngLat): Promise<NavRoute[]> {
  const routes: NavRoute[] = [];
  for (const v of ORS_VARIANTS) {
    try {
      const parsed = await fetchOrsVariant(apiKey, start, end, v.body);
      if (parsed && parsed.geometry.length >= 2) {
        if (routes.some((r) => geometryNearlySameAsExisting(parsed.geometry, r.geometry))) {
          continue;
        }
        routes.push({
          id: v.id,
          role: v.role,
          label: v.label,
          geometry: parsed.geometry,
          baseEtaMinutes: Math.max(1, parsed.durationSec / 60),
          turnSteps: parsed.turnSteps.length ? parsed.turnSteps : undefined,
          routeNotices: parsed.routeNotices.length ? parsed.routeNotices : undefined,
        });
      }
    } catch {
      /* try next variant */
    }
  }
  return routes;
}

export type BuildTripFromOpenRouteResult = {
  plan: TripPlan;
  /** End coordinate passed to ORS (snapped onto the road grid when needed). */
  routeDestination: LngLat;
  /** Start coordinate passed to ORS (only differs from input if GPS had to be snapped). */
  routeStart: LngLat;
  snapNotice?: string;
};

/**
 * Build A/B/C legs from ORS. If raw coordinates fail (e.g. pin in a field), snaps destination
 * and if needed start onto the driving network and retries with larger search radii.
 */
export async function buildTripFromOpenRoute(
  apiKey: string,
  start: LngLat,
  end: LngLat,
  labels: { origin: string; destination: string } = {
    origin: "Start",
    destination: "Destination",
  }
): Promise<BuildTripFromOpenRouteResult> {
  const origStart = start;
  const origEnd = end;
  let useStart = start;
  let useEnd = end;

  let routes = await collectRouteVariants(apiKey, useStart, useEnd);

  if (routes.length === 0) {
    const se =
      (await snapPointToRoutableRoad(apiKey, end, 4000)) ??
      (await snapPointToRoutableRoad(apiKey, end, 12000)) ??
      (await snapPointToRoutableRoad(apiKey, end, 28000));
    if (se) {
      routes = await collectRouteVariants(apiKey, useStart, se.lngLat);
      if (routes.length) useEnd = se.lngLat;
    }
  }

  if (routes.length === 0) {
    const ss =
      (await snapPointToRoutableRoad(apiKey, start, 3500)) ??
      (await snapPointToRoutableRoad(apiKey, start, 10000)) ??
      (await snapPointToRoutableRoad(apiKey, start, 25000));
    if (ss) {
      routes = await collectRouteVariants(apiKey, ss.lngLat, useEnd);
      if (routes.length) useStart = ss.lngLat;
    }
  }

  if (routes.length === 0) {
    const se =
      (await snapPointToRoutableRoad(apiKey, end, 4000)) ??
      (await snapPointToRoutableRoad(apiKey, end, 12000)) ??
      (await snapPointToRoutableRoad(apiKey, end, 50000));
    const ss =
      (await snapPointToRoutableRoad(apiKey, start, 3500)) ??
      (await snapPointToRoutableRoad(apiKey, start, 12000)) ??
      (await snapPointToRoutableRoad(apiKey, start, 30000));
    if (se && ss) {
      routes = await collectRouteVariants(apiKey, ss.lngLat, se.lngLat);
      if (routes.length) {
        useStart = ss.lngLat;
        useEnd = se.lngLat;
      }
    }
  }

  if (routes.length === 0) {
    throw new Error(
      "Could not build a driving route — try a point closer to a public road, or check your OpenRoute key."
    );
  }

  const plan: TripPlan = {
    originLabel: labels.origin,
    destinationLabel: labels.destination,
    routes,
  };

  const destMovedM = haversineMeters(origEnd, useEnd);
  const startMovedM = haversineMeters(origStart, useStart);
  const hints: string[] = [];
  if (destMovedM > 25) {
    hints.push(`Destination set on nearest drivable road (~${Math.round(destMovedM)} m from your pin).`);
  }
  if (startMovedM > 25) {
    hints.push(`Route starts from the nearest road to your GPS (~${Math.round(startMovedM)} m).`);
  }

  return {
    plan,
    routeDestination: useEnd,
    routeStart: useStart,
    snapNotice: hints.length ? hints.join(" ") : undefined,
  };
}
