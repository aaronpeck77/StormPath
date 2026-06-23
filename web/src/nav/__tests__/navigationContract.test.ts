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
    expect(mayChangeLockedRouteId("navigating", "go_geometry_snap")).toBe(false);
    expect(mayChangeLockedRouteId("planning", "go_lock")).toBe(true);
  });

  it("allows geometry snap after Go and automatic off-route replan fallback", () => {
    expect(mayMutateLockedRouteGeometry("navigating", "go_geometry_snap")).toBe(true);
    expect(mayMutateLockedRouteGeometry("navigating", "off_route_replan_fallback")).toBe(true);
    expect(mayMutateLockedRouteGeometry("navigating", "go_lock")).toBe(false);
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

  it("does not require compare for automatic off-route full replan in nav v1", () => {
    expect(offRouteFullRerouteRequiresExplicitCompare()).toBe(false);
  });
});
