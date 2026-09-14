import { describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
}));

import {
  resolveRainViewerTileBase,
  tileUrlFromHostAndPath,
} from "../rainViewerRadar";

describe("rainViewerRadar tile proxy", () => {
  it("builds Mapbox templates through the resolved tile base", () => {
    const url = tileUrlFromHostAndPath(
      "https://tilecache.rainviewer.com",
      "/v2/radar/1699999990",
      "map"
    );
    expect(url).toContain("/v2/radar/1699999990/256/{z}/{x}/{y}/4/0_1.png");
    expect(url.startsWith(resolveRainViewerTileBase())).toBe(true);
    expect(url).not.toContain("tilecache.rainviewer.com");
  });
});
