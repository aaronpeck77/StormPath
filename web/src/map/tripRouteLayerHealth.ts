import type { Map } from "mapbox-gl";
import { isMapUsable } from "../ui/mapCameraSafe";

export const TRIP_ROUTE_LAYER_PREFIX = "route";

export function tripRouteLineLayerId(routeId: string, prefix = TRIP_ROUTE_LAYER_PREFIX): string {
  return `${prefix}-${routeId}-line`;
}

/** Route leg line layers that should exist for the given visible route ids. */
export function expectedTripRouteLineLayerIds(
  routeIds: string[],
  prefix = TRIP_ROUTE_LAYER_PREFIX
): string[] {
  return routeIds.map((id) => tripRouteLineLayerId(id, prefix));
}

/** Layer ids that are missing from the current Mapbox style (empty if map/style not ready). */
export function findMissingTripRouteLineLayers(
  map: Map | null | undefined,
  routeIds: string[],
  prefix = TRIP_ROUTE_LAYER_PREFIX
): string[] {
  if (!map || !isMapUsable(map)) return [];
  try {
    if (!map.isStyleLoaded()) return [];
  } catch {
    return [];
  }
  const missing: string[] = [];
  for (const id of routeIds) {
    const lid = tripRouteLineLayerId(id, prefix);
    try {
      if (!map.getLayer(lid)) missing.push(lid);
    } catch {
      missing.push(lid);
    }
  }
  return missing;
}

export type TripRouteLayerAudit = {
  ok: boolean;
  expectedRouteIds: string[];
  missingLineLayerIds: string[];
};

export function auditTripRouteLayersOnMap(
  map: Map | null | undefined,
  expectedRouteIds: string[],
  prefix = TRIP_ROUTE_LAYER_PREFIX
): TripRouteLayerAudit {
  const missingLineLayerIds = findMissingTripRouteLineLayers(map, expectedRouteIds, prefix);
  return {
    ok: expectedRouteIds.length === 0 || missingLineLayerIds.length === 0,
    expectedRouteIds,
    missingLineLayerIds,
  };
}

/** Staggered + interval timings for post-route / low-data style recovery. */
export const ROUTE_LAYER_HEALTH_RETRY_MS = [0, 180, 450, 1_000, 2_200, 4_500] as const;
export const ROUTE_LAYER_HEALTH_POLL_MS = 7_500;
export const ROUTE_LAYER_HEALTH_REPAIR_COOLDOWN_MS = 900;
export const ROUTE_LAYER_HEALTH_IDLE_DEBOUNCE_MS = 1_400;
