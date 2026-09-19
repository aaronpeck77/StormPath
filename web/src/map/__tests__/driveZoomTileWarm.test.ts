import { describe, expect, it } from "vitest";
import type { LngLat } from "../../nav/types";
import {
  DRIVE_WARM_OVERLAP_M,
  DRIVE_WARM_WINDOW_M,
  DRIVE_WARM_ZOOMS,
  driveZoomWindowBounds,
  nextDriveZoomWindowStartM,
  shouldRunDriveZoomWarm,
  shouldWarmNextDriveZoomWindow,
} from "../driveZoomTileWarm";
import { CORRIDOR_PAD_M, corridorWindowBounds } from "../routeCorridorPreload";

/** ~eastbound line near Decatur IL, the park-loop corridor. */
function line(): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i < 60; i++) out.push([-88.95 + i * 0.01, 39.84]);
  return out;
}

function boxWidthDeg(b: [[number, number], [number, number]]): number {
  return b[1][0] - b[0][0];
}

describe("driveZoomTileWarm", () => {
  it("warms the zooms Drive renders from, not the regional set", () => {
    expect([...DRIVE_WARM_ZOOMS]).toEqual([15, 16]);
  });

  it("is a much shorter window than the regional corridor warm", () => {
    const drive = driveZoomWindowBounds(line(), 0);
    const regional = corridorWindowBounds(line(), 0);
    expect(drive).not.toBeNull();
    expect(regional).not.toBeNull();
    expect(boxWidthDeg(drive!)).toBeLessThan(boxWidthDeg(regional!));
  });

  it("pads tighter than the regional window (tiles grow with the square of pad)", () => {
    const b = driveZoomWindowBounds([[-88.9, 39.84], [-88.8, 39.84]], 0)!;
    const regionalPadDeg = CORRIDOR_PAD_M / 111_320;
    const drivePadDeg = (b[1][1] - b[0][1]) / 2;
    expect(drivePadDeg).toBeLessThan(regionalPadDeg);
  });

  it("slides with overlap so the seam is already warm", () => {
    const next = nextDriveZoomWindowStartM(0);
    expect(next).toBe(DRIVE_WARM_WINDOW_M - DRIVE_WARM_OVERLAP_M);
    expect(next).toBeLessThan(DRIVE_WARM_WINDOW_M);
  });

  it("triggers the next window about 2 mi before the current one runs out", () => {
    expect(shouldWarmNextDriveZoomWindow(1_000, 0)).toBe(false);
    expect(shouldWarmNextDriveZoomWindow(DRIVE_WARM_WINDOW_M - 1_000, 0)).toBe(true);
  });

  it("does not warm on a held radio, offline, mid-flight, or before Go", () => {
    const base = {
      navigationStarted: true,
      isOnline: true,
      holdLastGoodMap: false,
      inFlight: false,
    };
    expect(shouldRunDriveZoomWarm(base)).toBe(true);
    expect(shouldRunDriveZoomWarm({ ...base, holdLastGoodMap: true })).toBe(false);
    expect(shouldRunDriveZoomWarm({ ...base, isOnline: false })).toBe(false);
    expect(shouldRunDriveZoomWarm({ ...base, inFlight: true })).toBe(false);
    expect(shouldRunDriveZoomWarm({ ...base, navigationStarted: false })).toBe(false);
  });

  it("returns null for a route it cannot measure", () => {
    expect(driveZoomWindowBounds([], 0)).toBeNull();
    expect(driveZoomWindowBounds([[-88.9, 39.84]], 0)).toBeNull();
  });
});
