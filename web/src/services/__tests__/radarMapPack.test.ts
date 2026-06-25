import { describe, expect, it, vi } from "vitest";
import {
  animationCellsForPack,
  radarMapProviderForCenter,
  radarTileUrlForFrame,
  resolveRadarMapPack,
} from "../radarMapPack";
import { fetchRainViewerRadarFrames } from "../rainViewerRadar";
import { buildTomorrowIoRadarFrames, canUseTomorrowIoMapRasterTiles } from "../tomorrowIoRadarTiles";

vi.mock("../tomorrowIoRadarTiles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tomorrowIoRadarTiles")>();
  return {
    ...actual,
    canUseTomorrowIoMapRasterTiles: vi.fn(() => true),
    verifyTomorrowIoRadarTileAccess: vi.fn(async () => true),
  };
});

vi.mock("../rainViewerRadar", () => ({
  fetchRainViewerRadarFrames: vi.fn(),
  RAINVIEWER_RADAR_MAX_ZOOM: 7,
  tileUrlFromHostAndPath: (host: string, path: string) => `https://${host}${path}`,
}));

describe("radarMapPack", () => {
  it("picks Tomorrow.io for US centers when a key is present", () => {
    expect(radarMapProviderForCenter([-98, 39], "key")).toBe("tomorrow_io");
    expect(radarMapProviderForCenter([2, 48], "key")).toBe("rainviewer");
    expect(radarMapProviderForCenter([-98, 39], "")).toBe("rainviewer");
  });

  it("resolves a Tomorrow.io pack without RainViewer fetch when not animating", async () => {
    const pack = await resolveRadarMapPack([-98, 39], "abc", { mapAnimation: false });
    expect(pack?.provider).toBe("tomorrow_io");
    expect(pack?.frames.length).toBeGreaterThan(1);
    expect(fetchRainViewerRadarFrames).not.toHaveBeenCalled();
  });

  it("hybrid US map animation appends RainViewer nowcast after Tomorrow.io past", async () => {
    const latestTioSec = buildTomorrowIoRadarFrames().at(-1)!.time;
    vi.mocked(fetchRainViewerRadarFrames).mockResolvedValue({
      host: "tilecache.rainviewer.com",
      frames: [
        { time: latestTioSec + 600, path: "/nowcast/1" },
        { time: latestTioSec + 1200, path: "/nowcast/2" },
      ],
    });
    const pack = await resolveRadarMapPack([-98, 39], "abc", { mapAnimation: true });
    expect(pack?.provider).toBe("hybrid");
    expect(fetchRainViewerRadarFrames).toHaveBeenCalledWith({
      nowcastOnly: true,
      mapAnimation: true,
    });
    expect(pack?.frames.some((f) => f.tileProvider === "rainviewer")).toBe(true);
    expect(pack?.frames.some((f) => f.tileProvider === "tomorrow_io")).toBe(true);
    const cells = animationCellsForPack(pack!);
    expect(cells.at(-1)?.tileProvider).toBe("rainviewer");
  });

  it("includes RainViewer nowcast for map animation outside the US", async () => {
    vi.mocked(fetchRainViewerRadarFrames).mockResolvedValue({
      host: "tilecache.rainviewer.com",
      frames: [
        { time: 1, path: "/past" },
        { time: 9999, path: "/nowcast" },
      ],
    });
    const pack = await resolveRadarMapPack([2, 48], "abc", { mapAnimation: true });
    expect(pack?.provider).toBe("rainviewer");
    expect(fetchRainViewerRadarFrames).toHaveBeenCalledWith({
      includeNowcast: true,
      mapAnimation: true,
    });
  });

  it("builds tile URLs per provider", () => {
    const tioPack = {
      provider: "tomorrow_io" as const,
      host: "",
      frames: buildTomorrowIoRadarFrames({ windowMin: 0, stepMin: 10 }),
      maxZoom: 10,
      attribution: "",
    };
    expect(radarTileUrlForFrame(tioPack, tioPack.frames[0]!, "secret")).toContain("apikey=secret");

    const rvPack = {
      provider: "rainviewer" as const,
      host: "tilecache.rainviewer.com",
      frames: [{ time: 1, path: "/v2/radar/1/256/1_1.png" }],
      maxZoom: 7,
      attribution: "",
    };
    expect(radarTileUrlForFrame(rvPack, rvPack.frames[0]!)).toContain("tilecache.rainviewer.com");

    const hybridPack = {
      provider: "hybrid" as const,
      host: "tilecache.rainviewer.com",
      frames: [
        { time: 1, path: "2026-06-22T18:00:00Z", tileProvider: "tomorrow_io" as const },
        { time: 2, path: "/nowcast", tileProvider: "rainviewer" as const },
      ],
      maxZoom: 10,
      attribution: "",
    };
    expect(radarTileUrlForFrame(hybridPack, hybridPack.frames[0]!, "secret")).toContain("apikey=secret");
    expect(radarTileUrlForFrame(hybridPack, hybridPack.frames[1]!, "secret")).toContain("tilecache.rainviewer.com");
  });

  it("can force RainViewer for ETA nowcast even in the US", async () => {
    vi.mocked(fetchRainViewerRadarFrames).mockResolvedValue({
      host: "tilecache.rainviewer.com",
      frames: [
        { time: 1, path: "/past" },
        { time: 9999, path: "/nowcast" },
      ],
    });
    const pack = await resolveRadarMapPack([-98, 39], "abc", {
      includeNowcast: true,
      forceRainViewer: true,
    });
    expect(pack?.provider).toBe("rainviewer");
    expect(fetchRainViewerRadarFrames).toHaveBeenCalledWith({
      includeNowcast: true,
      mapAnimation: false,
    });
  });

  it("falls back to RainViewer when Tomorrow.io map tiles are unavailable", async () => {
    vi.mocked(canUseTomorrowIoMapRasterTiles).mockReturnValueOnce(false);
    vi.mocked(fetchRainViewerRadarFrames).mockResolvedValue({
      host: "tilecache.rainviewer.com",
      frames: [{ time: 1, path: "/v2/radar/1/256/1_1.png" }],
    });
    const pack = await resolveRadarMapPack([-98, 39], "abc", { mapAnimation: true });
    expect(pack?.provider).toBe("rainviewer");
    expect(fetchRainViewerRadarFrames).toHaveBeenCalled();
  });

  it("limits animation frames per provider", () => {
    const tioFrames = buildTomorrowIoRadarFrames();
    const tio = animationCellsForPack({
      provider: "tomorrow_io",
      host: "",
      frames: tioFrames,
      maxZoom: 10,
      attribution: "",
    });
    expect(tio).toHaveLength(12);

    const rv = animationCellsForPack({
      provider: "rainviewer",
      host: "h",
      frames: [
        { time: 1, path: "a" },
        { time: 2, path: "b" },
        { time: 3, path: "c" },
        { time: 4, path: "d" },
        { time: 5, path: "e" },
      ],
      maxZoom: 7,
      attribution: "",
    });
    expect(rv).toHaveLength(5);
    expect(rv[4]!.path).toBe("e");
  });
});
