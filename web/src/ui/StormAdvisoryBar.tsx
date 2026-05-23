import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SITEBIBLE_AD_BAR, type AdvisoryPromoLine } from "../config/advisoryPromo";
import { sortWeatherAlertsBySeverity, type NormalizedWeatherAlert } from "../weatherAlerts";
import { nwsAlertIsBasicEmergency } from "../weatherAlerts/basicEmergencyFilter";
import { nwsGlanceSummary } from "../weatherAlerts/nwsDriveSummary";
import type { DriveAheadLine, DriveAheadRadarTier } from "../nav/driveRouteAhead";
import { formatDriveAheadBrief, formatMinutesAsHoursMinutes } from "../nav/driveRouteAhead";
import {
  formatRouteAlertTiming,
  isAlertExpired,
  promoteAtPositionAlertToTop,
} from "../nav/routeAlertTiming";
import type { RouteImpact, RouteImpactSeverity } from "../nav/routeImpacts";
import { RouteHazardTimeline, impactToTimelineItem } from "./RouteHazardTimeline";
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

const BANNER_MSG_MAX = 72;
const BANNER_TICKER_MAX = 80;

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

/** Collapsed advisory line — clamped in CSS to avoid a tall bar. */
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
  /** Hazards-button rollup count (NWS overlaps + at-location); null = hide. */
  peekBadge?: number | null;
  /** Optional hazard status severity: drives the collapsed preview border color. */
  peekSeverity?: "none" | "info" | "warn" | "severe" | null;
  /** Short "doing something" label (NWS loading, traffic fetching…). Surfaced in preview. */
  busyLabel?: string | null;
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
  /** Open full corridor forecast sheet (route-tied timeline). */
  onOpenCorridorForecast?: () => void;
  /** Plus: suggest Data saver in About (rotator + expanded row until dismissed). */
  dataSaverHint?: {
    onOpenSettings: () => void;
    onDismiss: () => void;
  } | null;
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
      : a.severity === "Severe"
        ? "serious"
        : "caution";
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
          <span className="nws-chip__timing">{timingLine}</span>
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
  corridorAlerts,
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
  stormStripBands = null,
  routeTotalMeters = 0,
  userAlongMeters = 0,
  planEtaMinutes = null,
  driveEtaMinutes = null,
  barExpanded,
  onBarExpandedChange,
  hideHeadToggles = false,
  onNwsAlertClick,
  peekBadge = null,
  peekSeverity = null,
  busyLabel = null,
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
  onOpenCorridorForecast,
  dataSaverHint = null,
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

  /* Split weather into radar, Tomorrow.io forecast, vs other (NWS handled separately). */
  const radarImpacts = useMemo(
    () => allWeatherImpacts.filter((i) => i.source === "radar"),
    [allWeatherImpacts]
  );
  const forecastImpacts = useMemo(
    () => allWeatherImpacts.filter((i) => i.source === "tomorrowIo"),
    [allWeatherImpacts]
  );
  const weatherImpacts = allWeatherImpacts; // kept for hasWeather gate

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
  /* Traffic narrative rows live in ROADS (not duplicated in any other section). */
  const trafficNarrativeRows = useMemo(
    () => roadDetailRows.filter((r) => r.label !== "Better route"),
    [roadDetailRows]
  );

  /* Show WEATHER when there are weather impacts, storm strips, non-urgent at-location alerts,
   * or we're loading weather data. The at-location entry covers the "Wind Advisory at your
   * position" case, which previously had no panel surface. */
  const hasWeather =
    weatherImpacts.length > 0 ||
    (stormStripBands?.length ?? 0) > 0 ||
    atLocationOther.length > 0 ||
    crossingOther.length > 0; // fallback when route length unavailable so strips can't render

  /* Show ROADS when there are road impacts, traffic narrative rows, or a reroute CTA condition. */
  const hasTrafficStop = useMemo(
    () => roadDetailRows.some((r) => /traffic stop|closure/i.test(r.label)),
    [roadDetailRows]
  );
  const showRerouteCta = (trafficDelayMinutes >= 10 || hasTrafficStop) && Boolean(onTrafficReroute);
  const hasRoads =
    roadImpacts.length > 0 || trafficNarrativeRows.length > 0 || showRerouteCta;
  const hasSuggestion = Boolean(betterRouteRow) || (showRerouteCta && !roadDetailEnabled);

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

  /* Single, clear NWS status note when the panel has no NWS rows yet. */
  const nwsStatusMessage: { tone: "muted" | "warn"; text: string } | null = useMemo(() => {
    if (
      weatherImpacts.length > 0 ||
      (stormStripBands?.length ?? 0) > 0 ||
      atLocationSorted.length > 0 ||
      panelNwsAlerts.length > 0 ||
      urgentTopAlerts.length > 0
    ) {
      return null;
    }
    if (!isOnline) {
      return {
        tone: "warn",
        text: "NWS · Offline — alerts will refresh once you're back online.",
      };
    }
    const errMsg = (error ?? "").trim();
    if (errMsg) {
      return {
        tone: "warn",
        text: "NWS · Couldn't reach api.weather.gov. Try again in a moment.",
      };
    }
    if (loading) {
      return {
        tone: "muted",
        text:
          !navigationStarted && hasGuidanceRoute
            ? "NWS · Loading alerts for your planned route…"
            : "NWS · Loading active alerts near you…",
      };
    }
    if (!hasGuidanceRoute) {
      return corridorAlerts.length === 0
        ? {
            tone: "muted",
            text: "NWS · No active alerts near your position right now. Skies look clear.",
          }
        : {
            tone: "muted",
            text: `NWS · ${corridorAlerts.length} active alert${
              corridorAlerts.length === 1 ? "" : "s"
            } nearby — add a route to see which ones might cross it.`,
          };
    }
    if (corridorAlerts.length === 0) {
      return {
        tone: "muted",
        text: "NWS · No active alerts in this area right now. Looks like a nice day to drive.",
      };
    }
    return null;
  }, [
    weatherImpacts.length,
    stormStripBands,
    atLocationSorted.length,
    panelNwsAlerts.length,
    urgentTopAlerts.length,
    isOnline,
    error,
    loading,
    navigationStarted,
    hasGuidanceRoute,
    corridorAlerts.length,
  ]);

  const hasNow = urgentTopAlerts.length > 0;

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
    ? "Status bar — tap for connection, tips, and Plus info (no weather alerts on Basic)."
    : advisoryTier === "basic"
      ? ownsPlus
        ? "No urgent warnings. Tap for details."
        : "No life-safety warnings here — tap for details"
      : "No hazards in view — tap for advisory";
  const activeTicker = tickerMessages[tickerIdx];

  const localForecastBanner = useMemo(() => {
    if (!forecastAreaLabel) return null;
    return buildLocalForecastBannerItem({
      areaLabel: forecastAreaLabel,
      nowcastLine,
      minutePrecip: minutePrecipForecast,
      fetchedAtMs: latestForecastFetchedAtMs(
        currentNowcast?.fetchedAtMs,
        minutePrecipForecast?.fetchedAt
      ),
      nwsNearYou: localForecastNwsAlerts.length ? localForecastNwsAlerts : null,
    });
  }, [
    forecastAreaLabel,
    nowcastLine,
    minutePrecipForecast,
    currentNowcast?.fetchedAtMs,
    localForecastNwsAlerts,
  ]);

  const previewItems = useMemo(() => {
    if (basicNavAdvisoryMode) {
      const out: AdvisoryPreviewItem[] = [];
      if (!isOnline) {
        out.push(
          previewItem({
            badge: "Offline",
            raw: bannerMsg("Offline — reconnect for map and radar."),
            tone: "warn",
          })
        );
      }
      if (localForecastBanner) {
        out.push(
          previewItem({
            ...localForecastBanner,
            tone: localForecastBannerTone(localForecastBanner, localForecastNwsAlerts),
          })
        );
      } else if (nowcastLine) {
        out.push(
          previewItem({
            badge: "Now",
            raw: bannerMsg(nowcastLine),
            tone: conditionsLinePreviewTone(nowcastLine),
          })
        );
      } else {
        /* If weather is temporarily unavailable, keep the first visible fallback useful instead
         * of leading with the generic route-status line. */
        out.push(previewItem({ badge: "App", raw: SITEBIBLE_AD_BAR }));
      }
      if (hasGuidanceRoute) {
        out.push(previewItem({ badge: "Nav", raw: bannerMsg("Route set — tap Go when ready.") }));
      }
      if (busyLabel) out.push(previewItem({ badge: "Work", raw: bannerMsg(busyLabel) }));
      for (const p of promoLines) {
        if (!localForecastBanner && !nowcastLine && p.id === "sitebible") continue;
        out.push(previewItem({ badge: "Info", raw: bannerMsg(displayText(p.text)) }));
      }
      if (out.length === 0) out.push(previewItem({ badge: null, raw: defaultPreviewText, tone: "clear" }));
      return out;
    }
    /* Plus rotator: substantive items first (offline / error / Now / loading / busy / ticker /
     * traffic / ahead) so any real condition is the first thing a driver sees. App-promo and
     * filler content are appended at the END so they still cycle in over a long session, but
     * never crowd ahead of a hazard or current-conditions reading. */
    const out: AdvisoryPreviewItem[] = [];
    if (!isOnline) {
      out.push(
        previewItem({
          badge: "Offline",
          raw: bannerMsg("Offline — reconnect for map and advisories."),
          tone: "warn",
        })
      );
    }
    if (showErrorState && (error || "").trim()) {
      out.push(
        previewItem({
          badge: "Error",
          raw: bannerMsg((error || "").trim(), 96),
          tone: "severe",
        })
      );
    }
    if (localForecastBanner) {
      out.push(
        previewItem({
          ...localForecastBanner,
          tone: localForecastBannerTone(localForecastBanner, localForecastNwsAlerts),
        })
      );
    } else if (nowcastLine) {
      out.push(
        previewItem({
          badge: "Now",
          raw: bannerMsg(nowcastLine),
          tone: conditionsLinePreviewTone(nowcastLine),
        })
      );
    }
    if (loading) {
      if (!navigationStarted && hasGuidanceRoute) {
        out.push(
          previewItem({
            badge: "Plan",
            raw: bannerMsg(
              loadSlow ? "Still loading NWS for route…" : "Loading NWS for planned route…"
            ),
            tone: loadSlow ? "warn" : "info",
          })
        );
      } else {
        out.push(
          previewItem({
            badge: "Load",
            raw: bannerMsg(navigationStarted ? "Loading alerts…" : "Loading…"),
            tone: loadSlow ? "warn" : "info",
          })
        );
      }
    }
    if (busyLabel) {
      out.push(previewItem({ badge: "Work", raw: bannerMsg(busyLabel) }));
    }
    if (activeTicker) {
      out.push(
        previewItem({
          badge: activeTicker.badge,
          raw: bannerMsg(activeTicker.text, BANNER_TICKER_MAX),
          tone: activeTicker.tone,
        })
      );
    }
    if (advisoryTier !== "basic" && trafficDelayMinutes >= 8) {
      out.push(
        previewItem({
          badge: "Traffic",
          raw: bannerMsg(`Traffic +${formatMinutesAsHoursMinutes(trafficDelayMinutes)} on route`),
          tone: "warn",
        })
      );
    }
    if (advisoryTier !== "basic" && driveRouteAheadLine) {
      out.push(
        previewItem({
          badge: "Ahead",
          raw: bannerMsg(formatDriveAheadBrief(driveRouteAheadLine)),
          tone: driveAheadPreviewTone(driveRouteAheadLine.radarTier),
        })
      );
    }
    /* Filler / promo tail. Always present in the rotation so the SiteBible blurb and the route-
     * status hint show up over time, but appended after substantive items so they never pre-empt
     * a hazard or "Now" line. The "Drive" hint is only shown when there is no active ticker /
     * traffic / ahead — once those exist, the user already knows the route is set. */
    const hasRouteContext =
      Boolean(activeTicker) || trafficDelayMinutes >= 8 || Boolean(driveRouteAheadLine);
    out.push(previewItem({ badge: "App", raw: SITEBIBLE_AD_BAR }));
    if (hasGuidanceRoute && !hasRouteContext) {
      out.push(
        previewItem({
          badge: "Drive",
          raw: bannerMsg(
            navigationStarted ? "Route active — data updates while driving." : "Route set — tap Go for live data."
          ),
        })
      );
    }
    for (const p of promoLines) {
      if (p.id === "sitebible") continue;
      out.push(previewItem({ badge: "Info", raw: bannerMsg(displayText(p.text)) }));
    }
    if (dataSaverHint) {
      out.push(
        previewItem({
          badge: "Tip",
          raw: bannerMsg(DATA_SAVER_ADVISORY_TIP, BANNER_TICKER_MAX),
          tone: "info",
        })
      );
    }
    if (out.length === 0) out.push(previewItem({ badge: null, raw: defaultPreviewText, tone: "clear" }));
    return out;
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
      if (loading) return loadSlow ? "warn" : "info";
      if (busyLabel) return "info";
      if (urgentTopAlerts.length > 0) return "severe";
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
    if (loading) return loadSlow ? "warn" : "info";
    if (tickerMessages.length > 0) return "info";
    if (promoLines.length > 0) return "info";
    return "none";
  }, [
    peekSeverity,
    isOnline,
    showErrorState,
    basicNavAdvisoryMode,
    loading,
    loadSlow,
    busyLabel,
    urgentTopAlerts.length,
    routeImpacts,
    hasTrafficStop,
    trafficDelayMinutes,
    driveRouteAheadLine,
    tickerMessages.length,
    promoLines.length,
  ]);

  /* All NWS alerts available for band enrichment. */
  const allAlerts = useMemo(
    () => [...overlappingAlerts, ...nwsAtLocationAlerts],
    [overlappingAlerts, nwsAtLocationAlerts]
  );

  /* Resolve a band's onClick and extra info by looking up the matching alert by id. */
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
            {peekBadge != null && peekBadge > 0 && (
              <span
                className="storm-advisory-bar__head-badge"
                aria-label={`${peekBadge} active hazards`}
                title={`${peekBadge} active hazards`}
              >
                {peekBadge}
              </span>
            )}
          </div>
        </div>
        {onOpenCorridorForecast && !basicNavAdvisoryMode && hasGuidanceRoute ? (
          <button
            type="button"
            className="storm-advisory-bar__forecast-btn"
            onPointerDownCapture={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenCorridorForecast();
            }}
          >
            Route forecast
          </button>
        ) : null}
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
          Connection status and tips. Use the map <strong>Rad</strong> control for radar.
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

      {busyLabel && (
        <div className="storm-advisory-bar__now-row" aria-live="polite">
          <span className="storm-advisory-bar__now-chip storm-advisory-bar__now-chip--busy">
            <span className="storm-advisory-bar__now-dot" aria-hidden />
            {busyLabel}
          </span>
        </div>
      )}

      <div className="storm-advisory-bar__sections-scroll">
        {forecastAreaLabel &&
        (currentNowcast ||
          minutePrecipForecast ||
          hourlyForecast?.hours.length ||
          localForecastNwsAlerts.length > 0 ||
          nwsForecastLoading) ? (
          <AdvisoryLocalForecast
            areaLabel={forecastAreaLabel}
            nowcast={currentNowcast}
            minutePrecip={minutePrecipForecast}
            hourlyForecast={hourlyForecast}
            locationAlerts={localForecastNwsAlerts}
            nwsLoading={nwsForecastLoading}
            nwsError={nwsForecastError}
            onLocationAlertClick={onNwsAlertClick}
          />
        ) : null}

        {/* Pre-Go hint surfaced once at the very top so it doesn't repeat across sections. */}
        {!navigationStarted && hasGuidanceRoute && !basicNavAdvisoryMode && (
          <p className="storm-advisory-bar__pre-go-hint" role="note">
            <strong>Tap Go</strong> for live traffic and ETA. Below: each warning shows how far down your route it is and
            whether it may end before you get there.
          </p>
        )}

        {urgentTopAlerts.length > 0 && (
          <ul className="nws-chips nws-chips--urgent" role="list" aria-label="Urgent weather affecting you now">
            {urgentTopAlerts.map(({ alert, timingLine }) =>
              nwsChip(alert, timingLine, onNwsAlertClick, "urgent")
            )}
          </ul>
        )}

        {/* ───── UNIFIED ROUTE HAZARD TIMELINE ───────────────────────────────────
         *  A single Gantt-style graph where the route is the x-axis and every
         *  hazard category (NWS, Radar, Road) is its own labeled track.
         *  A shared YOU line moves left→right as the driver progresses; storm
         *  bands shift as NWS updates arrive.  All timing, distances, and
         *  context are in the legend rows below the graph.
         * ─────────────────────────────────────────────────────────────────────── */}
        {!basicNavAdvisoryMode && (() => {
          /* Build unified item list combining NWS strip bands + radar + road impacts. */
          const timelineItems: TimelineItem[] = [];

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
              timelineItems.push({
                id: band.id,
                track: "nws",
                label: band.event,
                severity: band.severity,
                startMeters: band.startMeters,
                endMeters: band.endMeters,
                detailLine: extra.detail ?? null,
                expiresIso: band.expiresIso,
                crossesRoute: band.crossesRoute !== false,
                onClick: stripBandClick(band),
              });
            }
          }

          const pushIfActive = (imp: (typeof radarImpacts)[number]) => {
            if (imp.endMeters <= userAlongMeters) return;
            timelineItems.push(impactToTimelineItem(imp));
          };
          for (const imp of radarImpacts) pushIfActive(imp);
          for (const imp of forecastImpacts) pushIfActive(imp);
          for (const imp of roadImpacts) pushIfActive(imp);

          const hasTimeline = timelineItems.length > 0 && routeTotalMeters > 0;

          return (
            <div className="storm-advisory-bar__dashboard">
              {/* ── Unified timeline ── */}
              {hasTimeline && (
                <RouteHazardTimeline
                  items={timelineItems}
                  totalMeters={routeTotalMeters}
                  userAlongMeters={userAlongMeters}
                  planEtaMinutes={planEtaMinutes}
                  driveEtaMinutes={driveEtaMinutes}
                  showRerouteCta={showRerouteCta}
                  onReroute={onTrafficReroute}
                  rerouteBusy={trafficRerouteBusy}
                />
              )}

              {/* NWS status note — when nothing is visible yet */}
              {nwsStatusMessage && (
                <p
                  className={`storm-advisory-bar__nws-status${
                    nwsStatusMessage.tone === "warn" ? " storm-advisory-bar__nws-status--warn" : ""
                  }`}
                  aria-live="polite"
                >
                  {nwsStatusMessage.text}
                </p>
              )}

              {panelNwsAlerts.length > 0 && (
                <ul
                  className="nws-chips nws-chips--secondary"
                  role="list"
                  aria-label="Weather alerts at your position or on your route"
                >
                  {panelNwsAlerts.map(({ alert, timingLine }) =>
                    nwsChip(alert, timingLine, onNwsAlertClick, "secondary")
                  )}
                </ul>
              )}

              {/* Better route suggestion */}
              {betterRouteRow && (
                <div className="storm-advisory-bar__suggestion-row">
                  <span className="storm-advisory-bar__suggestion-label">{betterRouteRow.label}</span>
                  <span className="storm-advisory-bar__suggestion-text">{betterRouteRow.text}</span>
                  {betterRouteRow.onAction && (
                    <button
                      type="button"
                      className="storm-advisory-bar__btn storm-advisory-bar__btn--traffic"
                      onClick={betterRouteRow.onAction}
                    >
                      {betterRouteRow.actionLabel ?? "Open"}
                    </button>
                  )}
                </div>
              )}

              {dataSaverHint && (
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
              )}

              {advisoryTier === "plus" && !sessionOn && !loading && (stormStripBands?.length ?? 0) === 0 && (
                <p className="storm-advisory-bar__muted storm-advisory-bar__section-hint">
                  Turn on <strong>NWS polygons</strong> above for shaded zones on the map.
                </p>
              )}

              {basicNavAdvisoryMode === false && advisoryTier === "basic" &&
                weatherImpacts.length === 0 && roadImpacts.length === 0 && !loading && (
                <p className="storm-advisory-bar__muted storm-advisory-bar__basic-upsell">
                  {ownsPlus
                    ? <>Turn on <strong>NWS polygons</strong> and <strong>Road impacts</strong> for full data.</>
                    : <>Basic shows the most urgent products. <strong>Plus</strong> adds full NWS and road tools.</>}
                </p>
              )}

              {!hasNow &&
                !hasWeather &&
                !hasRoads &&
                !hasSuggestion &&
                !loading &&
                !(
                  forecastAreaLabel &&
                  (currentNowcast ||
                    minutePrecipForecast ||
                    hourlyForecast?.hours.length ||
                    localForecastNwsAlerts.length > 0 ||
                    nwsForecastLoading)
                ) && (
                <p className="storm-advisory-bar__muted storm-advisory-bar__section-status">
                  {hasGuidanceRoute
                    ? "No advisories on your route right now."
                    : forecastAreaLabel
                      ? "Local weather is shown above. Set a destination for route hazards and corridor forecast."
                      : "Allow location to see weather at your position."}
                </p>
              )}
            </div>
          );
        })()}
          </div>
        </div>
      )}
    </div>
  );
}
