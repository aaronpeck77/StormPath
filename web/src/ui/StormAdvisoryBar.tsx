import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SITEBIBLE_AD_BAR, type AdvisoryPromoLine } from "../config/advisoryPromo";
import { sortWeatherAlertsBySeverity, type NormalizedWeatherAlert } from "../weatherAlerts";
import { nwsAlertIsBasicEmergency } from "../weatherAlerts/basicEmergencyFilter";
import { nwsGlanceSummary } from "../weatherAlerts/nwsDriveSummary";
import type { DriveAheadLine, DriveAheadRadarTier } from "../nav/driveRouteAhead";
import { formatDriveAheadBrief, formatMinutesAsHoursMinutes } from "../nav/driveRouteAhead";
import type { RouteImpact, RouteImpactSeverity } from "../nav/routeImpacts";
import { RouteStormStrip } from "./RouteStormStrip";

/** One-line target when static (no scroll); longer text scrolls inside the bar first. */
const PREVIEW_MAX_STATIC = 40;

function clipOneLine(s: string, max = PREVIEW_MAX_STATIC): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

/** Renders a single preview line: short copy fits; longer copy scrolls left so you can read it. */
function AdvisoryPreviewMessage({ raw }: { raw: string }) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const plain = raw.replace(/\s+/g, " ").trim();

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return;
    let anim: Animation | undefined;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        inner.style.transform = "translateX(0)";
        const need = inner.scrollWidth - wrap.clientWidth;
        if (plain.length <= PREVIEW_MAX_STATIC || need <= 1) return;
        const duration = Math.min(14_000, Math.max(2_400, need * 32));
        anim = inner.animate(
          [{ transform: "translateX(0px)" }, { transform: `translateX(-${need}px)` }],
          { duration, easing: "linear", fill: "forwards" }
        );
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      anim?.cancel();
    };
  }, [plain]);

  if (plain.length <= PREVIEW_MAX_STATIC) {
    return (
      <span className="storm-advisory-bar__preview-text" title={plain}>
        {clipOneLine(plain)}
      </span>
    );
  }
  return (
    <span className="storm-advisory-bar__preview-text storm-advisory-bar__preview-text--scroll" title={plain}>
      <span ref={wrapRef} className="storm-advisory-bar__preview-clip">
        <span ref={innerRef} className="storm-advisory-bar__preview-clip-inner">
          {plain}
        </span>
      </span>
    </span>
  );
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
};

const METERS_PER_MILE = 1609.34;

/** Distance and ETA for one timeline row (plan ETA when not yet navigating). */
function formatHazardAheadMeta(
  distanceAheadMeters: number | null,
  etaAheadMinutes: number | null,
  navigationStarted: boolean
): string | null {
  const bits: string[] = [];
  if (distanceAheadMeters != null && Number.isFinite(distanceAheadMeters)) {
    if (distanceAheadMeters < 80) {
      bits.push("Now — on your path");
    } else {
      const mi = distanceAheadMeters / METERS_PER_MILE;
      bits.push(mi < 10 ? `${mi.toFixed(1)} mi ahead` : `${Math.round(mi)} mi ahead`);
    }
  }
  if (etaAheadMinutes != null && Number.isFinite(etaAheadMinutes) && etaAheadMinutes >= 0.5) {
    const dur = formatMinutesAsHoursMinutes(etaAheadMinutes);
    bits.push(navigationStarted ? `≈ ${dur}` : `≈ ${dur} (plan)`);
  }
  if (bits.length === 0) return null;
  return bits.join(" · ");
}

