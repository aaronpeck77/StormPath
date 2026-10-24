import { describe, expect, it } from "vitest";
import {
  filterNwsMapWarningFeatures,
  nwsAlertShowsOnMap,
  nwsEventIsMapWarning,
} from "../nwsMapPolygon";

describe("nwsEventIsMapWarning", () => {
  it("keeps severe thunderstorm and tornado warnings", () => {
    expect(nwsEventIsMapWarning("Severe Thunderstorm Warning")).toBe(true);
    expect(nwsEventIsMapWarning("Tornado Warning")).toBe(true);
    expect(nwsEventIsMapWarning("Tornado Emergency")).toBe(true);
  });

  it("drops watches even when they share a convective name", () => {
    expect(nwsEventIsMapWarning("Tornado Watch")).toBe(false);
    expect(nwsEventIsMapWarning("Severe Thunderstorm Watch")).toBe(false);
    expect(nwsEventIsMapWarning("Flash Flood Watch")).toBe(false);
  });
});

describe("nwsAlertShowsOnMap", () => {
  it("draws SVR / TOR warnings and flash-flood warning at Severe+", () => {
    expect(nwsAlertShowsOnMap({ event: "Severe Thunderstorm Warning", severity: "Severe" })).toBe(
      true
    );
    expect(nwsAlertShowsOnMap({ event: "Tornado Warning", severity: "Extreme" })).toBe(true);
    expect(nwsAlertShowsOnMap({ event: "Flash Flood Warning", severity: "Severe" })).toBe(true);
  });

  it("does not draw watches or county flood / advisory clutter", () => {
    expect(nwsAlertShowsOnMap({ event: "Tornado Watch", severity: "Moderate" })).toBe(false);
    expect(nwsAlertShowsOnMap({ event: "Severe Thunderstorm Watch", severity: "Severe" })).toBe(
      false
    );
    expect(nwsAlertShowsOnMap({ event: "Flood Warning", severity: "Severe" })).toBe(false);
    expect(nwsAlertShowsOnMap({ event: "Wind Advisory", severity: "Minor" })).toBe(false);
    expect(nwsAlertShowsOnMap({ event: "Fire Weather Watch", severity: "Severe" })).toBe(false);
  });

  it("strips watch features from a mixed GeoJSON collection", () => {
    const filtered = filterNwsMapWarningFeatures({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { event: "Tornado Watch", severity: "Moderate", kind: "convective" },
          geometry: { type: "Polygon", coordinates: [] },
        },
        {
          type: "Feature",
          properties: { event: "Tornado Warning", severity: "Extreme", kind: "convective" },
          geometry: { type: "Polygon", coordinates: [] },
        },
      ],
    });
    expect(filtered?.features).toHaveLength(1);
    expect(filtered?.features[0]?.properties?.event).toBe("Tornado Warning");
  });
});
