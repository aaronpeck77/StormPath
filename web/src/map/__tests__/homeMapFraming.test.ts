import { describe, expect, it } from "vitest";
import {
  resolveIdleHomeCameraAction,
  resolveIdleHomeFraming,
} from "../homeMapFraming";

describe("resolveIdleHomeFraming", () => {
  const bounds: [[number, number], [number, number]] = [
    [-87, 36],
    [-86, 37],
  ];

  it("uses the trail area in auto when bounds exist", () => {
    expect(resolveIdleHomeFraming("auto", bounds)).toBe("activity_area");
  });

  it("falls back to my location in auto without bounds", () => {
    expect(resolveIdleHomeFraming("auto", null)).toBe("my_location");
  });
});

describe("resolveIdleHomeCameraAction", () => {
  const bounds: [[number, number], [number, number]] = [
    [-87, 36],
    [-86, 37],
  ];

  it("defers my-location while waiting for breadcrumb bounds on auto", () => {
    expect(
      resolveIdleHomeCameraAction({
        pref: "auto",
        trailBounds: null,
        nowMs: 100,
        waitDeadlineMs: 1500,
        activityAreaLatched: false,
      })
    ).toBe("defer");
  });

  it("applies my-location after the wait if bounds never arrive", () => {
    expect(
      resolveIdleHomeCameraAction({
        pref: "auto",
        trailBounds: null,
        nowMs: 2000,
        waitDeadlineMs: 1500,
        activityAreaLatched: false,
      })
    ).toBe("apply");
  });

  it("applies immediately when trail bounds are ready", () => {
    expect(
      resolveIdleHomeCameraAction({
        pref: "auto",
        trailBounds: bounds,
        nowMs: 50,
        waitDeadlineMs: 1500,
        activityAreaLatched: false,
      })
    ).toBe("apply");
  });

  it("holds the travel-area frame if bounds briefly disappear", () => {
    expect(
      resolveIdleHomeCameraAction({
        pref: "auto",
        trailBounds: null,
        nowMs: 2000,
        waitDeadlineMs: 1500,
        activityAreaLatched: true,
      })
    ).toBe("hold_latched");
  });

  it("does not defer when the user chose My location", () => {
    expect(
      resolveIdleHomeCameraAction({
        pref: "my_location",
        trailBounds: null,
        nowMs: 100,
        waitDeadlineMs: 1500,
        activityAreaLatched: false,
      })
    ).toBe("apply");
  });
});
