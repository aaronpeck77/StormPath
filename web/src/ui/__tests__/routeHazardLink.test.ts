import { describe, expect, it, vi } from "vitest";
import { hazardIdsAtPosition, scrollHazardBand, scrollHazardCard } from "../routeHazardLink";

const bands = [
  { id: "nws:a", left: 10, width: 20 },
  { id: "nws:b", left: 20, width: 30 },
  { id: "road:c", left: 70, width: 10 },
];

describe("shared hazard links", () => {
  it("resolves overlapping marks without choosing an arbitrary hazard", () => {
    expect(hazardIdsAtPosition(bands, 25, "nws:b")).toEqual(["nws:a", "nws:b"]);
    expect(hazardIdsAtPosition(bands, 75, "road:c")).toEqual(["road:c"]);
  });

  it("uses the focused hazard for keyboard selection and tolerates rounding at the edge", () => {
    expect(hazardIdsAtPosition(bands, NaN, "nws:b")).toEqual(["nws:b"]);
    expect(hazardIdsAtPosition(bands, 99, "road:c")).toEqual(["road:c"]);
    expect(hazardIdsAtPosition([...bands, bands[0]!], 15, "nws:a")).toEqual(["nws:a"]);
  });

  it("scrolls to the card vertically without resetting the graph's horizontal position", () => {
    const scrollTo = vi.fn();
    const panel = { getBoundingClientRect: () => ({ top: 100 }), scrollTop: 40, scrollTo };
    const card = { getBoundingClientRect: () => ({ top: 500 }) };
    scrollHazardCard(panel as unknown as HTMLElement, card as HTMLElement);
    expect(scrollTo).toHaveBeenCalledWith({ top: 434, behavior: "smooth" });
  });

  it("centers the graph mark using only horizontal scroll", () => {
    const scrollTo = vi.fn();
    const panel = { getBoundingClientRect: () => ({ left: 10 }), scrollLeft: 200, clientWidth: 300, scrollTo };
    const band = { getBoundingClientRect: () => ({ left: 250, width: 20 }) };
    scrollHazardBand(panel as unknown as HTMLElement, band as HTMLElement);
    expect(scrollTo).toHaveBeenCalledWith({ left: 300, behavior: "smooth" });
  });
});
