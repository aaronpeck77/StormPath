import { describe, expect, it } from "vitest";
import {
  auditTripNavDisplay,
  computeRemainingDistanceMeters,
  computeRemainingDriveEtaMinutes,
  repairActionsForIssues,
} from "../tripNavDisplay";

describe("tripNavDisplay", () => {
  it("prefers live remaining-leg Mapbox minutes while navigating", () => {
    expect(
      computeRemainingDriveEtaMinutes({
        navigationStarted: true,
        fullEtaMinutes: 90,
        routeLengthM: 51_000,
        alongM: 0,
        hasRouteGeometry: true,
        liveRemainingEtaMinutes: 28,
      })
    ).toBe(28);
  });

  it("scales full ETA by remaining distance fraction", () => {
    expect(
      computeRemainingDriveEtaMinutes({
        navigationStarted: true,
        fullEtaMinutes: 60,
        routeLengthM: 10_000,
        alongM: 5_000,
        hasRouteGeometry: true,
      })
    ).toBe(30);
  });

  it("does not show the whole planned trip as time left on a short corridor", () => {
    const planM = 80 * 1609.34;
    const corridorM = 18 * 1609.34;
    expect(
      computeRemainingDriveEtaMinutes({
        navigationStarted: true,
        fullEtaMinutes: 120,
        routeLengthM: corridorM,
        alongM: 0,
        hasRouteGeometry: true,
        planLengthM: planM,
        liveRemainingEtaMinutes: 118,
      })
    ).toBe(27);
  });

  it("keeps a live remaining duration that is not the whole trip", () => {
    const planM = 80 * 1609.34;
    const corridorM = 18 * 1609.34;
    expect(
      computeRemainingDriveEtaMinutes({
        navigationStarted: true,
        fullEtaMinutes: 120,
        routeLengthM: corridorM,
        alongM: 0,
        hasRouteGeometry: true,
        planLengthM: planM,
        liveRemainingEtaMinutes: 24,
      })
    ).toBe(24);
  });

  it("uses the odometer when along resets to the start of the full line", () => {
    const planM = 80 * 1609.34;
    expect(
      computeRemainingDriveEtaMinutes({
        navigationStarted: true,
        fullEtaMinutes: 120,
        routeLengthM: planM,
        alongM: 0,
        hasRouteGeometry: true,
        planLengthM: planM,
        tripOdometerM: 40 * 1609.34,
      })
    ).toBe(60);
  });

  it("returns null remaining distance when not navigating", () => {
    expect(computeRemainingDistanceMeters(false, 10_000, 0)).toBeNull();
  });

  it("flags ETA above full trip and suggests traffic refresh", () => {
    const audit = auditTripNavDisplay({
      navigationStarted: true,
      routeLengthM: 10_000,
      alongM: 2_000,
      fullEtaMinutes: 40,
      remainingEtaMinutes: 50,
      remainingDistanceM: 8_000,
      speedMps: 15,
    });
    expect(audit.ok).toBe(false);
    expect(audit.issues).toContain("eta_exceeds_full");
    expect(repairActionsForIssues(audit.issues)).toContain("refresh_traffic");
  });

  it("flags implausible fast remaining ETA", () => {
    const audit = auditTripNavDisplay({
      navigationStarted: true,
      routeLengthM: 20_000,
      alongM: 5_000,
      fullEtaMinutes: 30,
      remainingEtaMinutes: 3,
      remainingDistanceM: 15_000,
      speedMps: 20,
    });
    expect(audit.issues).toContain("eta_implausible_fast");
  });
});
