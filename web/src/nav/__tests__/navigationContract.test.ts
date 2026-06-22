import { describe, expect, it } from "vitest";
import {
  mayChangeLockedRouteId,
  mayMutateLockedRouteGeometry,
  mayRefreshAlternateLegsOnly,
  mayAutoRejoinOverlay,
} from "../navigationContract";

describe("navigationContract", () => {
  it("locks route id during navigation except explicit promote/stop/replan", () => {
    expect(mayChangeLockedRouteId("navigating", "driver_promote")).toBe(true);
    expect(mayChangeLockedRouteId("navigating", "go_lock")).toBe(false);
    expect(mayChangeLockedRouteId("navigating", "go_geometry_snap")).toBe(false);
    expect(mayChangeLockedRouteId("planning", "go_lock")).toBe(true);
  });

  it("allows one-time geometry snap after Go only", () => {
    expect(mayMutateLockedRouteGeometry("navigating", "go_geometry_snap")).toBe(true);
    expect(mayMutateLockedRouteGeometry("navigating", "go_lock")).toBe(false);
  });

  it("refreshes alternates only in route or map view while navigating", () => {
    expect(mayRefreshAlternateLegsOnly("navigating", "drive")).toBe(false);
    expect(mayRefreshAlternateLegsOnly("navigating", "route")).toBe(true);
    expect(mayRefreshAlternateLegsOnly("navigating", "topdown")).toBe(true);
    expect(mayRefreshAlternateLegsOnly("planning", "route")).toBe(false);
  });

  it("allows auto rejoin overlay only while navigating with setting on", () => {
    expect(mayAutoRejoinOverlay("navigating", true)).toBe(true);
    expect(mayAutoRejoinOverlay("navigating", false)).toBe(false);
    expect(mayAutoRejoinOverlay("planning", true)).toBe(false);
  });
});
