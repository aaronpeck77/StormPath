import { describe, expect, it } from "vitest";
import { pickLocalRejoinAlongM } from "../detourRejoin";
import { forwardOnlyRejoinPool } from "../localRejoinRoutes";
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
});

describe("forwardOnlyRejoinPool", () => {
  const user: [number, number] = [-77.0, 38.9];

  it("drops reverse stubs so guidance never follows a line behind the puck", () => {
    const reverse: NavRoute = {
      id: "r-b",
      role: "balanced",
      label: "B",
      geometry: [user, [-77.0, 38.88], [-77.0, 38.95]],
      baseEtaMinutes: 8,
    };
    const forward: NavRoute = {
      id: "r-c",
      role: "balanced",
      label: "C",
      geometry: [user, [-77.005, 38.905], [-77.02, 38.92]],
      baseEtaMinutes: 4,
    };
    const pool = forwardOnlyRejoinPool([reverse, forward], user, 45);
    expect(pool.map((r) => r.id)).toEqual(["r-c"]);
  });

  it("returns empty when only U-turn stubs exist", () => {
    const reverse: NavRoute = {
      id: "r-b",
      role: "balanced",
      label: "B",
      geometry: [user, [-77.0, 38.88], [-77.0, 38.95]],
      baseEtaMinutes: 8,
    };
    expect(forwardOnlyRejoinPool([reverse], user, null)).toEqual([]);
  });
});
