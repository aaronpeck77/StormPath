import { describe, expect, it } from "vitest";
import { tickOnRoutePuckAlong } from "../drivePuckAlong";

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
});
