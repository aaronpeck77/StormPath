import { describe, expect, it } from "vitest";
import { lockedRouteShouldAvoidMotorway } from "../driveAlwaysAhead";
import { routeGeometryAgreesWithLocked } from "../lockedRouteGeometryGuard";
import type { LngLat } from "../types";

describe("lockedRouteShouldAvoidMotorway", () => {
  it("avoids motorways for hazardSmart / balanced roles", () => {
    expect(
      lockedRouteShouldAvoidMotorway(
        { id: "r-b", role: "hazardSmart", baseEtaMinutes: 40 },
        [
          { id: "r-a", baseEtaMinutes: 30 },
          { id: "r-b", baseEtaMinutes: 40 },
        ]
      )
    ).toBe(true);
  });

  it("avoids motorways when the locked leg is slower than the plan's fastest", () => {
    // Preferred / trail blue preview can promote a slower corridor without a backroads role.
    expect(
      lockedRouteShouldAvoidMotorway(
        { id: "r-b", role: "fastest", baseEtaMinutes: 42 },
        [
          { id: "r-a", baseEtaMinutes: 30 },
          { id: "r-b", baseEtaMinutes: 42 },
        ]
      )
    ).toBe(true);
  });

  it("allows motorways when the locked leg is the fastest", () => {
    expect(
      lockedRouteShouldAvoidMotorway(
        { id: "r-a", role: "fastest", baseEtaMinutes: 30 },
        [
          { id: "r-a", baseEtaMinutes: 30 },
          { id: "r-b", baseEtaMinutes: 42 },
        ]
      )
    ).toBe(false);
  });
});

describe("routeGeometryAgreesWithLocked", () => {
  const locked: LngLat[] = [
    [-86.78, 36.16],
    [-86.79, 36.17],
    [-86.8, 36.18],
    [-86.81, 36.19],
  ];

  it("accepts a candidate that tracks the locked corridor", () => {
    const candidate: LngLat[] = locked.map(([lng, lat]) => [lng + 0.0002, lat + 0.0001]);
    expect(routeGeometryAgreesWithLocked(candidate, locked)).toBe(true);
  });

  it("rejects a highway fork that shares ends but diverges in the middle", () => {
    const candidate: LngLat[] = [
      locked[0]!,
      [-86.7, 36.165], // far east interstate swing
      [-86.65, 36.175],
      locked[locked.length - 1]!,
    ];
    expect(routeGeometryAgreesWithLocked(candidate, locked)).toBe(false);
  });
});
