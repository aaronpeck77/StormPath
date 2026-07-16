import { describe, expect, it } from "vitest";
import { learnedClusterToSavedRoute } from "../learnedToSaved";
import type { FrequentRouteCluster } from "../types";

describe("learnedClusterToSavedRoute", () => {
  it("uses From → To place names when labels exist", () => {
    const c: FrequentRouteCluster = {
      id: "fr-1",
      count: 4,
      lastSeen: 100,
      geometry: [
        [-90.2, 38.6],
        [-90.1, 38.65],
      ],
      centerStart: [-90.2, 38.6],
      centerEnd: [-90.1, 38.65],
      startLabel: "Springfield, IL",
      endLabel: "Decatur, IL",
    };
    const saved = learnedClusterToSavedRoute(c);
    expect(saved.name).toBe("Springfield, IL → Decatur, IL");
    expect(saved.startLabel).toBe("Springfield, IL");
    expect(saved.destinationLabel).toBe("Decatur, IL");
  });
});
