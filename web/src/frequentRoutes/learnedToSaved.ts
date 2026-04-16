import type { SavedRoute } from "../nav/savedRoutes";
import type { LngLat } from "../nav/types";
import type { FrequentRouteCluster } from "./types";

/** Temporary {@link SavedRoute} shape so learned geometry can reuse saved-route navigation flow. */
export function learnedClusterToSavedRoute(c: FrequentRouteCluster): SavedRoute {
  const end = c.geometry[c.geometry.length - 1]!;
  return {
    id: c.id,
    name: `Frequent trip (${c.count}×)`,
    destinationLngLat: [end[0]!, end[1]!] as LngLat,
    destinationLabel: "Learned destination",
    geometry: c.geometry.map(([lng, lat]) => [lng, lat] as LngLat),
    createdAt: c.lastSeen,
  };
}
