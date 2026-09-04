import { describe, expect, it } from "vitest";
import {
  advanceFollowCamWriter,
  driveFollowCamAllowsSetCenterHotLoop,
  pickDriveFollowCamWrite,
  shouldRepairFollowCamStall,
  FOLLOW_CAM_PAN_FAIL_FRAMES_TO_HARD,
  FOLLOW_CAM_STYLE_OK_FRAMES_TO_PAN,
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

  it("does not flip writer every frame when style loaded flaps (three-angle blur)", () => {
    let writer: FollowCamWriter = "pan";
    let styleOkStreak = 0;
    let panFailStreak = 0;
    const writers: FollowCamWriter[] = [];
    for (let i = 0; i < 20; i++) {
      const styleLoaded = i % 2 === 0;
      if (writer === "pan" && !styleLoaded) panFailStreak += 1;
      if (writer === "pan" && styleLoaded) panFailStreak = 0;
      const next = advanceFollowCamWriter({
        holdTiles: false,
        styleLoaded,
        writer,
        styleOkStreak,
        panFailStreak,
      });
      writer = next.writer;
      styleOkStreak = next.styleOkStreak;
      panFailStreak = next.panFailStreak;
      writers.push(writer);
    }
    expect(new Set(writers)).toEqual(new Set(["pan"]));
  });

  it("stays on hard while style loaded flaps (does not snap back to yard-line pan)", () => {
    let writer: FollowCamWriter = "hard";
    let styleOkStreak = 0;
    let panFailStreak = 0;
    for (let i = 0; i < 20; i++) {
      const next = advanceFollowCamWriter({
        holdTiles: false,
        styleLoaded: i % 2 === 0,
        writer,
        styleOkStreak,
        panFailStreak,
      });
      writer = next.writer;
      styleOkStreak = next.styleOkStreak;
      panFailStreak = next.panFailStreak;
    }
    expect(writer).toBe("hard");
  });

  it("holds hard while tiles are held, then waits for a stable style before pan", () => {
    let next = advanceFollowCamWriter({
      holdTiles: true,
      styleLoaded: true,
      writer: "pan",
      styleOkStreak: 0,
      panFailStreak: 0,
    });
    expect(next.writer).toBe("hard");

    next = { writer: "hard", styleOkStreak: 0, panFailStreak: 0 };
    for (let i = 0; i < FOLLOW_CAM_STYLE_OK_FRAMES_TO_PAN - 1; i++) {
      next = advanceFollowCamWriter({
        holdTiles: false,
        styleLoaded: true,
        writer: next.writer,
        styleOkStreak: next.styleOkStreak,
        panFailStreak: next.panFailStreak,
      });
      expect(next.writer).toBe("hard");
    }
    next = advanceFollowCamWriter({
      holdTiles: false,
      styleLoaded: true,
      writer: next.writer,
      styleOkStreak: next.styleOkStreak,
      panFailStreak: next.panFailStreak,
    });
    expect(next.writer).toBe("pan");
  });

  it("does not leave pan on the first failed easeTo", () => {
    const next = advanceFollowCamWriter({
      holdTiles: false,
      styleLoaded: false,
      writer: "pan",
      styleOkStreak: 0,
      panFailStreak: 1,
    });
    expect(next.writer).toBe("pan");
  });

  it("switches to hard only after consecutive pan failures (Wi-Fi drop)", () => {
    const next = advanceFollowCamWriter({
      holdTiles: false,
      styleLoaded: false,
      writer: "pan",
      styleOkStreak: 0,
      panFailStreak: FOLLOW_CAM_PAN_FAIL_FRAMES_TO_HARD,
    });
    expect(next.writer).toBe("hard");
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
