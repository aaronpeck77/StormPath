import { describe, expect, it } from "vitest";
import {
  driveFollowCamAllowsSetCenterHotLoop,
  pickDriveFollowCamWrite,
  shouldRepairFollowCamStall,
} from "../driveFollowCamWrite";

describe("drive follow-cam writes", () => {
  it("never uses setCenter on the 60fps Drive loop (yard-line offset fight)", () => {
    expect(driveFollowCamAllowsSetCenterHotLoop()).toBe(false);
  });

  it("jumps with offset when the puck or bearing moved", () => {
    expect(
      pickDriveFollowCamWrite({
        camMoved: true,
        bearingMoved: false,
        applyLayoutOrEntry: false,
      })
    ).toBe("jump_with_offset");
  });

  it("skips a camera write when nothing moved", () => {
    expect(
      pickDriveFollowCamWrite({
        camMoved: false,
        bearingMoved: false,
        applyLayoutOrEntry: false,
      })
    ).toBe("skip");
  });

  it("does not repair stall every few frames (that was the up/down road jitter)", () => {
    expect(
      shouldRepairFollowCamStall({
        stalledFrames: 3,
        lastRepairAtMs: 0,
        nowMs: 50,
      })
    ).toBe(false);
    expect(
      shouldRepairFollowCamStall({
        stalledFrames: 8,
        lastRepairAtMs: 10_000,
        nowMs: 10_200,
      })
    ).toBe(false);
    expect(
      shouldRepairFollowCamStall({
        stalledFrames: 8,
        lastRepairAtMs: 1_000,
        nowMs: 3_000,
      })
    ).toBe(true);
  });
});
