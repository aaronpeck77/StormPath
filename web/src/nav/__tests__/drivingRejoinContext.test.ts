import { describe, expect, it } from "vitest";
import {
  classifyTripRouteRole,
  resolveDrivingRejoinContext,
  roadClassAtAlong,
} from "../drivingRejoinContext";
import type { NavRoute } from "../types";
import { METERS_PER_MILE } from "../constants";

const MI = METERS_PER_MILE;

function route(steps: NavRoute["turnSteps"], geometry: NavRoute["geometry"]): NavRoute {
  return {
    id: "r-a",
    label: "A",
    role: "fastest",
    geometry,
    baseEtaMinutes: 30,
    turnSteps: steps,
  };
}

describe("drivingRejoinContext", () => {
  it("treats interstate steps as highway", () => {
    const r = route(
      [{ instruction: "Continue on I-95 North", distanceM: 5000, maneuverType: "continue" }],
      [
        [-77.0, 38.9],
        [-77.1, 39.0],
      ]
    );
    expect(roadClassAtAlong(r, 100)).toBe("highway");
  });

  it("auto local rejoin on city streets for a short trip", () => {
    const r = route(
      [{ instruction: "Turn right on Main St", distanceM: 400, maneuverType: "turn" }],
      [
        [-77.0, 38.9],
        [-77.01, 38.91],
      ]
    );
    const ctx = resolveDrivingRejoinContext({
      guidanceRoute: r,
      userAlongM: 200,
      destLngLat: [-77.01, 38.91],
    });
    expect(ctx.roadClass).toBe("city_streets");
    expect(ctx.tripRole).toBe("local");
    expect(ctx.mode).toBe("auto_local");
  });

  it("keeps highway-through trips manual even on surface streets near destination", () => {
    expect(
      classifyTripRouteRole({
        totalM: 120 * MI,
        remainingM: 80 * MI,
        destLngLat: [-77.5, 39.0],
        routeGeometry: [
          [-77.0, 38.9],
          [-77.5, 39.0],
        ],
      })
    ).toBe("through");

    const r = route(
      [{ instruction: "Continue on I-81 South", distanceM: 8000, maneuverType: "continue" }],
      [
        [-77.0, 38.9],
        [-77.5, 39.0],
      ]
    );
    const ctx = resolveDrivingRejoinContext({
      guidanceRoute: r,
      userAlongM: 20 * MI,
      destLngLat: [-77.5, 39.0],
    });
    expect(ctx.mode).toBe("manual");
    expect(ctx.roadClass).toBe("highway");
  });
});
