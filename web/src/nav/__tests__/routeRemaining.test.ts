import { describe, expect, it } from "vitest";
import { geometryForRemainingTrafficFetch } from "../routeRemaining";

describe("geometryForRemainingTrafficFetch", () => {
  const route: [number, number][] = [
    [0, 0],
    [0, 0.2],
    [0, 0.4],
    [0, 0.6],
    [0, 0.8],
    [0, 1],
  ];

  it("returns full geometry near trip start or end", () => {
    expect(geometryForRemainingTrafficFetch(route, 0, [0, 0.01])).toEqual(route);
    expect(geometryForRemainingTrafficFetch(route, 150_000, [0, 0.99])).toEqual(route);
  });

  it("slices ahead of along-route progress and anchors on user position", () => {
    const alongM = 40_000;
    const user: [number, number] = [0.01, 0.41];
    const slice = geometryForRemainingTrafficFetch(route, alongM, user);
    expect(slice.length).toBeGreaterThanOrEqual(2);
    expect(slice[0]).toEqual(user);
    expect(slice[slice.length - 1]).toEqual(route[route.length - 1]);
  });
});
