import { describe, expect, it } from "vitest";
import { STORMY_AVAILABLE, stormyMapButtonOn } from "../stormyAvailability";

describe("stormyMapButtonOn", () => {
  it("keeps the map on the normal dock while Stormy is coming soon", () => {
    expect(STORMY_AVAILABLE).toBe(false);
    expect(stormyMapButtonOn(true)).toBe(false);
    expect(stormyMapButtonOn(false)).toBe(false);
  });
});
