import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SITEBIBLE_AD_BAR, type AdvisoryPromoLine } from "../config/advisoryPromo";
import { sortWeatherAlertsBySeverity, type NormalizedWeatherAlert } from "../weatherAlerts";
import { nwsGlanceSummary, nwsWhatToDo } from "../weatherAlerts/nwsDriveSummary";
import type { DriveAheadLine, DriveAheadRadarTier } from "../nav/driveRouteAhead";
import { formatDriveAheadBrief } from "../nav/driveRouteAhead";

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

function weatherAdviceDriving(
  hasRouteOverlap: boolean,
  hasAtLocation: boolean,
  trafficDelayMinutes: number
): ReactNode {
  if (hasRouteOverlap) {
    return (
      <>
        <strong>Slow down</strong>, leave extra space, and avoid the hazard area if you can.
      </>
    );
  }
  if (hasAtLocation) {
    return (
      <>
        You’re <strong>inside</strong> this alert — conditions apply here even if the route line doesn’t touch the
        shaded area.
      </>
    );
  }
  if (trafficDelayMinutes >= 6) {
    return (
      <>
        <strong>Delays ahead</strong> — ease off and add following distance.
      </>
    );
  }
  return (
    <>
      <strong>No NWS zone</strong> on your route line — still watch radar and the road.
    </>
  );
}

