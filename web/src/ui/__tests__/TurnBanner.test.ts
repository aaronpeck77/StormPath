import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TurnBanner } from "../TurnBanner";
import type { RouteTurnStep } from "../../nav/types";

function renderBanner(steps: RouteTurnStep[]) {
  return renderToStaticMarkup(createElement(TurnBanner, {
    visible: true,
    steps,
    activeIndex: 0,
    metersToManeuverEnd: 100,
  }));
}

describe("TurnBanner missing next maneuver", () => {
  it("does not claim arrival when a non-arrival step has no successor", () => {
    const html = renderBanner([{ instruction: "Head west", maneuverType: "depart" }]);
    expect(html).not.toContain("Arriving");
    expect(html).toContain("Continue on route");
  });

  it("shows unavailable guidance rather than arrival for an empty turn list", () => {
    const html = renderBanner([]);
    expect(html).toContain("No turn list for this route");
    expect(html).not.toContain("Arriving");
  });

  it("retains arrival copy for a real arrival maneuver", () => {
    expect(renderBanner([{ instruction: "Arrive", maneuverType: "arrive" }])).toContain("Arriving");
  });
});
