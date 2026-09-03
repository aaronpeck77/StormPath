import { describe, expect, it } from "vitest";
import { lockedRouteShouldAvoidMotorway } from "../driveAlwaysAhead";
import {
  nativeGeometryApplyPolicy,
  nativeRouteChangedShouldForce,
  routeGeometryAgreesWithLocked,
  shouldAdoptNativeRouteGeometry,
  shouldFeedNativeProgressToUi,
  shouldForceAdoptOffRouteNativeGeometry,
  shouldReplaceGoPolylineOnNativeAdopt,
} from "../lockedRouteGeometryGuard";
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

describe("shouldAdoptNativeRouteGeometry", () => {
  const locked: LngLat[] = [
    [-86.78, 36.16],
    [-86.79, 36.17],
    [-86.8, 36.18],
    [-86.81, 36.19],
  ];
  const fastestFork: LngLat[] = [
    locked[0]!,
    [-86.7, 36.165],
    [-86.65, 36.175],
    locked[locked.length - 1]!,
  ];

  it("rejects session-start Core fastest that diverges from Go lock", () => {
    expect(shouldAdoptNativeRouteGeometry(fastestFork, locked, false)).toBe(false);
  });

  it("accepts mid-trip force even when geometry diverges", () => {
    expect(shouldAdoptNativeRouteGeometry(fastestFork, locked, true)).toBe(true);
  });

  it("accepts Core geometry that tracks the Go lock without force", () => {
    const refined = locked.map(([lng, lat]) => [lng + 0.0001, lat] as LngLat);
    expect(shouldAdoptNativeRouteGeometry(refined, locked, false)).toBe(true);
  });
});

describe("shouldForceAdoptOffRouteNativeGeometry", () => {
  const locked: LngLat[] = [
    [-86.78, 36.16],
    [-86.79, 36.17],
    [-86.8, 36.18],
  ];

  it("is false while the driver is still on the Go lock (session-start steal)", () => {
    expect(
      shouldForceAdoptOffRouteNativeGeometry({
        candidate: [
          locked[0]!,
          [-86.7, 36.165],
          locked[locked.length - 1]!,
        ],
        locked,
        userLngLat: locked[1],
      })
    ).toBe(false);
  });

  it("is true when the driver left the lock and Core starts near GPS", () => {
    const user: LngLat = [-86.74, 36.14];
    expect(
      shouldForceAdoptOffRouteNativeGeometry({
        candidate: [user, [-86.73, 36.13], [-86.72, 36.12]],
        locked,
        userLngLat: user,
      })
    ).toBe(true);
  });
});

describe("nativeRouteChangedShouldForce", () => {
  it("matches Apple 4.20.7: later Core reroutes always force", () => {
    expect(
      nativeRouteChangedShouldForce({
        isFirstRouteChanged: false,
        driverAlreadyOffLockedCorridor: false,
      })
    ).toBe(true);
  });

  it("does not steal Go-locked B on the first session emit", () => {
    expect(
      nativeRouteChangedShouldForce({
        isFirstRouteChanged: true,
        driverAlreadyOffLockedCorridor: false,
      })
    ).toBe(false);
  });

  it("forces the first emit only if already off the lock", () => {
    expect(
      nativeRouteChangedShouldForce({
        isFirstRouteChanged: true,
        driverAlreadyOffLockedCorridor: true,
      })
    ).toBe(true);
  });
});

describe("nativeGeometryApplyPolicy", () => {
  it("does not reset along or collapse A/B/C on session-start adopt", () => {
    expect(nativeGeometryApplyPolicy(false)).toEqual({
      resetAlongHold: false,
      collapsePlanToLocked: false,
    });
  });

  it("resets along and collapses only on mid-trip force", () => {
    expect(nativeGeometryApplyPolicy(true)).toEqual({
      resetAlongHold: true,
      collapsePlanToLocked: true,
    });
  });
});

describe("shouldReplaceGoPolylineOnNativeAdopt", () => {
  it("keeps the Go polyline on session-start Core refine", () => {
    expect(shouldReplaceGoPolylineOnNativeAdopt(false, true)).toBe(false);
  });

  it("replaces when there is no Go lock yet, or on mid-trip force", () => {
    expect(shouldReplaceGoPolylineOnNativeAdopt(false, false)).toBe(true);
    expect(shouldReplaceGoPolylineOnNativeAdopt(true, true)).toBe(true);
  });
});

describe("shouldFeedNativeProgressToUi", () => {
  it("ignores Core puck/alongM when the Go lock rejected Core geometry", () => {
    expect(
      shouldFeedNativeProgressToUi({ abandoned: true, corridorAdopted: false })
    ).toBe(false);
    expect(
      shouldFeedNativeProgressToUi({ abandoned: false, corridorAdopted: false })
    ).toBe(false);
  });

  it("feeds Core progress only after the corridor is adopted", () => {
    expect(
      shouldFeedNativeProgressToUi({ abandoned: false, corridorAdopted: true })
    ).toBe(true);
  });
});
