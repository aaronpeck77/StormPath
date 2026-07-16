import { timelineToMapCorridorAlerts, type TimelineItem } from "./routeAheadSync";
import { routeAlertShowsOnRouteLine, type RouteAlert } from "./routeAlerts";
import type { RouteImpact } from "./routeImpacts";
import type { LngLat } from "./types";

/**
 * Map line highlights — each corridor alert at its real along-route position.
 *
 * The progress strip bunches marks into the “ahead” half for a small bar; that
 * re-anchoring is wrong for the map (orange halo slides as the puck advances).
 */
export function buildMapAlongRouteAlerts(input: {
  guidanceGeometry: LngLat[] | null | undefined;
  progressStripAlerts: RouteAlert[];
  routeAheadTimeline: TimelineItem[];
  advisoryRouteImpacts: RouteImpact[];
}): RouteAlert[] {
  if (!input.guidanceGeometry?.length) return [];
  const roadFromTimeline = timelineToMapCorridorAlerts(
    input.routeAheadTimeline,
    input.advisoryRouteImpacts
  );
  const byId = new Map<string, RouteAlert>();
  for (const a of [...input.progressStripAlerts, ...roadFromTimeline]) {
    if (!routeAlertShowsOnRouteLine(a)) continue;
    byId.set(a.id, a);
  }
  return [...byId.values()];
}