function nwsAlertCard(
  a: NormalizedWeatherAlert,
  tier: "crosses" | "atLocation",
  onClick?: (alert: NormalizedWeatherAlert) => void
): ReactNode {
  const endsLabel = fmtEnds(a.ends);
  const glance = nwsGlanceSummary(a);
  const todoRaw = nwsWhatToDo(a);
  const todo =
    todoRaw.length > 88 ? `${todoRaw.slice(0, 87).replace(/\s+$/, "").trim()}…` : todoRaw;
  const titleRow = (
    <div className="storm-advisory-bar__nws-item-title">
      <strong>{a.event}</strong>
      {a.severity ? (
        <span className="storm-advisory-bar__nws-item-sev">{a.severity}</span>
      ) : null}
    </div>
  );
  const detailRow =
    glance.length > 0 ? (
      <div className="storm-advisory-bar__nws-item-primary">{glance}</div>
    ) : null;
  const endsRow =
    endsLabel != null ? (
      <div className="storm-advisory-bar__nws-item-meta">
        Ends <strong>{endsLabel}</strong>
      </div>
    ) : null;
  const action =
    todo.length > 0 ? (
      <div className="storm-advisory-bar__nws-item-action">{todo}</div>
    ) : null;
  if (tier === "crosses") {
    return (
      <li key={a.id} className="storm-advisory-bar__nws-item storm-advisory-bar__nws-item--crosses">
        <button
          type="button"
          className="storm-advisory-bar__nws-card"
          title="Open this alert"
          onClick={() => onClick?.(a)}
        >
          <span className="storm-advisory-bar__nws-item-badge">On route</span>
          <div className="storm-advisory-bar__nws-item-body">
            {titleRow}
            {detailRow}
            {endsRow}
            {action}
          </div>
        </button>
      </li>
    );
  }
  return (
    <li key={a.id} className="storm-advisory-bar__nws-item storm-advisory-bar__nws-item--nearby">
      <button
        type="button"
        className="storm-advisory-bar__nws-card"
        title="Open this alert"
        onClick={() => onClick?.(a)}
      >
        <span className="storm-advisory-bar__nws-item-badge">Here</span>
        <div className="storm-advisory-bar__nws-item-body">
          {titleRow}
          {detailRow}
          {endsRow}
          {action}
        </div>
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

  const displayNwsTier: "crosses" | "atLocation" =
    crossingSorted.length > 0 ? "crosses" : "atLocation";

  const displayNwsList =
    crossingSorted.length > 0
      ? crossingSorted
      : atLocationSorted;

  const tickerMessages = useMemo(
    () =>
      displayNwsList.map((a) => {
        const g = nwsGlanceSummary(a);
        const badge =
          displayNwsTier === "crosses"
            ? "On route"
            : "At your position";
        return {
          id: a.id,
          text: g || (a.event?.trim() || "Weather alert"),
          alert: a,
          badge,
        };
      }),
    [displayNwsList, displayNwsTier]
  );
  const [tickerIdx, setTickerIdx] = useState(0);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [loadSlow, setLoadSlow] = useState(false);
  const showErrorState = Boolean(error?.trim());
  const nwsContentReady = !loading && !showErrorState;
  const hasTrafficStop = useMemo(
    () => roadDetailRows.some((r) => /traffic stop|closure/i.test(r.label)),
    [roadDetailRows]
  );

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
        if (loadSlow) {
          out.push({
            badge: "Load",
            raw: navigationStarted
              ? "Still loading — try again shortly."
              : "Still loading — open the panel to retry.",
          });
        }
      }
    }
    if (hasGuidanceRoute) {
      out.push({
        badge: "Drive",
        raw: navigationStarted
          ? "Route is set. Data keeps updating while you drive."
          : "Route is set — tap Go for live traffic and corridor alerts.",
      });
    }
    out.push({ badge: "App", raw: SITEBIBLE_AD_BAR });
    if (busyLabel) {
      out.push({ badge: "Work", raw: busyLabel });
    }
    if (activeTicker) {
      out.push({ badge: activeTicker.badge, raw: activeTicker.text });
    }
    if (advisoryTier !== "basic" && trafficDelayMinutes >= 8) {
      out.push({
        badge: "Traffic",
        raw: `Traffic +${Math.round(trafficDelayMinutes)} min on route`,
      });
    }
    if (advisoryTier !== "basic" && driveRouteAheadLine) {
      out.push({ badge: "Ahead", raw: formatDriveAheadBrief(driveRouteAheadLine) });
    }
    for (const p of promoLines) {
      if (p.id === "sitebible") continue;
      out.push({ badge: "Info", raw: clipOneLine(p.text, 64) });
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

  /** Derive a "hazard tone" for the border of the preview bar + count badge. */
  const effectiveSeverity: "none" | "info" | "warn" | "severe" = basicNavAdvisoryMode
    ? peekSeverity ?? (!isOnline ? "warn" : busyLabel ? "info" : "none")
    : peekSeverity ??
      (!isOnline
        ? "warn"
        : showErrorState
          ? "severe"
          : loading
            ? loadSlow
              ? "warn"
              : "info"
            : crossingSorted.length > 0 || hasTrafficStop
              ? "severe"
              : atLocationSorted.length > 0 || trafficDelayMinutes >= 8
                ? "warn"
                : driveTierSev(driveRouteAheadLine?.radarTier) === "severe"
                  ? "severe"
                  : driveTierSev(driveRouteAheadLine?.radarTier) === "warn"
                    ? "warn"
                    : tickerMessages.length > 0
                      ? "info"
                      : promoLines.length > 0
                        ? "info"
                        : "none");

  if (!barExpanded) {
    const activePreview = previewItems[previewIdx % previewItems.length]!;
    return (
      <button
        type="button"
        className={`storm-advisory-bar storm-advisory-bar--preview storm-advisory-bar--sev-${effectiveSeverity}${showErrorState ? " storm-advisory-bar--err" : ""}`}
        id="storm-advisory-panel"
        role="region"
        aria-label={
          basicNavAdvisoryMode
            ? "Status bar — connection and tips, tap to expand"
            : "Advisory — weather, hazards, and road status (tap to expand)"
        }
        aria-expanded={false}
        aria-controls="storm-advisory-panel"
        onPointerDownCapture={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onBarExpandedChange(true);
        }}
        title={activePreview.raw}
      >
        <span className="storm-advisory-bar__preview-message-wrap">
          <AdvisoryPreviewMessage raw={activePreview.raw} />
        </span>
      </button>
    );
  }

  return (
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

      {(busyLabel || (!basicNavAdvisoryMode && driveRouteAheadLine)) && (
        <div className="storm-advisory-bar__now-row" aria-live="polite">
          {busyLabel && (
            <span className="storm-advisory-bar__now-chip storm-advisory-bar__now-chip--busy">
              <span className="storm-advisory-bar__now-dot" aria-hidden />
              {busyLabel}
            </span>
          )}
          {!basicNavAdvisoryMode && driveRouteAheadLine && (
            <span
              className={`storm-advisory-bar__now-chip storm-advisory-bar__now-chip--ahead storm-advisory-bar__now-chip--tier-${driveRouteAheadLine.radarTier}`}
              title="Route ahead — radar / traffic brief"
            >
              <span className="storm-advisory-bar__now-tag">Route ahead</span>
              <span className="storm-advisory-bar__now-text">{formatDriveAheadBrief(driveRouteAheadLine)}</span>
            </span>
          )}
        </div>
      )}

      {(!basicNavAdvisoryMode || roadDetailEnabled) && (
        <div className="storm-advisory-bar__panels-scroll">
          {!navigationStarted && hasGuidanceRoute && !basicNavAdvisoryMode && (
            <p className="storm-advisory-bar__pre-go-hint" role="note">
              <strong>Tap Go</strong> for live traffic, ETA, and corridor road notes. NWS preview below updates for
              your planned route.
            </p>
          )}
          {!basicNavAdvisoryMode && (
            <div className="storm-advisory-bar__weather-block">
              <p className="storm-advisory-bar__weather-title">
                {advisoryTier === "basic" ? "Urgent warnings" : "Hazards ahead"}
              </p>
              {driveRouteAheadLine && (driveRouteAheadLine.kind === "traffic" || driveRouteAheadLine.kind === "road") && (
                <p
                  className={`storm-advisory-bar__hazard-ahead-note storm-advisory-bar__hazard-ahead-note--${driveRouteAheadLine.radarTier}`}
                  aria-live="polite"
                >
                  <strong>{driveRouteAheadLine.kind === "traffic" ? "Traffic ahead" : "Road hazard ahead"}:</strong>{" "}
                  {formatDriveAheadBrief(driveRouteAheadLine)}
                </p>
              )}
              {advisoryTier === "basic" && displayNwsList.length === 0 && !loading && (
                <p className="storm-advisory-bar__muted storm-advisory-bar__basic-upsell">
                  {ownsPlus ? (
                    <>
                      Turn on <strong>NWS polygons</strong> and <strong>Road impacts</strong> for full data.
                    </>
                  ) : (
                    <>
                      Basic = most urgent products. <strong>Plus</strong> adds full NWS and road tools.
                    </>
                  )}
                </p>
              )}
              {loading && (
                <p className="storm-advisory-bar__muted storm-advisory-bar__status-line" aria-live="polite">
                  {!navigationStarted && hasGuidanceRoute
                    ? "Loading NWS for your planned route. Live traffic and ETA appear after Go."
                    : "Loading alerts…"}
                </p>
              )}
              {loadSlow && loading && (
                <p className="storm-advisory-bar__muted storm-advisory-bar__status-line" aria-live="polite">
                  {navigationStarted
                    ? "Still loading — service or network may be slow."
                    : "Still loading the alert list — not a traffic delay; corridor data starts after Go."}
                </p>
              )}
              {error && (
                <p className="storm-advisory-bar__err" role="alert">
                  {error}
                </p>
              )}
              {advisoryTier === "plus" && !sessionOn && crossingSorted.length === 0 && atLocationSorted.length === 0 && (
                <p className="storm-advisory-bar__muted storm-advisory-bar__nws-hint">
                  Turn on <strong>NWS polygons</strong> for shaded zones on the map.
                </p>
              )}
              {nwsContentReady && (
                <>
                  {crossingSorted.length > 0 ? (
                    <p className="storm-advisory-bar__nws-hero storm-advisory-bar__nws-hero--cross">
                      <span className="storm-advisory-bar__nws-hero-main">
                        <strong>{crossingSorted.length}</strong>{" "}
                        {crossingSorted.length === 1 ? "warning on your route" : "warnings on your route"}
                      </span>
                    </p>
                  ) : atLocationSorted.length > 0 ? (
                    <p className="storm-advisory-bar__nws-hero storm-advisory-bar__nws-hero--cross">
                      <span className="storm-advisory-bar__nws-hero-main">
                        <strong>{atLocationSorted.length}</strong>
                        {atLocationSorted.length === 1 ? " alert where you are" : " alerts where you are"}
                      </span>
                    </p>
                  ) : (
                    <p className="storm-advisory-bar__muted storm-advisory-bar__radar-note">
                      {advisoryTier === "basic"
                        ? ownsPlus
                          ? "No urgent-class warnings here. Turn on NWS polygons for the full feed."
                          : "No urgent-class warnings here. Plus adds full NWS on the map."
                        : "No warning zones on your route line. Radar may still show rain or snow."}
                    </p>
                  )}
                  {displayNwsList.length > 0 && (
                    <div
                      className="storm-advisory-bar__nws-scroll"
                      role="region"
                      aria-label="NWS warnings on your route"
                    >
                      <ul className="storm-advisory-bar__nws-list storm-advisory-bar__nws-list--crosses">
                        {displayNwsList.map((a) => nwsAlertCard(a, displayNwsTier, onNwsAlertClick))}
                      </ul>
                    </div>
                  )}
                  {navigationStarted && (
                    <p className="storm-advisory-bar__advice storm-advisory-bar__advice--weather">
                      {weatherAdviceDriving(
                        crossingSorted.length > 0,
                        crossingSorted.length === 0 && atLocationSorted.length > 0,
                        trafficDelayMinutes
                      )}
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {roadDetailEnabled && (
            <div className="storm-advisory-bar__road-block">
              <p className="storm-advisory-bar__road-title">Road &amp; traffic</p>
              {!hasGuidanceRoute ? (
                <p className="storm-advisory-bar__muted">
                  <strong>Add a route</strong> to see delay and notes.
                </p>
              ) : roadDetailRows.length === 0 ? (
                <p className="storm-advisory-bar__muted">Nothing extra on this route.</p>
              ) : (
                <dl className="storm-advisory-bar__road-dl storm-advisory-bar__road-dl--driver-stack">
                  {roadDetailRows.map((row, i) => (
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
              {(trafficDelayMinutes >= 10 || hasTrafficStop) && onTrafficReroute && (
                <p className="storm-advisory-bar__actions">
                  <button
                    type="button"
                    className="storm-advisory-bar__btn storm-advisory-bar__btn--traffic"
                    onClick={onTrafficReroute}
                    disabled={trafficRerouteBusy}
                    title="Find a faster route around current traffic"
                  >
                    {trafficRerouteBusy ? "Finding route…" : "Reroute for traffic"}
                  </button>
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
