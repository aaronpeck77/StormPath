import type { LngLat } from "../nav/types";
import { closestAlongRouteMeters, haversineMeters } from "../nav/routeGeometry";
import { fetchWithTimeout } from "../utils/fetchResilient";

export type MapMatchResult = {
  /** Snapped coordinate on the road network, or null when matching fails. */
  lngLat: LngLat | null;
  confidence: number | null;
};

type MapboxMatchingResponse = {
  matchings?: { confidence?: number }[];
  tracepoints?: ({ location?: [number, number] } | null)[];
};

/**
 * Mapbox Map Matching API spike — snaps a short GPS trace to the driving network.
 * Opt-in via `VITE_MAP_MATCHING_ENABLED=true` and a valid Mapbox token.
 *
 * @see https://docs.mapbox.com/api/navigation/map-matching/
 */
export async function matchGpsTraceToRoad(
  token: string,
  points: LngLat[],
  opts?: { signal?: AbortSignal; radiusMeters?: number }
): Promise<MapMatchResult> {
  if (!token || points.length < 2) {
    return { lngLat: null, confidence: null };
  }

  const radius = opts?.radiusMeters ?? 25;
  const coordPath = points.map(([lng, lat]) => `${lng},${lat}`).join(";");
  const radiuses = points.map(() => String(radius)).join(";");
  const url =
    `https://api.mapbox.com/matching/v5/mapbox/driving/${coordPath}.json` +
    `?access_token=${encodeURIComponent(token)}` +
    `&geometries=geojson&overview=full&radiuses=${encodeURIComponent(radiuses)}` +
    `&tidy=true`;

  const res = await fetchWithTimeout({
    input: url,
    timeoutMs: 12_000,
    externalSignal: opts?.signal,
  });
  if (!res.ok) {
    return { lngLat: null, confidence: null };
  }

  const body = (await res.json()) as MapboxMatchingResponse;
  const matching = body.matchings?.[0];
  const lastTrace = body.tracepoints?.[body.tracepoints.length - 1];
  const loc = lastTrace?.location;
  if (!loc || loc.length < 2) {
    return { lngLat: null, confidence: matching?.confidence ?? null };
  }
  return {
    lngLat: [loc[0]!, loc[1]!],
    confidence: matching?.confidence ?? null,
  };
}

export function mapMatchingEnabled(): boolean {
  return String(import.meta.env.VITE_MAP_MATCHING_ENABLED ?? "").toLowerCase() === "true";
}

/** Build-time kill switch — set `VITE_MAP_MATCHING_ENABLED=false` to hide/disable matching everywhere. */
export function mapMatchingBuildAllowed(): boolean {
  return import.meta.env.VITE_MAP_MATCHING_ENABLED !== "false";
}

const DEFAULT_MIN_CONFIDENCE = 0.35;
const DEFAULT_MAX_DRIFT_M = 90;

/** Guards against low-confidence snaps and matches far from the raw GPS fix or route corridor. */
export function acceptMapMatchSnap(
  raw: LngLat,
  snapped: LngLat,
  confidence: number | null,
  opts?: {
    minConfidence?: number;
    maxDriftM?: number;
    routeGeometry?: LngLat[];
    maxRouteLateralM?: number;
  }
): boolean {
  if (confidence == null || confidence < (opts?.minConfidence ?? DEFAULT_MIN_CONFIDENCE)) {
    return false;
  }
  if (haversineMeters(raw, snapped) > (opts?.maxDriftM ?? DEFAULT_MAX_DRIFT_M)) {
    return false;
  }
  const route = opts?.routeGeometry;
  if (route && route.length >= 2) {
    const lateral = closestAlongRouteMeters(snapped, route).lateralMetersApprox;
    if (lateral > (opts?.maxRouteLateralM ?? 80)) {
      return false;
    }
  }
  return true;
}
