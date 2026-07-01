import { describe, expect, it } from "vitest";
import {
  auditTripSurface,
  repairActionsForTripSurfaceIssues,
} from "../tripSurfaceHealth";
import type { NavRoute } from "../types";

function route(id: string, geom: boolean, steps = true): NavRoute {
  return {
    id,
    role: "fastest",
    label: id,
    geometry: geom ? [[-77, 38], [-77.01, 38.01]] : [],
    baseEtaMinutes: 10,
    turnSteps: steps ? [{ instruction: "Turn right", distanceM: 100 }] : [],
  };
}

describe("tripSurfaceHealth", () => {
  it("passes when all ordered routes have geometry", () => {
    const audit = auditTripSurface({
      orderedRouteIds: ["a", "b"],
      planRoutes: [route("a", true), route("b", true)],
      navigationStarted: false,
      guidanceRouteId: "a",
    });
    expect(audit.ok).toBe(true);
  });

  it("flags missing geometry on an ordered leg", () => {
    const audit = auditTripSurface({
      orderedRouteIds: ["a", "b"],
      planRoutes: [route("a", true), route("b", false)],
      navigationStarted: false,
      guidanceRouteId: "a",
    });
    expect(audit.issues).toContain("ordered_route_missing_geometry");
  });

  it("flags missing turn steps while navigating", () => {
    const audit = auditTripSurface({
      orderedRouteIds: ["a"],
      planRoutes: [route("a", true, false)],
      navigationStarted: true,
      guidanceRouteId: "a",
    });
    expect(audit.issues).toContain("guidance_missing_turn_steps");
  });

  it("requests map + data refresh on foreground resume", () => {
    const actions = repairActionsForTripSurfaceIssues(["foreground_resume"]);
    expect(actions).toContain("bump_map_fit");
    expect(actions).toContain("refresh_traffic");
  });
});
