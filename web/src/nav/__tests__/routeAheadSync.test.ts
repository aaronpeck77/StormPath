import { describe, expect, it } from "vitest";
import { buildRouteAheadCalloutSegments, buildRouteAheadGlanceCards, timelineItemShowsOnRouteGraph, timelineItemShowsOnRouteLine, timelineToProgressStripBands } from "../routeAheadSync";
import type { TimelineItem } from "../../ui/RouteHazardTimeline";

const baseItem = (overrides: Partial<TimelineItem>): TimelineItem => ({
  id: "a1",
  track: "nws",
  label: "Flood Warning",
  severity: "serious",
  startMeters: 8000,
  endMeters: 12000,
  detailLine: "Turn around, don't drown",
  expiresIso: new Date(Date.now() + 2 * 3600_000).toISOString(),
  crossesRoute: true,
  ...overrides,
});

describe("buildRouteAheadGlanceCards", () => {
  it("returns compact distance and ETA chips sorted by encounter", () => {
    const cards = buildRouteAheadGlanceCards({
      items: [
        baseItem({ id: "far", startMeters: 40000, endMeters: 42000 }),
        baseItem({ id: "near", startMeters: 8000, endMeters: 12000 }),
      ],
      totalMeters: 80000,
      userAlongMeters: 0,
      planEtaMinutes: 60,
    });
    expect(cards).toHaveLength(2);
    expect(cards[0]!.id).toBe("near");
    expect(cards[0]!.aheadLabel).toMatch(/ahead|Now|nearby/i);
    expect(cards[0]!.etaLabel).toMatch(/^~/);
  });

  it("marks still-active relevance for unexpired NWS ahead", () => {
    const cards = buildRouteAheadGlanceCards({
      items: [baseItem({})],
      totalMeters: 80000,
      userAlongMeters: 0,
      planEtaMinutes: 60,
    });
    expect(cards[0]!.relevance).toBe("active");
  });

  it("uses Now for hazards at current position", () => {
    const cards = buildRouteAheadGlanceCards({
      items: [baseItem({ startMeters: 1000, endMeters: 3000 })],
      totalMeters: 80000,
      userAlongMeters: 2000,
      planEtaMinutes: 60,
    });
    expect(cards[0]!.aheadLabel).toBe("Now");
    expect(cards[0]!.inside).toBe(true);
  });

  it("marks multiple overlapping hazards as inside at once", () => {
    const cards = buildRouteAheadGlanceCards({
      items: [
        baseItem({ id: "flood", startMeters: 1000, endMeters: 5000, label: "Flood" }),
        baseItem({ id: "wind", startMeters: 2000, endMeters: 6000, label: "Wind" }),
        baseItem({ id: "ahead", startMeters: 9000, endMeters: 12000, label: "Ahead" }),
      ],
      totalMeters: 80000,
      userAlongMeters: 3000,
      planEtaMinutes: 60,
    });
    expect(cards.filter((c) => c.inside).map((c) => c.id)).toEqual(["flood", "wind"]);
    expect(cards.find((c) => c.id === "ahead")?.inside).toBe(false);
  });

  it("clears inside once the hazard is passed", () => {
    const cards = buildRouteAheadGlanceCards({
      items: [baseItem({ startMeters: 1000, endMeters: 3000 })],
      totalMeters: 80000,
      userAlongMeters: 3500,
      planEtaMinutes: 60,
    });
    expect(cards).toHaveLength(0);
  });

  it("does not surface purple RAD cards in the route-info glance list", () => {
    const cards = buildRouteAheadGlanceCards({
      items: [
        baseItem({
          id: "radar-band",
          track: "radar",
          severity: "serious",
          label: "Steady rain along much of your route",
          startMeters: 50_000,
          endMeters: 80_000,
        }),
        baseItem({ id: "warning", stripMuted: false, label: "Flash Flood Warning" }),
      ],
      totalMeters: 80_000,
      userAlongMeters: 0,
      planEtaMinutes: 90,
    });
    expect(cards).toHaveLength(1);
    expect(cards.every((c) => c.track !== "radar")).toBe(true);
  });

  it("excludes strip-muted minor flood from route status cards", () => {
    const cards = buildRouteAheadGlanceCards({
      items: [
        baseItem({ id: "minor-flood", stripMuted: true, severity: "info", label: "Flood Advisory" }),
        baseItem({ id: "warning", stripMuted: false, label: "Flash Flood Warning" }),
      ],
      totalMeters: 80_000,
      userAlongMeters: 0,
      planEtaMinutes: 90,
    });
    expect(cards).toHaveLength(1);
    expect(cards.map((c) => c.label)).not.toContain("Flood Advisory");
    expect(cards.map((c) => c.label)).toContain("Flash Flood Warning");
  });
});

