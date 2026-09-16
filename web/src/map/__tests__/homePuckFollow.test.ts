import { describe, expect, it } from "vitest";
import { isIdleHomeScreen, readHomePuckFollow } from "../homePuckFollow";

describe("readHomePuckFollow", () => {
  it("defaults to follow so launch centers the puck on GPS", () => {
    expect(readHomePuckFollow()).toBe("follow");
  });
});

describe("isIdleHomeScreen", () => {
  it("is home only with no dest, no routes, and not navigating", () => {
    expect(
      isIdleHomeScreen({ routesLength: 0, navigationStarted: false, destLngLat: null })
    ).toBe(true);
  });

  it("is not home after a dest tap while routes are still loading", () => {
    expect(
      isIdleHomeScreen({
        routesLength: 0,
        navigationStarted: false,
        destLngLat: [-86.78, 36.16],
      })
    ).toBe(false);
  });
});
