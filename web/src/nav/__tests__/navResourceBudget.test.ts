import { describe, expect, it } from "vitest";
import { buildNavResourceBudget, type NavResourceBudgetInput } from "../navResourceBudget";
import { LONG_TRIP_ROUTE_M } from "../../utils/dataSaver";

const base: NavResourceBudgetInput = {
  navigationStarted: true,
  viewMode: "route",
  appForeground: true,
  showRadar: true,
  hasPlannedRoute: true,
  hasGuidanceGeometry: true,
  routeLengthM: 50_000,
  dataSaverMode: false,
  settingStormEnabled: true,
  settingWeatherHintsEnabled: true,
  progressCalloutsOpen: false,
  stormBarExpanded: false,
  isPlus: true,
  routeWeatherReady: true,
  hasEffectiveUserLngLat: true,
};

describe("navResourceBudget", () => {
  it("keeps radar and corridor fetches on route/map surfaces", () => {
    const budget = buildNavResourceBudget({ ...base, viewMode: "topdown" });
    expect(budget.driveNavMode).toBe(false);
    expect(budget.radarMapOverlayOn).toBe(true);
    expect(budget.radarRouteSamplingEnabled).toBe(true);
    expect(budget.tioRouteFetchEnabled).toBe(true);
    expect(budget.tioPointFetchEnabled).toBe(true);
    expect(budget.advisoryForecastRepairEnabled).toBe(true);
  });

  it("pauses advisory tier while navigating in drive", () => {
    const budget = buildNavResourceBudget({ ...base, viewMode: "drive" });
    expect(budget.driveNavMode).toBe(true);
    expect(budget.radarMapOverlayOn).toBe(false);
    expect(budget.radarRouteSamplingEnabled).toBe(false);
    expect(budget.tioRouteFetchEnabled).toBe(false);
    expect(budget.tioPointFetchEnabled).toBe(false);
    expect(budget.advisoryForecastRepairEnabled).toBe(false);
    expect(budget.advisoryWeatherSyncEnabled).toBe(false);
  });

  it("still allows point weather in drive when the storm bar is expanded", () => {
    const budget = buildNavResourceBudget({
      ...base,
      viewMode: "drive",
      stormBarExpanded: true,
    });
    expect(budget.tioPointFetchEnabled).toBe(true);
    expect(budget.tioRouteFetchEnabled).toBe(false);
    expect(budget.radarRouteSamplingEnabled).toBe(false);
  });

  it("does not sample radar in drive even when storm hints are on", () => {
    const budget = buildNavResourceBudget({
      ...base,
      viewMode: "drive",
      settingStormEnabled: true,
      settingWeatherHintsEnabled: true,
      progressCalloutsOpen: true,
    });
    expect(budget.radarRouteSamplingEnabled).toBe(false);
  });

  it("samples radar on a long route when storm mode is on in route view", () => {
    const budget = buildNavResourceBudget({
      ...base,
      viewMode: "route",
      routeLengthM: LONG_TRIP_ROUTE_M + 1,
      settingStormEnabled: true,
    });
    expect(budget.radarRouteSamplingEnabled).toBe(true);
  });

  it("turns off map radar overlay when backgrounded", () => {
    const budget = buildNavResourceBudget({
      ...base,
      viewMode: "route",
      appForeground: false,
    });
    expect(budget.radarMapOverlayOn).toBe(false);
  });
});
