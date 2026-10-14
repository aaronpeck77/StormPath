import { describe, expect, it } from "vitest";
import { runTripRefresh, showTripRefreshButton } from "../tripRefresh";

describe("runTripRefresh", () => {
  it("wakes the stuck pieces and restarts guidance last", () => {
    const order: string[] = [];
    runTripRefresh({
      resetAlong: () => order.push("along"),
      resyncCamera: () => order.push("camera"),
      refreshTraffic: () => order.push("traffic"),
      refreshForecast: () => order.push("forecast"),
      restartGuidance: () => order.push("guidance"),
    });
    expect(order).toEqual(["along", "camera", "traffic", "forecast", "guidance"]);
  });

  it("shows the button on the drive compass only while a trip is going", () => {
    expect(showTripRefreshButton(true, "drive")).toBe(true);
    expect(showTripRefreshButton(false, "drive")).toBe(false);
    expect(showTripRefreshButton(true, "route")).toBe(false);
    expect(showTripRefreshButton(true, "topdown")).toBe(false);
  });
});
