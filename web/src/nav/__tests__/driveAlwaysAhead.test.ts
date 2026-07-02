import { describe, expect, it } from "vitest";
import { isDriveOffRouteForwardFraming } from "../driveAlwaysAhead";

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
});
