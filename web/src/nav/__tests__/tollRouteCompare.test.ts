import { describe, expect, it } from "vitest";
import { buildTollCompareDisplayPlan } from "../tollRouteCompare";
import type { NavRoute, TripPlan } from "../types";

function fakeRoute(partial: Partial<NavRoute>): NavRoute {
  return {
    id: "x",
    role: "balanced",
    label: "",
    geometry: [
      [-86.5, 39.1],
      [-86.4, 39.2],
    ],
    baseEtaMinutes: 30,
    ...partial,
  };
}

describe("buildTollCompareDisplayPlan", () => {
  const basePlan: TripPlan = {
    originLabel: "Home",
    destinationLabel: "Office",
    routes: [
      fakeRoute({ id: "orig-a", label: "I-65 via tolls", baseEtaMinutes: 35 }),
      fakeRoute({ id: "orig-b", baseEtaMinutes: 41 }),
      fakeRoute({ id: "orig-c", baseEtaMinutes: 44 }),
    ],
  };

  it("produces a two-route plan with stable A/B ids", () => {
    const current = basePlan.routes[0]!;
    const tollFree = fakeRoute({ id: "tf", role: "balanced", baseEtaMinutes: 38 });

    const display = buildTollCompareDisplayPlan(basePlan, current, tollFree);

    expect(display.routes).toHaveLength(2);
    expect(display.routes[0]!.id).toBe("r-a");
    expect(display.routes[1]!.id).toBe("r-b");
    expect(display.routes[0]!.label).toBe("I-65 via tolls");
    expect(display.routes[1]!.label).toBe("Toll-free");
  });

  it("falls back to 'With tolls' when the current route has no usable label", () => {
    const current = fakeRoute({ id: "orig-a", label: "  " });
    const tollFree = fakeRoute({ id: "tf" });

    const display = buildTollCompareDisplayPlan(basePlan, current, tollFree);
    expect(display.routes[0]!.label).toBe("With tolls");
  });

  it("preserves origin/destination labels and copies route fields", () => {
    const current = fakeRoute({
      id: "orig-a",
      label: "Toll path",
      baseEtaMinutes: 33,
      hasTolls: true,
      tollLabels: ["I-65", "I-294"],
    });
    const tollFree = fakeRoute({ id: "tf", baseEtaMinutes: 41 });

    const display = buildTollCompareDisplayPlan(basePlan, current, tollFree);

    expect(display.originLabel).toBe("Home");
    expect(display.destinationLabel).toBe("Office");
    expect(display.routes[0]!.baseEtaMinutes).toBe(33);
    expect(display.routes[0]!.hasTolls).toBe(true);
    expect(display.routes[0]!.tollLabels).toEqual(["I-65", "I-294"]);
    expect(display.routes[1]!.baseEtaMinutes).toBe(41);
  });

  it("does not mutate the input plan or routes", () => {
    const current = basePlan.routes[0]!;
    const tollFree = fakeRoute({ id: "tf" });
    const before = JSON.stringify(basePlan);

    buildTollCompareDisplayPlan(basePlan, current, tollFree);

    expect(JSON.stringify(basePlan)).toBe(before);
    /* The original route's id must not be rewritten — only the copy in the display plan. */
    expect(current.id).toBe("orig-a");
  });
});
