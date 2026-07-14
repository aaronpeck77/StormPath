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

  it("follows temporary rejoin stub in drive view while navigating (regression: B lock stayed but guidance ignored stub)", () => {
    const { guidanceRouteId, lineFocusId } = resolveNavigationRouteIds({
      navigationStarted: true,
      lockedRouteId: "r-b",
      temporaryGuidanceRouteId: "r-c",
      viewMode: "drive",
      previewLegIndex: 1,
      orderedRouteIds: ordered,
      primaryRouteId: "r-a",
    });
    expect(guidanceRouteId).toBe("r-c");
    expect(lineFocusId).toBe("r-c");
  });

  it("returns to locked route in drive when rejoin stub clears", () => {
    const { guidanceRouteId, lineFocusId } = resolveNavigationRouteIds({
      navigationStarted: true,
      lockedRouteId: "r-b",
      temporaryGuidanceRouteId: null,
      viewMode: "drive",
      previewLegIndex: 1,
      orderedRouteIds: ordered,
      primaryRouteId: "r-a",
    });
    expect(guidanceRouteId).toBe("r-b");
    expect(lineFocusId).toBe("r-b");
  });

  it("keeps turn-by-turn on rejoin stub in route view; map focus can still preview", () => {
    const { guidanceRouteId, lineFocusId } = resolveNavigationRouteIds({
      navigationStarted: true,
      lockedRouteId: "r-b",
      temporaryGuidanceRouteId: "r-c",
      viewMode: "route",
      previewLegIndex: 2,
      orderedRouteIds: ordered,
      primaryRouteId: "r-a",
    });
    expect(guidanceRouteId).toBe("r-c");
    expect(lineFocusId).toBe("r-c");
  });

  it("ignores temporary guidance ids that are not in the plan slots", () => {
    const { guidanceRouteId } = resolveNavigationRouteIds({
      navigationStarted: true,
      lockedRouteId: "r-b",
      temporaryGuidanceRouteId: "r-missing",
      viewMode: "drive",
      previewLegIndex: 0,
      orderedRouteIds: ordered,
      primaryRouteId: "r-a",
    });
    expect(guidanceRouteId).toBe("r-b");
  });

  it("falls back to slot order when no lock is set", () => {
    expect(navigationPrimaryRouteIdForMerge(null, ordered)).toBe("r-b");
    expect(navigationPrimaryRouteIdForMerge("r-a", ordered)).toBe("r-a");
  });
});
