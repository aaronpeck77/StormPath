import { useMemo } from "react";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";
import { nwsAlertIsBasicEmergency } from "../weatherAlerts/basicEmergencyFilter";
import { nwsAlertIsStripProminent } from "../weatherAlerts/geometryOverlap";
import { nwsGlanceSummary } from "../weatherAlerts/nwsDriveSummary";
import { sortWeatherAlertsBySeverity } from "../weatherAlerts";
import {
  formatRouteAlertTiming,
  isAlertExpired,
  promoteAtPositionAlertToTop,
} from "../nav/routeAlertTiming";
import { placePhraseMatchingSpan } from "../nav/routePlaceReference";
import { TRAFFIC_BYPASS_ENABLED, TRAFFIC_DELAY_ALERT_MINUTES } from "../nav/constants";
import type { RouteImpact } from "../nav/routeImpacts";
import {
  impactToTimelineItem,
  mergeOverlappingTimelineItems,
  type TimelineItem,
} from "./RouteHazardTimeline";
import type { StormAdvisoryBarProps, StormStripBand } from "./StormAdvisoryBar";
import { isAdvisoryPromoNoise, limitExpandedPromoLines } from "./advisoryPreviewMix";
import type { AdvisoryPromoLine } from "../config/basicAds";
import {
  buildLocalForecastBannerItem,
  latestForecastFetchedAtMs,
} from "../utils/forecastDisplay";

/**
 * Everything the expanded advisory panel needs that is derived from the raw
 * props — alert sorting/bucketing, the unified route hazard timeline, NWS
 * status line, promo filtering, and the local-forecast banner item.
 *
 * Shared by {@link StormAdvisoryBar}'s expanded panel and the CarPlay
 * companion page so both surfaces always agree on what the hazards are.
 */
export type AdvisoryExpandedModel = {
  urgentTopAlerts: { alert: NormalizedWeatherAlert; timingLine: string }[];
  developingNwsAlerts: { alert: NormalizedWeatherAlert; timingLine: string }[];
  panelNwsAlertsExtra: { alert: NormalizedWeatherAlert; timingLine: string }[];
  advisoryRouteTimeline: TimelineItem[];
  hasRouteHazardDetail: boolean;
  showRerouteCta: boolean;
  nwsStatusMessage: { tone: "muted" | "warn"; text: string } | null;
  hasTrafficStop: boolean;
  localForecastBanner: ReturnType<typeof buildLocalForecastBannerItem>;
  expandedPromoLines: AdvisoryPromoLine[];
};

function impactSectionBucket(i: RouteImpact): "weather" | "road" {
  switch (i.category) {
    case "weather":
    case "winter":
    case "wind":
    case "flooding":
    case "visibility":
      return "weather";
    case "traffic":
    case "closure":
    case "incident":
    case "construction":
      return "road";
    default:
      return "road";
  }
}

