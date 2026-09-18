import { describe, expect, it } from "vitest";
import {
  DRIVE_CAMERA_BEARING_TC_S,
  DRIVE_CAMERA_ZOOM_TC_S,
  DRIVE_PUCK_BLEND_FREE_TC_S,
  DRIVE_PUCK_BLEND_SNAPPED_TC_S,
  DRIVE_SNAP_ALONG_TC_S,
  drivePuckBlendTcS,
  smoothDriveZoom,
} from "../driveFollowSmooth";

describe("driveFollowSmooth", () => {
  it("uses longer glide times than the pre-Sep-17 ticky pair", () => {
    /* Rollback: snapped 0.145 / free 0.095 / along 0.32 / bearing 0.7 / no zoom TC. */
    expect(DRIVE_PUCK_BLEND_SNAPPED_TC_S).toBeGreaterThan(0.145);
    expect(DRIVE_PUCK_BLEND_FREE_TC_S).toBeGreaterThan(0.095);
    expect(DRIVE_SNAP_ALONG_TC_S).toBeGreaterThan(0.32);
    expect(DRIVE_CAMERA_BEARING_TC_S).toBeGreaterThan(0.7);
    expect(DRIVE_CAMERA_ZOOM_TC_S).toBeGreaterThan(0.5);
  });

  it("picks the right puck blend for each motion band", () => {
    expect(drivePuckBlendTcS({ stationary: true, crawling: false, snapped: true })).toBe(2.4);
    expect(drivePuckBlendTcS({ stationary: false, crawling: true, snapped: true })).toBeGreaterThan(
      DRIVE_PUCK_BLEND_SNAPPED_TC_S
    );
    expect(drivePuckBlendTcS({ stationary: false, crawling: false, snapped: true })).toBe(
      DRIVE_PUCK_BLEND_SNAPPED_TC_S
    );
    expect(drivePuckBlendTcS({ stationary: false, crawling: false, snapped: false })).toBe(
      DRIVE_PUCK_BLEND_FREE_TC_S
    );
  });

  it("approaches a new zoom without leaping the whole delta in one frame", () => {
    const next = smoothDriveZoom(16.6, 15.35, 1);
    expect(next).toBeLessThan(16.6);
    expect(next).toBeGreaterThan(15.35);
    expect(16.6 - next).toBeLessThanOrEqual(0.035 + 1e-9);
  });

  it("takes the raw zoom on the first sample", () => {
    expect(smoothDriveZoom(null, 16.6, 0.5)).toBe(16.6);
  });
});
