import { describe, expect, it } from "vitest";
import {
  advanceFollowCamWriter,
  driveFollowCamAllowsSetCenterHotLoop,
  nativeFollowCamAllowsSameFrameHardFallback,
  pickDriveFollowCamWrite,
  shouldRepairFollowCamStall,
  FOLLOW_CAM_HOLD_CLEAR_MS,
  type FollowCamWriter,
} from "../driveFollowCamWrite";

describe("drive follow-cam writes", () => {
  it("never uses setCenter on the 60fps Drive loop (yard-line offset fight)", () => {
    expect(driveFollowCamAllowsSetCenterHotLoop()).toBe(false);
  });

  it("does not hard-fallback Core-to-web pan in the same frame (two-image flicker)", () => {
    expect(nativeFollowCamAllowsSameFrameHardFallback()).toBe(false);
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

  it("stays on pan when nothing failed and no hold is active", () => {
    const next = advanceFollowCamWriter({
      holdTiles: false,
      writer: "pan",
      holdFalseSinceMs: 0,
      nowMs: 5_000,
    });
    expect(next.writer).toBe("pan");
  });

  /**
   * A failed pan used to be ignored here, because switching writers mid-drive made
   * the puck leap along the road — pan framed at the yard line and `setCenter` framed
   * at midfield. `writeHardFollowToYardLine` removed that difference, so a failed pan
   * is now the most reliable signal that tiles are down and `easeTo` is a no-op.
   */
  it("goes hard on a failed pan and stays there for the clear window", () => {
    const failedAt = 10_000;
    const during = advanceFollowCamWriter({
      holdTiles: false,
      writer: "pan",
      holdFalseSinceMs: 0,
      nowMs: failedAt + 500,
      lastPanFailAtMs: failedAt,
    });
    expect(during.writer).toBe("hard");

    /* 438: the radio said "up" and the writer flipped back to pan every 3 s while
     * tiles were still missing — 137 failed pans, 24 freeze episodes. */
    const stillBad = advanceFollowCamWriter({
      holdTiles: false,
      writer: "hard",
      holdFalseSinceMs: null,
      nowMs: failedAt + FOLLOW_CAM_HOLD_CLEAR_MS - 1,
      lastPanFailAtMs: failedAt,
    });
    expect(stillBad.writer).toBe("hard");
  });

  it("returns to pan once pans have stopped failing for the clear window", () => {
    const failedAt = 10_000;
    const recovered = advanceFollowCamWriter({
      holdTiles: false,
      writer: "hard",
      holdFalseSinceMs: failedAt,
      nowMs: failedAt + FOLLOW_CAM_HOLD_CLEAR_MS + 1,
      lastPanFailAtMs: failedAt,
    });
    expect(recovered.writer).toBe("pan");
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
