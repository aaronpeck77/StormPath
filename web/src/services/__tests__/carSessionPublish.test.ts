import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ native: false, publish: vi.fn().mockResolvedValue({ ok: true }), clear: vi.fn() }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => bridge.native } }));
vi.mock("@stormpath/car-session", () => ({ StormpathCarSession: { publish: bridge.publish, clear: bridge.clear } }));

import { buildCarConditions, publishCarSession } from "../carSessionPublish";
import type { TimelineItem } from "../../nav/routeAheadSync";

const hazard: TimelineItem = {
  id: "road-1", track: "road", label: "Road closure", severity: "avoid",
  startMeters: 5000, endMeters: 6000, crossesRoute: true,
  detailLine: "Right lane closed",
};
const base = {
  items: [hazard], userAlongMeters: 1000, totalMeters: 10000,
  driveEtaMinutes: 20, outlook: [], localForecast: null, nowcast: null,
  online: true, isPlus: true,
};

beforeEach(() => {
  bridge.native = false;
  vi.clearAllMocks();
});

describe("CarPlay conditions snapshot", () => {
  it("keeps road and weather hazards from the shared timeline with relevance", () => {
    const sections = buildCarConditions({ ...base, items: [hazard, {
      ...hazard, id: "nws-1", track: "nws", label: "Flood warning", crossesRoute: false,
      etaStale: true,
    }] });
    const rows = sections.find((s) => s.title === "Route hazards")!.items;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.detail).toContain("Right lane closed");
    expect(rows[1]!.detail).toContain("Nearby");
    expect(rows[1]!.detail).toContain("Likely over before you reach it");
  });

  it("drops passed and expired hazards without claiming the road is clear", () => {
    const sections = buildCarConditions({ ...base, items: [
      { ...hazard, endMeters: 900 },
      { ...hazard, expiresIso: "2000-01-01T00:00:00Z" },
    ] });
    expect(sections[0]!.items[0]!.detail).toContain("not proof of a clear road");
  });

  it("labels offline information and withholds Plus-only forecast data", () => {
    const sections = buildCarConditions({ ...base, online: false, isPlus: false });
    expect(sections[0]!.items[0]!.detail).toContain("Offline");
    expect(sections.find((s) => s.title === "Route forecast")!.items[0]!.detail).toContain("Plus");
  });

  it("formats local probabilities as percentages and excludes old local snapshots", () => {
    const localForecast = {
      fetchedAt: Date.now(), lat: 38, lng: -90, provider: "tomorrowIo" as const,
      hours: [{ timeIso: new Date(Date.now() + 3600_000).toISOString(), offsetHours: 1,
        tempF: 60, precipIntensityMmh: 2, precipProbability: 0.8, windMph: 12, conditions: "Rain" }],
    };
    const sections = buildCarConditions({ ...base, localForecast });
    expect(sections[2]!.items[0]!.detail).toContain("Precipitation 80%");
    const stale = buildCarConditions({ ...base, localForecast: { ...localForecast, fetchedAt: Date.now() - 3 * 3600_000 } });
    expect(stale[2]!.items[0]!.title).toBe("Forecast unavailable");
  });

  it("preserves forecast temperatures, precipitation, and winds without graph UI", () => {
    const sections = buildCarConditions({ ...base, outlook: [{
      key: "end", shortLabel: "End", fraction: 1, tempF: 61,
      conditions: "Rain", precipPct: 80, precipHint: 0.8, etaLabel: "20 min", windGustMph: 25, icon: "",
    }] });
    const row = sections.find((s) => s.title === "Route forecast")!.items[0]!;
    expect(row.detail).toContain("61°F");
    expect(row.detail).toContain("80%");
    expect(row.detail).toContain("25 mph");
  });
});

describe("CarPlay native bridge", () => {
  it("does nothing on web", async () => {
    await publishCarSession({ navigating: true });
    expect(bridge.publish).not.toHaveBeenCalled();
  });

  it("publishes conditions and map configuration without starting navigation", async () => {
    bridge.native = true;
    const conditions = buildCarConditions(base);
    await publishCarSession({ navigating: false, destinationLabel: "Old trip",
      advisoryLine: "Old advisory", maneuverLine: "Old turn", conditions,
      radarTileBase: "https://stormpath2.netlify.app/.netlify/functions/rainviewer-tile", puckColor: "orange" });
    expect(bridge.clear).not.toHaveBeenCalled();
    expect(bridge.publish).toHaveBeenCalledWith(expect.objectContaining({
      navigating: false, destinationLabel: "", advisoryLine: "", maneuverLine: "",
      conditionsJson: JSON.stringify(conditions), puckColor: "orange",
      radarTileBase: "https://stormpath2.netlify.app/.netlify/functions/rainviewer-tile",
    }));
  });

  it("keeps the bridge optional when native publication fails", async () => {
    bridge.native = true;
    bridge.publish.mockRejectedValueOnce(new Error("Unavailable"));
    await expect(publishCarSession({ navigating: true })).resolves.toBeUndefined();
  });
});
