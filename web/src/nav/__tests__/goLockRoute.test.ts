import { describe, expect, it } from "vitest";
import { resolveGoLockRouteId, shouldPromoteChosenToSlotAOnGo } from "../goLockRoute";

describe("resolveGoLockRouteId", () => {
  const ordered = ["r-a", "r-b", "r-c"];

  it("locks the highlighted chip, not always slot A", () => {
    expect(
      resolveGoLockRouteId({
        orderedRouteIds: ordered,
        previewLegIndex: 1,
        primaryRouteId: "r-a",
      })
    ).toBe("r-b");
  });

  it("falls back to slot A when preview is missing", () => {
    expect(
      resolveGoLockRouteId({
        orderedRouteIds: ordered,
        previewLegIndex: 9,
        primaryRouteId: "r-a",
      })
    ).toBe("r-a");
  });
});

describe("shouldPromoteChosenToSlotAOnGo", () => {
  it("keeps B labeled B after Go", () => {
    expect(shouldPromoteChosenToSlotAOnGo()).toBe(false);
  });
});
