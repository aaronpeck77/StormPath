import { describe, expect, it } from "vitest";
import { closestAlongRouteMeters } from "../../nav/routeGeometry";
import type { LngLat } from "../../nav/types";
import {
  detectForkFromActualVsPlanned,
  mergeDetectedFork,
  FORK_MIN_DIVERGE_M,
} from "../learn";
import { matchPersonalForkOffer, shouldAutoCommitPersonalFork } from "../match";
import { buildYourRouteNavRoute, PERSONAL_FORK_ROUTE_ID } from "../navRoute";
import type { PersonalFork } from "../types";

const HOME: LngLat = [-86.45, 39.12];

/**
 * Planned main: east on highway, then south to home (the "faster" through-town path).
 */
function plannedMainToHome(): LngLat[] {
  const pts: LngLat[] = [];
  for (let i = 0; i <= 20; i++) {
    pts.push([-86.6 + i * 0.01, 39.16]);
  }
  /* Continue east past the country exit, then drop south to home */
  for (let i = 1; i <= 8; i++) {
    pts.push([-86.4 + i * 0.005, 39.16]);
  }
  for (let j = 1; j <= 20; j++) {
    pts.push([-86.36, 39.16 - j * 0.002]);
  }
  pts.push(HOME);
  return pts;
}

/**
 * Actual: same highway until ~-86.45, then country roads south to the same home.
 */
function actualCountryForkToHome(): LngLat[] {
  const pts: LngLat[] = [];
  for (let i = 0; i <= 15; i++) {
    pts.push([-86.6 + i * 0.01, 39.16]);
  }
  for (let j = 1; j <= 35; j++) {
    pts.push([-86.45, 39.16 - j * 0.00115]);
  }
  pts.push(HOME);
  return pts;
}

describe("detectForkFromActualVsPlanned", () => {
  it("detects a sustained country-road fork off the highway", () => {
    const planned = plannedMainToHome();
    const actual = actualCountryForkToHome();
    const fork = detectForkFromActualVsPlanned(planned, actual);
    expect(fork).not.toBeNull();
    expect(fork!.divergeLengthM).toBeGreaterThanOrEqual(FORK_MIN_DIVERGE_M);
    expect(fork!.geometry.length).toBeGreaterThan(5);
    expect(fork!.forkPoint[0]).toBeCloseTo(-86.45, 1);
  });

  it("returns null when actual stays on the main corridor", () => {
    const planned = plannedMainToHome();
    const actual = planned.map(([lng, lat]) => [lng, lat + 0.00005] as LngLat);
    expect(detectForkFromActualVsPlanned(planned, actual)).toBeNull();
  });

  it("returns null for a brief blip off corridor", () => {
    const planned = plannedMainToHome();
    const actual = planned.map((p, i) =>
      i === 12 ? ([p[0], p[1] + 0.002] as LngLat) : ([p[0], p[1]] as LngLat)
    );
    expect(detectForkFromActualVsPlanned(planned, actual)).toBeNull();
  });
});

describe("mergeDetectedFork", () => {
  it("clusters repeated takes at the same exit", () => {
    const planned = plannedMainToHome();
    const actual = actualCountryForkToHome();
    const detected = detectForkFromActualVsPlanned(planned, actual)!;
    expect(detected).not.toBeNull();
    let forks = mergeDetectedFork([], detected, 1_000);
    expect(forks).toHaveLength(1);
    expect(forks[0]!.takeCount).toBe(1);

    const slightlyDifferent = {
      ...detected,
      forkPoint: [detected.forkPoint[0]! + 0.0003, detected.forkPoint[1]!] as LngLat,
    };
    forks = mergeDetectedFork(forks, slightlyDifferent, 2_000);
    expect(forks).toHaveLength(1);
    expect(forks[0]!.takeCount).toBe(2);
  });
});

describe("matchPersonalForkOffer", () => {
  function makeFork(overrides?: Partial<PersonalFork>): PersonalFork {
    const detected = detectForkFromActualVsPlanned(
      plannedMainToHome(),
      actualCountryForkToHome()
    )!;
    return {
      id: "pf-test",
      forkPoint: detected.forkPoint,
      forkBearingDeg: detected.forkBearingDeg,
      geometry: detected.geometry,
      destCenter: detected.destCenter,
      originCenter: detected.originCenter,
      takeCount: 3,
      lastTakenMs: Date.now(),
      createdAtMs: Date.now(),
      typicalEtaDeltaMin: 10,
      ...overrides,
    };
  }

  it("offers approaching when driver is within range of a known fork", () => {
    const fork = makeFork();
    const main = plannedMainToHome();
    const user: LngLat = [-86.48, 39.16];
    const { alongMeters } = closestAlongRouteMeters(user, main);
    const offer = matchPersonalForkOffer({
      forks: [fork],
      mainGeometry: main,
      userLngLat: user,
      userAlongMainM: alongMeters,
      destLngLat: fork.destCenter,
    });
    expect(offer).not.toBeNull();
    expect(offer!.phase).toBe("approaching");
    expect(offer!.fork.id).toBe("pf-test");
  });

  it("ignores dismissed or weak forks", () => {
    const fork = makeFork({ takeCount: 1, dismissed: true });
    const offer = matchPersonalForkOffer({
      forks: [fork],
      mainGeometry: plannedMainToHome(),
      userLngLat: [-86.48, 39.16],
      userAlongMainM: 12_000,
      destLngLat: fork.destCenter,
    });
    expect(offer).toBeNull();
  });

  it("auto-commits when GPS is on the fork corridor", () => {
    const fork = makeFork();
    const onForkPt = fork.geometry[Math.floor(fork.geometry.length * 0.4)]!;
    const offer = matchPersonalForkOffer({
      forks: [fork],
      mainGeometry: plannedMainToHome(),
      userLngLat: onForkPt,
      userAlongMainM: 16_000,
      destLngLat: fork.destCenter,
    });
    expect(offer?.phase).toBe("on_fork");
    expect(
      shouldAutoCommitPersonalFork({
        offer: offer!,
        userLngLat: onForkPt,
        mainGeometry: plannedMainToHome(),
        userAlongMainM: 16_000,
        headingDeg: fork.forkBearingDeg,
      })
    ).toBe(true);
  });
});

describe("buildYourRouteNavRoute", () => {
  it("builds a continuous Your route leg", () => {
    const detected = detectForkFromActualVsPlanned(
      plannedMainToHome(),
      actualCountryForkToHome()
    )!;
    const fork: PersonalFork = {
      id: "pf-nav",
      forkPoint: detected.forkPoint,
      forkBearingDeg: detected.forkBearingDeg,
      geometry: detected.geometry,
      destCenter: detected.destCenter,
      originCenter: detected.originCenter,
      takeCount: 4,
      lastTakenMs: 1,
      createdAtMs: 1,
      typicalEtaDeltaMin: 8,
    };
    const route = buildYourRouteNavRoute({
      fork,
      mainGeometry: plannedMainToHome(),
      userAlongMainM: 10_000,
    });
    expect(route.id).toBe(PERSONAL_FORK_ROUTE_ID);
    expect(route.label).toBe("Your route");
    expect(route.geometry.length).toBeGreaterThan(5);
    expect(route.turnSteps?.length).toBeGreaterThan(0);
  });
});
