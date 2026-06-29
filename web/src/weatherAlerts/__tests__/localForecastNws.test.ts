import { describe, expect, it } from "vitest";
import {
  dedupeNwsAlertsForDisplay,
  isHeatRelatedNwsAlert,
} from "../localForecastNws";
import type { NormalizedWeatherAlert } from "../types";

function alert(partial: Partial<NormalizedWeatherAlert> & { id: string; event: string }): NormalizedWeatherAlert {
  return {
    regionCode: "US",
    providerId: "nws-us",
    headline: partial.event,
    description: "",
    severity: "Moderate",
    urgency: "Expected",
    certainty: "Likely",
    ends: null,
    onset: null,
    geometry: null,
    areaDesc: "Test",
    stormMotionDeg: null,
    stormMotionMph: null,
    ...partial,
  };
}

describe("localForecastNws helpers", () => {
  it("dedupes repeated event names", () => {
    const alerts = [
      alert({ id: "a1", event: "Heat Advisory" }),
      alert({ id: "a2", event: "Heat Advisory" }),
      alert({ id: "a3", event: "Flood Watch" }),
    ];
    expect(dedupeNwsAlertsForDisplay(alerts).map((a) => a.id)).toEqual(["a1", "a3"]);
  });

  it("detects heat-related NWS products", () => {
    expect(isHeatRelatedNwsAlert(alert({ id: "h1", event: "Heat Advisory" }))).toBe(true);
    expect(isHeatRelatedNwsAlert(alert({ id: "t1", event: "Tornado Watch" }))).toBe(false);
  });
});
