import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
  CapacitorHttp: { request: vi.fn() },
}));

import { Capacitor } from "@capacitor/core";
import {
  buildTomorrowIoRadarFrames,
  canUseTomorrowIoMapRasterTiles,
  isInTomorrowIoUsPrecipRegion,
  resolveTomorrowIoMapTileBase,
  tomorrowIoPrecipTileUrlTemplate,
  TOMORROW_IO_RADAR_MAX_ZOOM,
  verifyTomorrowIoRadarTileAccess,
  resetTomorrowIoRadarTileProbeCache,
} from "../tomorrowIoRadarTiles";

describe("tomorrowIoRadarTiles", () => {
  beforeEach(() => {
    resetTomorrowIoRadarTileProbeCache();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  });
  it("flags CONUS, Alaska, and Hawaii", () => {
    expect(isInTomorrowIoUsPrecipRegion(-98, 39)).toBe(true);
    expect(isInTomorrowIoUsPrecipRegion(-150, 62)).toBe(true);
    expect(isInTomorrowIoUsPrecipRegion(-157, 21)).toBe(true);
    expect(isInTomorrowIoUsPrecipRegion(-0.1, 51)).toBe(false);
    expect(isInTomorrowIoUsPrecipRegion(10, 48)).toBe(false);
  });

  it("builds 12 animation frames by default at 5-minute steps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T21:40:00.000Z"));
    const frames = buildTomorrowIoRadarFrames();
    expect(frames.length).toBeGreaterThanOrEqual(12);
    expect(frames.at(-1)!.path).toBe("2026-06-22T21:40:00Z");
    expect(frames[0]!.time).toBeLessThan(frames.at(-1)!.time);
    const spanMin = (frames.at(-1)!.time - frames[0]!.time) / 60;
    expect(spanMin).toBeGreaterThanOrEqual(50);
    vi.useRealTimers();
  });

  it("builds observed frames newest-last with 10-minute steps when configured", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T18:00:00.000Z"));
    const frames = buildTomorrowIoRadarFrames({ windowMin: 30, stepMin: 10 });
    expect(frames).toHaveLength(4);
    expect(frames[0]!.time).toBeLessThan(frames.at(-1)!.time);
    expect(frames.at(-1)!.path).toBe("2026-06-22T18:00:00Z");
    vi.useRealTimers();
  });

  it("emits a Mapbox tile template with encoded timestamp", () => {
    const url = tomorrowIoPrecipTileUrlTemplate("abc123", "2026-06-22T18:00:00Z");
    expect(url).toContain("/{z}/{x}/{y}/precipitationIntensity/");
    expect(url).toContain("apikey=abc123");
    expect(TOMORROW_IO_RADAR_MAX_ZOOM).toBeGreaterThan(7);
  });

  it("uses a CORS-friendly proxy for map tiles on native Capacitor", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    expect(canUseTomorrowIoMapRasterTiles()).toBe(true);
    const base = resolveTomorrowIoMapTileBase();
    expect(base).toContain("tomorrow-io-tile");
    const url = tomorrowIoPrecipTileUrlTemplate("key", "now");
    expect(url).toContain(base);
    expect(url).toContain("apikey=key");
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  });

  it("probes tile access on native via CapacitorHttp", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    const { CapacitorHttp } = await import("@capacitor/core");
    vi.mocked(CapacitorHttp.request).mockResolvedValueOnce({ status: 200, data: "" } as never);
    await expect(verifyTomorrowIoRadarTileAccess("key")).resolves.toBe(true);
    expect(CapacitorHttp.request).toHaveBeenCalled();
  });
});
