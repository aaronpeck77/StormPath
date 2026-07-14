import { describe, expect, it } from "vitest";
import { shouldPromptTollBeforeGo } from "../useTripLifecycle";
import type { NavRoute } from "../types";

function route(over: Partial<NavRoute> & Pick<NavRoute, "id">): NavRoute {
  return {
    role: "fastest",
    label: "A",
    geometry: [
      [-88, 39],
      [-87, 40],
    ],
    turnSteps: [],
    baseEtaMinutes: 30,
    hasTolls: false,
    tollLabels: [],
    ...over,
  };
}

describe("shouldPromptTollBeforeGo", () => {
  it("prompts when toll bypass is on, route has tolls, and route is not yet accepted", () => {
    expect(
      shouldPromptTollBeforeGo({
        route: route({ id: "r-a", hasTolls: true }),
        tollBypassEnabled: true,
        acceptedRouteIds: new Set(),
        chosenRouteId: "r-a",
      })
    ).toBe(true);
  });

  it("skips when the driver already accepted tolls for that leg", () => {
    expect(
      shouldPromptTollBeforeGo({
        route: route({ id: "r-a", hasTolls: true }),
        tollBypassEnabled: true,
        acceptedRouteIds: new Set(["r-a"]),
        chosenRouteId: "r-a",
      })
    ).toBe(false);
  });

  it("skips when toll bypass is off or the route is toll-free", () => {
    expect(
      shouldPromptTollBeforeGo({
        route: route({ id: "r-a", hasTolls: true }),
        tollBypassEnabled: false,
        acceptedRouteIds: new Set(),
        chosenRouteId: "r-a",
      })
    ).toBe(false);
    expect(
      shouldPromptTollBeforeGo({
        route: route({ id: "r-a", hasTolls: false }),
        tollBypassEnabled: true,
        acceptedRouteIds: new Set(),
        chosenRouteId: "r-a",
      })
    ).toBe(false);
  });
});
