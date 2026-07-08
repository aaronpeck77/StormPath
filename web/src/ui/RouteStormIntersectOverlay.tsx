import type { StormCorridorBand, StormCorridorEvent } from "../features/stormCorridorIntersect";
import { routePlotLeftPct } from "./routeAxisLayout";

type Props = {
  bands: StormCorridorBand[];
  events: StormCorridorEvent[];
};

/** Experimental rain-intersect markers on the Route Info axis (feature-flagged). */
export function RouteStormIntersectOverlay({ bands, events }: Props) {
  if (!bands.length && !events.length) return null;

  return (
    <div className="rpgl__storm-intersect" aria-hidden>
      {bands.map((band, i) => (
        <span
          key={`storm-band-${i}-${band.start}`}
          className={`rpgl__storm-intersect-band rpgl__storm-intersect-band--${band.level}`}
          style={{
            left: `${routePlotLeftPct(band.start)}%`,
            width: `${routePlotLeftPct(band.end) - routePlotLeftPct(band.start)}%`,
          }}
        />
      ))}
      {events
        .filter((e) => e.kind.startsWith("enter"))
        .map((event, i) => (
          <span
            key={`storm-ev-${i}-${event.kind}-${event.fraction}`}
            className={`rpgl__storm-intersect-line rpgl__storm-intersect-line--${event.kind}`}
            style={{ left: `${routePlotLeftPct(event.fraction)}%` }}
          />
        ))}
      {events
        .filter((e) => e.verdict === "affects_you" || e.verdict === "uncertain")
        .slice(0, 4)
        .map((event, i) => (
          <span
            key={`storm-lbl-${i}-${event.kind}-${event.fraction}`}
            className={`rpgl__storm-intersect-label rpgl__storm-intersect-label--${event.kind}${
              i % 2 === 1 ? " rpgl__storm-intersect-label--bottom" : ""
            }`}
            style={{ left: `${routePlotLeftPct(event.fraction)}%` }}
            title={event.line}
          >
            <span className="rpgl__storm-intersect-label-title">
              {event.kind === "enter_heavy" ? "Heavy rain" : "Rain"}
            </span>
            {event.etaMinutes != null ? (
              <span className="rpgl__storm-intersect-label-time">
                {event.etaMinutes < 60
                  ? `~${Math.round(event.etaMinutes)} min`
                  : `~${Math.round(event.etaMinutes / 60)} hr`}
              </span>
            ) : null}
          </span>
        ))}
    </div>
  );
}