describe("timelineToProgressStripBands", () => {
  it("skips strip-muted and non-serious items on the progress rail", () => {
    const bands = timelineToProgressStripBands([
      baseItem({ id: "minor-flood", stripMuted: true, severity: "info", label: "Flood Advisory" }),
      baseItem({ id: "wind-adv", stripMuted: false, severity: "caution", label: "Wind Advisory" }),
      baseItem({ id: "warning", stripMuted: false, label: "Flash Flood Warning" }),
    ]);
    expect(bands).toHaveLength(1);
    expect(bands[0]!.severity).toBe("serious");
  });

  it("never paints Tomorrow.io forecast bands on the progress strip", () => {
    const bands = timelineToProgressStripBands([
      baseItem({
        id: "forecast-summary",
        track: "forecast",
        severity: "serious",
        label: "Rain along much of your route",
        startMeters: 0,
        endMeters: 50_000,
      }),
    ]);
    expect(bands).toHaveLength(0);
  });

  it("keeps coarse far-route bands unless omitCoarsePreview is set", () => {
    const coarse = baseItem({
      id: "far-svr",
      coarsePreview: true,
      label: "Severe Thunderstorm Warning",
      startMeters: 200_000,
      endMeters: 240_000,
    });
    expect(timelineToProgressStripBands([coarse])).toHaveLength(1);
    expect(timelineToProgressStripBands([coarse], { omitCoarsePreview: true })).toHaveLength(0);
  });
});

describe("timelineItemShowsOnRouteLine", () => {
  it("allows serious and avoid only", () => {
    expect(timelineItemShowsOnRouteLine(baseItem({ severity: "serious" }))).toBe(true);
    expect(timelineItemShowsOnRouteLine(baseItem({ severity: "avoid" }))).toBe(true);
    expect(timelineItemShowsOnRouteLine(baseItem({ severity: "caution" }))).toBe(false);
    expect(timelineItemShowsOnRouteLine(baseItem({ severity: "info", stripMuted: true }))).toBe(
      false
    );
  });
});

describe("timelineItemShowsOnRouteGraph", () => {
  it("includes strip-muted NWS on the route-info graph rail", () => {
    expect(
      timelineItemShowsOnRouteGraph(
        baseItem({ track: "nws", severity: "serious", stripMuted: true, label: "Flood Warning" })
      )
    ).toBe(true);
    expect(
      timelineItemShowsOnRouteGraph(baseItem({ track: "road", severity: "caution", stripMuted: true }))
    ).toBe(false);
  });
});

describe("buildRouteAheadCalloutSegments", () => {
  it("excludes strip-muted minor flood from route status text", () => {
    const segments = buildRouteAheadCalloutSegments({
      items: [
        baseItem({ id: "minor-flood", stripMuted: true, severity: "info", label: "Flood Advisory" }),
        baseItem({ id: "warning", stripMuted: false, label: "Flash Flood Warning" }),
      ],
      totalMeters: 80_000,
      userAlongMeters: 0,
      planEtaMinutes: 90,
    });
    expect(segments).toHaveLength(1);
    expect(segments.some((s) => s.title.includes("Flood Advisory"))).toBe(false);
    expect(segments.some((s) => s.title.includes("Flash Flood Warning"))).toBe(true);
  });
});
