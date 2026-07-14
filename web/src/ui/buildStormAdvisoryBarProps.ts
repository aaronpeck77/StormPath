import type { CurrentNowcast } from "../services/openWeatherClient";
import type {
  MinutePrecipForecast,
  PointDailyForecast,
  PointHourlyForecast,
} from "../services/tomorrowIo";
import type { RouteImpact } from "../nav/routeImpacts";
import type { TimelineItem } from "./RouteHazardTimeline";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";
import type { DriveAheadLine } from "../nav/driveRouteAhead";
import type { AdvisoryPromoLine, BasicStatusPanelPromos } from "../config/basicAds";
import type {
  StormAdvisoryBarProps,
  StormRoadDetailRow,
  StormStripBand,
} from "./StormAdvisoryBar";

/**
 * StormAdvisoryBar prop assembly — Phase 3b.
 *
 * Same idea as {@link useDriveMapProps}: App owns the sources; this module applies
 * Plus/Basic gating and builds the bar's prop contract so App JSX stays thin.
 */

export type BuildStormAdvisoryBarPropsInput = {
  isPlus: boolean;
  stormSessionOn: boolean;
  onSessionToggle: (on: boolean) => void;
  stormLoading: boolean;
  stormError: string | null;
  stormCorridorAlertsLength: number;
  stormMapHasFeatures: boolean;
  allDisplayableAlerts: NormalizedWeatherAlert[];
  nwsAlertsForGuidanceAdvisory: NormalizedWeatherAlert[];
  stormNwsPuckInside: NormalizedWeatherAlert[];
  trafficDelayMinutes: number;
  /** Pre-resolved: either the bypass handler or undefined (App decides CTA eligibility). */
  onTrafficReroute: (() => void) | undefined;
  bypassBusy: boolean;
  roadAdvisoryDetailOn: boolean;
  onRoadDetailToggle: (on: boolean) => void;
  hasGuidanceRoute: boolean;
  advisoryRoadDetailRows: StormRoadDetailRow[];
  advisoryRouteImpacts: RouteImpact[] | null;
  advisoryStormStripBands: StormStripBand[] | null;
  routeAheadTimeline: TimelineItem[] | null;
  routeTotalMeters: number;
  userAlongMeters: number;
  planEtaMinutes: number | null;
  driveEtaMinutes: number | null;
  stormBarExpanded: boolean;
  onBarExpandedChange: (expanded: boolean) => void;
  onNwsAlertClick: (alert: NormalizedWeatherAlert) => void;
  busyLabel: string | null;
  staleWeatherNote: string | null;
  onRefreshWeather: (() => void) | null;
  driveModeUi: boolean;
  driveRouteAheadLine: DriveAheadLine | null;
  nextHazardAtEtaLine: string | null;
  advisoryPlusDetailOn: boolean;
  advisoryPromoLines: AdvisoryPromoLine[];
  isOnline: boolean;
  navigationStarted: boolean;
  advisoryNowcastLine: string | null;
  currentNowcast: CurrentNowcast | null;
  forecastAreaLabel: string | null;
  tioMinutePrecip: MinutePrecipForecast | null;
  localHourlyForecast: PointHourlyForecast | null;
  localDailyForecast: PointDailyForecast | null;
  localForecastNwsAlerts: NormalizedWeatherAlert[];
  localForecastPanelLoading: boolean;
  weatherKitPrimary: boolean;
  forecastLngLat: [number, number] | null;
  onOpenSubscription: () => void;
  basicStatusPanelPromos: BasicStatusPanelPromos | null;
  showDataSaverHint: boolean;
  onOpenDataSaverSettings: () => void;
  onDismissDataSaverHint: () => void;
};

