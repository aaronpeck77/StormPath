import { describe, expect, it } from "vitest";
import { computeSurgicalBypassWindow, earlyApproachMaxMetersForSpeed } from "../surgicalBypassWindow";
import { METERS_PER_MILE } from "../constants";

const MI = METERS_PER_MILE;

describe("computeSurgicalBypassWindow", () => {
  /* Highway-speed scenario: 65 mph ≈ 29 m/s. Lead-time floor = 29 * 30 ≈ 870 m. */
  const HIGHWAY_SPEED = 29;

  it("returns null when total length is invalid", () => {
    expect(
      computeSurgicalBypassWindow({
        userAlongMeters: 0,
        jamAlongMeters: 5000,
        totalMeters: 0,
        speedMps: HIGHWAY_SPEED,
      })
    ).toBeNull();
  });

  it("returns null when the jam is behind the user", () => {
    expect(
      computeSurgicalBypassWindow({
        userAlongMeters: 12_000,
        jamAlongMeters: 8000,
        totalMeters: 50_000,
        speedMps: HIGHWAY_SPEED,
      })
    ).toBeNull();
  });

  it("returns null when the user is already on top of the jam (under lead-time floor)", () => {
    /* 200 m gap < both 250 m floor and (29 * 30 = 870 m) speed-derived floor. */
    expect(
      computeSurgicalBypassWindow({
        userAlongMeters: 9800,
        jamAlongMeters: 10_000,
        totalMeters: 50_000,
        speedMps: HIGHWAY_SPEED,
      })
    ).toBeNull();
  });

  it("uses 'plenty' framing when there is more than 2 mi of lead time", () => {
    const w = computeSurgicalBypassWindow({
      userAlongMeters: 0,
      jamAlongMeters: 8 * MI,
      totalMeters: 50 * MI,
      speedMps: HIGHWAY_SPEED,
    });
    expect(w).not.toBeNull();
    expect(w!.framing).toBe("plenty");
    /* Comfortable 2 mi pre-jam exit + 3 mi rejoin. */
    expect(w!.exitMeters).toBeCloseTo(8 * MI - 2 * MI, 0);
    expect(w!.rejoinMeters).toBeCloseTo(8 * MI + 3 * MI, 0);
  });

  it("uses 'tight' framing when 0.8–2 mi of lead time remains and anchors exit ahead of the user", () => {
    const userAlong = 0;
    const jamAlong = 1.5 * MI;
    const w = computeSurgicalBypassWindow({
      userAlongMeters: userAlong,
      jamAlongMeters: jamAlong,
      totalMeters: 20 * MI,
      speedMps: HIGHWAY_SPEED,
    });
    expect(w).not.toBeNull();
    expect(w!.framing).toBe("tight");
    /* Exit ≈ user + half the gap; rejoin ≈ jam + 2 mi. */
    expect(w!.exitMeters).toBeGreaterThan(userAlong);
    expect(w!.exitMeters).toBeLessThan(jamAlong);
    expect(w!.rejoinMeters).toBeCloseTo(jamAlong + 2 * MI, 0);
  });

  it("uses 'nextExit' framing when the gap is under 0.8 mi (and over the safety floor)", () => {
    /* 1100 m gap (~0.68 mi) clears the 870 m highway lead-time floor. */
    const w = computeSurgicalBypassWindow({
      userAlongMeters: 0,
      jamAlongMeters: 1100,
      totalMeters: 50 * MI,
      speedMps: HIGHWAY_SPEED,
    });
    expect(w).not.toBeNull();
    expect(w!.framing).toBe("nextExit");
    /* Exit anchors slightly ahead of the user; rejoin shortens to 1.5 mi past the jam. */
    expect(w!.exitMeters).toBeGreaterThan(0);
    expect(w!.exitMeters).toBeLessThan(1100);
    expect(w!.rejoinMeters).toBeCloseTo(1100 + 1.5 * MI, 0);
  });

  it("returns null when the resulting detour span is shorter than 0.6 mi", () => {
    /* Jam very near the destination: rejoin clamps to totalMeters and span collapses below 0.6 mi. */
    const total = 12_000;
    const jam = 11_500;
    const w = computeSurgicalBypassWindow({
      userAlongMeters: 0,
      jamAlongMeters: jam,
      totalMeters: total,
      speedMps: HIGHWAY_SPEED,
    });
    /* exit ≈ jam - 2 mi; rejoin clamps to total = 12_000 → span = 12_000 - (11500 - 3219) ≈ 3719 m > 965 m, still 'plenty'.
     * Tighten to confirm the explicit short-span null branch. */
    expect(w).not.toBeNull();

    /* Construct the short-span case directly: jam at the very end, exit clamped to total, span < 0.6 mi. */
    const tooShort = computeSurgicalBypassWindow({
      userAlongMeters: total - 800,
      jamAlongMeters: total - 100,
      totalMeters: total,
      speedMps: 5,
    });
    expect(tooShort).toBeNull();
  });

  it("clamps both endpoints into [0, totalMeters]", () => {
    /* Jam near the end so the 3 mi rejoin would overshoot; the impl clamps to totalMeters. */
    const total = 8 * MI;
    const w = computeSurgicalBypassWindow({
      userAlongMeters: 0,
      jamAlongMeters: 7 * MI,
      totalMeters: total,
      speedMps: HIGHWAY_SPEED,
    });
    expect(w).not.toBeNull();
    expect(w!.exitMeters).toBeGreaterThanOrEqual(0);
    expect(w!.exitMeters).toBeLessThanOrEqual(total);
    expect(w!.rejoinMeters).toBeGreaterThanOrEqual(0);
    expect(w!.rejoinMeters).toBeLessThanOrEqual(total);
  });

  it("falls back to a conservative 25 m/s when speed is null/zero", () => {
    /* Lead-time floor = 25 * 30 = 750 m. A 700 m gap should be rejected. */
    expect(
      computeSurgicalBypassWindow({
        userAlongMeters: 0,
        jamAlongMeters: 700,
        totalMeters: 50_000,
        speedMps: null,
      })
    ).toBeNull();

    /* But 1000 m clears the floor. */
    const w = computeSurgicalBypassWindow({
      userAlongMeters: 0,
      jamAlongMeters: 1000,
      totalMeters: 50_000,
      speedMps: null,
    });
    expect(w).not.toBeNull();
  });
});

