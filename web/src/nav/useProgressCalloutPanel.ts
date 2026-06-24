import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type MutableRefObject,
} from "react";
import { buildSimpleCalloutBlock } from "./progressCalloutCopy";
import { buildRouteAheadCalloutSegments, timelineItemShowsOnRouteLine, type TimelineItem } from "./routeAheadSync";
import {
  buildRouteChunkCalloutList,
  type RouteChunkCalloutItem,
} from "./routeProgressChunkList";
import type { WxSample } from "./routeChunkWeather";
import { gustSpikeSeverity } from "./windForecastCalib";
import type { RouteOutlookStep, StormRouteOutlookBand } from "./routeForecastTimeline";
import {
  applyRadarOutlookBoost,
  buildMilestoneRouteOutlook,
  buildOutlookFromStormAlongRoute,
  buildRouteOutlookFromTomorrowForecast,
  buildSyncedRouteOutlook,
  ensureRouteOutlookForGraph,
  mergeRouteOutlookSteps,
  mergeRouteOutlookSamples,
  resolveRouteOutlookAnchorTempF,
  resyncRouteOutlookSteps,
  tomorrowForecastToWxSamples,
} from "./routeForecastTimeline";
import { layoutStripAlerts } from "./stripAlertLayout";
import { polylineLengthMeters } from "./routeGeometry";
import {
  auditRouteAheadSync,
  repairActionsForRouteAheadIssues,
  ROUTE_AHEAD_HEALTH_POLL_MS,
  ROUTE_AHEAD_HEALTH_REPAIR_COOLDOWN_MS,
} from "./routeAheadHealth";
import { reportAppHealthRepair } from "../monitoring/appHealthSignals";
import { routePickSlotHex } from "../ui/mapRouteStyle";
import { routeSlotIndexFor } from "../ui/mapRouteLayers";
import { isUltraLongTripRoute } from "../utils/dataSaver";
import type { RouteAlert } from "./routeAlerts";
import type { UnifiedTrafficNarrative } from "./trafficNarrative";
import type { LngLat, NavRoute } from "./types";
import type { RouteSituationSlice } from "../situation/types";
import type { WeatherOverlay } from "../situation/fusedSnapshot";
import type { RouteForecast } from "../services/tomorrowIo";
import { isTomorrowIoRateLimited } from "../services/tomorrowIoClient";
import type { CurrentNowcast } from "../services/openWeatherClient";
import { isOpenWeatherRateLimited } from "../services/openWeatherPacing";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";
import type { StormProgressStripBand } from "../weatherAlerts/geometryOverlap";

export type ProgressCalloutPanel = {
  routeWide: RouteChunkCalloutItem[];
  outlookTimeline: RouteOutlookStep[];
  outlookSamples: WxSample[];
  segments: RouteChunkCalloutItem[];
  userAlongT: number;
  stripTint: string;
  /** Wind gust points sampled directly from TIO forecast intervals (bypasses step merge). */
  windPoints: { t: number; mph: number }[];
  gustSpikePoints: { t: number; mph: number }[];
};

export type UseProgressCalloutPanelDeps = {
  navigationStarted: boolean;
  advisoryUserAlongM: number;
  userAlongGuidanceM: number;
  guidanceRouteLengthM: number;
  guidanceRoute: NavRoute | undefined;
  orderedRouteIds: string[];
  guidanceRouteId: string;
  routeAheadTimeline: TimelineItem[];
  routeAheadProgressBands: StormProgressStripBand[];
  stormCorridorAlerts: NormalizedWeatherAlert[];
  progressStripAlerts: RouteAlert[];
  guidanceSlice: RouteSituationSlice | undefined;
  weatherOverlay: WeatherOverlay | undefined;
  corridorWeatherDetail: string;
  lineFocusId: string;
  tioRouteForecast: RouteForecast | null;
  radarMosaicSamples: { t: number; intensity: number }[];
  liveTrafficNarrative: UnifiedTrafficNarrative | null;
  driveEtaMinutes: number | null;
  stormOutlookBands: StormRouteOutlookBand[];
  advisoryNowcastLine: string | null;
  currentNowcast: CurrentNowcast | null;
  tioMinutePrecip: { now?: { tempF?: number | null } | null } | null;
  localHourlyForecast: { hours: { tempF?: number | null }[] } | null;
  nwsAlertsAffectingActiveRoute: NormalizedWeatherAlert[];
  progressCalloutsOpen: boolean;
  progressCalloutDetailScrollRef: MutableRefObject<HTMLDivElement | null>;
  appForeground: boolean;
  isPlus: boolean;
  settingWeatherHintsEnabled: boolean;
  destLngLat: LngLat | null;
  planRoutes: NavRoute[];
  bumpWeatherRefresh: () => void;
  resetWeatherOverlayThrottle: () => void;
  bumpTrafficRefresh: () => void;
};

