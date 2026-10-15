import { describe, expect, it } from "vitest";
import {
  runTripRefresh,
  shouldRunTripRefresh,
  showTripRefreshButton,
  TRIP_REFRESH_COOLDOWN_MS,
} from "../tripRefresh";

describe("runTripRefresh", () => {
  it("wakes the stuck pieces and restarts guidance last", () => {
    const order: string[] = [];
    runTripRefresh({
      resetAlong: () => order.push("along"),
      resyncCamera: () => order.push("camera"),
      bumpMapFit: () => order.push("fit"),
      refreshTraffic: () => order.push("traffic"),
      refreshForecast: () => order.push("forecast"),
      restartGuidance: () => order.push("guidance"),
    });
    expect(order).toEqual(["along", "camera", "fit", "traffic", "forecast", "guidance"]);
  });

  it("ignores a second tap while Core is still coming back", () => {
    expect(shouldRunTripRefresh(null, 1_000)).toBe(true);
    expect(shouldRunTripRefresh(1_000, 1_000 + TRIP_REFRESH_COOLDOWN_MS - 1)).toBe(false);
    expect(shouldRunTripRefresh(1_000, 1_000 + TRIP_REFRESH_COOLDOWN_MS)).toBe(true);
  });

  it("shows the button on the drive compass only while a trip is going", () => {
    expect(showTripRefreshButton(true, "drive")).toBe(true);
    expect(showTripRefreshButton(false, "drive")).toBe(false);
    expect(showTripRefreshButton(true, "route")).toBe(false);
    expect(showTripRefreshButton(true, "topdown")).toBe(false);
  });
});
