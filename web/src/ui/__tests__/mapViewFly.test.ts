import { describe, expect, it } from "vitest";
import { MAP_VIEW_FLY_MS, shouldAnimateMapViewFly } from "../mapViewFly";

describe("shouldAnimateMapViewFly", () => {
  it("flies between the three map poses", () => {
    expect(
      shouldAnimateMapViewFly({ prevViewMode: "drive", nextViewMode: "topdown" })
    ).toBe(true);
    expect(shouldAnimateMapViewFly({ prevViewMode: "topdown", nextViewMode: "route" })).toBe(
      true
    );
    expect(shouldAnimateMapViewFly({ prevViewMode: "route", nextViewMode: "drive" })).toBe(
      true
    );
    expect(MAP_VIEW_FLY_MS).toBeLessThan(1000);
    expect(MAP_VIEW_FLY_MS).toBeGreaterThan(300);
  });

  it("jumps on first paint, same view, pinch, dest-hold, or compare", () => {
    expect(shouldAnimateMapViewFly({ prevViewMode: null, nextViewMode: "drive" })).toBe(false);
    expect(
      shouldAnimateMapViewFly({ prevViewMode: "drive", nextViewMode: "drive" })
    ).toBe(false);
    expect(
      shouldAnimateMapViewFly({
        prevViewMode: "drive",
        nextViewMode: "route",
        userExploring: true,
      })
    ).toBe(false);
    expect(
      shouldAnimateMapViewFly({
        prevViewMode: "drive",
        nextViewMode: "route",
        destPlaceHold: true,
      })
    ).toBe(false);
    expect(
      shouldAnimateMapViewFly({
        prevViewMode: "drive",
        nextViewMode: "topdown",
        offRouteCompare: true,
      })
    ).toBe(false);
  });
});
