import { describe, expect, it } from "vitest";
import {
  clampStormStripBandSpan,
  nwsAlertIsStripProminent,
  nwsEventIsHydro,
} from "../geometryOverlap";
import type { NormalizedWeatherAlert } from "../types";

function alert(partial: Partial<NormalizedWeatherAlert>): NormalizedWeatherAlert {
  return {
    id: "x",
    regionCode: "US",
    providerId: "nws-us",
    headline: "",
    event: "Flood Advisory",
    description: "",
    severity: "Minor",
    urgency: "Expected",
    certainty: "Likely",
    ends: null,
    geometry: null,
    areaDesc: "",
    stormMotionDeg: null,
    stormMotionMph: null,
    ...partial,
  };
}

describe("nwsAlertStripProminence", () => {
  it("treats minor flood advisory as non-prominent", () => {
    expect(nwsEventIsHydro("Flood Advisory")).toBe(true);
    expect(nwsAlertIsStripProminent(alert({ event: "Flood Advisory", severity: "Minor" }))).toBe(
      false
    );
  });

  it("keeps moderate+ hydro prominent and drops minor warnings", () => {
    expect(nwsAlertIsStripProminent(alert({ event: "Flood Advisory", severity: "Moderate" }))).toBe(
      true
    );
    expect(
      nwsAlertIsStripProminent(alert({ event: "Flash Flood Warning", severity: "Severe" }))
    ).toBe(true);
    expect(nwsAlertIsStripProminent(alert({ event: "Flood Warning", severity: "Minor" }))).toBe(
      false
    );
    expect(
      nwsAlertIsStripProminent(alert({ event: "Flash Flood Warning", severity: "Minor" }))
    ).toBe(false);
  });

  it("leaves non-hydro alerts prominent", () => {
    expect(nwsAlertIsStripProminent(alert({ event: "Wind Advisory", severity: "Minor" }))).toBe(
      true
    );
  });

  it("clamps wide minor-hydro spans to a short pin", () => {
    const clamped = clampStormStripBandSpan(0, 120_000, 150_000, false);
    expect(clamped.endM - clamped.startM).toBeLessThanOrEqual(6_100);
    expect(clamped.endM - clamped.startM).toBeGreaterThan(5_000);
  });
});
