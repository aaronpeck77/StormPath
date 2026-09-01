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

  it("is healthy when along-track is keeping up with GPS", () => {
    expect(
      isDriveLoopStalled({
        navigationStarted: true,
        windowMs: 8_000,
        gpsMovedM: 55,
        alongMovedM: 48,
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

  it("fires when the off-route poll goes silent", () => {
    expect(
      isOffRouteSubsystemHung({
        navigationStarted: true,
        offRouteLatched: true,
        rerouteInFlightMs: null,
        lastSampleAgeMs: 13_000,
      })
    ).toBe(true);
  });
});
