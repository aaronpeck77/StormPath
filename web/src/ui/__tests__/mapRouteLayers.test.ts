import { describe, expect, it } from "vitest";
import { hideAlternateRoutesOnDrive } from "../mapRouteLayers";

describe("hideAlternateRoutesOnDrive", () => {
  it("hides A/B on Drive so only the locked corridor paints", () => {
    expect(hideAlternateRoutesOnDrive("drive", 2)).toBe(true);
    expect(hideAlternateRoutesOnDrive("drive", 1)).toBe(true);
  });

  it("never hides alts on Rt / Mp", () => {
    expect(hideAlternateRoutesOnDrive("route", 1)).toBe(false);
    expect(hideAlternateRoutesOnDrive("topdown", 2)).toBe(false);
  });

  it("keeps PiP overview free to show alts", () => {
    expect(hideAlternateRoutesOnDrive("drive", 2, true)).toBe(false);
  });
});
