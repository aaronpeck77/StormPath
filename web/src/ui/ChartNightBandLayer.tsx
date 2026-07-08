import type { FractionBand, NightTransition } from "../forecast/chartNightBands";

type Props = {
  bands: FractionBand[];
  xPx: (fraction: number) => number;
  yTop: number;
  yBottom: number;
  className?: string;
  /** Vertical dusk/dawn markers drawn above the smoky fill. */
  transitions?: NightTransition[];
};

const SMOKE_GRAD_ID = "chart-night-smoke";

/** Smoky civil-night shading behind route-aligned SVG charts. */
export function ChartNightBandLayer({
  bands,
  xPx,
  yTop,
  yBottom,
  className = "chart-night-band",
  transitions = [],
}: Props) {
  if (!bands.length && !transitions.length) return null;
  const height = yBottom - yTop;

  return (
    <>
      {bands.length > 0 ? (
        <defs>
          <linearGradient id={SMOKE_GRAD_ID} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(30, 41, 59, 0.42)" />
            <stop offset="10%" stopColor="rgba(30, 41, 59, 0.28)" />
            <stop offset="100%" stopColor="rgba(30, 41, 59, 0.14)" />
          </linearGradient>
        </defs>
      ) : null}
      {bands.map((band, i) => {
        const x = xPx(band.start);
        const w = Math.max(0, xPx(band.end) - x);
        if (w < 0.5) return null;
        return (
          <rect
            key={`night-${i}-${band.start}`}
            x={x}
            y={yTop}
            width={w}
            height={height}
            className={className}
            fill={`url(#${SMOKE_GRAD_ID})`}
          />
        );
      })}
      {transitions.map((t, i) => {
        const x = xPx(t.fraction);
        return (
          <line
            key={`night-t-${i}-${t.kind}-${t.fraction}`}
            x1={x}
            x2={x}
            y1={yTop}
            y2={yBottom}
            className={`chart-night-transition chart-night-transition--${t.kind}`}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </>
  );
}

type HtmlProps = {
  bands: FractionBand[];
  transitions?: NightTransition[];
  className?: string;
};

/** Night shading overlay for CSS-positioned chart strips (% axis). */
export function ChartNightBandOverlay({
  bands,
  transitions = [],
  className = "chart-night-overlay",
}: HtmlProps) {
  if (!bands.length && !transitions.length) return null;
  return (
    <div className={className} aria-hidden>
      {bands.map((band, i) => (
        <span
          key={`night-${i}-${band.start}`}
          className="chart-night-overlay__band"
          style={{
            left: `${band.start * 100}%`,
            width: `${(band.end - band.start) * 100}%`,
          }}
        />
      ))}
      {transitions.map((t, i) => (
        <span
          key={`night-t-${i}-${t.kind}-${t.fraction}`}
          className={`chart-night-overlay__transition chart-night-overlay__transition--${t.kind}`}
          style={{ left: `${t.fraction * 100}%` }}
        />
      ))}
    </div>
  );
}
