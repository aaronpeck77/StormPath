import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DriveHazardTicker } from "../DriveHazardTicker";
import type { DriveHazardTickerInput } from "../../nav/driveHazardTicker";
import { buildRouteAheadTimeline } from "../../nav/routeAheadSync";

const items = buildRouteAheadTimeline({
  routeTotalMeters: 50000, userAlongMeters: 0, planEtaMinutes: 40,
  stormStripBands: [{ id: "warning", event: "Tornado Warning", severity: "avoid", startMeters: 16093.4,
    endMeters: 20000, expiresIso: null, alertId: "warning", crossesRoute: true }],
  routeImpacts: [],
});
const props: DriveHazardTickerInput = {
  items, isPlus: true, isOnline: true, navigationStarted: true, viewMode: "drive",
  userAlongMeters: 3218.68, metersToManeuver: 5000, miles: true,
};
const render = (patch: Partial<DriveHazardTickerInput> = {}) =>
  renderToStaticMarkup(createElement(DriveHazardTicker, { ...props, ...patch }));

describe("DriveHazardTicker", () => {
  it("renders the shared route timeline as a single compact distance line", () => {
    const html = render();
    expect(html).toContain("Next route hazard");
    expect(html).toContain("Tornado Warning");
    expect(html).toContain("8.0 mi");
    expect(html).not.toContain("aria-live");
  });

  it("renders nothing for Basic, other views, offline, nearby turns or an empty timeline", () => {
    for (const patch of [
      { isPlus: false }, { viewMode: "route" as const }, { isOnline: false },
      { metersToManeuver: 100 }, { items: [] }, { navigationStarted: false },
    ]) expect(render(patch)).toBe("");
  });
});
