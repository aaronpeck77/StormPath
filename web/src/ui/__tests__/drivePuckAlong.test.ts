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

  it("coasts forward between nav ticks at travel speed", () => {
    const next = tickOnRoutePuckAlong({
      prevAlongM: 1_000,
      navAlongM: 1_000.4,
      dtS: 0.05,
      speedMps: 20,
      routeTotalM: 50_000,
    });
    expect(next).toBeGreaterThan(1_000.5);
    expect(next).toBeLessThan(1_005);
  });
});
