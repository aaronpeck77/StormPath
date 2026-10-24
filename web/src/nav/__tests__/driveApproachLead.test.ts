import { describe, expect, it } from "vitest";
import { METERS_PER_MILE } from "../constants";
import { earlyApproachMaxMetersForSpeed } from "../driveApproachLead";

const MI = METERS_PER_MILE;

describe("earlyApproachMaxMetersForSpeed", () => {
  it("uses five miles when speed is missing", () => {
    expect(earlyApproachMaxMetersForSpeed(null)).toBeCloseTo(5 * MI, 0);
    expect(earlyApproachMaxMetersForSpeed(0)).toBeCloseTo(5 * MI, 0);
  });

  it("grows with highway speed and caps at eight miles", () => {
    expect(earlyApproachMaxMetersForSpeed(29)).toBeGreaterThan(5 * MI);
    expect(earlyApproachMaxMetersForSpeed(50)).toBeCloseTo(8 * MI, 0);
  });
});
