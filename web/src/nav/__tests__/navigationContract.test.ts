import { describe, expect, it } from "vitest";
import {
  driveGuidanceUsesRejoinOverlay,
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

  it("freezes locked leg geometry — silent stay-on-road overwrite is forbidden", () => {
    expect(mayMutateLockedRouteGeometry("navigating", "driver_stay_on_road")).toBe(false);
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

  it("requires explicit compare for full GPS→dest overwrite of the locked leg", () => {
    expect(offRouteFullRerouteRequiresExplicitCompare()).toBe(true);
  });

  it("follows a temporary rejoin stub that is not the locked id", () => {
    expect(driveGuidanceUsesRejoinOverlay("r-b", "r-a")).toBe(true);
    expect(driveGuidanceUsesRejoinOverlay("r-a", "r-a")).toBe(false);
    expect(driveGuidanceUsesRejoinOverlay(null, "r-a")).toBe(false);
  });
});
