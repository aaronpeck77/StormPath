import { describe, expect, it } from "vitest";
import {
  navigationPrimaryRouteIdForMerge,
  resolveNavigationRouteIds,
} from "../navigationRouteFocus";

describe("navigationRouteFocus", () => {
  const ordered = ["r-b", "r-a", "r-c"];

  it("uses preview leg for map focus in route view while planning", () => {
    const { guidanceRouteId, lineFocusId } = resolveNavigationRouteIds({
      navigationStarted: false,
      lockedRouteId: "r-b",
      viewMode: "route",
      previewLegIndex: 2,
      orderedRouteIds: ordered,
      primaryRouteId: "r-a",
    });
    expect(guidanceRouteId).toBe("r-c");
    expect(lineFocusId).toBe("r-c");
  });

  it("uses locked route for guidance but preview leg for map focus in route view while navigating", () => {
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

  it("uses locked route in drive view while navigating", () => {
    const { guidanceRouteId, lineFocusId } = resolveNavigationRouteIds({
      navigationStarted: true,
      lockedRouteId: "r-b",
      temporaryGuidanceRouteId: "r-c",
      viewMode: "drive",
      previewLegIndex: 1,
      orderedRouteIds: ordered,
      primaryRouteId: "r-a",
    });
    expect(guidanceRouteId).toBe("r-b");
    expect(lineFocusId).toBe("r-b");
  });

  it("ignores temporary guidance in route view while navigating", () => {
    const { guidanceRouteId, lineFocusId } = resolveNavigationRouteIds({
      navigationStarted: true,
      lockedRouteId: "r-b",
      temporaryGuidanceRouteId: "r-c",
      viewMode: "route",
      previewLegIndex: 2,
      orderedRouteIds: ordered,
      primaryRouteId: "r-a",
    });
    expect(guidanceRouteId).toBe("r-b");
    expect(lineFocusId).toBe("r-c");
  });

  it("falls back to slot order when no lock is set", () => {
    expect(navigationPrimaryRouteIdForMerge(null, ordered)).toBe("r-b");
    expect(navigationPrimaryRouteIdForMerge("r-a", ordered)).toBe("r-a");
  });
});
