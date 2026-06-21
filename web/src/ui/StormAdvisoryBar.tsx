import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SITEBIBLE_AD_BAR, type AdvisoryPromoLine, type BasicStatusPanelPromos } from "../config/basicAds";
import { BasicAdStrip } from "./BasicAdStrip";
import { BasicStatusAdSlot } from "./BasicStatusAdSlot";
import { limitExpandedPromoLines, mixAdvisoryPreviewItems } from "./advisoryPreviewMix";
import { sortWeatherAlertsBySeverity, type NormalizedWeatherAlert } from "../weatherAlerts";
import { nwsAlertIsBasicEmergency } from "../weatherAlerts/basicEmergencyFilter";
import { nwsAlertIsStripProminent } from "../weatherAlerts/geometryOverlap";
import { nwsGlanceSummary } from "../weatherAlerts/nwsDriveSummary";
import type { DriveAheadLine, DriveAheadRadarTier } from "../nav/driveRouteAhead";
import {
  formatDriveAheadBrief,
  formatMinutesAsHoursMinutes,
  isDriveAheadInsideSegment,
} from "../nav/driveRouteAhead";
import {
  formatRouteAlertTiming,
  isAlertExpired,
  promoteAtPositionAlertToTop,
} from "../nav/routeAlertTiming";
import { TRAFFIC_BYPASS_ENABLED, TRAFFIC_DELAY_ALERT_MINUTES } from "../nav/constants";
import type { RouteImpact, RouteImpactSeverity } from "../nav/routeImpacts";
import {
  RouteHazardTimeline,
  impactToTimelineItem,
  mergeOverlappingTimelineItems,
} from "./RouteHazardTimeline";
import type { TimelineItem } from "./RouteHazardTimeline";
import type { MinutePrecipForecast, PointHourlyForecast } from "../services/tomorrowIo";
import { AdvisoryLocalForecast } from "./AdvisoryLocalForecast";
import type { CurrentNowcast } from "../services/openWeatherClient";
import { displayText } from "../utils/displayText";
import {
  DATA_SAVER_ADVISORY_DETAIL,
  DATA_SAVER_ADVISORY_TIP,
} from "../utils/dataSaver";
import {
  buildLocalForecastBannerItem,
  latestForecastFetchedAtMs,
  truncateBannerText,
} from "../utils/forecastDisplay";

const BANNER_MSG_MAX = 96;
const BANNER_TICKER_MAX = 110;

/** Collapsed-bar background + ring — one per rotator message. */
type AdvisoryPreviewTone = "clear" | "weather" | "info" | "warn" | "hazard" | "severe";

type AdvisoryPreviewItem = {
  badge: string | null;
  raw: string;
  tone: AdvisoryPreviewTone;
  /** Area + freshness — only on the local forecast rotator slot. */
  localMeta?: { area: string; updated: string | null };
};

function nwsAlertPreviewTone(a: NormalizedWeatherAlert): AdvisoryPreviewTone {
  if (a.severity === "Extreme" || /tornado warning/i.test(a.event ?? "")) return "severe";
  if (a.severity === "Severe" || /warning/i.test(a.event ?? "")) return "hazard";
  return "warn";
}

function conditionsLinePreviewTone(line: string): AdvisoryPreviewTone {
  const l = line.toLowerCase();
  if (/\b(dry|clear|fair|sunny|no precip|mostly clear)\b/.test(l)) return "clear";
  if (/\b(rain|snow|storm|thunder|hail|flood|wind|ice|freez|heavy|severe)\b/.test(l)) return "warn";
  return "weather";
}

function localForecastBannerTone(
  item: { raw: string },
  nwsNearYou: NormalizedWeatherAlert[] | null | undefined
): AdvisoryPreviewTone {
  if (nwsNearYou?.length) {
    let worst: AdvisoryPreviewTone = "warn";
    for (const a of nwsNearYou) {
      const t = nwsAlertPreviewTone(a);
      if (t === "severe") return "severe";
      if (t === "hazard") worst = "hazard";
    }
    return worst;
  }
  return conditionsLinePreviewTone(item.raw);
}

function driveAheadPreviewTone(tier: DriveAheadRadarTier | undefined): AdvisoryPreviewTone {
  if (tier === "red") return "severe";
  if (tier === "orange") return "hazard";
  if (tier === "yellow") return "warn";
  if (tier === "green" || tier === "clear") return "clear";
  if (tier === "blue") return "weather";
  return "info";
}

function defaultPreviewTone(badge: string | null, raw: string): AdvisoryPreviewTone {
  const b = (badge ?? "").toLowerCase();
  const r = raw.toLowerCase();
  if (b === "offline") return "warn";
  if (b === "error") return "severe";
  if (b === "traffic") return "warn";
  if (b === "local" || b === "now") return conditionsLinePreviewTone(raw);
  if (b === "load" || b === "plan" || b === "work") return "info";
  if (b === "app" || b === "drive" || b === "nav" || b === "info") return "info";
  if (/no hazard|no urgent|no life-safety/.test(r)) return "clear";
  return "info";
}

function previewItem(
  item: Omit<AdvisoryPreviewItem, "tone"> & { tone?: AdvisoryPreviewTone }
): AdvisoryPreviewItem {
  return {
    ...item,
    tone: item.tone ?? defaultPreviewTone(item.badge, item.raw),
  };
}

