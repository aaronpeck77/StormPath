import { describe, expect, it } from "vitest";
import {
  auditTripNavDisplay,
  computeRemainingDistanceMeters,
  computeRemainingDriveEtaMinutes,
  easeRemainingEtaMinutes,
  emptyEtaEaseState,
  fartherAlongMeters,
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

  it("uses the farther point when Core's traveled distance reset to the start", () => {
    expect(fartherAlongMeters(40, 80_000, 100_000)).toBe(80_000);
    expect(fartherAlongMeters(90_000, 1_000, 100_000)).toBe(90_000);
    expect(fartherAlongMeters(40, 250_000, 100_000)).toBe(100_000);
  });

  it("drops a whole-trip live clock once the car is near the end of the line", () => {
    expect(
      computeRemainingDriveEtaMinutes({
        navigationStarted: true,
        fullEtaMinutes: 90,
        routeLengthM: 100_000,
        alongM: fartherAlongMeters(40, 80_000, 100_000),
        hasRouteGeometry: true,
        planLengthM: 100_000,
        liveRemainingEtaMinutes: 88,
      })
    ).toBe(18);
    expect(computeRemainingDistanceMeters(true, 100_000, 80_000)).toBe(20_000);
  });

  it("drops a live answer whose free-flow time is a longer road than the miles left", () => {
    const planM = 80 * 1609.34;
    expect(
      computeRemainingDriveEtaMinutes({
        navigationStarted: true,
        fullEtaMinutes: 90,
        routeLengthM: planM,
        alongM: planM * 0.75,
        hasRouteGeometry: true,
        planLengthM: planM,
        liveRemainingEtaMinutes: 72,
        typicalRemainingMinutes: 70,
      })
    ).toBe(23);
  });

  it("keeps a live delay when the free-flow time still matches the miles left", () => {
    const planM = 80 * 1609.34;
    expect(
      computeRemainingDriveEtaMinutes({
        navigationStarted: true,
        fullEtaMinutes: 90,
        routeLengthM: planM,
        alongM: planM * 0.75,
        hasRouteGeometry: true,
        planLengthM: planM,
        liveRemainingEtaMinutes: 38,
        typicalRemainingMinutes: 24,
      })
    ).toBe(38);
  });

  it("steps a higher arrival time up instead of jumping", () => {
    const state = emptyEtaEaseState();
    expect(easeRemainingEtaMinutes(state, 20, 20_000, 0)).toBe(20);
    expect(easeRemainingEtaMinutes(state, 35, 20_000, 1_000)).toBe(22);
    expect(easeRemainingEtaMinutes(state, 35, 19_000, 10_000)).toBe(22);
    expect(easeRemainingEtaMinutes(state, 35, 19_000, 50_000)).toBe(24);
    expect(easeRemainingEtaMinutes(state, 18, 16_000, 60_000)).toBe(18);
  });

  it("accepts a higher time at once when the road ahead got longer", () => {
    const state = emptyEtaEaseState();
    expect(easeRemainingEtaMinutes(state, 20, 12_000, 0)).toBe(20);
    expect(easeRemainingEtaMinutes(state, 40, 20_000, 1_000)).toBe(40);
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
