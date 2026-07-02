import { describe, expect, it } from "vitest";
import { pickBestForwardRoute, routeStartsWithUturn } from "../forwardRoutePick";
import type { NavRoute } from "../types";

function route(
  id: string,
  eta: number,
  geometry: [number, number][],
  firstStep?: { instruction: string; maneuverModifier?: string }
): NavRoute {
  return {
    id,
    role: "fastest",
    label: id,
    geometry,
    baseEtaMinutes: eta,
    turnSteps: firstStep ? [{ instruction: firstStep.instruction, maneuverModifier: firstStep.maneuverModifier }] : [],
  };
}

describe("forwardRoutePick", () => {
  it("detects U-turn first step", () => {
    expect(
      routeStartsWithUturn(
        route("a", 10, [[-77, 38], [-77.01, 38.01]], {
          instruction: "Make a U-turn",
          maneuverModifier: "uturn",
        })
      )
    ).toBe(true);
  });

  it("prefers forward depart over immediate U-turn even when U-turn is faster", () => {
    const user: [number, number] = [-77.0, 38.9];
    const heading = 270;
    const forward = route(
      "forward",
      14,
      [user, [-77.02, 38.9], [-77.04, 38.9]],
      { instruction: "Continue straight" }
    );
    const uturn = route(
      "uturn",
      11,
      [user, [-77.0, 38.905], [-77.0, 38.88]],
      { instruction: "Make a U-turn", maneuverModifier: "uturn" }
    );
    const picked = pickBestForwardRoute([uturn, forward], user, heading);
    expect(picked?.id).toBe("forward");
  });
});