describe("earlyApproachMaxMetersForSpeed", () => {
  it("returns the 5 mi fallback when speed is missing", () => {
    expect(earlyApproachMaxMetersForSpeed(null)).toBeCloseTo(5 * MI, 0);
    expect(earlyApproachMaxMetersForSpeed(0)).toBeCloseTo(5 * MI, 0);
    expect(earlyApproachMaxMetersForSpeed(-3)).toBeCloseTo(5 * MI, 0);
  });

  it("scales with 6 minutes of distance at the current speed", () => {
    /* 29 m/s * 360 s = 10,440 m ≈ 6.5 mi — between the 5 mi floor and 8 mi cap. */
    const v = earlyApproachMaxMetersForSpeed(29);
    expect(v).toBeCloseTo(29 * 360, 0);
    expect(v).toBeGreaterThan(5 * MI);
    expect(v).toBeLessThan(8 * MI);
  });

  it("never goes below the 5 mi floor for low speeds", () => {
    /* 10 m/s * 360 s = 3600 m, well below the 5 mi floor. */
    expect(earlyApproachMaxMetersForSpeed(10)).toBeCloseTo(5 * MI, 0);
  });

  it("never exceeds the 8 mi hard cap for very high speeds", () => {
    /* 50 m/s would give 18 km worth of warning — capped at 8 mi. */
    expect(earlyApproachMaxMetersForSpeed(50)).toBeCloseTo(8 * MI, 0);
  });
});
