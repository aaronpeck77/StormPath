import { describe, expect, it } from "vitest";
import { buildNwsAlertGeoJsonForMap } from "../buildNwsAlertGeoJsonForMap";
import type { NormalizedWeatherAlert } from "../types";

const box: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-97, 35],
      [-96, 35],
      [-96, 36],
      [-97, 36],
      [-97, 35],
    ],
  ],
};

function alert(partial: Partial<NormalizedWeatherAlert>): NormalizedWeatherAlert {
  return {
    id: "a",
    regionCode: "US",
    providerId: "nws-us",
    headline: "",
    event: "Tornado Watch",
    description: "",
    severity: "Moderate",
    urgency: "Expected",
    certainty: "Likely",
    ends: null,
    onset: null,
    geometry: box,
    areaDesc: "",
    stormMotionDeg: null,
    stormMotionMph: null,
    ...partial,
  };
}

const gates = {
  isPlus: true,
  advisoryLifeSafetyOn: true,
  settingStormEnabled: true,
  nwsMapOverlapRouteGeom: null,
  stormMapGeoJson: null,
  stormMapGeoJsonForMap: undefined,
  nwsAlertsAffectingActiveRoute: [],
  advisoryStormStripBands: [],
  guidanceRouteLengthM: 0,
  heavyAdvisoryAlongM: 0,
  planEtaMinutes: null,
  driveEtaMinutes: null,
};

describe("buildNwsAlertGeoJsonForMap", () => {
  it("draws a tornado warning and drops a tornado watch in browse mode", () => {
    const fc = buildNwsAlertGeoJsonForMap({
      ...gates,
      stormCorridorAlerts: [
        alert({ id: "watch", event: "Tornado Watch", severity: "Moderate" }),
        alert({ id: "warn", event: "Tornado Warning", severity: "Extreme" }),
      ],
    });
    expect(fc?.features).toHaveLength(1);
    expect(fc?.features[0]?.properties?.event).toBe("Tornado Warning");
  });

  it("stays off when NWS is disabled in About", () => {
    expect(
      buildNwsAlertGeoJsonForMap({
        ...gates,
        settingStormEnabled: false,
        stormCorridorAlerts: [alert({ event: "Tornado Warning", severity: "Extreme" })],
      })
    ).toBeNull();
  });
});