function fmtEnds(ends: string | null): string | null {
  if (!ends) return null;
  const t = Date.parse(ends);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

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

function impactSourceLabel(s: RouteImpact["source"]): string {
  switch (s) {
    case "nws":
      return "NWS";
    case "radar":
      return "Radar";
    case "mapboxTraffic":
      return "Mapbox traffic";
    case "mapboxIncident":
      return "Mapbox incident";
    case "routeNotice":
      return "Route notice";
    case "fused":
      return "Combined";
    default:
      return "Internal";
  }
}

/**
 * Severity-tinted card for one weather/road impact in the unified along-route timeline.
 * Replaces the old "hazard timeline row" — now adds a small source pill.
 */
function impactRow(
  i: RouteImpact,
  navigationStarted: boolean,
  onClick?: () => void
): ReactNode {
  const aheadMeta = formatHazardAheadMeta(i.distanceAheadMeters, i.etaAheadMinutes, navigationStarted);
  const detail = (i.roadEffect || i.detail || "").trim();
  return (
    <div
      key={i.id}
      className={`storm-advisory-bar__impact-row storm-advisory-bar__impact-row--sev-${i.severity}${
        onClick ? " storm-advisory-bar__impact-row--tappable" : ""
      }`}
      role={onClick ? "button" : "listitem"}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div className="storm-advisory-bar__impact-head">
        <span className="storm-advisory-bar__impact-headline">{i.driverHeadline}</span>
        <span className="storm-advisory-bar__impact-source">{impactSourceLabel(i.source)}</span>
      </div>
      {aheadMeta ? <div className="storm-advisory-bar__impact-meta">{aheadMeta}</div> : null}
      {detail ? <p className="storm-advisory-bar__impact-detail">{detail}</p> : null}
    </div>
  );
}

/** Compact urgent card for the NOW section — life-safety NWS at the user's position. */
function urgentNwsCard(
  a: NormalizedWeatherAlert,
  context: "atLocation" | "crosses",
  onClick?: (alert: NormalizedWeatherAlert) => void
): ReactNode {
  const endsLabel = fmtEnds(a.ends);
  const glance = nwsGlanceSummary(a);
  return (
    <li
      key={a.id}
      className={`storm-advisory-bar__now-card storm-advisory-bar__now-card--${context}`}
    >
      <button
        type="button"
        className="storm-advisory-bar__now-card-btn"
        onClick={() => onClick?.(a)}
        aria-label={`${a.event} — open details`}
      >
        <span className="storm-advisory-bar__now-card-icon" aria-hidden>
          ⚠
        </span>
        <span className="storm-advisory-bar__now-card-body">
          <span className="storm-advisory-bar__now-card-title">
            <strong>{a.event}</strong>
            {a.severity ? <span className="storm-advisory-bar__now-card-sev">{a.severity}</span> : null}
          </span>
          {glance ? (
            <span className="storm-advisory-bar__now-card-detail">{glance}</span>
          ) : null}
          <span className="storm-advisory-bar__now-card-meta">
            {context === "atLocation" ? "At your position" : "Crosses your route"}
            {endsLabel ? ` · ends ${endsLabel}` : ""}
          </span>
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
}: StormAdvisoryBarProps) {
  if (!featureEnabled) return null;
  void corridorAlerts;

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
  const nowCrossing = useMemo(() => {
    /* Crossing life-safety alerts that have a polygon overlap close to the user are also "now".
     * Heuristic: pull life-safety crossings into NOW; less-urgent crossings live in WEATHER. */
    return crossingSorted.filter(nwsAlertIsBasicEmergency);
  }, [crossingSorted]);

  /* WEATHER: weather-bucket impacts that AREN'T already promoted to NOW. We dedupe by impact id —
   * a single Tornado Warning is in NOW only, not also in WEATHER. */
  const weatherImpacts = useMemo(() => {
    if (!routeImpacts?.length) return [];
    const promoted = new Set<string>();
    /* NWS alert ids → matching impact ids: impacts derived from a NOW alert share the headline. */
    const nowEvents = new Set([
      ...nowAtLocation.map((a) => a.event.toLowerCase()),
      ...nowCrossing.map((a) => a.event.toLowerCase()),
    ]);
    for (const i of routeImpacts) {
      if (i.source !== "nws") continue;
      const headline = i.driverHeadline.toLowerCase();
      for (const ev of nowEvents) {
        if (ev && headline.includes(ev)) {
          promoted.add(i.id);
          break;
        }
      }
    }
    return routeImpacts.filter((i) => impactSectionBucket(i) === "weather" && !promoted.has(i.id));
  }, [routeImpacts, nowAtLocation, nowCrossing]);

  /* ROADS: traffic / closure / incident / construction impacts. The live traffic narrative from
   * `roadDetailRows` is folded in as a single highlight row above the impact list. */
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

  /* Show NOW when there is a real urgency. Empty otherwise. */
  const hasNow = nowAtLocation.length > 0 || nowCrossing.length > 0;
  /* Show WEATHER when there are weather impacts OR storm strips OR we're loading weather data. */
  const hasWeather = weatherImpacts.length > 0 || (stormStripBands?.length ?? 0) > 0;
  /* Show ROADS when there are road impacts, traffic narrative rows, or a reroute CTA condition. */
  const hasTrafficStop = useMemo(
    () => roadDetailRows.some((r) => /traffic stop|closure/i.test(r.label)),
    [roadDetailRows]
  );
  const showRerouteCta = (trafficDelayMinutes >= 10 || hasTrafficStop) && Boolean(onTrafficReroute);
  const hasRoads =
    roadImpacts.length > 0 || trafficNarrativeRows.length > 0 || showRerouteCta;
  const hasSuggestion = Boolean(betterRouteRow) || (showRerouteCta && !roadDetailEnabled);

  const tickerMessages = useMemo(() => {
    const list = [...crossingSorted, ...atLocationSorted];
    return list.map((a) => {
      const g = nwsGlanceSummary(a);
      const badge = crossingSorted.includes(a) ? "On route" : "At your position";
      return {
        id: a.id,
        text: g || (a.event?.trim() || "Weather alert"),
        alert: a,
        badge,
      };
    });
  }, [crossingSorted, atLocationSorted]);
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
  const previewItems = useMemo(() => {
    if (basicNavAdvisoryMode) {
      const out: { badge: string | null; raw: string }[] = [];
      if (!isOnline) {
        out.push({
          badge: "Offline",
          raw: "No network. Reconnect to refresh map tiles and radar.",
        });
      }
      if (hasGuidanceRoute) {
        out.push({ badge: "Nav", raw: "Route is set — tap Go when you are ready to drive." });
      }
      if (busyLabel) out.push({ badge: "Work", raw: busyLabel });
      for (const p of promoLines) {
        out.push({ badge: "Info", raw: clipOneLine(p.text, 64) });
      }
      if (out.length === 0) out.push({ badge: null, raw: defaultPreviewText });
      return out;
    }
    /* Plus rotator: only show app-promo content when nothing real is going on. Keeps the bar
     * from looking like an ad reel when there are actual conditions to talk about. */
    const out: { badge: string | null; raw: string }[] = [];
    if (!isOnline) {
      out.push({ badge: "Offline", raw: "No network. Reconnect to refresh the map and advisories." });
    }
    if (showErrorState && (error || "").trim()) {
      out.push({ badge: "Error", raw: (error || "").trim() });
    }
    if (loading) {
      if (!navigationStarted && hasGuidanceRoute) {
        out.push({
          badge: "Plan",
          raw: loadSlow
            ? "Still loading NWS for this route. Live traffic & road strip after Go."
            : "Loading NWS for your planned route. Live traffic after Go.",
        });
      } else {
        out.push({ badge: "Load", raw: navigationStarted ? "Loading alerts…" : "Loading…" });
      }
    }
    if (busyLabel) {
      out.push({ badge: "Work", raw: busyLabel });
    }
    if (activeTicker) {
      out.push({ badge: activeTicker.badge, raw: activeTicker.text });
    }
    if (advisoryTier !== "basic" && trafficDelayMinutes >= 8) {
      out.push({
        badge: "Traffic",
        raw: `Traffic +${formatMinutesAsHoursMinutes(trafficDelayMinutes)} on route`,
      });
    }
    if (advisoryTier !== "basic" && driveRouteAheadLine) {
      out.push({ badge: "Ahead", raw: formatDriveAheadBrief(driveRouteAheadLine) });
    }
    /* Only inject promos / app blurbs when the rotator has nothing of substance (no alerts, no busy,
     * no ticker, no traffic, no road-ahead). Avoids the "ad reel" feeling when something is happening. */
    const hasSubstantive =
      !isOnline ||
      showErrorState ||
      loading ||
      Boolean(busyLabel) ||
      Boolean(activeTicker) ||
      trafficDelayMinutes >= 8 ||
      Boolean(driveRouteAheadLine);
    if (!hasSubstantive) {
      if (hasGuidanceRoute) {
        out.push({
          badge: "Drive",
          raw: navigationStarted
            ? "Route is set. Data keeps updating while you drive."
            : "Route is set — tap Go for live traffic and corridor alerts.",
        });
      }
      out.push({ badge: "App", raw: SITEBIBLE_AD_BAR });
      for (const p of promoLines) {
        if (p.id === "sitebible") continue;
        out.push({ badge: "Info", raw: clipOneLine(p.text, 64) });
      }
    }
    if (out.length === 0) out.push({ badge: null, raw: defaultPreviewText });
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
      if (nowAtLocation.length > 0) return "severe";
      return "none";
    }
    /* Worst impact severity wins. */
    let worstSev: RouteImpactSeverity | null = null;
    const rank = (s: RouteImpactSeverity) =>
      s === "avoid" ? 4 : s === "serious" ? 3 : s === "caution" ? 2 : 1;
    for (const i of routeImpacts ?? []) {
      if (!worstSev || rank(i.severity) > rank(worstSev)) worstSev = i.severity;
    }
    if (worstSev === "avoid" || worstSev === "serious" || hasTrafficStop || nowAtLocation.length > 0) {
      return "severe";
    }
    if (worstSev === "caution" || trafficDelayMinutes >= 8 || nowCrossing.length > 0) return "warn";
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
    nowAtLocation.length,
    nowCrossing.length,
    routeImpacts,
    hasTrafficStop,
    trafficDelayMinutes,
    driveRouteAheadLine,
    tickerMessages.length,
    promoLines.length,
  ]);

  /* Resolve a band's onClick by looking up the matching alert by id. */
  const stripBandClick = (band: StormStripBand): (() => void) | undefined => {
    if (!band.alertId || !onNwsAlertClick) return undefined;
    const all = [...overlappingAlerts, ...nwsAtLocationAlerts];
    const matched = all.find((a) => a.id === band.alertId);
    if (!matched) return undefined;
    return () => onNwsAlertClick(matched);
  };

  const activePreview = previewItems[previewIdx % previewItems.length]!;

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
        className={`storm-advisory-bar storm-advisory-bar--preview storm-advisory-bar--sev-${effectiveSeverity}${showErrorState ? " storm-advisory-bar--err" : ""}${barExpanded ? " storm-advisory-bar--preview-active" : ""}`}
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
        <span className="storm-advisory-bar__preview-message-wrap">
          {barExpanded ? (
            <span className="storm-advisory-bar__preview-text" title="Close advisory">
              {basicNavAdvisoryMode ? "Status — tap to close ▲" : "Advisory — tap to close ▲"}
            </span>
          ) : (
            <AdvisoryPreviewMessage raw={activePreview.raw} />
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
        {/* Pre-Go hint surfaced once at the very top so it doesn't repeat across sections. */}
        {!navigationStarted && hasGuidanceRoute && !basicNavAdvisoryMode && (
          <p className="storm-advisory-bar__pre-go-hint" role="note">
            <strong>Tap Go</strong> for live traffic and ETA. NWS / radar already preview your planned route below.
          </p>
        )}

        {/* ───── NOW ───── Life-safety NWS that is at-location or crossing now. */}
        {hasNow && (
          <section className="storm-advisory-bar__section storm-advisory-bar__section--now">
            <p className="storm-advisory-bar__section-title">Now</p>
            <ul className="storm-advisory-bar__now-list" role="list">
              {nowAtLocation.map((a) => urgentNwsCard(a, "atLocation", onNwsAlertClick))}
              {nowCrossing
                .filter((a) => !nowAtLocation.some((b) => b.id === a.id))
                .map((a) => urgentNwsCard(a, "crosses", onNwsAlertClick))}
            </ul>
            <p className="storm-advisory-bar__section-source">Source: NWS</p>
          </section>
        )}

        {/* ───── WEATHER along your route ───── Storm strip(s) for severe NWS overlaps + impact rows. */}
        {!basicNavAdvisoryMode && (hasWeather || (loading && hasGuidanceRoute)) && (
          <section className="storm-advisory-bar__section storm-advisory-bar__section--weather">
            <p className="storm-advisory-bar__section-title">Weather along your route</p>

            {/* Severe NWS strip(s) — one per band. Tap to open the matched alert. */}
            {(stormStripBands?.length ?? 0) > 0 &&
              routeTotalMeters > 0 &&
              stormStripBands!.map((band) => (
                <RouteStormStrip
                  key={band.id}
                  band={{
                    id: band.id,
                    event: band.event,
                    severity: band.severity,
                    startMeters: band.startMeters,
                    endMeters: band.endMeters,
                    expiresIso: band.expiresIso,
                    onClick: stripBandClick(band),
                  }}
                  totalMeters={routeTotalMeters}
                  userAlongMeters={userAlongMeters}
                  planEtaMinutes={planEtaMinutes}
                  driveEtaMinutes={driveEtaMinutes}
                />
              ))}

            {/* Loading message — section-scoped so it doesn't repeat in the rotator and at the bottom. */}
            {loading && weatherImpacts.length === 0 && (
              <p className="storm-advisory-bar__muted storm-advisory-bar__section-status" aria-live="polite">
                {!navigationStarted && hasGuidanceRoute
                  ? "Loading NWS for your planned route…"
                  : "Loading weather alerts…"}
              </p>
            )}

            {/* Hint when polygons are off and there's nothing to show. */}
            {advisoryTier === "plus" && !sessionOn && weatherImpacts.length === 0 && !loading && (
              <p className="storm-advisory-bar__muted storm-advisory-bar__section-hint">
                Turn on <strong>NWS polygons</strong> for shaded zones on the map.
              </p>
            )}

            {/* Per-impact rows for non-severe weather (advisories, watches, radar bands, OW samples). */}
            {weatherImpacts.length > 0 && (
              <div
                className="storm-advisory-bar__impact-list"
                role="list"
                aria-label="Weather along your route"
              >
                {weatherImpacts.map((i) => impactRow(i, navigationStarted))}
              </div>
            )}

            {weatherImpacts.length === 0 &&
              (stormStripBands?.length ?? 0) === 0 &&
              !loading &&
              hasGuidanceRoute && (
                <p className="storm-advisory-bar__muted storm-advisory-bar__section-status">
                  No weather impact on your route line right now.
                </p>
              )}

            <p className="storm-advisory-bar__section-source">Sources: NWS · Radar · OpenWeather</p>
          </section>
        )}

        {/* ───── ROADS & HAZARDS along your route ───── Mapbox traffic + closures/incidents/construction. */}
        {!basicNavAdvisoryMode && hasRoads && (
          <section className="storm-advisory-bar__section storm-advisory-bar__section--roads">
            <p className="storm-advisory-bar__section-title">Roads &amp; hazards along your route</p>

            {!hasGuidanceRoute && (
              <p className="storm-advisory-bar__muted">
                <strong>Add a route</strong> to see corridor traffic and notes.
              </p>
            )}

            {hasGuidanceRoute && trafficNarrativeRows.length > 0 && (
              <dl className="storm-advisory-bar__road-dl storm-advisory-bar__road-dl--driver-stack">
                {trafficNarrativeRows.map((row, i) => (
                  <div key={`${row.label}-${i}`} className="storm-advisory-bar__road-row">
                    <dt>{row.label}</dt>
                    <dd>
                      {row.onAction ? (
                        <button
                          type="button"
                          className="storm-advisory-bar__ticker"
                          onClick={row.onAction}
                          title={row.actionLabel ?? "Open"}
                        >
                          {row.text}
                        </button>
                      ) : (
                        row.text
                      )}
                      {row.onAction && (
                        <button
                          type="button"
                          className="storm-advisory-bar__btn storm-advisory-bar__btn--traffic"
                          onClick={row.onAction}
                        >
                          {row.actionLabel ?? "Open"}
                        </button>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            {roadImpacts.length > 0 && (
              <div
                className="storm-advisory-bar__impact-list"
                role="list"
                aria-label="Road impacts along your route"
              >
                {roadImpacts.map((i) => impactRow(i, navigationStarted))}
              </div>
            )}

            <p className="storm-advisory-bar__section-source">Sources: Mapbox traffic · NWS road events</p>
          </section>
        )}

        {/* ───── ROUTE SUGGESTION ───── A real alternate exists, or a reroute-around-traffic CTA. */}
        {!basicNavAdvisoryMode && hasSuggestion && (
          <section className="storm-advisory-bar__section storm-advisory-bar__section--suggestion">
            <p className="storm-advisory-bar__section-title">Route suggestion</p>

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

            {showRerouteCta && (
              <p className="storm-advisory-bar__actions">
                <button
                  type="button"
                  className="storm-advisory-bar__btn storm-advisory-bar__btn--traffic"
                  onClick={onTrafficReroute}
                  disabled={trafficRerouteBusy}
                  title="Find a faster route around current traffic"
                >
                  {trafficRerouteBusy ? "Finding route…" : "Reroute around traffic"}
                </button>
              </p>
            )}

            <p className="storm-advisory-bar__section-source">Source: Route analysis · Mapbox traffic</p>
          </section>
        )}

        {/* Basic-tier upsell stays at the bottom when nothing else is shown. */}
        {basicNavAdvisoryMode === false &&
          advisoryTier === "basic" &&
          weatherImpacts.length === 0 &&
          roadImpacts.length === 0 &&
          !loading && (
            <p className="storm-advisory-bar__muted storm-advisory-bar__basic-upsell">
              {ownsPlus ? (
                <>
                  Turn on <strong>NWS polygons</strong> and <strong>Road impacts</strong> for full data.
                </>
              ) : (
                <>
                  Basic shows the most urgent products. <strong>Plus</strong> adds full NWS and road tools.
                </>
              )}
            </p>
          )}

        {/* Empty state when nothing qualifies for any section. */}
        {!hasNow && !hasWeather && !hasRoads && !hasSuggestion && !loading && !basicNavAdvisoryMode && (
          <p className="storm-advisory-bar__muted storm-advisory-bar__section-status">
            No advisories on your route right now.
          </p>
        )}
          </div>
        </div>
      )}
    </div>
  );
}
