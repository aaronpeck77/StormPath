import { describe, expect, it } from "vitest";
import { allowFollowCamJumpToFallback } from "../mapLowSignalResilience";
import { driveFollowCamAllowsSetCenterHotLoop } from "../driveFollowCamWrite";

/**
 * Regression notes for Wi‑Fi→cell freeze:
 * - Follow-cam must not require Mapbox `isStyleLoaded()` (sources stay "loading" on failed tiles).
 * - Drive follow uses jumpTo with yard-line offset — not a 60fps setCenter (that fought offset pan).
 */
describe("wifi-to-cell follow cam contract", () => {
  it("allows hard camera repair when follow is stalled under dead-zone hold", () => {
    expect(
      allowFollowCamJumpToFallback({
        intentionalResync: false,
        holdLastGoodMap: true,
        gpsFollowStalled: true,
      })
    ).toBe(true);
  });

  it("does not use setCenter on the Drive RAF loop", () => {
    expect(driveFollowCamAllowsSetCenterHotLoop()).toBe(false);
  });
});
