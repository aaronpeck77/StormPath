import { describe, expect, it } from "vitest";
import { driveRailProgressFraction } from "../driveRailProgress";

describe("driveRailProgressFraction", () => {
  it("stays on the line when along is ahead of the odometer", () => {
    const totalM = 80_000;
    const frac = driveRailProgressFraction({
      totalM,
      userAlongM: 60_000,
      tripOdometerM: 20_000,
      tripRelative: true,
    });
    expect(frac).toBeCloseTo(0.75, 2);
  });

  it("keeps moving from the odometer when along snaps back to the start", () => {
    const totalM = 80_000;
    const frac = driveRailProgressFraction({
      totalM,
      userAlongM: 0,
      tripOdometerM: 40_000,
      tripRelative: true,
    });
    expect(frac).toBeCloseTo(40_000 / (40_000 + 80_000), 3);
    expect(frac).toBeGreaterThan(0.3);
  });

  it("ignores the odometer before Go", () => {
    expect(
      driveRailProgressFraction({
        totalM: 80_000,
        userAlongM: 0,
        tripOdometerM: 40_000,
        tripRelative: false,
      })
    ).toBe(0);
  });
});
