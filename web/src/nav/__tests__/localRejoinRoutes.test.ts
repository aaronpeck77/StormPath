import { describe, expect, it } from "vitest";
import { pickLocalRejoinAlongM } from "../localRejoinRoutes";

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
