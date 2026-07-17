import { useCallback, useEffect, useMemo, useRef } from "react";
import type { LngLat, NavRoute } from "../nav/types";
import type { MapViewMode } from "../ui/driveMapTypes";
import type { RouteSituationSlice } from "../situation/types";
import {
  formatRadarSampleAge,
  useRadarBandsAlongRoute,
  type RadarSample,
} from "../hooks/useRadarBandsAlongRoute";
import {
  useLocalDailyForecast,
  useLocalHourlyForecast,
  useTomorrowMinutePrecip,
  useTomorrowRouteForecast,
} from "../hooks/useTomorrowWeather";
import type {
  MinutePrecipForecast,
  PointDailyForecast,
  PointHourlyForecast,
  RouteForecast,
} from "../services/tomorrowIo";
import { getRadarRouteSampleIntervalMs } from "../utils/dataSaver";
import { formatMinutePrecipNowLine } from "../utils/forecastDisplay";
import { formatNowcastLine, type CurrentNowcast } from "../services/openWeatherClient";
import {
  buildNavResourceBudget,
  type NavResourceBudget,
} from "../nav/navResourceBudget";
import { buildRouteWeatherOverlayFromForecast } from "./routeForecastOverlay";
import { enrichCorridorWeatherDetail } from "./enrichCorridorWeatherDetail";
import { routeForecastIntensityFloor } from "./corridorForecastModel";

export type UseRouteWeatherPipelineDeps = {
  isPlus: boolean;
  settingTrafficEnabled: boolean;
  destLngLat: LngLat | null;
  planRoutes: NavRoute[];
  guidanceRoute: NavRoute | undefined;
  guidanceRouteId: string;
  guidanceRouteLengthM: number;
  maxPlanRouteLengthM: number;
  navigationStarted: boolean;
  viewMode: MapViewMode;
  appForeground: boolean;
  showRadar: boolean;
  dataSaverMode: boolean;
  settingStormEnabled: boolean;
  settingWeatherHintsEnabled: boolean;
  progressCalloutsOpen: boolean;
  stormBarExpanded: boolean;
  effectiveUserLngLat: LngLat | null;
  speedMps: number | null;
  lineFocusId: string;
  guidanceSliceRaw: RouteSituationSlice | undefined;
  currentNowcast: CurrentNowcast | null;
  weatherKitEnabled: boolean;
  tomorrowIoApiKey: string;
  openWeatherApiKey: string;
};

export type UseRouteWeatherPipelineResult = {
  showTrafficCorridorOnRoute: boolean;
  showRoadNoticesOnRoute: boolean;
  navResourceBudget: NavResourceBudget;
  radarMosaicSamples: RadarSample[];
  radarMosaicUpdatedAt: number | null;
  radarRefreshBlocked: string | null;
  tioMinutePrecip: MinutePrecipForecast | null;
  localHourlyForecast: PointHourlyForecast | null;
  localDailyForecast: PointDailyForecast | null;
  tioRouteForecast: RouteForecast | null;
  bumpRouteForecastRefresh: () => void;
  routeForecastRefreshBlocked: string | null;
  routeWeatherReady: boolean;
  guidanceSlice: RouteSituationSlice | undefined;
  handleRefreshRouteInfoWeather: () => void;
  routeInfoWeatherRefreshing: boolean;
  routeInfoRefreshNote: string | null;
  routeInfoRefreshNoteTone: "warn" | "info";
  advisoryNowcastLine: string | null;
  enrichedCorridorWeatherDetail: string;
  localForecastPanelLoading: boolean;
  radarMosaicMaxIntensity: number;
};

/**
 * Assembles the route-weather pipeline: nav resource budget gating, radar-along-route
 * sampling, Tomorrow.io/WeatherKit point + corridor forecasts, and the derived advisory
 * copy/loading flags the Route Info panel and StormAdvisoryBar consume.
 *
 * `useTripSurfaceRecovery` and `useRouteAheadDerivations` stay in `App` — they either
 * consume this hook's outputs (`bumpRouteForecastRefresh`, `navResourceBudget`) or are
 * intentionally kept alongside the other route-ahead derivations.
 */
