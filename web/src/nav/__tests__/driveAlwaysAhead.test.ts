import { describe, expect, it } from "vitest";
import {
  DRIVE_AHEAD_CONFIRM_TICKS,
  DRIVE_AHEAD_OFF_ROUTE_ENTER_M,
  DRIVE_AHEAD_OFF_ROUTE_EXIT_M,
  isDriveOffRouteForwardFraming,
  lockedRoutePrefersBackroads,
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

  it("keeps no-interstate and balanced alternates off motorways on replan", () => {
    expect(lockedRoutePrefersBackroads("hazardSmart")).toBe(true);
    expect(lockedRoutePrefersBackroads("balanced")).toBe(true);
    expect(lockedRoutePrefersBackroads("fastest")).toBe(false);
    expect(lockedRoutePrefersBackroads(null)).toBe(false);
  });
});
