import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RouteProgressGlancePanel } from "../RouteProgressGlancePanel";
import { selectDriveHazardTicker } from "../../nav/driveHazardTicker";
import type { TimelineItem } from "../RouteHazardTimeline";

const timeline: TimelineItem[] = Array.from({ length: 9 }, (_, i) => ({
  id: `hazard:${i}`, track: i % 2 ? "road" : "nws", label: `Hazard ${i}`,
  severity: "serious", startMeters: 5000 + i * 1000, endMeters: 6000 + i * 1000, crossesRoute: true,
}));
const render = (items = timeline) => renderToStaticMarkup(createElement(RouteProgressGlancePanel, {
  timeline: items, routeWide: [], outlookSteps: [], fallbackSegments: [], totalMeters: 50000,
  userAlongMeters: 0, planEtaMinutes: 50, userAlongT: 0, stripTint: "#fff",
}));

describe("Route Info shared hazard links", () => {
  it("gives every upcoming NWS and road graph mark a matching card, including beyond the old six-card cap", () => {
    const html = render();
    const targets = [...html.matchAll(/aria-controls="([^"]+)"/g)].map((match) => match[1]);
    expect(targets).toHaveLength(9);
    for (const target of targets) expect(html).toContain(`id="${target}"`);
    expect(html).toContain("Show on graph: Hazard 8");
    expect(html).not.toContain("more alerts ahead");
  });

  it("uses the exact hazard identity also selected by the Drive countdown", () => {
    const ticker = selectDriveHazardTicker({ items: timeline, isPlus: true, isOnline: true,
      navigationStarted: true, viewMode: "drive", userAlongMeters: 0, metersToManeuver: 5000, miles: true });
    expect(ticker?.id).toBe(timeline[0]!.id);
    expect(render()).toContain(`hazard-${encodeURIComponent(ticker!.id)}`);
  });

  it("does not advertise a card link for a passed graph mark", () => {
    const html = render([{ ...timeline[0]!, startMeters: -2000, endMeters: -1000 }]);
    expect(html).not.toContain("aria-controls=");
    expect(html).toContain("disabled");
  });
});
