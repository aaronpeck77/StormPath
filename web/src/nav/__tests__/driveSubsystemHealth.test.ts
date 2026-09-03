import { describe, expect, it } from "vitest";
import { isDriveLoopStalled, isOffRouteSubsystemHung } from "../driveSubsystemHealth";

describe("isDriveLoopStalled", () => {
  it("is false until GPS has actually moved while GO is on", () => {
    expect(
      isDriveLoopStalled({
        navigationStarted: true,
        windowMs: 8_000,
        gpsMovedM: 10,
        alongMovedM: 0,
      })
    ).toBe(false);
  });

  it("fires when GPS moved but along-track did not (frozen Drive)", () => {
    expect(
      isDriveLoopStalled({
        navigationStarted: true,
        windowMs: 8_000,
        gpsMovedM: 55,
        alongMovedM: 2,
      })
    ).toBe(true);
  });

  it("does not treat off-route (GPS moving, along frozen) as a Drive freeze", () => {
    expect(
      isDriveLoopStalled({
        navigationStarted: true,
        windowMs: 8_000,
        gpsMovedM: 55,
        alongMovedM: 2,
        offRouteLatched: true,
      })
    ).toBe(false);
  });
});

describe("isOffRouteSubsystemHung", () => {
  it("ignores a normal off-route with fresh samples", () => {
    expect(
      isOffRouteSubsystemHung({
        navigationStarted: true,
        offRouteLatched: true,
        rerouteInFlightMs: 4_000,
        lastSampleAgeMs: 1_200,
      })
    ).toBe(false);
  });

  it("fires when a reroute fetch never returns", () => {
    expect(
      isOffRouteSubsystemHung({
        navigationStarted: true,
        offRouteLatched: true,
        rerouteInFlightMs: 21_000,
        lastSampleAgeMs: 800,
      })
    ).toBe(true);
  });

  it("does not abort a live reroute just because poll samples look stale", () => {
    expect(
      isOffRouteSubsystemHung({
        navigationStarted: true,
        offRouteLatched: true,
        rerouteInFlightMs: 5_000,
        lastSampleAgeMs: 13_000,
      })
    ).toBe(false);
  });
});
