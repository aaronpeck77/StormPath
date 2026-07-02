import { describe, expect, it } from "vitest";
import {
  mayChangeLockedRouteId,
  mayMutateLockedRouteGeometry,
  mayRefreshAlternateLegsOnly,
  mayAutoRejoinOverlay,
  offRouteFullRerouteRequiresExplicitCompare,
} from "../navigationContract";

describe("navigationContract", () => {
  it("locks route id during navigation except explicit promote/stop/replan", () => {
    expect(mayChangeLockedRouteId("navigating", "driver_promote")).toBe(true);
    expect(mayChangeLockedRouteId("navigating", "go_lock")).toBe(false);
    expect(mayChangeLockedRouteId("planning", "go_lock")).toBe(true);
  });

  it("freezes locked leg geometry during navigation except explicit driver adopt", () => {
    expect(mayMutateLockedRouteGeometry("navigating", "driver_stay_on_road")).toBe(true);
    expect(mayMutateLockedRouteGeometry("navigating", "driver_promote")).toBe(true);
    expect(mayMutateLockedRouteGeometry("navigating", "go_lock")).toBe(false);
    expect(mayMutateLockedRouteGeometry("planning", "go_lock")).toBe(true);
  });

  it("refreshes alternates only in route or map view while navigating", () => {
    expect(mayRefreshAlternateLegsOnly("navigating", "drive")).toBe(false);
    expect(mayRefreshAlternateLegsOnly("navigating", "route")).toBe(true);
    expect(mayRefreshAlternateLegsOnly("navigating", "topdown")).toBe(true);
    expect(mayRefreshAlternateLegsOnly("planning", "route")).toBe(false);
  });

  it("allows auto rejoin overlay while navigating", () => {
    expect(mayAutoRejoinOverlay("navigating")).toBe(true);
    expect(mayAutoRejoinOverlay("planning")).toBe(false);
  });

  it("allows auto replan from GPS during drive without compare sheet", () => {
    expect(offRouteFullRerouteRequiresExplicitCompare()).toBe(false);
  });
});
