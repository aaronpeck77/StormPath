import { describe, expect, it } from "vitest";
import { allowFollowCamJumpToFallback } from "../mapLowSignalResilience";

/**
 * Regression notes for Wi‑Fi→cell freeze:
 * - Follow-cam must not require Mapbox `isStyleLoaded()` (sources stay "loading" on failed tiles).
 * - Under hold / offline, Drive uses hard setCenter/setBearing — not easeTo.
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
});
