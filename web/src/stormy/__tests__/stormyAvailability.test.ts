import { describe, expect, it } from "vitest";
import { STORMY_AVAILABLE, stormyMapButtonOn } from "../stormyAvailability";

describe("stormyMapButtonOn", () => {
  it("shows her button when the driver leaves her on", () => {
    expect(STORMY_AVAILABLE).toBe(true);
    expect(stormyMapButtonOn(true)).toBe(true);
    expect(stormyMapButtonOn(false)).toBe(false);
  });
});
