import { describe, expect, it, vi } from "vitest";
import { buildStormAdvisoryBarProps } from "../buildStormAdvisoryBarProps";

function baseInput(
  over: Partial<Parameters<typeof buildStormAdvisoryBarProps>[0]> = {}
) {
  return {
    isPlus: true,
    settingStormEnabled: true,
    stormLoading: false,
    stormError: null,
    stormCorridorAlertsLength: 1,
    stormMapHasFeatures: true,
    allDisplayableAlerts: [],
    nwsAlertsForGuidanceAdvisory: [],
    stormNwsPuckInside: [],
    trafficDelayMinutes: 3,
    onTrafficReroute: vi.fn(),
    bypassBusy: false,
    settingTrafficEnabled: true,
    hasGuidanceRoute: true,
    advisoryRoadDetailRows: [],
    advisoryRouteImpacts: null,
    advisoryStormStripBands: null,
    routeAheadTimeline: null,
    routeTotalMeters: 10_000,
    userAlongMeters: 500,
    planEtaMinutes: 40,
    driveEtaMinutes: 38,
    stormBarExpanded: false,
    onBarExpandedChange: vi.fn(),
    onNwsAlertClick: vi.fn(),
    busyLabel: null,
    staleWeatherNote: null,
    onRefreshWeather: null,
    driveModeUi: false,
    driveRouteAheadLine: null,
    nextHazardAtEtaLine: "Hail in 22 min",
    advisoryPlusDetailOn: true,
    advisoryPromoLines: [],
    isOnline: true,
    navigationStarted: true,
    advisoryNowcastLine: "72°F",
    currentNowcast: null,
    forecastAreaLabel: "Springfield, IL",
    tioMinutePrecip: null,
    localHourlyForecast: null,
    localDailyForecast: null,
    localForecastNwsAlerts: [],
    localForecastPanelLoading: false,
    weatherKitPrimary: true,
    forecastLngLat: [-88.9, 39.8] as [number, number],
    onOpenSubscription: vi.fn(),
    basicStatusPanelPromos: null,
    showDataSaverHint: false,
    onOpenDataSaverSettings: vi.fn(),
    onDismissDataSaverHint: vi.fn(),
    ...over,
  };
}

describe("buildStormAdvisoryBarProps", () => {
  it("Plus keeps corridor alerts and hazard ETA line", () => {
    const props = buildStormAdvisoryBarProps(baseInput());
    expect(props.ownsPlus).toBe(true);
    expect(props.advisoryTier).toBe("plus");
    expect(props.nextHazardAtEtaLine).toBe("Hail in 22 min");
    expect(props.nowcastLine).toBe("72°F");
    expect(props.sessionOn).toBe(true);
    expect(props.roadDetailEnabled).toBe(true);
    expect(props.basicNavAdvisoryMode).toBe(false);
  });

  it("Basic strips Plus-only corridor data and forces basic tier", () => {
    const props = buildStormAdvisoryBarProps(
      baseInput({ isPlus: false, advisoryPlusDetailOn: false })
    );
    expect(props.corridorAlerts).toEqual([]);
    expect(props.overlappingAlerts).toEqual([]);
    expect(props.nextHazardAtEtaLine).toBeNull();
    expect(props.nowcastLine).toBeNull();
    expect(props.routeImpacts).toBeNull();
    expect(props.sessionOn).toBe(false);
    expect(props.roadDetailEnabled).toBe(false);
    expect(props.basicNavAdvisoryMode).toBe(true);
    expect(props.advisoryTier).toBe("basic");
  });

  it("mirrors About NWS / traffic settings on status chips", () => {
    const off = buildStormAdvisoryBarProps(
      baseInput({ settingStormEnabled: false, settingTrafficEnabled: false })
    );
    expect(off.sessionOn).toBe(false);
    expect(off.roadDetailEnabled).toBe(false);
  });

  it("shows NWS loading only when Plus has no alerts and no map features yet", () => {
    const loading = buildStormAdvisoryBarProps(
      baseInput({
        stormLoading: true,
        stormCorridorAlertsLength: 0,
        stormMapHasFeatures: false,
      })
    );
    expect(loading.loading).toBe(true);
    expect(loading.nwsForecastLoading).toBe(true);

    const ready = buildStormAdvisoryBarProps(
      baseInput({
        stormLoading: true,
        stormCorridorAlertsLength: 2,
        stormMapHasFeatures: false,
      })
    );
    expect(ready.loading).toBe(false);
  });

  it("only surfaces driveRouteAheadLine while driveModeUi is on", () => {
    const line = { radarTier: "light" as const, text: "Light rain ahead" };
    const off = buildStormAdvisoryBarProps(
      baseInput({ driveModeUi: false, driveRouteAheadLine: line as never })
    );
    expect(off.driveRouteAheadLine).toBeNull();

    const on = buildStormAdvisoryBarProps(
      baseInput({ driveModeUi: true, driveRouteAheadLine: line as never })
    );
    expect(on.driveRouteAheadLine).toEqual(line);
  });

  it("wires data-saver hint only when showDataSaverHint is true", () => {
    const off = buildStormAdvisoryBarProps(baseInput({ showDataSaverHint: false }));
    expect(off.dataSaverHint).toBeNull();

    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    const on = buildStormAdvisoryBarProps(
      baseInput({
        showDataSaverHint: true,
        onOpenDataSaverSettings: onOpen,
        onDismissDataSaverHint: onDismiss,
      })
    );
    expect(on.dataSaverHint).not.toBeNull();
    on.dataSaverHint!.onOpenSettings();
    on.dataSaverHint!.onDismiss();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