export function useAdvisoryExpandedModel(props: StormAdvisoryBarProps): AdvisoryExpandedModel {
  const {
    overlappingAlerts,
    nwsAtLocationAlerts,
    trafficDelayMinutes,
    onTrafficReroute,
    roadDetailRows,
    routeImpacts = null,
    routeAheadTimeline = null,
    stormStripBands = null,
    routeTotalMeters = 0,
    userAlongMeters = 0,
    planEtaMinutes = null,
    driveEtaMinutes = null,
    isOnline = true,
    error = null,
    onNwsAlertClick,
    basicNavAdvisoryMode = false,
    forecastAreaLabel = null,
    nowcastLine = null,
    minutePrecipForecast = null,
    currentNowcast = null,
    localForecastNwsAlerts = [],
    promoLines = [],
    hasGuidanceRoute = false,
  } = props;

  const crossingSorted = useMemo(
    () => sortWeatherAlertsBySeverity(overlappingAlerts),
    [overlappingAlerts]
  );

  const atLocationSorted = useMemo(
    () => sortWeatherAlertsBySeverity(nwsAtLocationAlerts),
    [nwsAtLocationAlerts]
  );

  /* NOW: life-safety NWS at-location, plus crossing-soon if the route doesn't already include them.
   * These are rendered FIRST, separately, so urgent stuff isn't buried under forecast-style rows. */
  const nowAtLocation = useMemo(
    () => atLocationSorted.filter(nwsAlertIsBasicEmergency),
    [atLocationSorted]
  );
  /* AT-YOUR-POSITION (non-urgent): NWS alerts whose polygon contains the user but which aren't
   * life-safety (e.g. Wind Advisory, Blowing Dust Advisory, Dense Fog Advisory). The collapsed
   * bar's ticker already rotates through these — without a panel surface, the bar would say
   * "Wind Advisory at your position" while the panel said "no active alerts in this area",
   * which is confusing. We show these in WEATHER as a compact list so the two views agree. */
  const atLocationOther = useMemo(
    () => atLocationSorted.filter((a) => !nwsAlertIsBasicEmergency(a)),
    [atLocationSorted]
  );

  /* ROUTE-CROSSING (non-urgent): NWS alerts whose polygon intersects the planned route but are
   * not life-safety (e.g. Flood Advisory, Flood Warning, Special Weather Statement, Wind Advisory).
   * Life-safety crossing alerts are already in NOW. These live in WEATHER so the user sees what
   * is actually on their route even before pressing Go. */
  const crossingOther = useMemo(
    () => crossingSorted.filter((a) => !nwsAlertIsBasicEmergency(a)),
    [crossingSorted]
  );

  /* WEATHER: weather-bucket impacts that AREN'T already promoted to NOW. */
  const allWeatherImpacts = useMemo(() => {
    if (!routeImpacts?.length) return [];
    const promoted = new Set<string>();
    const nowEvents = new Set(nowAtLocation.map((a) => a.event.toLowerCase()));
    for (const i of routeImpacts) {
      if (i.source !== "nws") continue;
      const headline = i.driverHeadline.toLowerCase();
      for (const ev of nowEvents) {
        if (ev && headline.includes(ev)) { promoted.add(i.id); break; }
      }
    }
    return routeImpacts.filter((i) => impactSectionBucket(i) === "weather" && !promoted.has(i.id));
  }, [routeImpacts, nowAtLocation]);

  const radarImpacts = useMemo(
    () => allWeatherImpacts.filter((i) => i.source === "radar"),
    [allWeatherImpacts]
  );
  const forecastImpacts = useMemo(
    () => allWeatherImpacts.filter((i) => i.source === "tomorrowIo"),
    [allWeatherImpacts]
  );
  /* ROADS: traffic / closure / incident / construction impacts. */
  const roadImpacts = useMemo(() => {
    if (!routeImpacts?.length) return [];
    return routeImpacts.filter((i) => impactSectionBucket(i) === "road");
  }, [routeImpacts]);

  /* Show ROADS when there are road impacts, traffic narrative rows, or a reroute CTA condition. */
  const hasTrafficStop = useMemo(
    () => roadDetailRows.some((r) => /traffic stop|closure/i.test(r.label)),
    [roadDetailRows]
  );
  const showRerouteCta =
    TRAFFIC_BYPASS_ENABLED &&
    (trafficDelayMinutes >= TRAFFIC_DELAY_ALERT_MINUTES || hasTrafficStop) &&
    Boolean(onTrafficReroute);

  const bandByAlertId = useMemo(() => {
    const m = new Map<string, StormStripBand>();
    for (const b of stormStripBands ?? []) {
      if (b.alertId) m.set(b.alertId, b);
    }
    return m;
  }, [stormStripBands]);

  const urgentTopAlerts = useMemo(() => {
    const out: { alert: NormalizedWeatherAlert; timingLine: string }[] = [];
    const seen = new Set<string>();

    for (const a of nowAtLocation) {
      if (isAlertExpired(a.ends)) continue;
      seen.add(a.id);
      out.push({ alert: a, timingLine: promoteAtPositionAlertToTop().timingLine });
    }

    if (routeTotalMeters > 0) {
      for (const a of crossingSorted) {
        if (seen.has(a.id)) continue;
        const band = bandByAlertId.get(a.id);
        if (!band || isAlertExpired(band.expiresIso)) continue;
        const timing = formatRouteAlertTiming({
          startMeters: band.startMeters,
          endMeters: band.endMeters,
          userAlongMeters,
          totalMeters: routeTotalMeters,
          planEtaMinutes,
          driveEtaMinutes,
          expiresIso: band.expiresIso,
          onsetIso: band.onsetIso ?? a.onset,
          crossesRoute: band.crossesRoute,
          placePhrase: placePhraseMatchingSpan(routeAheadTimeline, band.startMeters, band.endMeters),
          placeLabel: a.event,
        });
        if (!timing.promoteToTop) continue;
        if (!nwsAlertIsStripProminent(a)) continue;
        seen.add(a.id);
        out.push({ alert: a, timingLine: timing.timingLine });
      }
    }

    return out;
  }, [
    nowAtLocation,
    crossingSorted,
    bandByAlertId,
    routeTotalMeters,
    userAlongMeters,
    planEtaMinutes,
    driveEtaMinutes,
    routeAheadTimeline,
  ]);

  /** Non–life-safety alerts at your position or on the route — shown below the hazard graph. */
  const panelNwsAlerts = useMemo(() => {
    const out: { alert: NormalizedWeatherAlert; timingLine: string }[] = [];
    const seen = new Set(urgentTopAlerts.map((x) => x.alert.id));

    for (const a of atLocationOther) {
      if (seen.has(a.id) || isAlertExpired(a.ends)) continue;
      seen.add(a.id);
      out.push({ alert: a, timingLine: promoteAtPositionAlertToTop().timingLine });
    }

    for (const a of crossingOther) {
      if (seen.has(a.id) || isAlertExpired(a.ends)) continue;
      const band = bandByAlertId.get(a.id);
      let timingLine = "On your planned route";
      if (band && routeTotalMeters > 0) {
        const timing = formatRouteAlertTiming({
          startMeters: band.startMeters,
          endMeters: band.endMeters,
          userAlongMeters,
          totalMeters: routeTotalMeters,
          planEtaMinutes,
          driveEtaMinutes,
          expiresIso: band.expiresIso,
          onsetIso: band.onsetIso ?? a.onset,
          crossesRoute: band.crossesRoute,
          placePhrase: placePhraseMatchingSpan(routeAheadTimeline, band.startMeters, band.endMeters),
          placeLabel: a.event,
        });
        timingLine = timing.timingLine;
      }
      seen.add(a.id);
      out.push({ alert: a, timingLine });
    }

    return out;
  }, [
    urgentTopAlerts,
    atLocationOther,
    crossingOther,
    bandByAlertId,
    routeTotalMeters,
    userAlongMeters,
    planEtaMinutes,
    driveEtaMinutes,
    routeAheadTimeline,
  ]);

  /** NWS alert ids on the route hazard list — skip duplicate chip rows below. */
  const timelineNwsAlertIds = useMemo(() => {
    const ids = new Set<string>();
    for (const b of stormStripBands ?? []) {
      if (b.alertId) ids.add(b.alertId);
    }
    return ids;
  }, [stormStripBands]);

  /** At-position-only NWS chips — excludes route timeline rows (same alert + timing). */
  const developingNwsAlerts = useMemo(() => {
    if (routeTotalMeters <= 0) return [];
    return panelNwsAlerts.filter(({ alert }) => {
      const band = bandByAlertId.get(alert.id);
      if (!band) return false;
      const timing = formatRouteAlertTiming({
        startMeters: band.startMeters,
        endMeters: band.endMeters,
        userAlongMeters,
        totalMeters: routeTotalMeters,
        planEtaMinutes,
        driveEtaMinutes,
        expiresIso: band.expiresIso,
        onsetIso: band.onsetIso ?? alert.onset,
        crossesRoute: band.crossesRoute,
      });
      return timing.developingLater;
    });
  }, [
    panelNwsAlerts,
    bandByAlertId,
    routeTotalMeters,
    userAlongMeters,
    planEtaMinutes,
    driveEtaMinutes,
  ]);

  const panelNwsAlertsExtra = useMemo(
    () =>
      panelNwsAlerts.filter(
        ({ alert }) =>
          !timelineNwsAlertIds.has(alert.id) &&
          !developingNwsAlerts.some((d) => d.alert.id === alert.id)
      ),
    [panelNwsAlerts, timelineNwsAlertIds, developingNwsAlerts]
  );

  /** Only surface NWS status when fetch is blocked — skip “all clear” / “along route” filler. */
  const nwsStatusMessage: { tone: "muted" | "warn"; text: string } | null = useMemo(() => {
    if (!isOnline) {
      return {
        tone: "warn",
        text: "Offline — NWS alerts will refresh when you're back online.",
      };
    }
    const errMsg = (error ?? "").trim();
    if (errMsg) {
      return {
        tone: "warn",
        text: "Couldn't reach weather.gov — try again in a moment.",
      };
    }
    return null;
  }, [isOnline, error]);

  const localForecastBanner = useMemo(() => {
    if (!forecastAreaLabel) return null;
    return buildLocalForecastBannerItem({
      areaLabel: forecastAreaLabel,
      nowcastLine,
      minutePrecip: basicNavAdvisoryMode ? null : minutePrecipForecast,
      fetchedAtMs: latestForecastFetchedAtMs(
        currentNowcast?.fetchedAtMs,
        basicNavAdvisoryMode ? undefined : minutePrecipForecast?.fetchedAt
      ),
      nwsNearYou:
        basicNavAdvisoryMode || !localForecastNwsAlerts.length ? null : localForecastNwsAlerts,
    });
  }, [
    forecastAreaLabel,
    nowcastLine,
    minutePrecipForecast,
    currentNowcast?.fetchedAtMs,
    localForecastNwsAlerts,
    basicNavAdvisoryMode,
  ]);

  const expandedPromoLines = useMemo(() => {
    const filtered = promoLines.filter((p) => !isAdvisoryPromoNoise(p));
    if (basicNavAdvisoryMode) return filtered;
    const hasTripOrWeatherContent = Boolean(
      forecastAreaLabel ||
        localForecastBanner ||
        nowcastLine ||
        hasGuidanceRoute ||
        (routeImpacts?.length ?? 0) > 0 ||
        (stormStripBands?.length ?? 0) > 0
    );
    return limitExpandedPromoLines(filtered, hasTripOrWeatherContent);
  }, [
    basicNavAdvisoryMode,
    promoLines,
    forecastAreaLabel,
    localForecastBanner,
    nowcastLine,
    hasGuidanceRoute,
    routeImpacts?.length,
    stormStripBands?.length,
  ]);

  const allAlerts = useMemo(
    () => [...overlappingAlerts, ...nwsAtLocationAlerts],
    [overlappingAlerts, nwsAtLocationAlerts]
  );

  const stripBandClick = (band: StormStripBand): (() => void) | undefined => {
    if (!band.alertId || !onNwsAlertClick) return undefined;
    const matched = allAlerts.find((a) => a.id === band.alertId);
    if (!matched) return undefined;
    return () => onNwsAlertClick(matched);
  };

  const stripBandDetail = (band: StormStripBand): { severityLabel: string | null; detail: string | null } => {
    const matched = band.alertId ? allAlerts.find((a) => a.id === band.alertId) : null;
    if (!matched) return { severityLabel: null, detail: null };
    return {
      severityLabel: matched.severity ?? null,
      detail: nwsGlanceSummary(matched) ?? null,
    };
  };

  const advisoryRouteTimeline = useMemo((): TimelineItem[] => {
    const timelineFromApp =
      routeAheadTimeline != null && routeTotalMeters > 0 ? routeAheadTimeline : null;
    const timelineItems: TimelineItem[] = timelineFromApp ? [...timelineFromApp] : [];

    if (!timelineFromApp) {
      if (routeTotalMeters > 0 && (stormStripBands?.length ?? 0) > 0) {
        for (const band of stormStripBands!) {
          if (isAlertExpired(band.expiresIso)) continue;
          const timing = formatRouteAlertTiming({
            startMeters: band.startMeters,
            endMeters: band.endMeters,
            userAlongMeters,
            totalMeters: routeTotalMeters,
            planEtaMinutes,
            driveEtaMinutes,
          expiresIso: band.expiresIso,
          onsetIso: band.onsetIso,
          crossesRoute: band.crossesRoute,
          });
          if (timing.passed) continue;
          const extra = stripBandDetail(band);
          const nwsDetail = (extra.detail ?? "").trim() || null;
          timelineItems.push({
            id: band.id,
            track: "nws",
            label: band.event,
            severity: band.severity,
            startMeters: band.startMeters,
            endMeters: band.endMeters,
            detailLine: nwsDetail || null,
            expiresIso: band.expiresIso,
            crossesRoute: band.crossesRoute !== false,
            onClick: stripBandClick(band),
          });
        }
      }

      const pushIfActive = (imp: RouteImpact) => {
        if (imp.endMeters <= userAlongMeters) return;
        timelineItems.push(impactToTimelineItem(imp));
      };
      for (const imp of radarImpacts) pushIfActive(imp);
      for (const imp of forecastImpacts) pushIfActive(imp);
      for (const imp of roadImpacts) pushIfActive(imp);
    } else {
      for (let i = 0; i < timelineItems.length; i++) {
        const item = timelineItems[i]!;
        if (item.track !== "nws" || item.onClick) continue;
        const band = stormStripBands?.find((b) => b.id === item.id);
        if (band) timelineItems[i] = { ...item, onClick: stripBandClick(band) };
      }
    }

    return timelineFromApp ?? mergeOverlappingTimelineItems(timelineItems, routeTotalMeters);
  }, [
    routeAheadTimeline,
    routeTotalMeters,
    stormStripBands,
    userAlongMeters,
    planEtaMinutes,
    driveEtaMinutes,
    radarImpacts,
    forecastImpacts,
    roadImpacts,
    allAlerts,
    onNwsAlertClick,
  ]);

  const hasRouteHazardDetail =
    advisoryRouteTimeline.some((item) => !item.stripMuted && item.endMeters > userAlongMeters) && routeTotalMeters > 0;

  return {
    urgentTopAlerts,
    developingNwsAlerts,
    panelNwsAlertsExtra,
    advisoryRouteTimeline,
    hasRouteHazardDetail,
    showRerouteCta,
    nwsStatusMessage,
    hasTrafficStop,
    localForecastBanner,
    expandedPromoLines,
  };
}
