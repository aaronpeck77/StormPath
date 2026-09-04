import { describe, expect, it } from "vitest";
import {
  advanceFollowCamWriter,
  driveFollowCamAllowsSetCenterHotLoop,
  pickDriveFollowCamWrite,
  shouldRepairFollowCamStall,
  FOLLOW_CAM_HOLD_CLEAR_MS,
  type FollowCamWriter,
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

  it("stays on yard-line pan while tiles flap (no hold) — puck must not leap along the road", () => {
    let writer: FollowCamWriter = "pan";
    let holdFalseSinceMs: number | null = 0;
    const writers: FollowCamWriter[] = [];
    for (let i = 0; i < 40; i++) {
      const next = advanceFollowCamWriter({
        holdTiles: false,
        writer,
        holdFalseSinceMs,
        nowMs: i * 16,
      });
      writer = next.writer;
      holdFalseSinceMs = next.holdFalseSinceMs;
      writers.push(writer);
    }
    expect(new Set(writers)).toEqual(new Set(["pan"]));
  });

  it("does not switch to hard because easeTo failed (that was the forward/back flip)", () => {
    const next = advanceFollowCamWriter({
      holdTiles: false,
      writer: "pan",
      holdFalseSinceMs: 0,
      nowMs: 5_000,
    });
    expect(next.writer).toBe("pan");
  });

  it("goes hard immediately when tiles are held, then waits before returning to pan", () => {
    let next = advanceFollowCamWriter({
      holdTiles: true,
      writer: "pan",
      holdFalseSinceMs: 0,
      nowMs: 10_000,
    });
    expect(next.writer).toBe("hard");
    expect(next.holdFalseSinceMs).toBeNull();

    next = advanceFollowCamWriter({
      holdTiles: false,
      writer: next.writer,
      holdFalseSinceMs: next.holdFalseSinceMs,
      nowMs: 10_000,
    });
    expect(next.writer).toBe("hard");
    expect(next.holdFalseSinceMs).toBe(10_000);

    next = advanceFollowCamWriter({
      holdTiles: false,
      writer: next.writer,
      holdFalseSinceMs: next.holdFalseSinceMs,
      nowMs: 10_000 + FOLLOW_CAM_HOLD_CLEAR_MS - 1,
    });
    expect(next.writer).toBe("hard");

    next = advanceFollowCamWriter({
      holdTiles: false,
      writer: next.writer,
      holdFalseSinceMs: next.holdFalseSinceMs,
      nowMs: 10_000 + FOLLOW_CAM_HOLD_CLEAR_MS,
    });
    expect(next.writer).toBe("pan");
  });

  it("stays hard if the radio flaps during the clear delay", () => {
    let next = advanceFollowCamWriter({
      holdTiles: true,
      writer: "pan",
      holdFalseSinceMs: 0,
      nowMs: 0,
    });
    next = advanceFollowCamWriter({
      holdTiles: false,
      writer: next.writer,
      holdFalseSinceMs: next.holdFalseSinceMs,
      nowMs: 500,
    });
    next = advanceFollowCamWriter({
      holdTiles: true,
      writer: next.writer,
      holdFalseSinceMs: next.holdFalseSinceMs,
      nowMs: 800,
    });
    expect(next.writer).toBe("hard");
    expect(next.holdFalseSinceMs).toBeNull();
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
