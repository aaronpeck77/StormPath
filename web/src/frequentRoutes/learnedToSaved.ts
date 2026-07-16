import type { SavedRoute } from "../nav/savedRoutes";
import type { LngLat } from "../nav/types";
import type { FrequentRouteCluster } from "./types";

/** Temporary {@link SavedRoute} shape so learned geometry can reuse saved-route navigation flow. */
export function learnedClusterToSavedRoute(c: FrequentRouteCluster): SavedRoute {
  const end = c.geometry[c.geometry.length - 1]!;
  const startName = c.startLabel?.trim();
  const endName = c.endLabel?.trim() || "Learned destination";
  const name =
    startName && c.endLabel?.trim()
      ? `${startName} → ${endName}`
      : `Frequent trip (${c.count}×)`;
  return {
    id: c.id,
    name,
    destinationLngLat: [end[0]!, end[1]!] as LngLat,
    destinationLabel: endName,
    startLabel: startName,
    geometry: c.geometry.map(([lng, lat]) => [lng, lat] as LngLat),
    createdAt: c.lastSeen,
  };
}
