import { describe, expect, it } from "vitest";
import {
  DRIVE_CAMERA_BEARING_MAX_STEP_DEG,
  DRIVE_CAMERA_BEARING_TC_S,
} from "../driveFollowSmooth";
import { DRIVE_PUCK_ANCHOR_SEVERE_DRIFT_PX } from "../drivePuckHealth";
import {
  DRIVE_CAMERA_HEADING_REPAIR_COOLDOWN_MS,
  DRIVE_CAMERA_HEALTH_POLL_MS,
  driveBearingCatchUp,
  jeffRepairCooldownMs,
  shouldReclaimDrivePuckThisFrame,
} from "../driveCameraRules";

describe("driveBearingCatchUp", () => {
  it("keeps the cruise glide on a straight highway", () => {
    expect(driveBearingCatchUp(4)).toEqual({
      tcS: DRIVE_CAMERA_BEARING_TC_S,
      maxStepDeg: DRIVE_CAMERA_BEARING_MAX_STEP_DEG,
    });
  });

  it("rights a corner faster than the cruise 1s glide", () => {
    const corner = driveBearingCatchUp(20);
    expect(corner.tcS).toBeLessThan(DRIVE_CAMERA_BEARING_TC_S);
    expect(corner.maxStepDeg).toBeGreaterThan(DRIVE_CAMERA_BEARING_MAX_STEP_DEG);
  });

  it("takes a sharper step on a 90-degree turn", () => {
    const sharp = driveBearingCatchUp(90);
    const corner = driveBearingCatchUp(20);
    expect(sharp.tcS).toBeLessThan(corner.tcS);
    expect(sharp.maxStepDeg).toBeGreaterThan(corner.maxStepDeg);
  });
});

describe("shouldReclaimDrivePuckThisFrame", () => {
  it("yanks the camera when the puck left the canvas", () => {
    expect(
      shouldReclaimDrivePuckThisFrame({
        exploring: false,
        offCanvas: true,
        driftPx: null,
        speedMps: 2,
      })
    ).toBe(true);
  });

  it("yanks when the puck has climbed far off the yard-line while moving", () => {
    expect(
      shouldReclaimDrivePuckThisFrame({
        exploring: false,
        offCanvas: false,
        driftPx: DRIVE_PUCK_ANCHOR_SEVERE_DRIFT_PX,
        speedMps: 15,
      })
    ).toBe(true);
  });

  it("does not fight a pinch/pan", () => {
    expect(
      shouldReclaimDrivePuckThisFrame({
        exploring: true,
        offCanvas: true,
        driftPx: 400,
        speedMps: 20,
      })
    ).toBe(false);
  });

  it("ignores on-canvas severe drift while crawling", () => {
    expect(
      shouldReclaimDrivePuckThisFrame({
        exploring: false,
        offCanvas: false,
        driftPx: 200,
        speedMps: 1,
      })
    ).toBe(false);
  });
});

describe("jeffRepairCooldownMs", () => {
  it("polls faster than the old 1.5s / 15s watchdog", () => {
    expect(DRIVE_CAMERA_HEALTH_POLL_MS).toBeLessThan(1_500);
    expect(DRIVE_CAMERA_HEADING_REPAIR_COOLDOWN_MS).toBeLessThan(15_000);
  });

  it("does not wait to repair a severe puck miss", () => {
    expect(jeffRepairCooldownMs({ puckReady: true, puckSevere: true })).toBe(0);
  });
});
