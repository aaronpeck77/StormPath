import type { FractionBand, NightTransition } from "../forecast/chartNightBands";
import { routePlotLeftPct } from "./routeAxisLayout";

export type NightAxisLabel = {
  fraction: number;
  kind: "sunset" | "sunrise" | "night-now";
  title: string;
  time?: string;
  place?: string;
  /** Stagger label up/down when multiple events crowd the axis. */
  stagger?: "top" | "bottom";
};

type RouteNightAxisOverlayProps = {
  bands: FractionBand[];
  transitions?: NightTransition[];
  labels?: NightAxisLabel[];
};

/**
 * Full-height night/day overlay for the Route Info synced graph stack.
 * HTML % positioning matches the YOU → DEST axis (not stretched SVG coords).
 */
export function RouteNightAxisOverlay({
  bands,
  transitions = [],
  labels = [],
}: RouteNightAxisOverlayProps) {
  const hasNight = bands.length > 0 || transitions.length > 0 || labels.length > 0;
  if (!hasNight) return null;

  return (
    <div className="rpgl__night-axis" aria-hidden>
      {bands.map((band, i) => (
        <span
          key={`night-band-${i}-${band.start}`}
          className="rpgl__night-axis-band"
          style={{
            left: `${routePlotLeftPct(band.start)}%`,
            width: `${routePlotLeftPct(band.end) - routePlotLeftPct(band.start)}%`,
          }}
        />
      ))}
      {transitions.map((t, i) => (
        <span
          key={`night-line-${i}-${t.kind}-${t.fraction}`}
          className={`rpgl__night-axis-line rpgl__night-axis-line--${t.kind}`}
          style={{ left: `${routePlotLeftPct(t.fraction)}%` }}
        />
      ))}
      {labels.map((label, i) => (
        <span
          key={`night-label-${i}-${label.kind}-${label.fraction}`}
          className={`rpgl__night-axis-label rpgl__night-axis-label--${label.kind}${
            label.stagger === "bottom" ? " rpgl__night-axis-label--bottom" : ""
          }`}
          style={{ left: `${routePlotLeftPct(label.fraction)}%` }}
          title={[label.title, label.time, label.place].filter(Boolean).join(" · ")}
        >
          <span className="rpgl__night-axis-label-title">{label.title}</span>
          {label.time ? (
            <span className="rpgl__night-axis-label-time">{label.time}</span>
          ) : null}
          {label.place ? (
            <span className="rpgl__night-axis-label-place">{label.place}</span>
          ) : null}
        </span>
      ))}
    </div>
  );
}
