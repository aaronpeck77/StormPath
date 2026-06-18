import { describe, expect, it } from "vitest";
import { buildRouteAheadCalloutSegments, buildRouteAheadGlanceCards, timelineToProgressStripBands } from "../routeAheadSync";
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

  it("skips strip-muted minor flood cards", () => {
    const cards = buildRouteAheadGlanceCards({
      items: [
        baseItem({ id: "minor-flood", stripMuted: true, label: "Flood Advisory" }),
        baseItem({ id: "warning", stripMuted: false, label: "Flash Flood Warning" }),
      ],
      totalMeters: 80_000,
      userAlongMeters: 0,
      planEtaMinutes: 90,
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.label).toBe("Flash Flood Warning");
  });
});

describe("timelineToProgressStripBands", () => {
  it("skips strip-muted minor flood items on the progress rail", () => {
    const bands = timelineToProgressStripBands([
      baseItem({ id: "minor-flood", stripMuted: true, label: "Flood Advisory" }),
      baseItem({ id: "warning", stripMuted: false, label: "Flash Flood Warning" }),
    ]);
    expect(bands).toHaveLength(1);
    expect(bands[0]!.severity).toBe("serious");
  });
});

describe("buildRouteAheadCalloutSegments", () => {
  it("omits strip-muted minor flood rows from the progress info panel", () => {
    const segments = buildRouteAheadCalloutSegments({
      items: [
        baseItem({ id: "minor-flood", stripMuted: true, label: "Flood Advisory" }),
        baseItem({ id: "warning", stripMuted: false, label: "Flash Flood Warning" }),
      ],
      totalMeters: 80_000,
      userAlongMeters: 0,
      planEtaMinutes: 90,
    });
    expect(segments).toHaveLength(1);
    expect(segments[0]!.title).toContain("Flash Flood Warning");
  });
});
