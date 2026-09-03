import { describe, expect, it } from "vitest";
import { arrivalProximity, isStationaryForArrival } from "../arrivalDetect";

describe("isStationaryForArrival", () => {
  it("treats low explicit speed as stationary", () => {
    expect(isStationaryForArrival(0, 5_000)).toBe(true);
    expect(isStationaryForArrival(2.8, 5_000)).toBe(true);
    expect(isStationaryForArrival(3, 5_000)).toBe(false);
  });

  it("does not treat missing speed as stationary mid-route", () => {
    expect(isStationaryForArrival(null, 5_000)).toBe(false);
    expect(isStationaryForArrival(undefined, 500)).toBe(false);
  });

  it("treats missing speed as stationary only when almost no distance remains", () => {
    expect(isStationaryForArrival(null, 35)).toBe(true);
    expect(isStationaryForArrival(null, 36)).toBe(false);
  });
});

describe("arrivalProximity", () => {
  const dest: [number, number] = [-97.74, 30.27];
  const farPos: [number, number] = [-97.84, 30.27];

  it("is not near when far from destination with plenty of route left", () => {
    const prox = arrivalProximity({
      pos: farPos,
      dest,
      routeGeometry: [farPos, dest],
      alongRouteM: 2_000,
      routeLengthM: 12_000,
    });
    expect(prox.near).toBe(false);
  });
});
