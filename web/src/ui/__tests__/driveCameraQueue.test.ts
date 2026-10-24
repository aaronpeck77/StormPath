import { describe, expect, it } from "vitest";

import {
  driveCameraCommandDegraded,
  driveCameraCommandWrites,
  driveCameraDegrade,
  resolveDriveCameraCommand,
  type DriveCameraFrame,
} from "../driveCameraQueue";

function frame(over: Partial<DriveCameraFrame> = {}): DriveCameraFrame {
  return {
    droneActive: false,
    flyWindowOpen: false,
    radioHold: false,
    writeFailStreak: 0,
    resyncRequested: false,
    exploring: false,
    parkedHold: false,
    poseChanged: true,
    writer: "pan",
    ...over,
  };
}

describe("resolveDriveCameraCommand", () => {
  it("writes the normal follow frame on the pan path", () => {
    const cmd = resolveDriveCameraCommand(frame());
    expect(cmd).toEqual({ kind: "write", writer: "pan", resync: false, degraded: null });
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

  /* 438: a held radio used to return `freeze`, so 125 s of dead zone meant 125 s of
   * no camera writes and the puck drove off a frozen map. It must keep following. */
  it("keeps following on a held radio, degraded to the hard writer", () => {
    const cmd = resolveDriveCameraCommand(frame({ radioHold: true }));
    expect(cmd).toEqual({ kind: "write", writer: "hard", resync: false, degraded: "radio_hold" });
    expect(driveCameraCommandWrites(cmd)).toBe(true);
    expect(driveCameraCommandDegraded(cmd)).toBe("radio_hold");
  });

  it("never returns a command that skips the write because of signal", () => {
    for (const f of [
      frame({ radioHold: true }),
      frame({ writeFailStreak: 1 }),
      frame({ writeFailStreak: 99 }),
      frame({ radioHold: true, writeFailStreak: 99 }),
    ]) {
      expect(resolveDriveCameraCommand(f).kind).toBe("write");
    }
  });

  /* One failed pan means isStyleLoaded() is false; the next pan fails the same way. */
  it("degrades after a single failed pan instead of retrying easeTo", () => {
    expect(resolveDriveCameraCommand(frame({ writeFailStreak: 1 }))).toEqual({
      kind: "write",
      writer: "hard",
      resync: false,
      degraded: "write_fails",
    });
  });

  it("still takes the re-pin snap while degraded", () => {
    expect(
      resolveDriveCameraCommand(frame({ radioHold: true, resyncRequested: true }))
    ).toEqual({ kind: "write", writer: "hard", resync: true, degraded: "radio_hold" });
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
      degraded: null,
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

  it("reports no write for a yield or idle frame", () => {
    for (const f of [frame({ droneActive: true }), frame({ poseChanged: false })]) {
      expect(driveCameraCommandWrites(resolveDriveCameraCommand(f))).toBe(false);
    }
  });
});

describe("driveCameraDegrade", () => {
  it("prefers the radio reason when both are true", () => {
    expect(driveCameraDegrade({ radioHold: true, writeFailStreak: 5 })).toBe("radio_hold");
    expect(driveCameraDegrade({ radioHold: false, writeFailStreak: 5 })).toBe("write_fails");
    expect(driveCameraDegrade({ radioHold: false, writeFailStreak: 0 })).toBeNull();
  });
});
