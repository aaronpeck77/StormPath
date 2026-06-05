import { describe, expect, it } from "vitest";
import {
  expectedTripRouteLineLayerIds,
  tripRouteLineLayerId,
} from "../tripRouteLayerHealth";

describe("tripRouteLayerHealth", () => {
  it("builds stable Mapbox layer ids for route legs", () => {
    expect(tripRouteLineLayerId("r-a")).toBe("route-r-a-line");
    expect(expectedTripRouteLineLayerIds(["r-a", "r-b"])).toEqual([
      "route-r-a-line",
      "route-r-b-line",
    ]);
  });
});