export function buildStormAdvisoryBarProps(
  input: BuildStormAdvisoryBarPropsInput
): StormAdvisoryBarProps {
  const {
    isPlus,
    stormSessionOn,
    onSessionToggle,
    stormLoading,
    stormError,
    stormCorridorAlertsLength,
    stormMapHasFeatures,
    allDisplayableAlerts,
    nwsAlertsForGuidanceAdvisory,
    stormNwsPuckInside,
    trafficDelayMinutes,
    onTrafficReroute,
    bypassBusy,
    roadAdvisoryDetailOn,
    onRoadDetailToggle,
    hasGuidanceRoute,
    advisoryRoadDetailRows,
    advisoryRouteImpacts,
    advisoryStormStripBands,
    routeAheadTimeline,
    routeTotalMeters,
    userAlongMeters,
    planEtaMinutes,
    driveEtaMinutes,
    stormBarExpanded,
    onBarExpandedChange,
    onNwsAlertClick,
    busyLabel,
    staleWeatherNote,
    onRefreshWeather,
    driveModeUi,
    driveRouteAheadLine,
    nextHazardAtEtaLine,
    advisoryPlusDetailOn,
    advisoryPromoLines,
    isOnline,
    navigationStarted,
    advisoryNowcastLine,
    currentNowcast,
    forecastAreaLabel,
    tioMinutePrecip,
    localHourlyForecast,
    localDailyForecast,
    localForecastNwsAlerts,
    localForecastPanelLoading,
    weatherKitPrimary,
    forecastLngLat,
    onOpenSubscription,
    basicStatusPanelPromos,
    showDataSaverHint,
    onOpenDataSaverSettings,
    onDismissDataSaverHint,
  } = input;

  const plusNwsLoading =
    isPlus && stormLoading && stormCorridorAlertsLength === 0 && !stormMapHasFeatures;

  return {
    featureEnabled: true,
    sessionOn: stormSessionOn,
    onSessionToggle,
    loading: plusNwsLoading,
    error: isPlus ? stormError : null,
    corridorAlerts: isPlus ? allDisplayableAlerts : [],
    overlappingAlerts: isPlus ? nwsAlertsForGuidanceAdvisory : [],
    nwsAtLocationAlerts: isPlus ? stormNwsPuckInside : [],
    trafficDelayMinutes,
    onTrafficReroute,
    trafficRerouteBusy: bypassBusy,
    roadDetailEnabled: isPlus && roadAdvisoryDetailOn,
    onRoadDetailToggle,
    hasGuidanceRoute,
    roadDetailRows: isPlus ? advisoryRoadDetailRows : [],
    routeImpacts: isPlus ? advisoryRouteImpacts : null,
    stormStripBands: isPlus ? advisoryStormStripBands : null,
    routeAheadTimeline: isPlus ? routeAheadTimeline : null,
    routeTotalMeters,
    userAlongMeters,
    planEtaMinutes,
    driveEtaMinutes,
    barExpanded: stormBarExpanded,
    onBarExpandedChange,
    hideHeadToggles: !isPlus,
    onNwsAlertClick,
    busyLabel,
    staleWeatherNote,
    onRefreshWeather,
    driveRouteAheadLine: driveModeUi ? driveRouteAheadLine : null,
    nextHazardAtEtaLine: isPlus ? nextHazardAtEtaLine : null,
    advisoryTier: advisoryPlusDetailOn ? "plus" : "basic",
    ownsPlus: isPlus,
    promoLines: advisoryPromoLines,
    isOnline,
    basicNavAdvisoryMode: !isPlus,
    navigationStarted,
    nowcastLine: isPlus ? advisoryNowcastLine : null,
    currentNowcast: isPlus ? currentNowcast : null,
    forecastAreaLabel: isPlus ? forecastAreaLabel : null,
    minutePrecipForecast: isPlus ? tioMinutePrecip : null,
    hourlyForecast: isPlus ? localHourlyForecast : null,
    dailyForecast: isPlus ? localDailyForecast : null,
    localForecastNwsAlerts: isPlus ? localForecastNwsAlerts : [],
    nwsForecastLoading: plusNwsLoading,
    nwsForecastError: isPlus ? stormError : null,
    basicForecastLoading: isPlus ? localForecastPanelLoading : false,
    weatherKitPrimary,
    forecastLngLat,
    onOpenSubscription,
    basicStatusPanelPromos,
    dataSaverHint: showDataSaverHint
      ? {
          onOpenSettings: onOpenDataSaverSettings,
          onDismiss: onDismissDataSaverHint,
        }
      : null,
  };
}

export type { StormRoadDetailRow, StormStripBand };