function bannerMsg(text: string, max = BANNER_MSG_MAX): string {
  return truncateBannerText(text, max);
}

const GENERIC_NWS_CHIP_TIMING = new Set(["On your planned route"]);

function nwsChipDetailText(a: NormalizedWeatherAlert): string | null {
  const summary = nwsGlanceSummary(a).trim();
  const ev = (a.event ?? "").trim();
  if (!summary) return null;
  if (!ev) return summary;
  const summaryL = summary.toLowerCase();
  const evL = ev.toLowerCase();
  if (summaryL === evL || summaryL.startsWith(`${evL}:`) || summaryL.startsWith(evL)) return null;
  return summary;
}

function isAdvisoryPromoNoise(line: AdvisoryPromoLine): boolean {
  return line.id === "sp-weather-upgrades-soon";
}

/** Collapsed advisory line — CSS clamps to 2–3 lines when needed. */
function AdvisoryPreviewMessage({ raw }: { raw: string }) {
  return <span className="storm-advisory-bar__preview-text">{displayText(raw)}</span>;
}

export type StormRoadDetailRow = {
  label: string;
  text: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
};

export type StormStripBand = {
  id: string;
  event: string;
  severity: RouteImpactSeverity;
  startMeters: number;
  endMeters: number;
  expiresIso: string | null;
  /** NWS alert id (when matched) so the bar can wire a tap → alert detail handler. */
  alertId: string | null;
  /**
   * Whether the route actually crosses the polygon vs. just being within the NWS corridor
   * buffer (~45 km).  When false the strip shows "Nearby" instead of enter/exit timing.
   */
  crossesRoute?: boolean;
};

type SharedProps = {
  featureEnabled: boolean;
  sessionOn: boolean;
  onSessionToggle: (on: boolean) => void;
  loading: boolean;
  error: string | null;
  corridorAlerts: NormalizedWeatherAlert[];
  overlappingAlerts: NormalizedWeatherAlert[];
  /** Alerts whose polygon contains your position when the route line does not intersect (thin / sampling gaps). */
  nwsAtLocationAlerts: NormalizedWeatherAlert[];
  trafficDelayMinutes: number;
  onTrafficReroute?: () => void;
  trafficRerouteBusy?: boolean;
  roadDetailEnabled: boolean;
  onRoadDetailToggle: (on: boolean) => void;
  hasGuidanceRoute: boolean;
  roadDetailRows: StormRoadDetailRow[];
  /** Unified route impact list (already sorted nearest-first) — drives Weather + Roads sections. */
  routeImpacts?: RouteImpact[] | null;
  /** Pre-built route timeline — shared with progress strip / glance panel (advisory shows detail list only). */
  routeAheadTimeline?: TimelineItem[] | null;
  /** Severe / extreme NWS bands crossing the active route (Stage C). One strip rendered per band. */
  stormStripBands?: StormStripBand[] | null;
  /** Total length of the active leg (m) — required for storm strip percent placement. */
  routeTotalMeters?: number;
  /** Current along-route position of the user (m) — required for the YOU marker on the strip. */
  userAlongMeters?: number;
  /** Plan ETA (min) and live drive ETA (min) used to label "enter / exit in N min" on strip bands. */
  planEtaMinutes?: number | null;
  driveEtaMinutes?: number | null;
};

export type StormAdvisoryBarProps = SharedProps & {
  barExpanded: boolean;
  onBarExpandedChange: (expanded: boolean) => void;
  hideHeadToggles?: boolean;
  onNwsAlertClick?: (alert: NormalizedWeatherAlert) => void;
  /** Optional hazard status severity: drives the collapsed preview border color. */
  peekSeverity?: "none" | "info" | "warn" | "severe" | null;
  /** Short "doing something" label (NWS loading, traffic fetching…). Surfaced in preview. */
  busyLabel?: string | null;
  /** Shown when forecast data is stale / rate-limited — rotates into the collapsed preview strip. */
  staleWeatherNote?: string | null;
  /** Drive-mode route-ahead summary (radar tier + brief text). Surfaced in preview when driving. */
  driveRouteAheadLine?: DriveAheadLine | null;
  /** Plus: full NWS + road tools. Basic: life-safety NWS, connectivity, and promo rotation. */
  advisoryTier?: "plus" | "basic";
  /** Subscription/entitlement state for copy (distinct from current advisoryTier rendering mode). */
  ownsPlus?: boolean;
  promoLines?: AdvisoryPromoLine[];
  /** Browser / PWA online flag — surfaced for Basic. */
  isOnline?: boolean;
  /**
   * Basic (nav + radar only): keep the advisory strip for status and tips, but omit NWS/weather panels
   * and preview rotation that references forecasts, NWS loads, or hazard lists.
   */
  basicNavAdvisoryMode?: boolean;
  /** After Go: live traffic / corridor road data; before Go, copy explains preview vs live. */
  navigationStarted: boolean;
  /**
   * Compact "right now" weather string for the preview rotator (e.g.
   * `72°F · Wind 8 mph · Partly cloudy`). Provided by the App when an OpenWeather key is set
   * and we have a position; null otherwise. Always shown — works on both Plus and Basic so
   * drivers see a quick read of conditions at a glance.
   */
  nowcastLine?: string | null;
  /** OpenWeather snapshot at the user's position (expanded local forecast card). */
  currentNowcast?: CurrentNowcast | null;
  /** Human place label, e.g. "Springfield, IL". */
  forecastAreaLabel?: string | null;
  /** Tomorrow.io 60-minute minute-by-minute precip forecast at the user's location. */
  minutePrecipForecast?: MinutePrecipForecast | null;
  /** 24-hour hourly outlook at the user's position. */
  hourlyForecast?: PointHourlyForecast | null;
  /** NWS alerts merged for local forecast (corridor + near you + route context). */
  localForecastNwsAlerts?: NormalizedWeatherAlert[];
  nwsForecastLoading?: boolean;
  nwsForecastError?: string | null;
  /** Plus: suggest Data saver in About (rotator + expanded row until dismissed). */
  dataSaverHint?: {
    onOpenSettings: () => void;
    onDismiss: () => void;
  } | null;
  /** Basic: waiting on OpenWeather for the status-panel forecast. Plus: waiting on TIO/OpenWeather. */
  basicForecastLoading?: boolean;
  /** Basic: open About → Subscription from the Plus upsell card. */
  onOpenSubscription?: () => void;
  /** Basic status panel layout — partner banner slot, Plus upsell, SiteBible. */
  basicStatusPanelPromos?: BasicStatusPanelPromos | null;
};



