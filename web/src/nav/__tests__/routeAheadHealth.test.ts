import { describe, expect, it } from "vitest";
import {
  auditRouteAheadSync,
  repairActionsForRouteAheadIssues,
} from "../routeAheadHealth";

const base = {
  hasRouteGeometry: true,
  isPlus: true,
  weatherHintsEnabled: true,
  hasPlannedRoute: true,
  navigationStarted: false,
  outlookStepCount: 0,
  timelineItemCount: 0,
  progressBandCount: 0,
  corridorWeatherDetail: "",
  routeForecastHeadline: "",
  hasWeatherSamples: false,
};

describe("routeAheadHealth", () => {
  it("is ok when plus trip has no weather configured", () => {
    const audit = auditRouteAheadSync({
      ...base,
      weatherHintsEnabled: false,
    });
    expect(audit.ok).toBe(true);
  });

  it("flags missing route forecast when weather hints are on", () => {
    const audit = auditRouteAheadSync(base);
    expect(audit.ok).toBe(false);
    expect(audit.issues).toContain("route_forecast_missing");
    expect(audit.issues).toContain("outlook_empty_weather_expected");
  });

  it("flags outlook gap when corridor copy exists without graph steps", () => {
    const audit = auditRouteAheadSync({
      ...base,
      corridorWeatherDetail: "Start: 72°F · Midway: rain 40%",
      routeForecastHeadline: "Rain along route",
    });
    expect(audit.issues).toContain("forecast_detail_without_outlook");
  });

  it("is ok when outlook steps are populated", () => {
    const audit = auditRouteAheadSync({
      ...base,
      outlookStepCount: 5,
      routeForecastHeadline: "Start → End forecast",
      hasWeatherSamples: true,
      timelineItemCount: 2,
      progressBandCount: 2,
    });
    expect(audit.ok).toBe(true);
  });

  it("flags timeline vs strip desync", () => {
    const audit = auditRouteAheadSync({
      ...base,
      outlookStepCount: 5,
      routeForecastHeadline: "ok",
      hasWeatherSamples: true,
      timelineItemCount: 3,
      progressBandCount: 0,
    });
    expect(audit.issues).toContain("timeline_bands_desync");
  });

  it("maps issues to repair actions", () => {
    expect(
      repairActionsForRouteAheadIssues(["route_forecast_missing", "timeline_bands_desync"])
    ).toEqual(["refresh_route_forecast", "refresh_traffic"]);
  });
});
