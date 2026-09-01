import { describe, expect, it } from "vitest";
import {
  isParkedForAlongPuck,
  netApparentSpeedMps,
  tickOnRoutePuckAlong,
} from "../drivePuckAlong";

describe("tickOnRoutePuckAlong", () => {
  it("does not chase a reverse along jump while rolling", () => {
    const next = tickOnRoutePuckAlong({
      prevAlongM: 1_000,
      navAlongM: 820,
      dtS: 0.016,
      speedMps: 20,
      routeTotalM: 50_000,
    });
    expect(next).toBeGreaterThan(990);
    expect(next).toBeLessThan(1_010);
  });

  it("caps a teleport forward so the puck cannot leap hundreds of meters in one frame", () => {
    const next = tickOnRoutePuckAlong({
      prevAlongM: 1_000,
      navAlongM: 4_000,
      dtS: 0.016,
      speedMps: 20,
      routeTotalM: 50_000,
    });
    expect(next).toBeLessThan(1_040);
    expect(next).toBeGreaterThan(1_000);
  });

  it("coasts toward nav along while rolling, but never past it", () => {
    const next = tickOnRoutePuckAlong({
      prevAlongM: 1_000,
      navAlongM: 1_020,
      dtS: 0.05,
      speedMps: 20,
      routeTotalM: 50_000,
    });
    expect(next).toBeGreaterThan(1_000);
    expect(next).toBeLessThanOrEqual(1_020);
  });

  it("stays put at Go when sitting still", () => {
    let along = 0;
    for (let i = 0; i < 180; i++) {
      along = tickOnRoutePuckAlong({
        prevAlongM: along,
        navAlongM: 0,
        dtS: 0.016,
        speedMps: 0,
        routeTotalM: 50_000,
        parked: true,
      });
    }
    expect(along).toBeLessThan(1);
  });

  it("does not invent motion past nav along when speed is wrongly high while parked", () => {
    let along = 0;
    for (let i = 0; i < 180; i++) {
      along = tickOnRoutePuckAlong({
        prevAlongM: along,
        navAlongM: 0,
        dtS: 0.016,
        speedMps: 16,
        routeTotalM: 50_000,
        parked: true,
      });
    }
    expect(along).toBeLessThan(1);
  });

  it("ignores GPS projecting far down the route while parked", () => {
    const next = tickOnRoutePuckAlong({
      prevAlongM: 5,
      navAlongM: 120,
      dtS: 0.016,
      speedMps: 0.3,
      routeTotalM: 50_000,
      parked: true,
    });
    expect(next).toBe(5);
  });

  it("does not creep toward a nearby nav along while parked", () => {
    let along = 0;
    for (let i = 0; i < 180; i++) {
      along = tickOnRoutePuckAlong({
        prevAlongM: along,
        navAlongM: 10,
        dtS: 0.016,
        speedMps: 16,
        routeTotalM: 50_000,
        parked: true,
      });
    }
    expect(along).toBe(0);
  });
});

describe("isParkedForAlongPuck", () => {
  it("treats leftover iOS speed as parked when GPS has not moved yet", () => {
    expect(
      isParkedForAlongPuck({
        reportedSpeedMps: 16,
        apparentSpeedMps: null,
      })
    ).toBe(true);
  });

  it("treats GPS jitter with leftover speed as parked", () => {
    expect(
      isParkedForAlongPuck({
        reportedSpeedMps: 16,
        apparentSpeedMps: 0.4,
      })
    ).toBe(true);
  });

  it("unparks only when GPS is actually translating", () => {
    expect(
      isParkedForAlongPuck({
        reportedSpeedMps: 16,
        apparentSpeedMps: 14,
      })
    ).toBe(false);
  });
});

describe("netApparentSpeedMps", () => {
  it("does not treat GPS wobble around one spot as driving", () => {
    const samples = [
      { lng: -86.78, lat: 36.16, t: 0 },
      { lng: -86.78002, lat: 36.16002, t: 1000 },
      { lng: -86.77998, lat: 36.15998, t: 2000 },
      { lng: -86.78, lat: 36.16, t: 3000 },
    ];
    const speed = netApparentSpeedMps(samples, 3000);
    expect(speed).not.toBeNull();
    expect(speed!).toBeLessThan(1.4);
  });

  it("reports real motion when the phone actually translates", () => {
    /* ~20 m/s north for 3 s ≈ 0.00018 deg lat/s */
    const samples = [
      { lng: -86.78, lat: 36.16, t: 0 },
      { lng: -86.78, lat: 36.16018, t: 1000 },
      { lng: -86.78, lat: 36.16036, t: 2000 },
      { lng: -86.78, lat: 36.16054, t: 3000 },
    ];
    const speed = netApparentSpeedMps(samples, 3000);
    expect(speed).not.toBeNull();
    expect(speed!).toBeGreaterThan(10);
  });
});
