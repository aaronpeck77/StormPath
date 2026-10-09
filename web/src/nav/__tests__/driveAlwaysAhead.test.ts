import { describe, expect, it } from "vitest";
import {
  DRIVE_AHEAD_CONFIRM_TICKS,
  DRIVE_AHEAD_OFF_ROUTE_ENTER_M,
  DRIVE_AHEAD_OFF_ROUTE_EXIT_M,
  DRIVE_REANCHOR_LATERAL_M,
  driveReroutePace,
  driveTurnedOffRoute,
  isDriveOffRouteForwardFraming,
  lockedRoutePrefersBackroads,
  lockedRouteShouldAvoidMotorway,
} from "../driveAlwaysAhead";

describe("isDriveOffRouteForwardFraming", () => {
  const base = {
    driveModeUi: true,
    navigationStarted: true,
    onRoute: true,
    offRouteLatched: false,
  };

  it("is false while on route in drive", () => {
    expect(isDriveOffRouteForwardFraming(base)).toBe(false);
  });

  it("is true when latched off route in drive", () => {
    expect(isDriveOffRouteForwardFraming({ ...base, offRouteLatched: true })).toBe(true);
  });

  it("is true when nav progress leaves the corridor in drive", () => {
    expect(isDriveOffRouteForwardFraming({ ...base, onRoute: false })).toBe(true);
  });

  it("is false in route view even when off route", () => {
    expect(
      isDriveOffRouteForwardFraming({
        ...base,
        driveModeUi: false,
        offRouteLatched: true,
      })
    ).toBe(false);
  });

  it("ignores the stale locked-corridor latch while a rejoin leg is on route", () => {
    // Latched vs the ORIGINAL route, but GPS is on the new rejoin/detour polyline —
    // camera should frame off the rejoin leg, not fall back to travel-only.
    expect(
      isDriveOffRouteForwardFraming({
        ...base,
        onRoute: true,
        offRouteLatched: true,
        followingTemporaryGuidance: true,
      })
    ).toBe(false);
  });

  it("still frames forward if GPS drifts off the rejoin leg itself", () => {
    expect(
      isDriveOffRouteForwardFraming({
        ...base,
        onRoute: false,
        offRouteLatched: true,
        followingTemporaryGuidance: true,
      })
    ).toBe(true);
  });
});

describe("drive always-ahead thresholds", () => {
  it("does not treat a few meters of GPS noise as off-route", () => {
    expect(DRIVE_AHEAD_OFF_ROUTE_ENTER_M).toBeGreaterThanOrEqual(15);
    expect(DRIVE_AHEAD_OFF_ROUTE_EXIT_M).toBeLessThan(DRIVE_AHEAD_OFF_ROUTE_ENTER_M);
    expect(DRIVE_AHEAD_CONFIRM_TICKS).toBeGreaterThanOrEqual(2);
  });

  it("treats a moving turn off the line as a new forward plan", () => {
    expect(
      driveTurnedOffRoute({
        headingDeg: 90,
        routeBearingDeg: 0,
        speedMps: 8,
        lateralM: 20,
      })
    ).toBe(true);
    expect(
      driveTurnedOffRoute({
        headingDeg: 20,
        routeBearingDeg: 0,
        speedMps: 25,
        lateralM: 40,
      })
    ).toBe(false);
    expect(
      driveTurnedOffRoute({
        headingDeg: 180,
        routeBearingDeg: 0,
        speedMps: 1,
        lateralM: 30,
      })
    ).toBe(false);
    expect(
      driveTurnedOffRoute({
        headingDeg: null,
        routeBearingDeg: 0,
        speedMps: 8,
        lateralM: 30,
      })
    ).toBe(false);
  });

  it("draws a city leave before the next block and keeps the highway wait", () => {
    const city = driveReroutePace("city_streets");
    const highway = driveReroutePace("highway");
    expect(city.confirmTicks).toBe(2);
    expect(city.reanchorLateralM).toBeGreaterThan(DRIVE_AHEAD_OFF_ROUTE_ENTER_M);
    expect(city.reanchorLateralM).toBeLessThan(70);
    expect(city.coreGraceMs).toBeLessThanOrEqual(1_500);
    expect(city.throttleMs).toBeLessThan(4_000);
    expect(highway.reanchorLateralM).toBe(DRIVE_REANCHOR_LATERAL_M);
    expect(highway.confirmTicks).toBe(DRIVE_AHEAD_CONFIRM_TICKS);
    expect(highway.coreGraceMs).toBeGreaterThan(city.coreGraceMs);
  });

  it("keeps no-interstate and balanced alternates off motorways on replan", () => {
    expect(lockedRoutePrefersBackroads("hazardSmart")).toBe(true);
    expect(lockedRoutePrefersBackroads("balanced")).toBe(true);
    expect(lockedRoutePrefersBackroads("fastest")).toBe(false);
    expect(lockedRoutePrefersBackroads(null)).toBe(false);
  });

  it("also avoids motorways when a slower preferred leg is locked without a backroads role", () => {
    expect(
      lockedRouteShouldAvoidMotorway(
        { id: "r-b", role: "fastest", baseEtaMinutes: 45 },
        [
          { id: "r-a", baseEtaMinutes: 32 },
          { id: "r-b", baseEtaMinutes: 45 },
        ]
      )
    ).toBe(true);
  });

  it("keeps a Main lock on motorways after a detour makes that leg slower", () => {
    expect(
      lockedRouteShouldAvoidMotorway(
        { id: "r-a", role: "fastest", baseEtaMinutes: 55 },
        [
          { id: "r-a", baseEtaMinutes: 55 },
          { id: "r-b", baseEtaMinutes: 40 },
        ]
      )
    ).toBe(false);
  });
});
