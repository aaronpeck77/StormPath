import { describe, expect, it } from "vitest";
import { mapboxBearingsParam } from "../mapboxDirectionsRouter";

describe("mapboxBearingsParam", () => {
  it("pads empty slots so bearings count matches waypoints", () => {
    expect(mapboxBearingsParam(2, 90, 45)).toBe("90,45;");
    expect(mapboxBearingsParam(3, 12.6, 40)).toBe("13,40;;");
    expect(mapboxBearingsParam(4, 0, 45)).toBe("0,45;;;");
  });

  it("returns null for invalid input", () => {
    expect(mapboxBearingsParam(1, 90)).toBeNull();
    expect(mapboxBearingsParam(2, Number.NaN)).toBeNull();
  });
});