export type UseProgressCalloutPanelResult = {
  progressPanelAlongM: number;
  activeProgressCalloutPanel: ProgressCalloutPanel;
  progressCalloutUserAlongT: number;
  progressCalloutCount: number;
};

export function useProgressCalloutPanel(
  deps: UseProgressCalloutPanelDeps
): UseProgressCalloutPanelResult {
  const {
    navigationStarted,
    advisoryUserAlongM,
    userAlongGuidanceM,
    guidanceRouteLengthM,
    guidanceRoute,
    orderedRouteIds,
    guidanceRouteId,
    routeAheadTimeline,
    routeAheadProgressBands,
    stormCorridorAlerts,
    progressStripAlerts,
    guidanceSlice,
    weatherOverlay,
    corridorWeatherDetail,
    lineFocusId,
    tioRouteForecast,
    radarMosaicSamples,
    liveTrafficNarrative,
    driveEtaMinutes,
    stormOutlookBands,
    advisoryNowcastLine,
    currentNowcast,
    tioMinutePrecip,
    localHourlyForecast,
    nwsAlertsAffectingActiveRoute,
    progressCalloutsOpen,
    progressCalloutDetailScrollRef,
    appForeground,
    isPlus,
    settingWeatherHintsEnabled,
    destLngLat,
    planRoutes,
    bumpWeatherRefresh,
    resetWeatherOverlayThrottle,
    bumpTrafficRefresh,
  } = deps;

  const progressPanelAlongM = navigationStarted ? advisoryUserAlongM : userAlongGuidanceM;
  const skipHeavyProgressPanel =
    isUltraLongTripRoute(guidanceRouteLengthM) && !navigationStarted;
  const ultraLongActiveNav =
    navigationStarted && isUltraLongTripRoute(guidanceRouteLengthM);

  const progressCalloutPanel = useMemo((): ProgressCalloutPanel => {
    const g = guidanceRoute?.geometry;
    const stripTint =
      guidanceRoute != null
        ? navigationStarted
          ? routePickSlotHex(0)
          : routePickSlotHex(routeSlotIndexFor(guidanceRoute.id, orderedRouteIds))
        : "#94a3b8";

    /* Wind gust points sampled from TIO intervals — sustained speed on graph; spikes as markers. */
    const planEtaForWind = guidanceRoute?.baseEtaMinutes ?? null;
    const windPoints: { t: number; mph: number }[] =
      tioRouteForecast && planEtaForWind && planEtaForWind > 0
        ? tioRouteForecast.intervals
            .filter((iv) => iv.windSpeedMph >= 8)
            .map((iv) => ({
              t: Math.min(1, Math.max(0, iv.etaMinutes / planEtaForWind)),
              mph: Math.round(iv.windSpeedMph),
            }))
        : [];
    const gustSpikePoints: { t: number; mph: number }[] =
      tioRouteForecast && planEtaForWind && planEtaForWind > 0
        ? tioRouteForecast.intervals
            .filter((iv) => gustSpikeSeverity(iv.windSpeedMph, iv.windGustMph) !== null)
            .map((iv) => ({
              t: Math.min(1, Math.max(0, iv.etaMinutes / planEtaForWind)),
              mph: Math.round(iv.windGustMph),
            }))
        : [];

    if (skipHeavyProgressPanel) {
      return {
        routeWide: [],
        outlookTimeline: [],
        outlookSamples: [],
        segments: [],
        userAlongT: 0,
        stripTint,
        windPoints,
        gustSpikePoints,
      };
    }

    if (!g?.length) {
      return {
        routeWide: [],
        outlookTimeline: [],
        outlookSamples: [],
        segments: [],
        userAlongT: 0,
        stripTint,
        windPoints,
        gustSpikePoints,
      };
    }
    const totalM = polylineLengthMeters(g);
    if (totalM <= 0) {
      return {
        routeWide: [],
        outlookTimeline: [],
        outlookSamples: [],
        segments: [],
        userAlongT: 0,
        stripTint,
        windPoints,
        gustSpikePoints,
      };
    }
    const userAlongT =
      totalM > 0 ? Math.min(1, Math.max(0, userAlongGuidanceM / totalM)) : 0;

    const planEta = guidanceRoute?.baseEtaMinutes ?? null;
    const wxOverlay =
      weatherOverlay?.[guidanceRouteId] ??
      weatherOverlay?.[lineFocusId] ??
      (weatherOverlay ? Object.values(weatherOverlay)[0] : undefined);
    const wxSamples = wxOverlay?.samples;
    const wxHeadline =
      guidanceSlice?.forecastHeadline?.trim() ||
      wxOverlay?.headline?.trim() ||
      corridorWeatherDetail ||
      advisoryNowcastLine ||
      "";

    const stormOutlook =
      totalM > 0
        ? buildOutlookFromStormAlongRoute({
            totalMeters: totalM,
            stormBands: stormOutlookBands,
            radarSamples: radarMosaicSamples,
          })
        : [];

    const tioSamples =
      tioRouteForecast && planEta && planEta > 0
        ? tomorrowForecastToWxSamples(tioRouteForecast, planEta)
        : [];
    const outlookGraphSamples = mergeRouteOutlookSamples(wxSamples ?? [], tioSamples);
    const routeOutlookAnchorTempF = resolveRouteOutlookAnchorTempF({
      nowcastTempF: currentNowcast?.tempF,
      minutePrecipTempF: tioMinutePrecip?.now?.tempF,
      hourlyTempF: localHourlyForecast?.hours[0]?.tempF ?? null,
      headline: wxHeadline,
      tioRouteForecast,
    });

    if (ultraLongActiveNav) {
      const routeAheadSegments = buildRouteAheadCalloutSegments({
        items: routeAheadTimeline,
        totalMeters: totalM,
        userAlongMeters: progressPanelAlongM,
        planEtaMinutes: planEta,
        driveEtaMinutes: driveEtaMinutes ?? null,
      });

      const tioOutlook =
        tioRouteForecast && planEta && planEta > 0
          ? buildSyncedRouteOutlook({
              forecastHeadline: "",
              samples: tomorrowForecastToWxSamples(tioRouteForecast, planEta),
              totalMeters: totalM,
              userAlongMeters: progressPanelAlongM,
              planEtaMinutes: planEta,
              driveEtaMinutes: driveEtaMinutes ?? null,
            })
          : [];

      const syncedOutlook =
        outlookGraphSamples.length
          ? buildSyncedRouteOutlook({
              forecastHeadline: wxHeadline,
              samples: outlookGraphSamples,
              totalMeters: totalM,
              userAlongMeters: progressPanelAlongM,
              planEtaMinutes: planEta,
              driveEtaMinutes: driveEtaMinutes ?? null,
            })
          : wxHeadline
            ? buildSyncedRouteOutlook({
                forecastHeadline: wxHeadline,
                samples: wxSamples,
                totalMeters: totalM,
                userAlongMeters: progressPanelAlongM,
                planEtaMinutes: planEta,
                driveEtaMinutes: driveEtaMinutes ?? null,
              })
            : [];

      let outlookTimeline = resyncRouteOutlookSteps(
        mergeRouteOutlookSteps(syncedOutlook, tioOutlook, stormOutlook),
        {
          samples: outlookGraphSamples,
          totalMeters: totalM,
          userAlongMeters: progressPanelAlongM,
          planEtaMinutes: planEta,
          driveEtaMinutes: driveEtaMinutes ?? null,
        }
      );

      if (outlookTimeline.length === 0) {
        outlookTimeline = buildMilestoneRouteOutlook(totalM, planEta, wxHeadline);
      }

      const ensuredOutlook = ensureRouteOutlookForGraph({
        steps: outlookTimeline,
        samples: outlookGraphSamples,
        headline: wxHeadline,
        totalMeters: totalM,
        stormBands: stormOutlookBands,
        radarSamples: radarMosaicSamples,
        anchorTempF: routeOutlookAnchorTempF,
        tioRouteForecast,
        planEtaMinutes: planEta,
      });

      return {
        routeWide: [],
        outlookTimeline: ensuredOutlook.steps,
        outlookSamples: ensuredOutlook.samples,
        segments: routeAheadSegments.sort((a, b) => b.alongT - a.alongT),
        userAlongT,
        stripTint,
        windPoints,
        gustSpikePoints,
      };
    }

    const laidOut = layoutStripAlerts(progressStripAlerts, g, progressPanelAlongM, totalM);

    const routeAheadSegments = buildRouteAheadCalloutSegments({
      items: routeAheadTimeline,
      totalMeters: totalM,
      userAlongMeters: progressPanelAlongM,
      planEtaMinutes: planEta,
      driveEtaMinutes: driveEtaMinutes ?? null,
    });

    const bundle = buildRouteChunkCalloutList({
      geometry: g,
      totalM,
      userAlongM: progressPanelAlongM,
      planEtaMinutes: planEta,
      slice: guidanceSlice,
      weatherSamples: wxSamples,
      laidOutAlerts: laidOut,
      stormBands: routeAheadProgressBands,
      stripTint,
      stormNwsAlerts: nwsAlertsAffectingActiveRoute,
      progressTrafficLine: navigationStarted ? liveTrafficNarrative?.progressStartLine ?? null : null,
    });

    const syncedOutlook = buildSyncedRouteOutlook({
      forecastHeadline: wxHeadline,
      samples: outlookGraphSamples.length ? outlookGraphSamples : wxSamples,
      totalMeters: totalM,
      userAlongMeters: progressPanelAlongM,
      planEtaMinutes: planEta,
      driveEtaMinutes: driveEtaMinutes ?? null,
    });

    const tioOutlook =
      tioRouteForecast && planEta && planEta > 0
        ? buildSyncedRouteOutlook({
            forecastHeadline: "",
            samples: tomorrowForecastToWxSamples(tioRouteForecast, planEta),
            totalMeters: totalM,
            userAlongMeters: progressPanelAlongM,
            planEtaMinutes: planEta,
            driveEtaMinutes: driveEtaMinutes ?? null,
          })
        : [];

    const tioOutlookFallback =
      tioRouteForecast && planEta && planEta > 0
        ? buildRouteOutlookFromTomorrowForecast(tioRouteForecast, planEta)
        : [];

    const mergedSegments = [...routeAheadSegments, ...bundle.segments].sort((a, b) => b.alongT - a.alongT);
    let outlookTimeline = resyncRouteOutlookSteps(
      applyRadarOutlookBoost(
        mergeRouteOutlookSteps(
          syncedOutlook,
          tioOutlook,
          tioOutlook.length === 0 ? tioOutlookFallback : [],
          bundle.outlookTimeline,
          stormOutlook
        ),
        radarMosaicSamples
      ),
      {
        samples: outlookGraphSamples,
        totalMeters: totalM,
        userAlongMeters: progressPanelAlongM,
        planEtaMinutes: planEta,
        driveEtaMinutes: driveEtaMinutes ?? null,
      }
    );
    if (outlookTimeline.length === 0 && isUltraLongTripRoute(totalM)) {
      outlookTimeline = buildMilestoneRouteOutlook(totalM, planEta, wxHeadline);
    }
    if (outlookTimeline.length === 0 && navigationStarted && totalM > 0) {
      outlookTimeline = buildMilestoneRouteOutlook(totalM, planEta, wxHeadline || undefined);
    }

    const ensuredOutlook = ensureRouteOutlookForGraph({
      steps: outlookTimeline,
      samples: outlookGraphSamples,
      headline: wxHeadline,
      totalMeters: totalM,
      stormBands: stormOutlookBands,
      radarSamples: radarMosaicSamples,
      anchorTempF: routeOutlookAnchorTempF,
      tioRouteForecast,
      planEtaMinutes: planEta,
    });

    if (bundle.routeWide.length > 0 || ensuredOutlook.steps.length > 0 || mergedSegments.length > 0) {
      return {
        routeWide: bundle.routeWide,
        outlookTimeline: ensuredOutlook.steps,
        outlookSamples: ensuredOutlook.samples,
        segments: mergedSegments,
        userAlongT,
        stripTint,
        windPoints,
        gustSpikePoints,
      };
    }

    const pt = totalM > 0 ? Math.min(1, Math.max(0, userAlongGuidanceM / totalM)) : 0.5;
    const hasStormUi =
      Boolean(routeAheadProgressBands?.length) ||
      Boolean(stormCorridorAlerts?.length) ||
      Boolean(progressStripAlerts?.length);
    const b = buildSimpleCalloutBlock(
      "Route conditions",
      hasStormUi
        ? ["NWS active — open Rt view for warning polygons on the map."]
        : navigationStarted
          ? [
              liveTrafficNarrative?.progressStartLine ?? "Traffic updating along your route.",
              wxHeadline
                ? `Weather along route: ${wxHeadline}`
                : advisoryNowcastLine
                  ? `At your position: ${advisoryNowcastLine}`
                  : "No corridor alerts — local forecast above is at your GPS position.",
            ]
          : [
              "Open Rt view for NWS warning polygons on the map.",
              "Press Go for live traffic and segment labels on the strip.",
            ]
    );
    return {
      routeWide: [],
      outlookTimeline: [],
      outlookSamples: [],
      segments: [
        {
          key: "callout-fallback",
          scope: "segment",
          title: b.title,
          summary: b.summary,
          tooltip: b.tooltip,
          color: stripTint,
          alongT: pt,
          alongPct: Math.round(pt * 100),
        },
      ],
      userAlongT,
      stripTint,
      windPoints,
      gustSpikePoints,
    };
  }, [
    navigationStarted,
    guidanceRoute,
    orderedRouteIds,
    guidanceRoute?.geometry,
    guidanceRoute?.baseEtaMinutes,
    guidanceRouteId,
    progressPanelAlongM,
    userAlongGuidanceM,
    routeAheadTimeline,
    routeAheadProgressBands,
    stormCorridorAlerts,
    progressStripAlerts,
    guidanceSlice,
    weatherOverlay,
    corridorWeatherDetail,
    lineFocusId,
    tioRouteForecast,
    radarMosaicSamples,
    liveTrafficNarrative,
    driveEtaMinutes,
    skipHeavyProgressPanel,
    ultraLongActiveNav,
    stormOutlookBands,
    advisoryNowcastLine,
    currentNowcast?.tempF,
    tioMinutePrecip?.now?.tempF,
    localHourlyForecast?.hours[0]?.tempF,
    nwsAlertsAffectingActiveRoute,
  ]);

  const deferredProgressCalloutPanel = useDeferredValue(progressCalloutPanel);
  const activeProgressCalloutPanel = progressCalloutsOpen
    ? progressCalloutPanel
    : deferredProgressCalloutPanel;

  const routeAheadHealthRepairAtRef = useRef(0);
  const progressCalloutWasOpenRef = useRef(false);

  // Stable primitive deps for the watchdog — avoids effect re-running every render when
  // planRoutes/weatherOverlay object references change even though the relevant values haven't.
  const hasPlannedRoute = Boolean(
    destLngLat && planRoutes.some((r) => r.geometry && r.geometry.length >= 2)
  );
  const _owEntry = weatherOverlay?.[guidanceRouteId];
  const weatherOverlayHeadline = _owEntry?.headline?.trim() ?? "";
  const hasWeatherSamples = Boolean(_owEntry?.samples?.length);

  /** Route-hazard watchdog — progress strip and progress info panel stay fed from one pipeline. */
  useEffect(() => {
    if (!appForeground) return;
    const hasRoute = Boolean(guidanceRoute?.geometry && guidanceRoute.geometry.length >= 2);
    if (!hasRoute) return;

    const runAudit = () => {
      const audit = auditRouteAheadSync({
        hasRouteGeometry: hasRoute,
        isPlus,
        weatherHintsEnabled: settingWeatherHintsEnabled,
        hasPlannedRoute,
        navigationStarted,
        outlookStepCount: progressCalloutPanel.outlookTimeline.length,
        timelineItemCount: routeAheadTimeline.filter(timelineItemShowsOnRouteLine).length,
        progressBandCount: routeAheadProgressBands.length,
        corridorWeatherDetail,
        weatherOverlayHeadline,
        hasWeatherSamples,
        isWeatherRateLimited: isTomorrowIoRateLimited() || isOpenWeatherRateLimited(),
      });

      if (audit.ok) return;
      const now = Date.now();
      if (now - routeAheadHealthRepairAtRef.current < ROUTE_AHEAD_HEALTH_REPAIR_COOLDOWN_MS) return;
      routeAheadHealthRepairAtRef.current = now;

      const actions = repairActionsForRouteAheadIssues(audit.issues);
      for (const action of actions) {
        if (action === "refresh_weather_overlay") {
          resetWeatherOverlayThrottle();
          bumpWeatherRefresh();
        }
        if (action === "refresh_traffic") {
          bumpTrafficRefresh();
        }
      }
      reportAppHealthRepair("route_ahead", audit.issues, actions);
      if (import.meta.env.DEV) {
        console.info("[route-ahead-health] repair", audit.issues, actions);
      }
    };

    runAudit();
    const id = window.setInterval(runAudit, ROUTE_AHEAD_HEALTH_POLL_MS);
    return () => window.clearInterval(id);
  }, [
    appForeground,
    isPlus,
    settingWeatherHintsEnabled,
    navigationStarted,
    destLngLat,
    hasPlannedRoute,
    guidanceRoute?.geometry,
    guidanceRouteId,
    progressCalloutPanel.outlookTimeline.length,
    routeAheadTimeline.length,
    routeAheadProgressBands.length,
    corridorWeatherDetail,
    weatherOverlayHeadline,
    hasWeatherSamples,
    progressCalloutsOpen,
    bumpWeatherRefresh,
    resetWeatherOverlayThrottle,
    bumpTrafficRefresh,
  ]);

  const progressCalloutCount =
    progressCalloutPanel.routeWide.length +
    (progressCalloutPanel.outlookTimeline.length > 0 ? 1 : 0) +
    progressCalloutPanel.segments.length;

  /** Open panel with nearest-ahead events at the top of the scroll list. */
  useLayoutEffect(() => {
    const wasOpen = progressCalloutWasOpenRef.current;
    progressCalloutWasOpenRef.current = progressCalloutsOpen;
    if (progressCalloutsOpen && !wasOpen && progressCalloutCount > 0) {
      const el = progressCalloutDetailScrollRef.current;
      if (el) {
        requestAnimationFrame(() => {
          el.scrollTop = 0;
        });
      }
    }
  }, [progressCalloutsOpen, progressCalloutCount, progressCalloutDetailScrollRef]);

  return {
    progressPanelAlongM,
    activeProgressCalloutPanel,
    progressCalloutUserAlongT: progressCalloutPanel.userAlongT,
    progressCalloutCount,
  };
}
