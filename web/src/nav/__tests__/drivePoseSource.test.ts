import { describe, expect, it } from "vitest";
import {
  CORE_POSE_STALE_MS,
  drivePoseCountsAsSnapped,
  pickDrivePoseSource,
  shouldSnapPuckToRoute,
} from "../drivePoseSource";

const pose = { lng: -88.95, lat: 39.84 };

describe("pickDrivePoseSource", () => {
  it("uses Core's matched pose while Core is reporting", () => {
    expect(
      pickDrivePoseSource({
        coreFollowActive: true,
        corePose: pose,
        coreSampleAtMs: 10_000,
        nowMs: 10_800,
      })
    ).toBe("core");
  });

  it("falls back to GPS when Core goes quiet", () => {
    expect(
      pickDrivePoseSource({
        coreFollowActive: true,
        corePose: pose,
        coreSampleAtMs: 10_000,
        nowMs: 10_000 + CORE_POSE_STALE_MS + 1,
      })
    ).toBe("gps");
  });

  it("rides out a single dropped 1 Hz sample instead of switching pipelines", () => {
    expect(
      pickDrivePoseSource({
        coreFollowActive: true,
        corePose: pose,
        coreSampleAtMs: 10_000,
        nowMs: 12_000,
      })
    ).toBe("core");
  });

  it("is GPS for web-only Go, a missing pose, or a never-seen sample", () => {
    expect(
      pickDrivePoseSource({
        coreFollowActive: false,
        corePose: pose,
        coreSampleAtMs: 10_000,
        nowMs: 10_100,
      })
    ).toBe("gps");
    expect(
      pickDrivePoseSource({
        coreFollowActive: true,
        corePose: null,
        coreSampleAtMs: 10_000,
        nowMs: 10_100,
      })
    ).toBe("gps");
    expect(
      pickDrivePoseSource({
        coreFollowActive: true,
        corePose: pose,
        coreSampleAtMs: null,
        nowMs: 10_100,
      })
    ).toBe("gps");
  });

  it("rejects a non-finite pose rather than driving the puck to NaN", () => {
    expect(
      pickDrivePoseSource({
        coreFollowActive: true,
        corePose: { lng: Number.NaN, lat: 39.84 },
        coreSampleAtMs: 10_000,
        nowMs: 10_100,
      })
    ).toBe("gps");
  });
});

describe("shouldSnapPuckToRoute", () => {
  it("skips the second snap on a Core pose and keeps it for GPS", () => {
    expect(shouldSnapPuckToRoute("core")).toBe(false);
    expect(shouldSnapPuckToRoute("gps")).toBe(true);
  });
});

describe("drivePoseCountsAsSnapped", () => {
  it("treats a Core pose as on-road even though the JS snap never ran", () => {
    expect(drivePoseCountsAsSnapped({ source: "core", diySnapLatched: false })).toBe(true);
    expect(drivePoseCountsAsSnapped({ source: "gps", diySnapLatched: false })).toBe(false);
    expect(drivePoseCountsAsSnapped({ source: "gps", diySnapLatched: true })).toBe(true);
  });
});
