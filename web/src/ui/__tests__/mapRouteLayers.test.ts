import { describe, expect, it } from "vitest";
import { hideAlternateRoutesOnDrive } from "../mapRouteLayers";

describe("hideAlternateRoutesOnDrive", () => {
  it("keeps Plus A/B visible in Drive", () => {
    expect(hideAlternateRoutesOnDrive("drive", 2)).toBe(false);
  });

  it("hides nothing to hide when Drive has a single corridor", () => {
    expect(hideAlternateRoutesOnDrive("drive", 1)).toBe(true);
  });

  it("never hides alts on Rt / Mp", () => {
    expect(hideAlternateRoutesOnDrive("route", 1)).toBe(false);
    expect(hideAlternateRoutesOnDrive("topdown", 2)).toBe(false);
  });
});
