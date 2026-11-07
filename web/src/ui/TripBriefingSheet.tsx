import type { TripBriefing } from "../forecast/tripBriefing";
import type { DepartureRecommendationKind } from "../forecast/departureScan";

/**
 * Pre-trip briefing — one card a driver reads before hitting Go: when to
 * leave, hazards ahead, corridor weather, traffic, and why this route.
 * Follows the RouteForecastSheet chrome pattern; severity shown via dots,
 * never left-border accent stripes.
 */

function leaveTone(kind: DepartureRecommendationKind | null): string {
  switch (kind) {
    case "wait":
      return "briefing-leave--wait";
    case "rough_anyway":
      return "briefing-leave--rough";
    case "leave_now":
      return "briefing-leave--go";
    default:
      return "";
  }
}

function toneDot(tone: TripBriefing["hazards"][number]["tone"]): string {
  return `briefing-hazard__dot briefing-hazard__dot--${tone}`;
}

export function TripBriefingSheet(props: {
  briefing: TripBriefing | null;
  /** Plus gate — Basic users see the upsell panel instead of the briefing. */
  locked?: boolean;
  onSeePlus?: () => void;
  onClose: () => void;
}) {
  const { briefing: b, locked = false, onSeePlus, onClose } = props;

  return (
    <div className="briefing-scrim" role="presentation" onClick={onClose}>
      <div
        className="briefing-sheet"
        role="dialog"
        aria-label={b ? `Trip briefing for ${b.destinationLabel}` : "Trip briefing"}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="briefing-sheet__head">
          <div className="briefing-sheet__head-text">
            <p className="briefing-sheet__eyebrow">Trip briefing</p>
            <h2 className="briefing-sheet__title">
              {b ? `${b.routeLetter} · ${b.destinationLabel}` : "StormPath Plus"}
            </h2>
            {b ? (
              <p className="briefing-sheet__meta">
                {b.originLabel} → {b.destinationLabel} · {b.distanceLabel} · {b.etaLabel}
                {b.isSuggested ? " · StormPath's pick" : ""}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="briefing-sheet__close"
            onClick={onClose}
            aria-label="Close trip briefing"
          >
            Done
          </button>
        </header>

        {locked ? (
          <div className="briefing-sheet__body">
            <section className="briefing-panel" aria-label="StormPath Plus">
              <h3 className="briefing-panel__h">A smarter start to every drive</h3>
              <ul className="briefing-gate-list">
                <li>Best departure window — beat the storm, not sit in it</li>
                <li>Hazards, weather, and traffic along your exact route</li>
                <li>Why StormPath picked this route over the alternates</li>
              </ul>
              {onSeePlus ? (
                <button
                  type="button"
                  className="briefing-gate__btn"
                  onClick={onSeePlus}
                >
                  See StormPath Plus
                </button>
              ) : null}
            </section>
          </div>
        ) : b ? (
          <BriefingBody b={b} />
        ) : null}
      </div>
    </div>
  );
}

function BriefingBody({ b }: { b: TripBriefing }) {
  const leave = b.leaveCard;
  return (
        <div className="briefing-sheet__body">
          {/* Departure recommendation — the headline card. */}
          <section
            className={`briefing-panel briefing-leave ${leaveTone(leave.kind)}`}
            aria-label="When to leave"
          >
            <h3 className="briefing-panel__h">When to leave</h3>
            {leave.status === "loading" || leave.status === "idle" ? (
              <p className="briefing-leave__headline briefing-leave__headline--muted">
                {leave.headline}
              </p>
            ) : (
              <>
                <p className="briefing-leave__headline">{leave.headline}</p>
                {leave.detail ? (
                  <p className="briefing-leave__detail">{leave.detail}</p>
                ) : null}
                {leave.arriveLabel ? (
                  <p className="briefing-leave__arrive">{leave.arriveLabel}</p>
                ) : null}
                {leave.coverageNote ? (
                  <p className="briefing-leave__coverage">{leave.coverageNote}</p>
                ) : null}
              </>
            )}
          </section>

          {/* Hazards along this route. */}
          <section className="briefing-panel" aria-label="Hazards ahead">
            <h3 className="briefing-panel__h">
              Hazards{b.hazards.length > 0 ? ` · ${b.hazards.length}` : ""}
            </h3>
            {b.hazards.length === 0 ? (
              <p className="briefing-muted">No hazards flagged along this route.</p>
            ) : (
              <ul className="briefing-hazards">
                {b.hazards.map((h) => (
                  <li key={h.id} className="briefing-hazard">
                    <span className={toneDot(h.tone)} aria-hidden="true" />
                    <div className="briefing-hazard__main">
                      <p className="briefing-hazard__headline">{h.headline}</p>
                      {h.sub ? (
                        <p className="briefing-hazard__sub">{h.sub}</p>
                      ) : null}
                      {h.when ? (
                        <p className="briefing-hazard__when">{h.when}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Corridor weather. */}
          {b.weatherLines.length > 0 ? (
            <section className="briefing-panel" aria-label="Weather along the route">
              <h3 className="briefing-panel__h">Weather along the way</h3>
              <ul className="briefing-weather">
                {b.weatherLines.map((line, i) => (
                  <li key={i} className="briefing-weather__line">{line}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Traffic (read-only context — departure rec is weather-only). */}
          {b.trafficLine ? (
            <section className="briefing-panel" aria-label="Traffic">
              <h3 className="briefing-panel__h">Traffic</h3>
              <p className="briefing-line">{b.trafficLine}</p>
            </section>
          ) : null}

          {/* Why this route. */}
          {b.whyLine || b.alternateNote ? (
            <section className="briefing-panel" aria-label="Why this route">
              <h3 className="briefing-panel__h">Why this route</h3>
              {b.whyLine ? <p className="briefing-line">{b.whyLine}</p> : null}
              {b.alternateNote ? (
                <p className="briefing-line briefing-line--muted">{b.alternateNote}</p>
              ) : null}
            </section>
          ) : null}

          <p className="briefing-footnote">{b.freshnessLine}</p>
        </div>
  );
}
