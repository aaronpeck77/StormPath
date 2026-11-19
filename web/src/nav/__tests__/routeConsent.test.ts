import { describe, expect, it } from "vitest";
import {
  classifyRouteChangeMateriality,
  consentTierForContext,
  deviationIsCostly,
  proposedRejoinsPreviousCorridor,
  routeChangeUxFor,
  ROUTE_CHANGE_OFFER_TIMEOUT_MS,
} from "../routeConsent";
import type { LngLat } from "../types";

/** Straight east-west line ~10 mi long near I-80 Nebraska. */
function straightLine(): LngLat[] {
  const pts: LngLat[] = [];
  for (let i = 0; i <= 40; i++) {
    pts.push([-96.0 + i * 0.02, 40.0]);
  }
  return pts;
}

/** Parallel line ~5 km north — same endpoints-ish, different road. */
function parallelOffsetLine(): LngLat[] {
  return straightLine().map(([lng, lat]) => [lng, lat + 0.05] as LngLat);
}

/** Line that leaves the corridor then comes back and shares the tail. */
function rejoinLine(): LngLat[] {
  const base = straightLine();
  // Detour north for the first third, then merge back onto the corridor.
  return base.map(([lng, lat], i) => {
    if (i < 10) return [lng, lat + 0.03] as LngLat;
    return [lng, lat] as LngLat;
  });
}

describe("consentTierForContext", () => {
  it("maps highway to the offer tier", () => {
    expect(
      consentTierForContext({ roadClass: "highway", rejoinMode: "manual" })
    ).toBe("highway");
  });

  it("maps dense city streets to the auto tier", () => {
    expect(
      consentTierForContext({ roadClass: "city_streets", rejoinMode: "auto_local" })
    ).toBe("city");
  });

  it("maps spread-out streets to the notify tier", () => {
    expect(
      consentTierForContext({ roadClass: "city_streets", rejoinMode: "manual" })
    ).toBe("town");
    expect(
      consentTierForContext({ roadClass: "unknown", rejoinMode: "manual" })
    ).toBe("town");
  });
});

describe("classifyRouteChangeMateriality", () => {
  it("treats a corridor-agreeing line as tactical", () => {
    const prev = straightLine();
    /* Same corridor, slightly resampled — a refinement, not a new road. */
    const proposed = prev.filter((_, i) => i % 2 === 0);
    expect(
      classifyRouteChangeMateriality({ proposedGeometry: proposed, previousGeometry: prev })
    ).toBe("tactical");
  });

  it("treats a detour that leaves and rejoins as material — it is a different road", () => {
    const prev = straightLine();
    const proposed = rejoinLine();
    expect(
      classifyRouteChangeMateriality({ proposedGeometry: proposed, previousGeometry: prev })
    ).toBe("material");
  });

  it("treats a divergent line as material", () => {
    const prev = straightLine();
    const proposed = parallelOffsetLine();
    expect(
      classifyRouteChangeMateriality({ proposedGeometry: proposed, previousGeometry: prev })
    ).toBe("material");
  });

  it("treats a missing previous corridor as material", () => {
    expect(
      classifyRouteChangeMateriality({
        proposedGeometry: straightLine(),
        previousGeometry: null,
      })
    ).toBe("material");
  });
});

describe("proposedRejoinsPreviousCorridor", () => {
  it("detects a line that merges back onto the corridor", () => {
    expect(
      proposedRejoinsPreviousCorridor({
        proposedGeometry: rejoinLine(),
        previousGeometry: straightLine(),
      })
    ).toBe(true);
  });

  it("rejects a parallel line that never rejoins", () => {
    expect(
      proposedRejoinsPreviousCorridor({
        proposedGeometry: parallelOffsetLine(),
        previousGeometry: straightLine(),
      })
    ).toBe(false);
  });
});

describe("deviationIsCostly", () => {
  /** ~1.5x the locked corridor's length — a real detour, not a shortcut. */
  function longLine(): LngLat[] {
    const pts: LngLat[] = [];
    for (let i = 0; i <= 40; i++) {
      pts.push([-96.0 + i * 0.03, 40.0]);
    }
    return pts;
  }

  it("treats a pick no longer than the remaining corridor as free", () => {
    const prev = straightLine();
    /* Same length as the corridor left — a parallel shortcut, not a cost. */
    const proposed = parallelOffsetLine();
    expect(
      deviationIsCostly({
        proposedGeometry: proposed,
        previousGeometry: prev,
        userLngLat: prev[0]!,
      })
    ).toBe(false);
  });

  it("flags a pick much longer than the remaining corridor", () => {
    const prev = straightLine();
    expect(
      deviationIsCostly({
        proposedGeometry: longLine(),
        previousGeometry: prev,
        userLngLat: prev[0]!,
      })
    ).toBe(true);
  });

  it("never nags when the driver is nearly at the destination", () => {
    const prev = straightLine();
    const nearEnd: LngLat = [-95.22, 40.0];
    expect(
      deviationIsCostly({
        proposedGeometry: longLine(),
        previousGeometry: prev,
        userLngLat: nearEnd,
      })
    ).toBe(false);
  });

  it("treats a missing corridor or line as not costly — nothing to return to", () => {
    expect(
      deviationIsCostly({
        proposedGeometry: straightLine(),
        previousGeometry: null,
        userLngLat: [-96.0, 40.0],
      })
    ).toBe(false);
    expect(
      deviationIsCostly({
        proposedGeometry: [],
        previousGeometry: straightLine(),
        userLngLat: [-96.0, 40.0],
      })
    ).toBe(false);
  });
});

describe("routeChangeUxFor", () => {
  it("offers only on highway material changes with a corridor to return to", () => {
    expect(
      routeChangeUxFor({ materiality: "material", tier: "highway", canReturnToPrevious: true })
    ).toBe("offer");
    expect(
      routeChangeUxFor({ materiality: "material", tier: "highway", canReturnToPrevious: false })
    ).toBe("notify");
    expect(
      routeChangeUxFor({ materiality: "material", tier: "town", canReturnToPrevious: true })
    ).toBe("notify");
    expect(
      routeChangeUxFor({ materiality: "material", tier: "city", canReturnToPrevious: true })
    ).toBe("notify");
  });

  it("never blocks on tactical moves", () => {
    for (const tier of ["city", "town", "highway"] as const) {
      expect(routeChangeUxFor({ materiality: "tactical", tier, canReturnToPrevious: true })).toBe(
        "notify"
      );
    }
  });
});

describe("constants", () => {
  it("offer timeout stays in the glance-not-stare window", () => {
    expect(ROUTE_CHANGE_OFFER_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000);
    expect(ROUTE_CHANGE_OFFER_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});
