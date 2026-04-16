import { useEffect, useMemo, useState, type ReactNode } from "react";
import { sortWeatherAlertsBySeverity, type NormalizedWeatherAlert } from "../weatherAlerts";
import { nwsIssuedByLine, nwsWhatIsHappening, nwsWhatToDo } from "../weatherAlerts/nwsDriveSummary";

export type StormRoadDetailRow = { label: string; text: ReactNode };

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
        <strong>Slow down</strong>, widen following distance, and consider delaying or exiting until warned
        conditions pass.
      </>
    );
  }
  if (hasAtLocation) {
    return (
      <>
        <strong>Your position is inside an NWS alert polygon</strong>, but your plotted route may not intersect it on
        our map (geometry / sampling). <strong>Assume local conditions apply</strong> — read what is happening below.
      </>
    );
  }
  if (trafficDelayMinutes >= 6) {
    return (
      <>
        <strong>Traffic delays</strong> on corridor — may reflect wet roads or visibility.{" "}
        <strong>Slow down</strong> and increase following distance.
      </>
    );
  }
  return (
    <>
      No NWS polygon on your route line — <strong>still check conditions visually</strong> (radar, sky, road spray).
    </>
  );
}

function nwsAlertCard(
  a: NormalizedWeatherAlert,
  tier: "crosses" | "atLocation"
): ReactNode {
  const endsLabel = fmtEnds(a.ends);
  const what = nwsWhatIsHappening(a);
  const todo = nwsWhatToDo(a);
  const issuedLine = nwsIssuedByLine(a.headline);
  /* Hazard first — not “Special Weather Statement Moderate” without substance */
  const primary = (
    <div className="storm-advisory-bar__nws-item-primary">{what}</div>
  );
  const kindRow = (
    <div className="storm-advisory-bar__nws-item-title">
      <strong>{a.event}</strong>
      {a.severity ? (
        <>
          {" "}
          <span className="storm-advisory-bar__nws-item-sev">{a.severity}</span>
        </>
      ) : null}
    </div>
  );
  const issuedMeta =
    issuedLine.length > 0 ? (
      <div className="storm-advisory-bar__nws-item-issued">{issuedLine}</div>
    ) : null;
  const endsRow =
    endsLabel != null ? (
      <div className="storm-advisory-bar__nws-item-meta">
        Alert ends <strong>{endsLabel}</strong>
      </div>
    ) : null;
  const action =
    todo.length > 0 ? (
      <div className="storm-advisory-bar__nws-item-action">{todo}</div>
    ) : null;
  if (tier === "crosses") {
    return (
      <li key={a.id} className="storm-advisory-bar__nws-item storm-advisory-bar__nws-item--crosses">
        <span className="storm-advisory-bar__nws-item-badge">On route</span>
        <div className="storm-advisory-bar__nws-item-body">
          {primary}
          {kindRow}
          {issuedMeta}
          {endsRow}
          {action}
        </div>
      </li>
    );
  }
  return (
    <li key={a.id} className="storm-advisory-bar__nws-item storm-advisory-bar__nws-item--nearby">
      <span className="storm-advisory-bar__nws-item-badge">At your position</span>
      <div className="storm-advisory-bar__nws-item-body">
        {primary}
        {kindRow}
        {issuedMeta}
        {endsRow}
        {action}
      </div>
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

  const displayNwsList = crossingSorted.length > 0 ? crossingSorted : atLocationSorted;
  const displayNwsTier = crossingSorted.length > 0 ? ("crosses" as const) : ("atLocation" as const);
  const tickerMessages = useMemo(
    () =>
      displayNwsList.map((a) => {
        const primary = nwsWhatIsHappening(a).replace(/\s+/g, " ").trim();
        const short = primary.length > 96 ? `${primary.slice(0, 95)}…` : primary;
        return {
          id: a.id,
          text: short || (a.event?.trim() || "Weather alert"),
          alert: a,
          badge: crossingSorted.length > 0 ? "On route" : "At your position",
        };
      }),
    [displayNwsList, crossingSorted.length]
  );
  const [tickerIdx, setTickerIdx] = useState(0);
  useEffect(() => {
    setTickerIdx(0);
  }, [tickerMessages.length]);
  useEffect(() => {
    if (tickerMessages.length <= 1 || !sessionOn || loading || error) return;
    const id = window.setInterval(() => {
      setTickerIdx((v) => (v + 1) % tickerMessages.length);
    }, 3000);
    return () => window.clearInterval(id);
  }, [tickerMessages.length, sessionOn, loading, error]);

  if (!barExpanded) return null;

  return (
    <div
      className="storm-advisory-bar"
      id="storm-advisory-panel"
      role="region"
      aria-label="Storm, weather, and road advisory"
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
            title="Close storm advisory"
            aria-label="Close storm advisory"
          >
            <span className="storm-advisory-bar__collapse-icon storm-advisory-bar__collapse-icon--narrow">Done</span>
            <span className="storm-advisory-bar__collapse-icon storm-advisory-bar__collapse-icon--wide" aria-hidden>
              ◀
            </span>
          </button>
          <span className="storm-advisory-bar__title">Advisory</span>
        </div>
        {!hideHeadToggles && (
          <div className="storm-advisory-bar__toggles">
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

      <div className="storm-advisory-bar__weather-block">
        <p className="storm-advisory-bar__weather-title">Weather (NWS)</p>
        {!sessionOn && (
          <p className="storm-advisory-bar__muted storm-advisory-bar__nws-hint">
            Turn on <strong>NWS polygons</strong> to load warnings, map shading, and route highlights.
          </p>
        )}
        {sessionOn && (
          <>
            {loading && <p className="storm-advisory-bar__muted">Loading NWS active alerts…</p>}
            {error && (
              <p className="storm-advisory-bar__err" role="alert">
                {error}
              </p>
            )}
            {!loading && !error && (
              <>
                {crossingSorted.length > 0 ? (
                  <p className="storm-advisory-bar__nws-hero storm-advisory-bar__nws-hero--cross">
                    <span className="storm-advisory-bar__nws-hero-main">
                      <strong>{crossingSorted.length}</strong>
                      {crossingSorted.length === 1 ? " warning crosses" : " warnings cross"} your route
                    </span>
                  </p>
                ) : atLocationSorted.length > 0 ? (
                  <p className="storm-advisory-bar__nws-hero storm-advisory-bar__nws-hero--cross">
                    <span className="storm-advisory-bar__nws-hero-main">
                      <strong>{atLocationSorted.length}</strong>
                      {atLocationSorted.length === 1
                        ? " NWS alert at your position"
                        : " NWS alerts at your position"}{" "}
                      <span className="storm-advisory-bar__muted">(route may not show an intersection)</span>
                    </span>
                  </p>
                ) : (
                  <p className="storm-advisory-bar__muted storm-advisory-bar__radar-note">
                    No NWS warning polygons on your route line. Map radar may still show precipitation.
                  </p>
                )}
                {displayNwsList.length > 0 && (
                  <div className="storm-advisory-bar__ticker-wrap">
                    <button
                      type="button"
                      className="storm-advisory-bar__ticker"
                      title="Open this alert"
                      onClick={() => onNwsAlertClick?.(tickerMessages[tickerIdx]!.alert)}
                    >
                      <span className="storm-advisory-bar__ticker-badge">{tickerMessages[tickerIdx]?.badge}</span>
                      <span className="storm-advisory-bar__ticker-text">{tickerMessages[tickerIdx]?.text}</span>
                      {tickerMessages.length > 1 && (
                        <span className="storm-advisory-bar__ticker-count">
                          {tickerIdx + 1}/{tickerMessages.length}
                        </span>
                      )}
                    </button>
                  </div>
                )}
                {displayNwsList.length > 0 && (
                  <div
                    className="storm-advisory-bar__nws-scroll"
                    role="region"
                    aria-label="NWS warnings on your route"
                  >
                    <ul className="storm-advisory-bar__nws-list storm-advisory-bar__nws-list--crosses">
                      {displayNwsList.map((a) => nwsAlertCard(a, displayNwsTier))}
                    </ul>
                  </div>
                )}
                <p className="storm-advisory-bar__advice storm-advisory-bar__advice--weather">
                  {weatherAdviceDriving(
                    crossingSorted.length > 0,
                    crossingSorted.length === 0 && atLocationSorted.length > 0,
                    trafficDelayMinutes
                  )}
                </p>
              </>
            )}
          </>
        )}
      </div>

      {roadDetailEnabled && (
        <div className="storm-advisory-bar__road-block">
          <p className="storm-advisory-bar__road-title">Road impacts &amp; traffic (active route)</p>
          {!hasGuidanceRoute ? (
            <p className="storm-advisory-bar__muted">
              <strong>Plan a route</strong> for delay, traffic read, and notes.
            </p>
          ) : roadDetailRows.length === 0 ? (
            <p className="storm-advisory-bar__muted">No extra road or router notes for this line.</p>
          ) : (
            <dl className="storm-advisory-bar__road-dl storm-advisory-bar__road-dl--grid">
              {roadDetailRows.map((row, i) => (
                <div key={`${row.label}-${i}`} className="storm-advisory-bar__road-row">
                  <dt>{row.label}</dt>
                  <dd>{row.text}</dd>
                </div>
              ))}
            </dl>
          )}
          {trafficDelayMinutes >= 4 && onTrafficReroute && (
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
  );
}
