import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { type AdvisoryPromoLine, type BasicStatusPanelPromos } from "../config/basicAds";
import { isAdvisoryPromoNoise, mixAdvisoryPreviewItems } from "./advisoryPreviewMix";
import type { NormalizedWeatherAlert } from "../weatherAlerts";
import { nwsGlanceSummary } from "../weatherAlerts/nwsDriveSummary";
import type { DriveAheadLine, DriveAheadRadarTier } from "../nav/driveRouteAhead";
import type { CorridorTimingExplainLine } from "../nav/corridorTimingExplain";
import type { PassengerAdvisoryLine } from "../nav/passengerAdvisory";
import {
  formatDriveAheadBrief,
  formatMinutesAsHoursMinutes,
  isDriveAheadInsideSegment,
} from "../nav/driveRouteAhead";
import type { RouteImpact, RouteImpactSeverity } from "../nav/routeImpacts";
import type { TimelineItem } from "./RouteHazardTimeline";
import type { MinutePrecipForecast, PointDailyForecast, PointHourlyForecast } from "../services/tomorrowIo";
import type { CurrentNowcast } from "../services/openWeatherClient";
import { displayText } from "../utils/displayText";
import { DATA_SAVER_ADVISORY_TIP } from "../utils/dataSaver";
import { AdvisoryExpandedSections } from "./AdvisoryExpandedSections";
import { useAdvisoryExpandedModel } from "./advisoryExpandedModel";

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
  if (b === "timing" || b === "wx") return "info";
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

function bannerMsg(text: string): string {
  return displayText(text);
}


/** Collapsed advisory line — full message wraps; never ellipsis-truncated. */
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
  onsetIso?: string | null;
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
  /** Read-only: About → NWS setting (status chip in hazards panel). */
  sessionOn: boolean;
  loading: boolean;
  error: string | null;
  corridorAlerts: NormalizedWeatherAlert[];
  overlappingAlerts: NormalizedWeatherAlert[];
  /** Alerts whose polygon contains your position when the route line does not intersect (thin / sampling gaps). */
  nwsAtLocationAlerts: NormalizedWeatherAlert[];
  trafficDelayMinutes: number;
  onTrafficReroute?: () => void;
  trafficRerouteBusy?: boolean;
  /** Read-only: About → Road impacts & traffic setting (status chip in hazards panel). */
  roadDetailEnabled: boolean;
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
  onNwsAlertClick?: (alert: NormalizedWeatherAlert) => void;
  /** Optional hazard status severity: drives the collapsed preview border color. */
  peekSeverity?: "none" | "info" | "warn" | "severe" | null;
  /** Short "doing something" label (NWS loading, traffic fetching…). Surfaced in preview. */
  busyLabel?: string | null;
  /** Shown when forecast data is stale / rate-limited — rotates into the collapsed preview strip. */
  staleWeatherNote?: string | null;
  /** Called when the user taps "Refresh Weather" from the stale-data banner. */
  onRefreshWeather?: (() => void) | null;
  /** Drive-mode route-ahead summary (radar tier + brief text). Surfaced in preview when driving. */
  driveRouteAheadLine?: DriveAheadLine | null;
  /** Nearest hazard likely to matter at your ETA along the route. */
  nextHazardAtEtaLine?: string | null;
  /** Now-map vs ETA corridor timing explain lines (collapsed ticker only). */
  corridorTimingLines?: CorridorTimingExplainLine[];
  /** Plus: full NWS + road tools. Basic: life-safety NWS, connectivity, and promo rotation. */
  advisoryTier?: "plus" | "basic";
  /** Subscription/entitlement state for copy (distinct from current advisoryTier rendering mode). */
  ownsPlus?: boolean;
  promoLines?: AdvisoryPromoLine[];
  /** Browser / PWA online flag — surfaced for Basic. */
  isOnline?: boolean;
  /** Radio is up but the map host is not answering, or the drive is holding last-good tiles. */
  dataLow?: boolean;
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
  /** One departure or pull-off suggestion. Local forecast and the opened panels stay as they are. */
  passengerLine?: PassengerAdvisoryLine | null;
  /** Sparse Mapbox POI tip while navigating (low priority in the rotator). */
  nearbyPoiTipLine?: string | null;
  /** OpenWeather snapshot at the user's position (expanded local forecast card). */
  currentNowcast?: CurrentNowcast | null;
  /** Human place label, e.g. "Springfield, IL". */
  forecastAreaLabel?: string | null;
  /** Tomorrow.io 60-minute minute-by-minute precip forecast at the user's location. */
  minutePrecipForecast?: MinutePrecipForecast | null;
  /** 24-hour hourly outlook at the user's position. */
  hourlyForecast?: PointHourlyForecast | null;
  /** Multi-day outlook (WeatherKit forecastDaily). */
  dailyForecast?: PointDailyForecast | null;
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
  /** When true, local forecast UI labels WeatherKit as primary provider. */
  weatherKitPrimary?: boolean;
  /** User position for local forecast night shading. */
  forecastLngLat?: [number, number] | null;
  /** Basic: open About → Subscription from the Plus upsell card. */
  onOpenSubscription?: () => void;
  /** Basic status panel layout — partner banner slot + Plus upsell. */
  basicStatusPanelPromos?: BasicStatusPanelPromos | null;
};



