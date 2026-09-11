import { describe, expect, it } from "vitest";
import {
  DRIVE_FOLLOW_ZOOM_DEFAULT,
  DRIVE_FOLLOW_ZOOM_MIN,
  clampDriveFollowZoom,
  driveFollowBlocksWideFit,
  guardDriveFollowCamera,
  isDriveContinentZoom,
  rememberDriveFollowZoom,
  repairStoredDriveFollowZoom,
} from "../driveFollowZoomGuard";

describe("drive follow zoom block", () => {
  it("treats Rt/Canada regional zoom as continent-scale", () => {
    expect(isDriveContinentZoom(6.95)).toBe(true);
    expect(isDriveContinentZoom(4)).toBe(true);
    expect(isDriveContinentZoom(DRIVE_FOLLOW_ZOOM_MIN)).toBe(false);
    expect(isDriveContinentZoom(16.35)).toBe(false);
  });

  it("snaps Canada-scale zoom back to street Drive, not the floor", () => {
    expect(clampDriveFollowZoom(6.95)).toBe(DRIVE_FOLLOW_ZOOM_DEFAULT);
    expect(clampDriveFollowZoom(Number.NaN)).toBe(DRIVE_FOLLOW_ZOOM_DEFAULT);
    expect(clampDriveFollowZoom(14.2)).toBe(14.2);
  });

  it("repairs a stored Drive zoom ref that leaked Canada scale", () => {
    const stored = { current: 6.95 };
    expect(repairStoredDriveFollowZoom(stored)).toBe(DRIVE_FOLLOW_ZOOM_DEFAULT);
    expect(stored.current).toBe(DRIVE_FOLLOW_ZOOM_DEFAULT);
  });

  it("does not remember a continent pinch as the Drive follow zoom", () => {
    expect(rememberDriveFollowZoom(6.9, 16.35)).toBe(16.35);
    expect(rememberDriveFollowZoom(15.1, 16.35)).toBe(15.1);
  });

  it("snaps a camera center that flew away from the puck", () => {
    const puck: [number, number] = [-89.6, 39.8];
    const canada: [number, number] = [-96, 62];
    const guarded = guardDriveFollowCamera({
      center: canada,
      zoom: 6.95,
      puck,
    });
    expect(guarded.center).toEqual(puck);
    expect(guarded.zoom).toBe(DRIVE_FOLLOW_ZOOM_DEFAULT);
  });

  it("keeps a center that is still on the puck", () => {
    const puck: [number, number] = [-89.6, 39.8];
    const guarded = guardDriveFollowCamera({
      center: puck,
      zoom: 16.1,
      puck,
    });
    expect(guarded.center).toEqual(puck);
    expect(guarded.zoom).toBe(16.1);
  });

  it("blocks wide fits while Drive follow is active", () => {
    expect(driveFollowBlocksWideFit({ navigationStarted: true, viewMode: "drive" })).toBe(true);
    expect(driveFollowBlocksWideFit({ navigationStarted: true, viewMode: "route" })).toBe(false);
    expect(driveFollowBlocksWideFit({ navigationStarted: false, viewMode: "drive" })).toBe(false);
  });
});
