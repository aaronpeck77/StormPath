import { describe, expect, it } from "vitest";
import {
  formatHorizonHazardLine,
  horizonHazardsFromProgress,
  horizonLimitMph,
  mergeHorizonHazardLine,
} from "../horizonAhead";

describe("horizonLimitMph", () => {
  it("keeps a normal road-graph limit", () => {
    expect(horizonLimitMph(65)).toBe(65);
  });

  it("drops unlimited and nonsense values", () => {
    expect(horizonLimitMph(null)).toBeNull();
    expect(horizonLimitMph(0)).toBeNull();
    expect(horizonLimitMph(120)).toBeNull();
  });
});

describe("horizon hazards", () => {
  it("keeps the nearest construction and drops unknown kinds", () => {
    expect(
      horizonHazardsFromProgress([
        { kind: "tunnel", text: "Tunnel", distanceM: 100 },
        { kind: "construction", text: "Construction: left lane", distanceM: 2400 },
        { kind: "accident", text: "Crash", distanceM: 800 },
      ])
    ).toEqual([
      { kind: "accident", text: "Crash", distanceM: 800 },
      { kind: "construction", text: "Construction: left lane", distanceM: 2400 },
    ]);
  });

  it("adds the horizon line when the bar does not already say it", () => {
    const line = formatHorizonHazardLine(
      { kind: "construction", text: "Construction", distanceM: 1609 },
      true
    );
    expect(line).toBe("Construction, 1.0 mi ahead");
    expect(mergeHorizonHazardLine("Hail in 22 min", line, "construction")).toBe(
      "Construction, 1.0 mi ahead. Hail in 22 min"
    );
    expect(mergeHorizonHazardLine("Construction on I-72", line, "construction")).toBe(
      "Construction on I-72"
    );
  });
});
