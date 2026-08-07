import { describe, expect, it } from "vitest";
import { navigationRouteOverviewSnapKey } from "../navigationCamera";

describe("navigationRouteOverviewSnapKey", () => {
  it("does not change when only mapResumeTick changes (explore-end must not re-fit Rt)", () => {
    const a = navigationRouteOverviewSnapKey("route", 3, 0, "r-a", "geom-a");
    const b = navigationRouteOverviewSnapKey("route", 3, 99, "r-a", "geom-a");
    expect(a).toBe(b);
  });

  it("changes when fitTrigger or route graph changes", () => {
    const base = navigationRouteOverviewSnapKey("route", 3, 0, "r-a", "geom-a");
    expect(navigationRouteOverviewSnapKey("route", 4, 0, "r-a", "geom-a")).not.toBe(base);
    expect(navigationRouteOverviewSnapKey("route", 3, 0, "r-b", "geom-a")).not.toBe(base);
    expect(navigationRouteOverviewSnapKey("route", 3, 0, "r-a", "geom-b")).not.toBe(base);
  });
});