export function useRouteWeatherPipeline(
  deps: UseRouteWeatherPipelineDeps
): UseRouteWeatherPipelineResult {
  const {
    isPlus,
    settingTrafficEnabled,
    destLngLat,
    planRoutes,
    guidanceRoute,
    guidanceRouteId,
    guidanceRouteLengthM,
    maxPlanRouteLengthM,
    navigationStarted,
    viewMode,
    appForeground,
    showRadar,
    dataSaverMode,
    settingStormEnabled,
    settingWeatherHintsEnabled,
    progressCalloutsOpen,
    stormBarExpanded,
    effectiveUserLngLat,
    speedMps,
    lineFocusId,
    guidanceSliceRaw,
    currentNowcast,
    weatherKitEnabled,
    tomorrowIoApiKey,
    openWeatherApiKey,
  } = deps;

  /** Strip + map corridors: About → Road impacts & traffic (`settingTrafficEnabled`). */
  const showTrafficCorridorOnRoute = isPlus && settingTrafficEnabled;
  const showRoadNoticesOnRoute = isPlus && settingTrafficEnabled;
  const hasPlannedRoute = Boolean(
    destLngLat && planRoutes.some((r) => r.geometry && r.geometry.length >= 2)
  );
  /** Sample RainViewer along the route for advisory/timeline whenever a leg is loaded or Rad is on. */
  const routeLenForCorridorLean =
    guidanceRouteLengthM > 0 ? guidanceRouteLengthM : maxPlanRouteLengthM;
  const routeWeatherReady = weatherKitEnabled || Boolean(tomorrowIoApiKey);
  const navResourceBudget = useMemo(
    () =>
      buildNavResourceBudget({
        navigationStarted,
        viewMode,
        appForeground,
        showRadar,
        hasPlannedRoute,
        hasGuidanceGeometry: Boolean(
          guidanceRoute?.geometry && guidanceRoute.geometry.length >= 2
        ),
        routeLengthM: routeLenForCorridorLean,
        dataSaverMode,
        settingStormEnabled,
        settingWeatherHintsEnabled,
        progressCalloutsOpen,
        stormBarExpanded,
        isPlus: Boolean(isPlus),
        routeWeatherReady,
        hasEffectiveUserLngLat: Boolean(effectiveUserLngLat),
      }),
    [
      navigationStarted,
      viewMode,
      appForeground,
      showRadar,
      hasPlannedRoute,
      guidanceRoute?.geometry,
      routeLenForCorridorLean,
      dataSaverMode,
      settingStormEnabled,
      settingWeatherHintsEnabled,
      progressCalloutsOpen,
      stormBarExpanded,
      isPlus,
      routeWeatherReady,
      effectiveUserLngLat,
    ]
  );
  const radarRouteSamplingEnabled = navResourceBudget.radarRouteSamplingEnabled;
  const radarSampleIntervalMs = getRadarRouteSampleIntervalMs(
    dataSaverMode,
    navigationStarted,
    routeLenForCorridorLean
  );
  const radarMosaicAlongRoute = useRadarBandsAlongRoute(
    radarRouteSamplingEnabled,
    guidanceRoute?.geometry,
    radarSampleIntervalMs,
    guidanceRoute?.baseEtaMinutes ?? null,
    tomorrowIoApiKey
  );
  const {
    samples: radarMosaicSamples,
    updatedAt: radarMosaicUpdatedAt,
    refreshBlocked: radarRefreshBlocked,
    refreshing: radarRouteRefreshing,
    bumpRadarResample,
  } = radarMosaicAlongRoute;

  // ── Route weather (Tomorrow.io or Apple WeatherKit) ──
  const tioApiKey = weatherKitEnabled ? "" : tomorrowIoApiKey;
  /** At-your-location minute precip + hourly — paused in drive unless storm bar is open. */
  const tioPointFetchEnabled = navResourceBudget.tioPointFetchEnabled;
  /** OpenWeather hourly is fallback only — skip when primary provider covers the point card. */
  const openWeatherHourlyEnabled =
    tioPointFetchEnabled && !routeWeatherReady;
  /** Corridor hourly along the active leg — route shape only (no GPS required). */
  const tioRouteFetchEnabled = navResourceBudget.tioRouteFetchEnabled;
  const tioMinutePrecip = useTomorrowMinutePrecip(
    tioApiKey,
    effectiveUserLngLat ?? null,
    tioPointFetchEnabled,
    navigationStarted,
    weatherKitEnabled
  );
  const localHourlyForecast = useLocalHourlyForecast(
    tioApiKey,
    openWeatherApiKey,
    effectiveUserLngLat ?? null,
    tioPointFetchEnabled,
    openWeatherHourlyEnabled,
    weatherKitEnabled
  );
  const localDailyForecast = useLocalDailyForecast(
    effectiveUserLngLat ?? null,
    navResourceBudget.localDailyForecastEnabled,
    weatherKitEnabled
  );
  const {
    forecast: tioRouteForecast,
    bumpRouteForecastRefresh,
    routeForecastRefreshing,
    routeForecastRefreshBlocked,
    routeForecastUsingCache,
  } = useTomorrowRouteForecast(
    tomorrowIoApiKey,
    isPlus && guidanceRoute?.geometry?.length ? guidanceRoute.geometry : null,
    speedMps ?? 0,
    tioRouteFetchEnabled,
    weatherKitEnabled
  );

  const routeWeatherOverlay = useMemo(
    () =>
      buildRouteWeatherOverlayFromForecast(
        tioRouteForecast,
        lineFocusId || guidanceRouteId,
        guidanceRoute?.baseEtaMinutes
      ),
    [tioRouteForecast, lineFocusId, guidanceRouteId, guidanceRoute?.baseEtaMinutes]
  );

  const guidanceSlice = useMemo(() => {
    if (!guidanceSliceRaw) return undefined;
    const legId = lineFocusId || guidanceRouteId;
    const wx = routeWeatherOverlay?.[legId];
    if (!wx) return guidanceSliceRaw;
    return {
      ...guidanceSliceRaw,
      forecastHeadline: wx.headline,
      radarIntensity: Math.min(1, Math.max(0, wx.precipHint)),
    };
  }, [guidanceSliceRaw, lineFocusId, guidanceRouteId, routeWeatherOverlay]);

  const corridorWeatherDetail = useMemo(() => {
    if (!lineFocusId) return "";
    return guidanceSlice?.forecastHeadline?.trim() ?? "";
  }, [lineFocusId, guidanceSlice?.forecastHeadline]);

  const handleRefreshRouteInfoWeather = useCallback(() => {
    if (!guidanceRoute?.geometry || guidanceRoute.geometry.length < 2) return;
    if (routeWeatherReady) bumpRouteForecastRefresh();
    bumpRadarResample();
  }, [
    bumpRouteForecastRefresh,
    bumpRadarResample,
    routeWeatherReady,
    guidanceRoute?.geometry,
  ]);

  const routeInfoWeatherRefreshing = routeForecastRefreshing || radarRouteRefreshing;

  const routeInfoRefreshNote = useMemo(() => {
    if (radarRefreshBlocked) return radarRefreshBlocked;
    if (routeForecastRefreshBlocked) return routeForecastRefreshBlocked;
    const age = formatRadarSampleAge(radarMosaicUpdatedAt);
    if (age && radarMosaicSamples.length > 0) {
      const ageMin =
        radarMosaicUpdatedAt != null
          ? Math.round((Date.now() - radarMosaicUpdatedAt) / 60_000)
          : 0;
      if (ageMin >= 8) return age;
    }
    return null;
  }, [
    radarRefreshBlocked,
    routeForecastRefreshBlocked,
    radarMosaicUpdatedAt,
    radarMosaicSamples.length,
  ]);

  const routeInfoRefreshNoteTone =
    radarRefreshBlocked ||
    (routeForecastRefreshBlocked && !routeForecastUsingCache)
      ? "warn"
      : "info";

  const prevProgressCalloutsOpenRef = useRef(false);
  useEffect(() => {
    const justOpened = progressCalloutsOpen && !prevProgressCalloutsOpenRef.current;
    prevProgressCalloutsOpenRef.current = progressCalloutsOpen;
    if (!justOpened) return;
    if (!isPlus || !guidanceRoute?.geometry?.length) return;
    /* Only refresh when data is actually missing/stale — Drive keeps corridor
     * weather warm while the panel is closed, so reopen should show the full
     * trip already synced (not a cold restart from "now"). */
    const missingForecast = (tioRouteForecast?.intervals?.length ?? 0) === 0;
    const missingRadar = radarMosaicSamples.length === 0;
    const radarStale =
      radarMosaicUpdatedAt != null && Date.now() - radarMosaicUpdatedAt > 8 * 60_000;
    if (missingForecast || missingRadar || radarStale) {
      handleRefreshRouteInfoWeather();
    }
  }, [
    progressCalloutsOpen,
    tioRouteForecast?.intervals?.length,
    radarMosaicSamples.length,
    radarMosaicUpdatedAt,
    isPlus,
    guidanceRoute?.geometry?.length,
    handleRefreshRouteInfoWeather,
  ]);

  const advisoryNowcastLine = useMemo(() => {
    if (currentNowcast) return formatNowcastLine(currentNowcast);
    if (tioMinutePrecip?.now) return formatMinutePrecipNowLine(tioMinutePrecip.now);
    return null;
  }, [currentNowcast, tioMinutePrecip?.now]);

  /**
   * Enrich corridor weather detail with the worst forecast interval timing.
   * "Thunderstorm in ~42 min" surfaces in the advisory bar and progress copy when the
   * worst corridor segment is mid-route — not just at the destination. No new UI added.
   */
  const enrichedCorridorWeatherDetail = useMemo(
    () =>
      enrichCorridorWeatherDetail({
        corridorWeatherDetail,
        advisoryNowcastLine,
        tioRouteForecast,
      }),
    [corridorWeatherDetail, tioRouteForecast, advisoryNowcastLine]
  );

  const localForecastPanelLoading = useMemo(() => {
    if (!isPlus || !stormBarExpanded || !effectiveUserLngLat) return false;
    const hasData =
      Boolean(currentNowcast) ||
      Boolean(tioMinutePrecip) ||
      (localHourlyForecast?.hours.length ?? 0) > 0 ||
      (localDailyForecast?.days.length ?? 0) > 0;
    if (hasData) return false;
    return routeWeatherReady || Boolean(openWeatherApiKey);
  }, [
    isPlus,
    stormBarExpanded,
    effectiveUserLngLat,
    currentNowcast,
    tioMinutePrecip,
    localHourlyForecast?.hours.length,
    localDailyForecast?.days.length,
    routeWeatherReady,
    openWeatherApiKey,
  ]);

  const radarMosaicMaxIntensity = useMemo(() => {
    const s = radarMosaicSamples;
    const radarMax = s.length ? Math.max(...s.map((x) => x.intensity)) : 0;
    // Safety floor: if corridor forecast says thunderstorm or high precip probability,
    // the advisory banner must reflect at least that severity even if radar hasn't caught up yet.
    const forecastFloor = routeForecastIntensityFloor(tioRouteForecast);
    return Math.max(radarMax, forecastFloor);
  }, [radarMosaicSamples, tioRouteForecast]);

  return {
    showTrafficCorridorOnRoute,
    showRoadNoticesOnRoute,
    navResourceBudget,
    radarMosaicSamples,
    radarMosaicUpdatedAt,
    radarRefreshBlocked,
    tioMinutePrecip,
    localHourlyForecast,
    localDailyForecast,
    tioRouteForecast,
    bumpRouteForecastRefresh,
    routeForecastRefreshBlocked,
    routeWeatherReady,
    guidanceSlice,
    handleRefreshRouteInfoWeather,
    routeInfoWeatherRefreshing,
    routeInfoRefreshNote,
    routeInfoRefreshNoteTone,
    advisoryNowcastLine,
    enrichedCorridorWeatherDetail,
    localForecastPanelLoading,
    radarMosaicMaxIntensity,
  };
}
