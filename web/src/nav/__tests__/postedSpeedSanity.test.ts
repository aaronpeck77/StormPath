import { describe, expect, it } from "vitest";
import {
  sanitizePostedSpeedMph,
  snapDownToPostedBucket,
  speedLimitRoadKindAt,
  SPEED_LIMIT_CLASS_CAP_MPH,
} from "../postedSpeedSanity";
import type { NavRoute } from "../types";

describe("snapDownToPostedBucket", () => {
  it("snaps down to common posted values", () => {
    expect(snapDownToPostedBucket(58)).toBe(55);
    expect(snapDownToPostedBucket(55)).toBe(55);
    expect(snapDownToPostedBucket(56)).toBe(55);
    expect(snapDownToPostedBucket(72)).toBe(70);
  });
});

describe("speedLimitRoadKindAt", () => {
  it("detects interstate vs county vs local from step text", () => {
    const interstate: NavRoute = {
      id: "a",
      role: "fastest",
      label: "A",
      geometry: [
        [0, 0],
        [1, 0],
      ],
      baseEtaMinutes: 10,
      turnSteps: [{ instruction: "Continue on I-72 East", distanceM: 5000, roadRef: "I 72" }],
    };
    expect(speedLimitRoadKindAt(interstate, 100)).toBe("interstate");

    const county: NavRoute = {
      ...interstate,
      turnSteps: [{ instruction: "Continue on County Highway 18", distanceM: 3000 }],
    };
    expect(speedLimitRoadKindAt(county, 100)).toBe("county_arterial");

    const local: NavRoute = {
      ...interstate,
      turnSteps: [{ instruction: "Turn right onto Main Street", distanceM: 400, roadName: "Main Street" }],
    };
    expect(speedLimitRoadKindAt(local, 100)).toBe("local");
  });
});

describe("sanitizePostedSpeedMph", () => {
  it("never invents a limit when Mapbox has none", () => {
    expect(
      sanitizePostedSpeedMph({ mapboxMph: null, cruiseMph: 55, roadKind: "county_arterial" })
    ).toBeNull();
  });

  it("never raises Mapbox", () => {
    expect(
      sanitizePostedSpeedMph({ mapboxMph: 45, cruiseMph: 58, roadKind: "county_arterial" })
    ).toBe(45);
  });

  it("caps county highways at 55 even without cruise", () => {
    expect(
      sanitizePostedSpeedMph({ mapboxMph: 70, cruiseMph: null, roadKind: "county_arterial" })
    ).toBe(SPEED_LIMIT_CLASS_CAP_MPH.county_arterial);
  });

  it("lowers county 70 toward cruise when driver is ~58", () => {
    const out = sanitizePostedSpeedMph({
      mapboxMph: 70,
      cruiseMph: 58,
      roadKind: "county_arterial",
    });
    /* Class cap alone brings 70 → 55; cruise keeps it from staying high. */
    expect(out).toBe(55);
  });

  it("uses cruise to pull unknown-road 70 down when cruising ~58", () => {
    expect(
      sanitizePostedSpeedMph({ mapboxMph: 70, cruiseMph: 58, roadKind: "unknown" })
    ).toBe(60);
  });

  it("leaves interstate 70 alone when cruising under the limit", () => {
    expect(
      sanitizePostedSpeedMph({ mapboxMph: 70, cruiseMph: 58, roadKind: "interstate" })
    ).toBe(70);
  });

  it("caps local streets", () => {
    expect(sanitizePostedSpeedMph({ mapboxMph: 55, cruiseMph: null, roadKind: "local" })).toBe(45);
  });
});
