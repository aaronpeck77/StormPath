import { beforeEach, describe, expect, it } from "vitest";
import {
  bumpDriveDiag,
  driveDiagSnapshot,
  formatDriveDiagLines,
  resetDriveDiag,
  setDriveDiagRoadControls,
} from "../driveDiagnostics";

describe("driveDiagnostics", () => {
  beforeEach(() => {
    resetDriveDiag(1_000);
  });

  it("stays quiet in About until a trip has started", () => {
    const cold = { ...driveDiagSnapshot(), startedAtMs: null, coreSamples: 0 };
    expect(formatDriveDiagLines(cold, 2_000)).toEqual([]);
  });

  it("counts what the Drive loop reports", () => {
    bumpDriveDiag("coreSamples", 60);
    bumpDriveDiag("camApplied", 55);
    bumpDriveDiag("camParkedHold", 5);
    setDriveDiagRoadControls(37);
    const snap = driveDiagSnapshot();
    expect(snap.coreSamples).toBe(60);
    expect(snap.camApplied).toBe(55);
    expect(snap.camParkedHold).toBe(5);
    expect(snap.roadControls).toBe(37);
  });

  it("reports Core's sample rate so a slow feed is visible", () => {
    bumpDriveDiag("coreSamples", 60);
    /* 60 samples over one minute of trip → 1.00/s */
    const lines = formatDriveDiagLines(driveDiagSnapshot(), 61_000);
    expect(lines[0]).toContain("1.0 min");
    expect(lines[0]).toContain("60 samples");
    expect(lines[0]).toContain("1.00/s");
  });

  it("separates parked holds from real camera writes", () => {
    bumpDriveDiag("camApplied", 12);
    bumpDriveDiag("camParkedHold", 9);
    bumpDriveDiag("camHardFallback", 1);
    const lines = formatDriveDiagLines(driveDiagSnapshot(), 61_000);
    expect(lines[1]).toBe("Camera: 12 applied, 9 parked holds, 1 hard fallbacks");
  });

  it("shows tile warm and low-signal holds together", () => {
    bumpDriveDiag("lowSignalHolds", 3);
    bumpDriveDiag("tileWarmDone", 4);
    bumpDriveDiag("tileWarmFailed", 1);
    const lines = formatDriveDiagLines(driveDiagSnapshot(), 61_000);
    expect(lines[2]).toBe("Signal: 3 map holds, tiles 4 warm / 1 failed");
  });

  it("clears counters on the next Go", () => {
    bumpDriveDiag("coreSamples", 10);
    resetDriveDiag(5_000);
    const snap = driveDiagSnapshot();
    expect(snap.coreSamples).toBe(0);
    expect(snap.startedAtMs).toBe(5_000);
  });

  it("ignores a junk road-control count", () => {
    setDriveDiagRoadControls(Number.NaN);
    expect(driveDiagSnapshot().roadControls).toBe(0);
    setDriveDiagRoadControls(-4);
    expect(driveDiagSnapshot().roadControls).toBe(0);
  });
});
