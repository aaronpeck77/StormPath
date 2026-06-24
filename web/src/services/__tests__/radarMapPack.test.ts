import { describe, expect, it, vi } from "vitest";
import {
  animationCellsForPack,
  radarMapProviderForCenter,
  radarTileUrlForFrame,
  resolveRadarMapPack,
} from "../radarMapPack";
import { fetchRainViewerRadarFrames } from "../rainViewerRadar";
import { buildTomorrowIoRadarFrames } from "../tomorrowIoRadarTiles";

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

  it("resolves a Tomorrow.io pack without RainViewer fetch", async () => {
    const pack = await resolveRadarMapPack([-98, 39], "abc");
    expect(pack?.provider).toBe("tomorrow_io");
    expect(pack?.frames.length).toBeGreaterThan(1);
    expect(fetchRainViewerRadarFrames).not.toHaveBeenCalled();
  });

  it("falls back to RainViewer outside the US", async () => {
    vi.mocked(fetchRainViewerRadarFrames).mockResolvedValue({
      host: "tilecache.rainviewer.com",
      frames: [{ time: 1, path: "/v2/radar/1/256/1_1.png" }],
    });
    const pack = await resolveRadarMapPack([2, 48], "abc");
    expect(pack?.provider).toBe("rainviewer");
    expect(pack?.host).toBe("tilecache.rainviewer.com");
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
