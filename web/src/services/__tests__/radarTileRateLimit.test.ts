import { describe, expect, it } from "vitest";
import {
  RADAR_TILE_ERROR_PAUSE_COUNT,
  RADAR_TILE_ERROR_WINDOW_MS,
  radarTileHttpShouldCooldown,
  shouldTripRadarTileErrorPause,
} from "../rainViewerTileFetch";

describe("radarTileHttpShouldCooldown", () => {
  it("treats only HTTP 429 as a rate-limit cooldown", () => {
    expect(radarTileHttpShouldCooldown(429)).toBe(true);
    expect(radarTileHttpShouldCooldown(500)).toBe(false);
    expect(radarTileHttpShouldCooldown(502)).toBe(false);
    expect(radarTileHttpShouldCooldown(503)).toBe(false);
    expect(radarTileHttpShouldCooldown(404)).toBe(false);
    expect(radarTileHttpShouldCooldown(200)).toBe(false);
  });
});

describe("shouldTripRadarTileErrorPause", () => {
  it("ignores a single failed tile (Wi-Fi drop, edge of coverage)", () => {
    expect(shouldTripRadarTileErrorPause([10_000], 10_100)).toBe(false);
  });

  it("trips only after a burst of failures in the window", () => {
    const start = 50_000;
    const times = Array.from({ length: RADAR_TILE_ERROR_PAUSE_COUNT }, (_, i) => start + i * 80);
    expect(shouldTripRadarTileErrorPause(times, start + 700)).toBe(true);
  });

  it("forgets errors outside the window", () => {
    const now = 80_000;
    const stale = Array.from(
      { length: RADAR_TILE_ERROR_PAUSE_COUNT },
      (_, i) => now - RADAR_TILE_ERROR_WINDOW_MS - 1_000 - i
    );
    expect(shouldTripRadarTileErrorPause(stale, now)).toBe(false);
  });
});
