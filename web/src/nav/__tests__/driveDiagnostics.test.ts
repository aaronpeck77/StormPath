import { beforeEach, describe, expect, it } from "vitest";
import {
  bumpDriveDiag,
  driveDiagSnapshot,
  formatDriveDiagLines,
  hydrateDriveDiagFromJson,
  noteViewDroneEnd,
  noteViewDroneSkip,
  noteViewDroneStart,
  noteDriveDiagCamFailStreak,
  noteDriveDiagCamFreeze,
  noteDriveDiagJeffResync,
  noteDriveDiagRadioHold,
  noteViewDroneTap,
  persistDriveDiagNow,
  resetDriveDiag,
  setDriveDiagRoadControls,
  setDriveDiagRouteLengthM,
} from "../driveDiagnostics";

describe("driveDiagnostics", () => {
  beforeEach(() => {
    try {
      sessionStorage.removeItem("stormpath.driveDiag.v1");
    } catch {
      /* node */
    }
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

  it("separates parked holds and failed writes from real camera writes", () => {
    bumpDriveDiag("camApplied", 12);
    bumpDriveDiag("camParkedHold", 9);
    bumpDriveDiag("camWriteFailed", 1);
    const lines = formatDriveDiagLines(driveDiagSnapshot(), 61_000);
    expect(lines[1]).toBe("Camera: 12 applied, 9 parked holds, 1 write fails, 0 reclaims");
  });

  /* The 42s field trip reported 2519 applies against ~42 samples — a per-frame bump. */
  it("keeps camera writes in the same order as Core samples", () => {
    bumpDriveDiag("coreSamples", 42);
    bumpDriveDiag("camApplied", 40);
    const snap = driveDiagSnapshot();
    expect(snap.camApplied).toBeLessThanOrEqual(snap.coreSamples * 3);
  });

  it("shows tile warm and low-signal holds together", () => {
    bumpDriveDiag("lowSignalHolds", 3);
    bumpDriveDiag("tileWarmDone", 4);
    bumpDriveDiag("tileWarmFailed", 1);
    const lines = formatDriveDiagLines(driveDiagSnapshot(), 61_000);
    expect(lines[3]).toBe("Signal: 3 map holds, tiles 4 warm / 1 failed");
  });

  it("shows a sub-minute trip in seconds so a 0.6s dump is obvious", () => {
    const lines = formatDriveDiagLines(driveDiagSnapshot(), 1_600);
    expect(lines[0]).toContain("0.6 s");
  });

  it("survives an in-memory wipe the way a Core reconnect used to", () => {
    bumpDriveDiag("coreSamples", 40);
    bumpDriveDiag("camApplied", 38);
    persistDriveDiagNow();
    const raw = JSON.stringify(driveDiagSnapshot());
    resetDriveDiag(9_000);
    expect(driveDiagSnapshot().coreSamples).toBe(0);
    hydrateDriveDiagFromJson(raw);
    const snap = driveDiagSnapshot();
    expect(snap.coreSamples).toBe(40);
    expect(snap.camApplied).toBe(38);
    expect(snap.startedAtMs).toBe(1_000);
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

  it("records a parked Dr/Mp/Rt session so About has a trail without Core samples", () => {
    resetDriveDiag(1_000);
    const parked = { ...driveDiagSnapshot(), startedAtMs: null, coreSamples: 0 };
    expect(formatDriveDiagLines(parked, 2_000)).toEqual([]);

    noteViewDroneSkip("first");
    expect(driveDiagSnapshot().startedAtMs).toBe(1_000);
    expect(formatDriveDiagLines({ ...driveDiagSnapshot(), startedAtMs: null, coreSamples: 0 }, 2_000)).toEqual(
      []
    );

    noteViewDroneTap("drive", "topdown");
    noteViewDroneStart();
    noteViewDroneEnd("done", 0, 1402);
    noteViewDroneTap("topdown", "route");
    noteViewDroneStart();
    noteViewDroneEnd("done", 12, 1390);
    noteViewDroneTap("route", "drive");
    noteViewDroneSkip("no_from");

    const snap = driveDiagSnapshot();
    expect(snap.viewTaps).toBe(3);
    expect(snap.droneStarts).toBe(2);
    expect(snap.droneDone).toBe(2);
    expect(snap.droneLast).toBe("Rt>Dr");
    expect(snap.droneTrail).toContain("Dr>Mp ok 1402ms");
    expect(snap.droneTrail).toContain("Mp>Rt fail12 1390ms");
    expect(snap.droneTrail).toContain("Rt>Dr noFrom");

    const lines = formatDriveDiagLines(snap, 8_000);
    expect(lines[6]).toContain("3 taps");
    expect(lines[6]).toContain("2 start / 2 done");
    expect(lines[8]).toContain("last Rt>Dr");
    expect(lines[9]).toContain("Dr>Mp ok 1402ms");
  });

  it("counts a retarget on its own and keeps the shot label that left the pad", () => {
    noteViewDroneTap("route", "drive");
    noteViewDroneStart();
    noteViewDroneTap("drive", "topdown");
    noteViewDroneEnd("retarget");
    const snap = driveDiagSnapshot();
    expect(snap.droneAbort).toBe(0);
    expect(snap.droneRetarget).toBe(1);
    expect(snap.droneTrail).toContain("Rt>Dr retarget");
    expect(snap.droneTrail).not.toContain("??");
    const lines = formatDriveDiagLines(snap, 8_000);
    expect(lines[6]).toContain("0 abort / 1 retarget");
  });

  it("keeps the in-flight label when Go resets the counters", () => {
    noteViewDroneTap("route", "topdown");
    noteViewDroneStart();
    resetDriveDiag(5_000);
    noteViewDroneEnd("done", 0, 2202);
    expect(driveDiagSnapshot().droneTrail).toContain("Rt>Mp ok 2202ms");
    expect(driveDiagSnapshot().droneTrail).not.toContain("??");
  });

  it("records a pre-shot wait so a 5s Dr>Mp hitch is visible", () => {
    noteViewDroneTap("drive", "topdown");
    noteViewDroneStart();
    noteViewDroneEnd("done", 0, 1401, 3720);
    expect(driveDiagSnapshot().droneTrail).toContain("Dr>Mp ok 1401ms wait3720");
  });

  it("reports radio holds, trip size, and cam health without coordinates", () => {
    setDriveDiagRouteLengthM(90_000);
    noteDriveDiagRadioHold(true, 1_000);
    noteDriveDiagRadioHold(false, 13_000);
    noteDriveDiagCamFreeze();
    noteDriveDiagCamFailStreak(12);
    noteDriveDiagJeffResync();
    const lines = formatDriveDiagLines(driveDiagSnapshot(), 20_000);
    expect(lines[0]).toContain("50-100mi");
    expect(lines[2]).toContain("freeze 1");
    expect(lines[2]).toContain("max fail streak 12");
    expect(lines[2]).toContain("Jeff 1");
    expect(lines[4]).toBe("Radio: 1 holds (12s, longest 12s)");
    expect(lines.join("\n")).not.toMatch(/-?\d+\.\d{3},/);
  });

  it("keeps view-drone counters across a Core reconnect hydrate", () => {
    noteViewDroneTap("route", "drive");
    noteViewDroneStart();
    persistDriveDiagNow();
    const raw = JSON.stringify(driveDiagSnapshot());
    resetDriveDiag(9_000);
    hydrateDriveDiagFromJson(raw);
    expect(driveDiagSnapshot().viewTaps).toBe(1);
    expect(driveDiagSnapshot().droneStarts).toBe(1);
    expect(driveDiagSnapshot().droneLast).toBe("Rt>Dr");
  });
});
