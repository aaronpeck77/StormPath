import { describe, expect, it } from "vitest";
import {
  applyArrivalVerdictsToImpacts,
  computeHazardArrivalVerdict,
  pickNextHazardAffectingYou,
} from "../hazardArrivalVerdict";
import type { RouteImpact } from "../routeImpacts";

function fakeImpact(partial: Partial<RouteImpact>): RouteImpact {
  return {
    id: "x",
    category: "weather",
    severity: "serious",
    confidence: "high",
    source: "nws",
    lngLat: [-87, 42],
    alongMeters: 50_000,
    startMeters: 48_000,
    endMeters: 52_000,
    distanceAheadMeters: 38_000,
    etaAheadMinutes: 90,
    driverHeadline: "Severe Thunderstorm Warning ahead",
    driverAction: "prepare",
    roadEffect: "Heavy rain, hail possible.",
    detail: "detail",
    numericSeverity: 75,
    ...partial,
  };
}

describe("hazardArrivalVerdict", () => {
  it("marks NWS alert that expires before arrival as may_pass", () => {
    const now = Date.now();
    const verdict = computeHazardArrivalVerdict(
      fakeImpact({
        hazardExpiresIso: new Date(now + 8 * 60_000).toISOString(),
        startMeters: 48_000,
        endMeters: 52_000,
      }),
      {
        userAlongM: 10_000,
        totalMeters: 200_000,
        planEtaMinutes: 120,
        driveEtaMinutes: 100,
      }
    );
    expect(verdict.kind).toBe("may_pass");
    expect(verdict.suppressFromDriveMap).toBe(true);
  });

  it("marks construction as persistent at arrival", () => {
    const verdict = computeHazardArrivalVerdict(
      fakeImpact({
        category: "construction",
        source: "mapboxIncident",
        etaAheadMinutes: 45,
        driverHeadline: "Construction zone",
      }),
      {
        userAlongM: 0,
        totalMeters: 100_000,
        planEtaMinutes: 90,
      }
    );
    expect(verdict.kind).toBe("persistent");
    expect(verdict.line).toContain("Expect this when you arrive");
  });

  it("marks distant incident as may clear before arrival", () => {
    const verdict = computeHazardArrivalVerdict(
      fakeImpact({
        category: "incident",
        source: "mapboxIncident",
        severity: "caution",
        etaAheadMinutes: 70,
        driverHeadline: "Accident ahead",
      }),
      {
        userAlongM: 0,
        totalMeters: 200_000,
        planEtaMinutes: 120,
      }
    );
    expect(verdict.kind).toBe("may_pass");
    expect(verdict.softenDriverAction).toBe(true);
  });

  it("prepends verdict line to driver headline", () => {
    const out = applyArrivalVerdictsToImpacts({
      impacts: [
        fakeImpact({
          category: "construction",
          source: "mapboxIncident",
          driverHeadline: "Construction zone",
        }),
      ],
      userAlongM: 0,
      totalMeters: 100_000,
      planEtaMinutes: 60,
    });
    expect(out[0]!.driverHeadline).toMatch(/Expect this when you arrive/);
    expect(out[0]!.driverHeadline).toContain("Construction zone");
  });

  it("picks nearest impact that affects driver at arrival", () => {
    const impacts = applyArrivalVerdictsToImpacts({
      impacts: [
        fakeImpact({
          id: "far",
          distanceAheadMeters: 80_000,
          etaAheadMinutes: 95,
          hazardExpiresIso: new Date(Date.now() + 20 * 60_000).toISOString(),
        }),
        fakeImpact({
          id: "near",
          distanceAheadMeters: 20_000,
          etaAheadMinutes: 25,
          category: "construction",
          source: "mapboxIncident",
          driverHeadline: "Construction zone",
          hazardExpiresIso: null,
        }),
      ],
      userAlongM: 10_000,
      totalMeters: 200_000,
      planEtaMinutes: 120,
      driveEtaMinutes: 100,
    });
    const pick = pickNextHazardAffectingYou(impacts);
    expect(pick?.impact.id).toBe("near");
  });
});
