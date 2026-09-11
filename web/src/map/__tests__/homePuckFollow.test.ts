import { describe, expect, it } from "vitest";
import { isIdleHomeScreen, readHomePuckFollow } from "../homePuckFollow";

describe("readHomePuckFollow", () => {
  it("defaults to follow so launch centers the puck on GPS", () => {
    expect(readHomePuckFollow()).toBe("follow");
  });
});

describe("isIdleHomeScreen", () => {
  it("is home only before a destination or routes exist", () => {
    expect(
      isIdleHomeScreen({ routesLength: 0, navigationStarted: false, destLngLat: null })
    ).toBe(true);
  });

  it("leaves home as soon as a map destination is placed (routes may still be loading)", () => {
    expect(
      isIdleHomeScreen({
        routesLength: 0,
        navigationStarted: false,
        destLngLat: [-89.6, 39.8],
      })
    ).toBe(false);
  });

  it("is not home while navigating or once routes exist", () => {
    expect(
      isIdleHomeScreen({
        routesLength: 1,
        navigationStarted: false,
        destLngLat: [-89.6, 39.8],
      })
    ).toBe(false);
    expect(
      isIdleHomeScreen({ routesLength: 0, navigationStarted: true, destLngLat: null })
    ).toBe(false);
  });
});
