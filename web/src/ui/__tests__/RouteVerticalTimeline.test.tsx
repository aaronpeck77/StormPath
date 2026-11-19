import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RouteVerticalTimeline } from "../RouteVerticalTimeline";
import type { TimelineItem } from "../RouteHazardTimeline";

const roadItem: TimelineItem = {
  id: "road:1",
  track: "road",
  label: "Bridge work",
  severity: "serious",
  startMeters: 20000,
  endMeters: 30000,
  crossesRoute: true,
};

const baseProps = {
  timeline: [roadItem],
  outlookSteps: [],
  totalMeters: 50000,
  userAlongMeters: 10000,
  userAlongT: 0.2,
  arrivalTempF: 41,
  stripTint: "#4da3ff",
};

function render(props = {}) {
  return renderToStaticMarkup(
    createElement(RouteVerticalTimeline, { ...baseProps, ...props })
  );
}

describe("RouteVerticalTimeline", () => {
  it("places destination at top and start at bottom with miles captions", () => {
    const html = render();
    expect(html).toContain("DEST · 41°");
    expect(html).toContain("START");
    // 50 km? no — 50000 m ≈ 31 mi
    expect(html).toContain("31 mi");
  });

  it("positions the YOU marker at the user fraction from the bottom", () => {
    const html = render({ userAlongT: 0.25 });
    expect(html).toContain('bottom:25%');
    expect(html).toContain("YOU · 23 mi"); // 0.75 * 31 mi
  });

  it("spans hazard bands vertically by route fraction, not horizontally", () => {
    const html = render();
    // roadItem: 20km–30km of 50km → startF .4 endF .6 → bottom:40%, height:20%
    expect(html).toContain("bottom:40%");
    expect(html).toContain("height:20%");
    expect(html).not.toContain("left:40%");
  });

  it("dims bands the driver already passed", () => {
    const passed: TimelineItem = { ...roadItem, id: "road:past", startMeters: 0, endMeters: 5000 };
    const html = render({ timeline: [roadItem, passed], userAlongMeters: 10000 });
    expect(html).toContain("rvtl__band--muted");
  });

  it("disables bands that have no detail card", () => {
    const html = render({ linkableIds: new Set(["road:1"]), cardId: (id: string) => `card-${id}` });
    expect(html).toContain("card-road:1");
    const html2 = render({ linkableIds: new Set<string>(), cardId: (id: string) => `card-${id}` });
    expect(html2).toContain("disabled");
  });

  it("renders the empty weather state when no forecast or radar exists", () => {
    const html = render();
    expect(html).toContain("Weather along route");
    expect(html).not.toContain("rvtl__temp-line");
  });
});
