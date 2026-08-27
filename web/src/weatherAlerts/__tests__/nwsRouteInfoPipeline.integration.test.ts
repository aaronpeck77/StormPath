import { describe, expect, it } from "vitest";
import { NWS_REQUEST_USER_AGENT } from "../../config/nwsUserAgent";
import { buildRouteStormStripBands, filterAlertsAffectingRoute } from "../geometryOverlap";
import { fetchNwsAlertsForRouteCorridor } from "../nwsUsProvider";
import { buildRouteAheadTimeline, timelineItemShowsOnRouteGraph } from "../../nav/routeAheadSync";
import { polylineLengthMeters } from "../../nav/routeGeometry";
import { WEATHER_PLANNING_DETAIL_AHEAD_M } from "../../nav/constants";

const IL_ROUTE: [number, number][] = [
  [-88.8, 39.78],
  [-89.0, 40.0],
  [-87.9, 41.5],
];

describe("NWS route-info pipeline", () => {
  it("produces Route Info graph bands for an Illinois corridor", async () => {
    const { alerts } = await fetchNwsAlertsForRouteCorridor(IL_ROUTE, NWS_REQUEST_USER_AGENT);
    /* Live NWS — skip quietly when the corridor is clear (common on quiet weather days). */
    if (alerts.length === 0) return;

    const affecting = filterAlertsAffectingRoute(IL_ROUTE, alerts);
    if (affecting.length === 0) return;

    const totalM = polylineLengthMeters(IL_ROUTE);
    const stripBands = buildRouteStormStripBands(IL_ROUTE, totalM, affecting, {
      userAlongM: 0,
      navigationActive: false,
      planningDetailAheadM: WEATHER_PLANNING_DETAIL_AHEAD_M,
    });
    expect(stripBands.length).toBeGreaterThan(0);

    const advisoryBands = stripBands.map((b) => ({
      id: b.id,
      event: b.event,
      severity: b.impactSeverity,
      startMeters: b.startMeters,
      endMeters: b.endMeters,
      expiresIso: b.expiresIso,
      alertId: b.alertId,
      crossesRoute: b.crossesRoute,
      coarsePreview: b.detailTier === "coarse",
      stripMuted: !b.stripProminent,
    }));

    const timeline = buildRouteAheadTimeline({
      routeTotalMeters: totalM,
      userAlongMeters: 0,
      planEtaMinutes: 120,
      stormStripBands: advisoryBands,
      routeImpacts: [],
    });

    const graphItems = timeline.filter(
      (item) => timelineItemShowsOnRouteGraph(item) && item.endMeters > 0
    );
    expect(graphItems.length).toBeGreaterThan(0);
  }, 90_000);
});
