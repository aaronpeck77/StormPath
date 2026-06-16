import { describe, expect, it } from "vitest";
import {
  navigationPrimaryRouteIdForMerge,
  resolveNavigationRouteIds,
} from "../navigationRouteFocus";

describe("navigationRouteFocus", () => {
  const ordered = ["r-b", "r-a", "r-c"];

  it("uses preview leg for map focus in route view while guidance stays locked", () => {
    const { guidanceRouteId, lineFocusId } = resolveNavigationRouteIds({
      navigationStarted: true,
      lockedRouteId: "r-b",
      viewMode: "route",
      previewLegIndex: 2,
      orderedRouteIds: ordered,
      primaryRouteId: "r-a",
    });
    expect(guidanceRouteId).toBe("r-b");
    expect(lineFocusId).toBe("r-c");
  });

  it("uses locked route for both focus and guidance in drive view", () => {
    const { guidanceRouteId, lineFocusId } = resolveNavigationRouteIds({
      navigationStarted: true,
      lockedRouteId: "r-b",
      viewMode: "drive",
      previewLegIndex: 2,
      orderedRouteIds: ordered,
      primaryRouteId: "r-a",
    });
    expect(guidanceRouteId).toBe("r-b");
    expect(lineFocusId).toBe("r-b");
  });

  it("falls back to slot order when no lock is set", () => {
    expect(navigationPrimaryRouteIdForMerge(null, ordered)).toBe("r-b");
    expect(navigationPrimaryRouteIdForMerge("r-a", ordered)).toBe("r-a");
  });
});
