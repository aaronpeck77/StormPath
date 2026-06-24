import { describe, expect, it } from "vitest";
import { computePuckTargetBeforeRouteSnap, type PuckFix } from "../driveMapPuckTarget";

describe("computePuckTargetBeforeRouteSnap", () => {
  it("lerps between two fixes while alpha <= 1", () => {
    const prev: PuckFix = { lng: -86.78, lat: 36.16, t: 1000 };
    const cur: PuckFix = { lng: -86.779, lat: 36.161, t: 2000 };
    const mid = computePuckTargetBeforeRouteSnap({
      now: 1500,
      prevFix: prev,
      curFix: cur,
      fallback: [-86.78, 36.16],
      speedMps: null,
      headingDeg: null,
    });
    expect(mid[0]).toBeCloseTo(-86.7795, 5);
    expect(mid[1]).toBeCloseTo(36.1605, 5);
  });

  it("dead-reckons past the latest fix instead of stopping", () => {
    const prev: PuckFix = { lng: -86.78, lat: 36.16, t: 1000 };
    const cur: PuckFix = { lng: -86.779, lat: 36.161, t: 2000 };
    const ahead = computePuckTargetBeforeRouteSnap({
      now: 2500,
      prevFix: prev,
      curFix: cur,
      fallback: [-86.78, 36.16],
      speedMps: 20,
      headingDeg: 90,
      maxDeadReckonS: 2.5,
    });
    expect(ahead[0]).toBeGreaterThan(cur.lng);
    expect(ahead[1]).toBeCloseTo(cur.lat, 3);
  });

  it("holds at the latest fix when speed is unknown and stationary", () => {
    const prev: PuckFix = { lng: -86.78, lat: 36.16, t: 1000 };
    const cur: PuckFix = { lng: -86.779, lat: 36.161, t: 2000 };
    const held = computePuckTargetBeforeRouteSnap({
      now: 2500,
      prevFix: prev,
      curFix: cur,
      fallback: [-86.78, 36.16],
      speedMps: 0.2,
      headingDeg: null,
    });
    expect(held[0]).toBe(cur.lng);
    expect(held[1]).toBe(cur.lat);
  });
});