export function StormAdvisoryBar(props: StormAdvisoryBarProps) {
  const {
    featureEnabled,
    loading,
    error,
    trafficDelayMinutes,
    hasGuidanceRoute,
    routeImpacts = null,
    barExpanded,
    onBarExpandedChange,
    peekSeverity = null,
    busyLabel = null,
    staleWeatherNote = null,
    onRefreshWeather = null,
    driveRouteAheadLine = null,
    nextHazardAtEtaLine = null,
    corridorTimingLines = [],
    advisoryTier = "plus",
    ownsPlus = false,
    promoLines = [],
    isOnline = true,
    dataLow = false,
    basicNavAdvisoryMode = false,
    navigationStarted,
    nowcastLine = null,
    passengerLine = null,
    nearbyPoiTipLine = null,
    localForecastNwsAlerts = [],
    dataSaverHint = null,
  } = props;

  const model = useAdvisoryExpandedModel(props);

  if (!featureEnabled) return null;

  const tickerMessages = useMemo(() => {
    return model.urgentTopAlerts.map(({ alert: a, timingLine }) => {
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
  }, [model.urgentTopAlerts]);
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

  const localForecastBanner = model.localForecastBanner;

  const previewItems = useMemo(() => {
    if (basicNavAdvisoryMode) {
      const trip: AdvisoryPreviewItem[] = [];
      const promo: AdvisoryPreviewItem[] = [];

      if (!isOnline || dataLow) {
        trip.push(
          previewItem({
            badge: "Data",
            raw: bannerMsg(
              "Data is low. Find better cell coverage or Wi-Fi for accurate performance."
            ),
            tone: "warn",
          })
        );
      }
      if (localForecastBanner) {
        trip.push(
          previewItem({
            ...localForecastBanner,
            tone: localForecastBannerTone(localForecastBanner, []),
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
      /* Pre-Go only — never after navigation has started. */
      if (hasGuidanceRoute && !navigationStarted) {
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
      if (nearbyPoiTipLine?.trim()) {
        promo.push(
          previewItem({
            badge: "Nearby",
            raw: bannerMsg(nearbyPoiTipLine.trim()),
            tone: "info",
          })
        );
      }
      if (passengerLine) {
        trip.push(
          previewItem({
            badge: passengerLine.badge,
            raw: bannerMsg(passengerLine.text),
            tone: "warn",
          })
        );
      }

      let mixed = mixAdvisoryPreviewItems(trip, promo);
      if (mixed.length === 0) {
        mixed = [previewItem({ badge: null, raw: defaultPreviewText, tone: "clear" })];
      }
      return mixed;
    }

    const trip: AdvisoryPreviewItem[] = [];
    const promo: AdvisoryPreviewItem[] = [];

    if (!isOnline || dataLow) {
      trip.push(
        previewItem({
          badge: "Data",
          raw: bannerMsg(
            "Data is low. Find better cell coverage or Wi-Fi for accurate performance."
          ),
          tone: "warn",
        })
      );
    }
    if (showErrorState && (error || "").trim()) {
      trip.push(
        previewItem({
          badge: "Error",
          raw: bannerMsg((error || "").trim()),
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
          raw: displayText(activeTicker.text),
          tone: activeTicker.tone,
        })
      );
    }
    for (const timingLine of corridorTimingLines) {
      const raw = timingLine.text?.trim();
      if (!raw) continue;
      trip.push(
        previewItem({
          badge: timingLine.badge,
          raw: bannerMsg(raw),
          tone: timingLine.tone,
        })
      );
    }
    if (nextHazardAtEtaLine?.trim()) {
      trip.push(
        previewItem({
          badge: "Route",
          raw: bannerMsg(nextHazardAtEtaLine),
          tone: "warn",
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
      Boolean(nextHazardAtEtaLine?.trim()) ||
      corridorTimingLines.some((l) => l.text?.trim()) ||
      trafficDelayMinutes >= 8 ||
      Boolean(showDriveAheadPreview);
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
      if (isAdvisoryPromoNoise(p)) continue;
      promo.push(previewItem({ badge: "Info", raw: bannerMsg(displayText(p.text)) }));
    }
    if (dataSaverHint) {
      promo.push(
        previewItem({
          badge: "Tip",
          raw: bannerMsg(DATA_SAVER_ADVISORY_TIP),
          tone: "info",
        })
      );
    }
    if (nearbyPoiTipLine?.trim()) {
      promo.push(
        previewItem({
          badge: "Nearby",
          raw: bannerMsg(nearbyPoiTipLine.trim()),
          tone: "info",
        })
      );
    }
    if (passengerLine) {
      trip.push(
        previewItem({
          badge: passengerLine.badge,
          raw: bannerMsg(passengerLine.text),
          tone: "warn",
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
    dataLow,
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
    nextHazardAtEtaLine,
    corridorTimingLines,
    promoLines,
    defaultPreviewText,
    nowcastLine,
    passengerLine,
    nearbyPoiTipLine,
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
    if (worstSev === "avoid" || worstSev === "serious" || model.hasTrafficStop || model.urgentTopAlerts.length > 0) {
      return "severe";
    }
    if (worstSev === "caution" || trafficDelayMinutes >= 8 || model.urgentTopAlerts.length > 0) return "warn";
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
    model.hasTrafficStop,
    model.urgentTopAlerts,
    trafficDelayMinutes,
    driveRouteAheadLine,
    tickerMessages.length,
    promoLines.length,
  ]);

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
          }${
            !barExpanded && activePreview.badge === "Alert"
              ? " storm-advisory-bar__preview-message-wrap--alert"
              : ""
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

      {staleWeatherNote && (
        <div className="storm-advisory-bar__stale-row" role="status">
          <span className="storm-advisory-bar__stale-text">{staleWeatherNote}</span>
          {onRefreshWeather && (
            <button
              type="button"
              className="storm-advisory-bar__btn storm-advisory-bar__btn--refresh"
              onPointerDownCapture={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRefreshWeather();
              }}
            >
              Refresh
            </button>
          )}
        </div>
      )}

      <AdvisoryExpandedSections p={props} model={model} />
        </div>
      )}
    </div>
  );
}