/**
 * Bucket a {@link RouteImpact}'s category into one of the four advisory sections:
 *   "weather" → Weather along your route
 *   "road"    → Roads & hazards along your route
 *   "now"     → Surfaced separately (life-safety NWS at-location is added to NOW from the alert lists)
 */
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



/** Compact urgent chip — only for hazards that affect you now or very soon on route. */
function nwsChip(
  a: NormalizedWeatherAlert,
  timingLine: string,
  onClick: ((alert: NormalizedWeatherAlert) => void) | undefined,
  variant: "urgent" | "secondary"
): ReactNode {
  const sevClass =
    a.severity === "Extreme" || /tornado warning/i.test(a.event ?? "")
      ? "avoid"
      : a.severity === "Severe" || /warning/i.test(a.event ?? "")
        ? "serious"
        : a.severity === "Moderate"
          ? "caution"
          : "info";
  return (
    <li key={a.id}>
      <button
        type="button"
        className={`nws-chip nws-chip--${variant} nws-chip--${sevClass}`}
        onClick={() => onClick?.(a)}
        aria-label={`${a.event} — ${timingLine} — open details`}
      >
        <span className="nws-chip__dot" aria-hidden />
        <span className="nws-chip__text">
          <span className="nws-chip__label">{a.event}</span>
          {(() => {
            const detail = nwsChipDetailText(a);
            return detail ? <span className="nws-chip__detail">{detail}</span> : null;
          })()}
          {!GENERIC_NWS_CHIP_TIMING.has(timingLine) ? (
            <span className="nws-chip__timing">{timingLine}</span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

export function StormAdvisoryBar({
  featureEnabled,
  sessionOn,
  onSessionToggle,
  loading,
  error,
  corridorAlerts: _corridorAlerts,
  overlappingAlerts,
  nwsAtLocationAlerts,
  trafficDelayMinutes,
  onTrafficReroute,
  trafficRerouteBusy = false,
  roadDetailEnabled,
  onRoadDetailToggle,
  hasGuidanceRoute,
  roadDetailRows,
  routeImpacts = null,
  routeAheadTimeline = null,
  stormStripBands = null,
  routeTotalMeters = 0,
  userAlongMeters = 0,
  planEtaMinutes = null,
  driveEtaMinutes = null,
  barExpanded,
  onBarExpandedChange,
  hideHeadToggles = false,
  onNwsAlertClick,
  peekSeverity = null,
  busyLabel = null,
  staleWeatherNote = null,
  driveRouteAheadLine = null,
  advisoryTier = "plus",
  ownsPlus = false,
  promoLines = [],
  isOnline = true,
  basicNavAdvisoryMode = false,
  navigationStarted,
  nowcastLine = null,
  currentNowcast = null,
  forecastAreaLabel = null,
  minutePrecipForecast = null,
  hourlyForecast = null,
  localForecastNwsAlerts = [],
  nwsForecastLoading = false,
  nwsForecastError = null,
  dataSaverHint = null,
  basicForecastLoading = false,
  onOpenSubscription,
  basicStatusPanelPromos = null,
}: StormAdvisoryBarProps) {
  if (!featureEnabled) return null;

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

  /* Pull the "Better route" suggestion out of `roadDetailRows` so it can live in its own section
   * instead of being nested under Traffic & Corridor (single source of truth for route suggestions). */
  const betterRouteRow = useMemo(
    () => roadDetailRows.find((r) => r.label === "Better route"),
    [roadDetailRows]
  );
  const alongRouteDetailRows = useMemo(
    () => roadDetailRows.filter((r) => r.label !== "Better route"),
    [roadDetailRows]
  );
  /* Show ROADS when there are road impacts, traffic narrative rows, or a reroute CTA condition. */
  const hasTrafficStop = useMemo(
    () => roadDetailRows.some((r) => /traffic stop|closure/i.test(r.label)),
    [roadDetailRows]
  );
  const showRerouteCta =
    TRAFFIC_BYPASS_ENABLED &&
    (trafficDelayMinutes >= TRAFFIC_DELAY_ALERT_MINUTES || hasTrafficStop) &&
    Boolean(onTrafficReroute);
  const showTrafficDelayInfoOnly =
    !TRAFFIC_BYPASS_ENABLED &&
    (trafficDelayMinutes >= TRAFFIC_DELAY_ALERT_MINUTES || hasTrafficStop);

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
          crossesRoute: band.crossesRoute,
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
          crossesRoute: band.crossesRoute,
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
  const panelNwsAlertsExtra = useMemo(
    () => panelNwsAlerts.filter(({ alert }) => !timelineNwsAlertIds.has(alert.id)),
    [panelNwsAlerts, timelineNwsAlertIds]
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

  const tickerMessages = useMemo(() => {
    return urgentTopAlerts.map(({ alert: a, timingLine }) => {
      const g = nwsGlanceSummary(a);
      const base = g || (a.event?.trim() || "Weather alert");
      return {
        id: a.id,
        text: `${base} — ${timingLine}`,
        alert: a,
        badge: "Alert",
        tone: nwsAlertPreviewTone(a),
      };
    });
  }, [urgentTopAlerts]);
  const [tickerIdx, setTickerIdx] = useState(0);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [loadSlow, setLoadSlow] = useState(false);
  const showErrorState = Boolean(error?.trim());

  useEffect(() => {
    setTickerIdx(0);
  }, [tickerMessages.length]);
  useEffect(() => {
    if (!loading) {
      setLoadSlow(false);
      return;
    }
    const t = window.setTimeout(() => setLoadSlow(true), 12_000);
    return () => {
      clearTimeout(t);
    };
  }, [loading]);
  useEffect(() => {
    if (tickerMessages.length <= 1) return;
    const id = window.setInterval(() => {
      setTickerIdx((v) => (v + 1) % tickerMessages.length);
    }, 5500);
    return () => window.clearInterval(id);
  }, [tickerMessages.length]);

  const defaultPreviewText = basicNavAdvisoryMode
    ? "Status — tap for tips and offers."
    : advisoryTier === "basic"
      ? ownsPlus
        ? "No urgent warnings. Tap for details."
        : "No life-safety warnings here — tap for details"
      : "No hazards in view — tap for advisory";
  const activeTicker = tickerMessages[tickerIdx];

  const localForecastBanner = useMemo(() => {
    if (basicNavAdvisoryMode || !forecastAreaLabel) return null;
    return buildLocalForecastBannerItem({
      areaLabel: forecastAreaLabel,
      nowcastLine,
      minutePrecip: minutePrecipForecast,
      fetchedAtMs: latestForecastFetchedAtMs(
        currentNowcast?.fetchedAtMs,
        minutePrecipForecast?.fetchedAt
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

  const previewItems = useMemo(() => {
    if (basicNavAdvisoryMode) {
      const trip: AdvisoryPreviewItem[] = [];
      const promo: AdvisoryPreviewItem[] = [];

      if (!isOnline) {
        trip.push(
          previewItem({
            badge: "Offline",
            raw: bannerMsg("Offline — reconnect for map and radar."),
            tone: "warn",
          })
        );
      }
      if (hasGuidanceRoute) {
        trip.push(previewItem({ badge: "Nav", raw: bannerMsg("Route set — tap Go when ready.") }));
      }
      if (busyLabel && !barExpanded) {
        trip.push(previewItem({ badge: "Work", raw: bannerMsg(busyLabel) }));
      }
      if (staleWeatherNote && !barExpanded) {
        trip.push(previewItem({ badge: "Wx", raw: bannerMsg(staleWeatherNote), tone: "warn" }));
      }
      for (const p of promoLines) {
        if (isAdvisoryPromoNoise(p)) continue;
        promo.push(previewItem({ badge: "Info", raw: bannerMsg(displayText(p.text)) }));
      }

      let mixed = mixAdvisoryPreviewItems(trip, promo);
      if (mixed.length === 0) {
        mixed = [previewItem({ badge: null, raw: defaultPreviewText, tone: "clear" })];
      }
      return mixed;
    }

    const trip: AdvisoryPreviewItem[] = [];
    const promo: AdvisoryPreviewItem[] = [];

    if (!isOnline) {
      trip.push(
        previewItem({
          badge: "Offline",
          raw: bannerMsg("Offline — reconnect for map and advisories."),
          tone: "warn",
        })
      );
    }
    if (showErrorState && (error || "").trim()) {
      trip.push(
        previewItem({
          badge: "Error",
          raw: bannerMsg((error || "").trim(), 96),
          tone: "severe",
        })
      );
    }
    if (localForecastBanner) {
      trip.push(
        previewItem({
          ...localForecastBanner,
          tone: localForecastBannerTone(localForecastBanner, localForecastNwsAlerts),
        })
      );
    } else if (nowcastLine) {
      trip.push(
        previewItem({
          badge: "Now",
          raw: bannerMsg(nowcastLine),
          tone: conditionsLinePreviewTone(nowcastLine),
        })
      );
    }
    if (busyLabel && !barExpanded) {
      trip.push(previewItem({ badge: "Work", raw: bannerMsg(busyLabel) }));
    }
    if (staleWeatherNote && !barExpanded) {
      trip.push(previewItem({ badge: "Wx", raw: bannerMsg(staleWeatherNote), tone: "warn" }));
    }
    if (activeTicker) {
      trip.push(
        previewItem({
          badge: activeTicker.badge,
          raw: bannerMsg(activeTicker.text, BANNER_TICKER_MAX),
          tone: activeTicker.tone,
        })
      );
    }
    if (advisoryTier !== "basic" && trafficDelayMinutes >= 8) {
      trip.push(
        previewItem({
          badge: "Traffic",
          raw: bannerMsg(`Traffic +${formatMinutesAsHoursMinutes(trafficDelayMinutes)} on route`),
          tone: "warn",
        })
      );
    }
    const showDriveAheadPreview =
      advisoryTier !== "basic" &&
      driveRouteAheadLine &&
      !isDriveAheadInsideSegment(driveRouteAheadLine);
    if (showDriveAheadPreview) {
      trip.push(
        previewItem({
          badge: "Ahead",
          raw: bannerMsg(formatDriveAheadBrief(driveRouteAheadLine)),
          tone: driveAheadPreviewTone(driveRouteAheadLine.radarTier),
        })
      );
    }

    const hasRouteContext =
      Boolean(activeTicker) ||
      trafficDelayMinutes >= 8 ||
      Boolean(showDriveAheadPreview);
    promo.push(previewItem({ badge: "App", raw: SITEBIBLE_AD_BAR }));
    if (hasGuidanceRoute && !hasRouteContext) {
      trip.push(
        previewItem({
          badge: "Drive",
          raw: bannerMsg(
            navigationStarted ? "Route active — data updates while driving." : "Route set — tap Go for live data."
          ),
        })
      );
    }
    for (const p of promoLines) {
      if (p.id === "sitebible" || isAdvisoryPromoNoise(p)) continue;
      promo.push(previewItem({ badge: "Info", raw: bannerMsg(displayText(p.text)) }));
    }
    if (dataSaverHint) {
      promo.push(
        previewItem({
          badge: "Tip",
          raw: bannerMsg(DATA_SAVER_ADVISORY_TIP, BANNER_TICKER_MAX),
          tone: "info",
        })
      );
    }

    let mixed = mixAdvisoryPreviewItems(trip, promo);
    if (mixed.length === 0) {
      mixed = [previewItem({ badge: null, raw: defaultPreviewText, tone: "clear" })];
    }
    return mixed;
  }, [
    basicNavAdvisoryMode,
    isOnline,
    showErrorState,
    error,
    loading,
    loadSlow,
    hasGuidanceRoute,
    navigationStarted,
    busyLabel,
    staleWeatherNote,
    barExpanded,
    activeTicker,
    advisoryTier,
    trafficDelayMinutes,
    driveRouteAheadLine,
    promoLines,
    defaultPreviewText,
    nowcastLine,
    localForecastBanner,
    localForecastNwsAlerts,
    dataSaverHint,
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

  useEffect(() => {
    setPreviewIdx(0);
  }, [previewItems.length]);
  useEffect(() => {
    if (previewItems.length <= 1) return;
    const id = window.setInterval(() => {
      setPreviewIdx((v) => (v + 1) % previewItems.length);
    }, 10_000);
    return () => window.clearInterval(id);
  }, [previewItems.length]);

  /** Map DriveAhead radar tier into an advisory severity bucket. */
  const driveTierSev = (t: DriveAheadRadarTier | null | undefined): "none" | "info" | "warn" | "severe" => {
    if (t === "red") return "severe";
    if (t === "orange" || t === "yellow") return "warn";
    if (t === "green" || t === "blue") return "info";
    return "none";
  };

  /** Severity now derived from the worst rendered item only — no separate cascade.
   *  This keeps the border and the visible content from disagreeing. */
  const effectiveSeverity: "none" | "info" | "warn" | "severe" = useMemo(() => {
    if (peekSeverity) return peekSeverity;
    if (!isOnline) return "warn";
    if (showErrorState) return "severe";
    if (basicNavAdvisoryMode) {
      if (busyLabel) return "info";
      return "none";
    }
    /* Worst impact severity wins. */
    let worstSev: RouteImpactSeverity | null = null;
    const rank = (s: RouteImpactSeverity) =>
      s === "avoid" ? 4 : s === "serious" ? 3 : s === "caution" ? 2 : 1;
    for (const i of routeImpacts ?? []) {
      if (!worstSev || rank(i.severity) > rank(worstSev)) worstSev = i.severity;
    }
    if (worstSev === "avoid" || worstSev === "serious" || hasTrafficStop || urgentTopAlerts.length > 0) {
      return "severe";
    }
    if (worstSev === "caution" || trafficDelayMinutes >= 8 || urgentTopAlerts.length > 0) return "warn";
    if (driveTierSev(driveRouteAheadLine?.radarTier) === "severe") return "severe";
    if (driveTierSev(driveRouteAheadLine?.radarTier) === "warn") return "warn";
    if (staleWeatherNote) return "warn";
    if (loading) return loadSlow ? "warn" : "info";
    if (tickerMessages.length > 0) return "info";
    if (promoLines.length > 0) return "info";
    return "none";
  }, [
    peekSeverity,
    isOnline,
    showErrorState,
    basicNavAdvisoryMode,
    busyLabel,
    staleWeatherNote,
    routeImpacts,
    hasTrafficStop,
    trafficDelayMinutes,
    driveRouteAheadLine,
    tickerMessages.length,
    promoLines.length,
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

  const activePreview = previewItems[previewIdx % previewItems.length]!;
  const previewTone: AdvisoryPreviewTone = barExpanded ? "info" : activePreview.tone;

  /* Measure the preview button's bounding rect → CSS vars on documentElement. The expanded panel
   * is `position: fixed` and uses these vars for its top / left / right so the three edges align
   * perfectly with the collapsed preview behind it, regardless of the cluster's actual height.
   *
   * We also measure the bottom stack (.nav-bottom-stack — the destination / address bar plus any
   * compare cards above it) and set --storm-advisory-bottom-inset so the panel ends with a small
   * gap directly above whatever the bottom UI's topmost edge is. This auto-adjusts as the bottom
   * stack grows or shrinks (e.g. when a bypass-compare panel appears). */
  const previewBtnRef = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (!barExpanded) return;
    const el = previewBtnRef.current;
    if (!el) return;
    const bottomStack = document.querySelector<HTMLElement>(".nav-bottom-stack");
    const propagate = () => {
      const rect = el.getBoundingClientRect();
      const root = document.documentElement;
      root.style.setProperty("--storm-advisory-anchor-top", `${Math.round(rect.top)}px`);
      root.style.setProperty("--storm-advisory-anchor-left", `${Math.round(rect.left)}px`);
      root.style.setProperty(
        "--storm-advisory-anchor-right",
        `${Math.round(window.innerWidth - rect.right)}px`
      );
      if (bottomStack) {
        const bRect = bottomStack.getBoundingClientRect();
        /* +8px gap so the panel's bottom edge sits a hair above the toolbar, not flush against it.
         * Clamp between 40 px (rare display:none / zero-height case) and 40 % of viewport so the
         * panel never collapses past the preview height even if the measurement goes wonky. */
        const raw = Math.round(window.innerHeight - bRect.top + 8);
        const inset = Math.max(40, Math.min(raw, Math.round(window.innerHeight * 0.4)));
        root.style.setProperty("--storm-advisory-bottom-inset", `${inset}px`);
      }
    };
    propagate();
    /* Re-measure on viewport resize / orientation change. ResizeObserver covers content-driven
     * shifts (e.g. NWS list growing the preview button height, or the bottom stack expanding when
     * a compare/bypass panel slides in). */
    const ro = new ResizeObserver(propagate);
    ro.observe(el);
    if (bottomStack) ro.observe(bottomStack);
    window.addEventListener("resize", propagate);
    window.addEventListener("orientationchange", propagate);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", propagate);
      window.removeEventListener("orientationchange", propagate);
      /* Reset so any other consumer of the var falls back to the CSS default (60px) when
       * the panel closes. */
      document.documentElement.style.removeProperty("--storm-advisory-bottom-inset");
    };
  }, [barExpanded]);

  /* Wrapper anchor: keeps the preview row in flow at its natural position so it doesn't shift when
   * expansion toggles. The expanded panel renders as a viewport-anchored fixed sibling so it
   * overlays everything below (progress rail + map) instead of pushing the cluster's row 2 down. */
  return (
    <div className="storm-advisory-bar-anchor">
      <button
        ref={previewBtnRef}
        type="button"
        className={`storm-advisory-bar storm-advisory-bar--preview storm-advisory-bar--tone-${previewTone}${showErrorState && !barExpanded ? " storm-advisory-bar--err" : ""}${barExpanded ? " storm-advisory-bar--preview-active" : ""}`}
        id="storm-advisory-panel-toggle"
        aria-label={
          basicNavAdvisoryMode
            ? barExpanded
              ? "Close status bar"
              : "Status bar — connection and tips, tap to expand"
            : barExpanded
              ? "Close advisory"
              : "Advisory — weather, hazards, and road status (tap to expand)"
        }
        aria-expanded={barExpanded}
        aria-controls="storm-advisory-panel"
        onPointerDownCapture={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onBarExpandedChange(!barExpanded);
        }}
        title={barExpanded ? "Close advisory" : activePreview.raw}
      >
        <span
          className={`storm-advisory-bar__preview-message-wrap${
            !barExpanded && activePreview.localMeta ? " storm-advisory-bar__preview-message-wrap--forecast" : ""
          }`}
        >
          {barExpanded ? (
            <span className="storm-advisory-bar__preview-text" title="Close advisory">
              {basicNavAdvisoryMode ? "Status — tap to close ▲" : "Advisory — tap to close ▲"}
            </span>
          ) : (
            <>
              {activePreview.badge ? (
                <span className="storm-advisory-bar__preview-ticker-badge">{activePreview.badge}</span>
              ) : null}
              <span className="storm-advisory-bar__preview-stack">
                {activePreview.localMeta ? (
                  <span className="storm-advisory-bar__preview-local-inline">
                    {activePreview.localMeta.area}
                    {activePreview.localMeta.updated
                      ? ` · ${activePreview.localMeta.updated}`
                      : null}
                  </span>
                ) : null}
                <AdvisoryPreviewMessage raw={activePreview.raw} />
              </span>
            </>
          )}
        </span>
      </button>

      {!barExpanded ? null : (
        <div
          className={`storm-advisory-bar storm-advisory-bar--expanded storm-advisory-bar--sev-${effectiveSeverity}${showErrorState ? " storm-advisory-bar--err" : ""}`}
          id="storm-advisory-panel"
          role="region"
          aria-label={
            basicNavAdvisoryMode ? "Status bar — connection and tips" : "Advisory — weather, hazards, and road status"
          }
        >
          <div className="storm-advisory-bar__head">
        <div className="storm-advisory-bar__head-leading">
          <div className="storm-advisory-bar__head-title-stack">
            <span className="storm-advisory-bar__title">{basicNavAdvisoryMode ? "Status" : "Advisory"}</span>
            <div className="storm-advisory-bar__head-busy-slot" aria-live="polite">
              {busyLabel ? (
                <span className="storm-advisory-bar__head-busy">
                  <span className="storm-advisory-bar__head-busy-dot" aria-hidden />
                  {busyLabel}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        {!hideHeadToggles && (
          <div className="storm-advisory-bar__toggles storm-advisory-bar__toggles--stacked">
            <label className="storm-advisory-bar__toggle storm-advisory-bar__toggle--nws">
              <input type="checkbox" checked={sessionOn} onChange={(e) => onSessionToggle(e.target.checked)} />
              <span>NWS polygons</span>
            </label>
            <label className="storm-advisory-bar__toggle storm-advisory-bar__toggle--road">
              <input type="checkbox" checked={roadDetailEnabled} onChange={(e) => onRoadDetailToggle(e.target.checked)} />
              <span>Road impacts &amp; traffic</span>
            </label>
          </div>
        )}
        <button
          type="button"
          className="storm-advisory-bar__collapse-btn"
          onPointerDownCapture={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onBarExpandedChange(false);
          }}
          aria-expanded={true}
          aria-controls="storm-advisory-panel"
          title={basicNavAdvisoryMode ? "Close status bar" : "Close advisory"}
          aria-label={basicNavAdvisoryMode ? "Close status bar" : "Close advisory"}
        >
          <span className="storm-advisory-bar__collapse-icon storm-advisory-bar__collapse-icon--narrow">Done</span>
          <span className="storm-advisory-bar__collapse-icon storm-advisory-bar__collapse-icon--wide" aria-hidden>
            ◀
          </span>
        </button>
      </div>

      {basicNavAdvisoryMode && (
        <p className="storm-advisory-bar__muted storm-advisory-bar__basic-tier-desc">
          Local forecast at your position. Navigation and radar are on the map — upgrade for NWS hazards, traffic, and
          route weather.
        </p>
      )}

      {!isOnline && (
        <div
          className="storm-advisory-bar__basic-strip"
          aria-label={basicNavAdvisoryMode ? "Tips and connectivity note" : "Tips"}
        >
          <p className="storm-advisory-bar__offline-note" aria-live="polite">
            <strong>Offline</strong> — reconnect to refresh map tiles and advisories.
          </p>
        </div>
      )}

      <div className="storm-advisory-bar__sections-scroll">
        {forecastAreaLabel &&
        !basicNavAdvisoryMode &&
        (currentNowcast ||
          minutePrecipForecast ||
          hourlyForecast?.hours.length ||
          localForecastNwsAlerts.length > 0 ||
          nwsForecastLoading ||
          basicForecastLoading) ? (
          <AdvisoryLocalForecast
            areaLabel={forecastAreaLabel}
            nowcast={currentNowcast}
            minutePrecip={minutePrecipForecast}
            hourlyForecast={hourlyForecast}
            locationAlerts={localForecastNwsAlerts}
            nwsLoading={nwsForecastLoading}
            nwsError={nwsForecastError}
            onLocationAlertClick={onNwsAlertClick}
            variant="full"
            forecastLoading={basicForecastLoading}
          />
        ) : null}

        {/* Pre-Go hint surfaced once at the very top so it doesn't repeat across sections. */}
        {!navigationStarted && hasGuidanceRoute && !basicNavAdvisoryMode && (
          <p className="storm-advisory-bar__pre-go-hint" role="note">
            <strong>Tap Go</strong> for live traffic and ETA. Below: each warning shows how far down your route it is and
            whether it may end before you get there.
          </p>
        )}

        {!basicNavAdvisoryMode && urgentTopAlerts.length > 0 && (
          <ul className="nws-chips nws-chips--urgent" role="list" aria-label="Urgent weather affecting you now">
            {urgentTopAlerts.map(({ alert, timingLine }) =>
              nwsChip(alert, timingLine, onNwsAlertClick, "urgent")
            )}
          </ul>
        )}

        {!basicNavAdvisoryMode ? (
          <div className="storm-advisory-bar__dashboard">
            {navigationStarted && hasGuidanceRoute && alongRouteDetailRows.length > 0 ? (
              <div className="storm-advisory-bar__road-rows" role="list" aria-label="Along your route">
                {alongRouteDetailRows.map((row) => (
                  <div key={row.label} className="storm-advisory-bar__suggestion-row">
                    <span className="storm-advisory-bar__suggestion-label">{row.label}</span>
                    <span className="storm-advisory-bar__suggestion-text">{row.text}</span>
                    {row.onAction ? (
                      <button
                        type="button"
                        className="storm-advisory-bar__btn storm-advisory-bar__btn--traffic"
                        onClick={row.onAction}
                      >
                        {row.actionLabel ?? "Open"}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {hasRouteHazardDetail ? (
              <RouteHazardTimeline
                variant="legendOnly"
                items={advisoryRouteTimeline.filter((item) => !item.stripMuted)}
                totalMeters={routeTotalMeters}
                userAlongMeters={userAlongMeters}
                planEtaMinutes={planEtaMinutes}
                driveEtaMinutes={driveEtaMinutes}
                showRerouteCta={showRerouteCta}
                onReroute={onTrafficReroute}
                rerouteBusy={trafficRerouteBusy}
              />
            ) : null}

            {navigationStarted &&
            hasGuidanceRoute &&
            !hasRouteHazardDetail &&
            alongRouteDetailRows.length === 0 ? (
              <p className="storm-advisory-bar__muted storm-advisory-bar__route-clear" role="status">
                No hazards ahead on your route.
                {driveEtaMinutes != null && driveEtaMinutes > 0
                  ? ` About ${formatMinutesAsHoursMinutes(Math.round(driveEtaMinutes))} remaining.`
                  : null}
              </p>
            ) : null}

            {nwsStatusMessage ? (
              <p
                className={`storm-advisory-bar__nws-status${
                  nwsStatusMessage.tone === "warn" ? " storm-advisory-bar__nws-status--warn" : ""
                }`}
                aria-live="polite"
              >
                {nwsStatusMessage.text}
              </p>
            ) : null}

            {panelNwsAlertsExtra.length > 0 ? (
              <ul
                className="nws-chips nws-chips--secondary"
                role="list"
                aria-label="Weather alerts at your position (not already listed on your route)"
              >
                {panelNwsAlertsExtra.map(({ alert, timingLine }) =>
                  nwsChip(alert, timingLine, onNwsAlertClick, "secondary")
                )}
              </ul>
            ) : null}

            {betterRouteRow ? (
              <div className="storm-advisory-bar__suggestion-row">
                <span className="storm-advisory-bar__suggestion-label">{betterRouteRow.label}</span>
                <span className="storm-advisory-bar__suggestion-text">{betterRouteRow.text}</span>
                {betterRouteRow.onAction ? (
                  <button
                    type="button"
                    className="storm-advisory-bar__btn storm-advisory-bar__btn--traffic"
                    onClick={betterRouteRow.onAction}
                  >
                    {betterRouteRow.actionLabel ?? "Open"}
                  </button>
                ) : null}
              </div>
            ) : null}

            {showTrafficDelayInfoOnly && !hasRouteHazardDetail ? (
              <div className="storm-advisory-bar__suggestion-row">
                <span className="storm-advisory-bar__suggestion-label">Traffic</span>
                <span className="storm-advisory-bar__suggestion-text">
                  {trafficDelayMinutes >= TRAFFIC_DELAY_ALERT_MINUTES
                    ? `Heavy delay ahead (~${trafficDelayMinutes} min). Consider an alternate route when you can — in-app reroute isn't available yet.`
                    : "Slowdown or stoppage ahead on your route. Consider an alternate route when you can."}
                </span>
              </div>
            ) : null}

            {showRerouteCta && onTrafficReroute && !hasRouteHazardDetail ? (
              <div className="storm-advisory-bar__suggestion-row">
                <span className="storm-advisory-bar__suggestion-label">Traffic</span>
                <span className="storm-advisory-bar__suggestion-text">Heavy delay ahead on your route.</span>
                <button
                  type="button"
                  className="storm-advisory-bar__btn storm-advisory-bar__btn--traffic"
                  onClick={onTrafficReroute}
                  disabled={trafficRerouteBusy}
                >
                  {trafficRerouteBusy ? "Finding route…" : "Reroute around traffic"}
                </button>
              </div>
            ) : null}

            {dataSaverHint ? (
              <div
                className="storm-advisory-bar__suggestion-row storm-advisory-bar__suggestion-row--data-saver"
                role="note"
              >
                <span className="storm-advisory-bar__suggestion-label">Data saver</span>
                <span className="storm-advisory-bar__suggestion-text">{DATA_SAVER_ADVISORY_DETAIL}</span>
                <button
                  type="button"
                  className="storm-advisory-bar__btn storm-advisory-bar__btn--traffic"
                  onClick={dataSaverHint.onOpenSettings}
                >
                  About
                </button>
                <button
                  type="button"
                  className="storm-advisory-bar__suggestion-row-dismiss"
                  onClick={dataSaverHint.onDismiss}
                  aria-label="Dismiss data saver tip"
                  title="Dismiss"
                >
                  ×
                </button>
              </div>
            ) : null}

          </div>
        ) : null}

              {basicNavAdvisoryMode && basicStatusPanelPromos ? (
                <div
                  className="storm-advisory-bar__basic-promos"
                  aria-label="StormPath Plus and partner offers"
                >
                  <BasicStatusAdSlot line={basicStatusPanelPromos.partnerSlot} expanded />
                  <BasicAdStrip
                    lines={[basicStatusPanelPromos.plusUpsell]}
                    expanded
                    className="storm-advisory-bar__basic-strip storm-advisory-bar__basic-strip--plus"
                    aria-label="StormPath Plus upgrade"
                    onOpenSubscription={onOpenSubscription}
                  />
                  <BasicAdStrip
                    lines={[basicStatusPanelPromos.siteBible]}
                    expanded
                    className="storm-advisory-bar__basic-strip storm-advisory-bar__basic-strip--sitebible"
                    aria-label="SiteBible partner offer"
                    onOpenSubscription={onOpenSubscription}
                  />
                </div>
              ) : basicNavAdvisoryMode && expandedPromoLines.length > 0 ? (
                <BasicAdStrip
                  lines={expandedPromoLines}
                  expanded
                  aria-label="StormPath Plus and partner offers"
                  onOpenSubscription={onOpenSubscription}
                />
              ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
