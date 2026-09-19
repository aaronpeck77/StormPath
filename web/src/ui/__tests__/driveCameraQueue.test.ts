import { describe, expect, it } from "vitest";

import {
  driveCameraCommandFreezes,
  driveCameraCommandWrites,
  resolveDriveCameraCommand,
  type DriveCameraFrame,
} from "../driveCameraQueue";

function frame(over: Partial<DriveCameraFrame> = {}): DriveCameraFrame {
  return {
    droneActive: false,
    flyWindowOpen: false,
    radioHold: false,
    writeFailStreak: 0,
    failFreezeAfter: 3,
    resyncRequested: false,
    exploring: false,
    parkedHold: false,
    poseChanged: true,
    writer: "pan",
    ...over,
  };
}

describe("resolveDriveCameraCommand", () => {
  it("writes the normal follow frame", () => {
    const cmd = resolveDriveCameraCommand(frame());
    expect(cmd).toEqual({ kind: "write", writer: "pan", resync: false });
    expect(driveCameraCommandWrites(cmd)).toBe(true);
  });

  it("drone outranks everything, including a pending resync", () => {
    expect(
      resolveDriveCameraCommand(frame({ droneActive: true, resyncRequested: true, radioHold: true }))
    ).toEqual({ kind: "yield", reason: "drone" });
  });

  it("yields through the post-drone landing window", () => {
    expect(resolveDriveCameraCommand(frame({ flyWindowOpen: true }))).toEqual({
      kind: "yield",
      reason: "fly_window",
    });
  });

  it("radio hold beats a resync so the camera never walks onto dead tiles", () => {
    const cmd = resolveDriveCameraCommand(frame({ radioHold: true, resyncRequested: true }));
    expect(cmd).toEqual({ kind: "freeze", reason: "radio_hold" });
    expect(driveCameraCommandFreezes(cmd)).toBe(true);
  });

  it("takes the one snap once the hold clears", () => {
    expect(resolveDriveCameraCommand(frame({ radioHold: false, resyncRequested: true }))).toEqual({
      kind: "write",
      writer: "pan",
      resync: true,
    });
  });

  it("freezes after the weak-tile fail streak", () => {
    expect(resolveDriveCameraCommand(frame({ writeFailStreak: 3 }))).toEqual({
      kind: "freeze",
      reason: "weak_tiles",
    });
  });

  it("a resync breaks the weak-tile freeze (435 deadlock)", () => {
    expect(
      resolveDriveCameraCommand(frame({ writeFailStreak: 9, resyncRequested: true, writer: "hard" }))
    ).toEqual({ kind: "write", writer: "hard", resync: true });
  });

  it("does not fight the driver mid-pinch", () => {
    expect(resolveDriveCameraCommand(frame({ exploring: true }))).toEqual({
      kind: "idle",
      reason: "exploring",
    });
  });

  it("a resync still re-pins while exploring is being exited", () => {
    expect(resolveDriveCameraCommand(frame({ exploring: true, resyncRequested: true }))).toEqual({
      kind: "write",
      writer: "pan",
      resync: true,
    });
  });

  it("holds still when parked and when the pose did not move", () => {
    expect(resolveDriveCameraCommand(frame({ parkedHold: true }))).toEqual({
      kind: "idle",
      reason: "parked",
    });
    expect(resolveDriveCameraCommand(frame({ poseChanged: false }))).toEqual({
      kind: "idle",
      reason: "no_change",
    });
  });

  it("never reports a write for a yield/freeze/idle frame", () => {
    for (const f of [
      frame({ droneActive: true }),
      frame({ radioHold: true }),
      frame({ writeFailStreak: 5 }),
      frame({ poseChanged: false }),
    ]) {
      expect(driveCameraCommandWrites(resolveDriveCameraCommand(f))).toBe(false);
    }
  });
});
