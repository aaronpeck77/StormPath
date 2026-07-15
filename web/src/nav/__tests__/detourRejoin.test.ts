import { describe, expect, it } from "vitest";
import {
  formatDetourRejoinDistanceM,
  hasRejoinedLockedRoute,
  isReverseRejoinRoute,
  metersRemainingToRejoinOnLockedRoute,
  pickBestRejoinRoute,
  pickLocalRejoinAlongM,
  resolveRejoinAlongBasisM,
} from "../detourRejoin";
import type { NavRoute } from "../types";

describe("pickLocalRejoinAlongM", () => {
  it("targets a point ahead on the locked leg, not the destination", () => {
    const totalM = 400_000;
    const along = 10_000;
    const rejoin = pickLocalRejoinAlongM(along, totalM, 0);
    expect(rejoin).toBeGreaterThan(along + 1500);
    expect(rejoin).toBeLessThan(along + 3500);
  });

  it("shifts the rejoin target on shuffle passes", () => {
    const totalM = 80_000;
    const along = 5_000;
    const a = pickLocalRejoinAlongM(along, totalM, 0);
    const b = pickLocalRejoinAlongM(along, totalM, 1);
    expect(b).not.toBe(a);
  });

  it("pushes rejoin further ahead at highway speed", () => {
    const totalM = 200_000;
    const along = 20_000;
    const city = pickLocalRejoinAlongM(along, totalM, 0, { speedMps: 8 });
    const highway = pickLocalRejoinAlongM(along, totalM, 0, { speedMps: 30 });
    expect(highway).toBeGreaterThan(city);
  });
});

describe("resolveRejoinAlongBasisM", () => {
  it("uses the farthest of leave latch and live along so targets stay ahead", () => {
    expect(
      resolveRejoinAlongBasisM({
        latchedLeaveAlongM: 8_000,
        liveAlongOnLockedM: 12_000,
        guidanceAlongM: 11_000,
      })
    ).toBe(12_000);
    expect(
      resolveRejoinAlongBasisM({
        latchedLeaveAlongM: 15_000,
        liveAlongOnLockedM: 9_000,
      })
    ).toBe(15_000);
  });
});

describe("isReverseRejoinRoute", () => {
  const user: [number, number] = [-77.0, 38.9];

  it("rejects labeled U-turns", () => {
    const uturn: NavRoute = {
      id: "r-b",
      role: "balanced",
      label: "B",
      geometry: [user, [-77.001, 38.901], [-77.02, 38.92]],
      baseEtaMinutes: 5,
      turnSteps: [
        {
          instruction: "Make a U-turn",
          maneuverType: "turn",
          maneuverModifier: "uturn",
          distanceM: 40,
        },
      ],
    };
    expect(isReverseRejoinRoute(uturn, user, 45)).toBe(true);
  });

  it("rejects stubs that depart opposite their own end (line behind the puck)", () => {
    /* End is north; first step goes south — classic reverse stub. */
    const reverse: NavRoute = {
      id: "r-b",
      role: "balanced",
      label: "B",
      geometry: [user, [-77.0, 38.88], [-77.0, 38.95]],
      baseEtaMinutes: 8,
    };
    expect(isReverseRejoinRoute(reverse, user, null)).toBe(true);
  });

  it("accepts a forward stub toward the rejoin end", () => {
    const forward: NavRoute = {
      id: "r-b",
      role: "balanced",
      label: "B",
      geometry: [user, [-77.005, 38.905], [-77.02, 38.92]],
      baseEtaMinutes: 4,
    };
    expect(isReverseRejoinRoute(forward, user, 45)).toBe(false);
  });
});

describe("pickBestRejoinRoute", () => {
  const user: [number, number] = [-77.0, 38.9];
  const rejoin: [number, number] = [-77.02, 38.92];

  it("prefers the shorter detour when ETAs are similar", () => {
    const short: NavRoute = {
      id: "r-b",
      role: "balanced",
      label: "B",
      geometry: [user, [-77.01, 38.905], rejoin],
      baseEtaMinutes: 4,
    };
    const long: NavRoute = {
      id: "r-c",
      role: "balanced",
      label: "C",
      geometry: [user, [-77.03, 38.88], [-77.04, 38.91], rejoin],
      baseEtaMinutes: 4,
    };
    expect(pickBestRejoinRoute([long, short], user, rejoin)?.id).toBe("r-b");
  });

  it("returns null when every candidate is a reverse stub", () => {
    const reverse: NavRoute = {
      id: "r-b",
      role: "balanced",
      label: "B",
      geometry: [user, [-77.0, 38.88], rejoin],
      baseEtaMinutes: 6,
    };
    expect(pickBestRejoinRoute([reverse], user, rejoin, 0)).toBeNull();
  });
});

describe("hasRejoinedLockedRoute", () => {
  const locked: [number, number][] = [
    [-77.0, 38.9],
    [-77.01, 38.91],
    [-77.02, 38.92],
    [-77.03, 38.93],
  ];

  it("detects when the driver is back on the locked line near rejoin", () => {
    const rejoinM = 2500;
    expect(hasRejoinedLockedRoute([-77.015, 38.915], locked, rejoinM, 2400)).toBe(true);
  });

  it("rejects a parallel offset still off the corridor", () => {
    const rejoinM = 2500;
    expect(hasRejoinedLockedRoute([-77.05, 38.915], locked, rejoinM, 2400)).toBe(false);
  });
});

describe("formatDetourRejoinDistanceM", () => {
  it("formats sub-mile and mile distances", () => {
    expect(formatDetourRejoinDistanceM(200)).toBe("ahead");
    expect(formatDetourRejoinDistanceM(3218)).toMatch(/mi/);
  });
});

describe("metersRemainingToRejoinOnLockedRoute", () => {
  const locked: [number, number][] = [
    [-77.0, 38.9],
    [-77.02, 38.92],
  ];

  it("returns distance along the locked route to the rejoin point", () => {
    const rejoinM = 3000;
    const remaining = metersRemainingToRejoinOnLockedRoute(
      locked,
      rejoinM,
      [-77.005, 38.902],
      500
    );
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThan(rejoinM);
  });
});
