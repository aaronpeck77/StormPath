import { describe, expect, it } from "vitest";
import { corridorHighlightHex } from "../routeAlerts";
import { timelineItemBandColor, timelineTrackFamily } from "../timelineBandColors";
import type { TimelineItem } from "../../ui/RouteHazardTimeline";

const item = (overrides: Partial<TimelineItem>): TimelineItem => ({
  id: "x",
  track: "nws",
  label: "Test",
  severity: "serious",
  startMeters: 0,
  endMeters: 1000,
  ...overrides,
});

describe("timelineTrackFamily", () => {
  it("groups nws radar and forecast as weather", () => {
    expect(timelineTrackFamily("nws")).toBe("weather");
    expect(timelineTrackFamily("radar")).toBe("weather");
    expect(timelineTrackFamily("forecast")).toBe("weather");
  });

  it("groups road impacts separately", () => {
    expect(timelineTrackFamily("road")).toBe("road");
  });
});

describe("timelineItemBandColor", () => {
  it("uses traffic corridor colors for road hazards", () => {
    expect(timelineItemBandColor(item({ track: "road", severity: "avoid" }))).toBe(
      corridorHighlightHex("traffic", 90)
    );
    expect(timelineItemBandColor(item({ track: "road", severity: "caution" }))).toBe(
      corridorHighlightHex("traffic", 58)
    );
  });

  it("uses weather corridor colors for radar and forecast", () => {
    expect(timelineItemBandColor(item({ track: "radar", severity: "serious" }))).toBe(
      corridorHighlightHex("weather", 75)
    );
    expect(timelineItemBandColor(item({ track: "forecast", severity: "caution" }))).toBe(
      corridorHighlightHex("weather", 58)
    );
  });

  it("keeps NWS bands on NWS severity palette", () => {
    expect(timelineItemBandColor(item({ track: "nws", severity: "avoid" }))).toBe("#991b1b");
    expect(timelineItemBandColor(item({ track: "nws", severity: "info" }))).toBe("#64748b");
  });
});
