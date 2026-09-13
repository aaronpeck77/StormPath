import { describe, expect, it } from "vitest";
import { isTransientGpsLocationError } from "../useUserLocation";

describe("isTransientGpsLocationError", () => {
  it("treats weak / timeout GPS as a short-lived banner", () => {
    expect(
      isTransientGpsLocationError(
        "GPS signal weak or unavailable. Check Settings → Location Services → StormPath is set to While Using."
      )
    ).toBe(true);
    expect(isTransientGpsLocationError("Location unavailable — try stepping outside.")).toBe(true);
    expect(isTransientGpsLocationError("Still no GPS fix — confirm Location is allowed")).toBe(true);
  });

  it("keeps permission-denied errors on screen", () => {
    expect(
      isTransientGpsLocationError(
        "Location permission denied. Open Settings → Privacy → Location Services → StormPath and set to 'While Using'."
      )
    ).toBe(false);
    expect(isTransientGpsLocationError(null)).toBe(false);
  });
});
