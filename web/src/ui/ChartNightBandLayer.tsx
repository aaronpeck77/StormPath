import type { FractionBand } from "../forecast/chartNightBands";

type Props = {
  bands: FractionBand[];
  xPx: (fraction: number) => number;
  yTop: number;
  yBottom: number;
  className?: string;
};

/** Subtle night shading behind route-aligned SVG charts. */
export function ChartNightBandLayer({ bands, xPx, yTop, yBottom, className = "chart-night-band" }: Props) {
  if (!bands.length) return null;
  const height = yBottom - yTop;
  return (
    <>
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
          />
        );
      })}
    </>
  );
}

type HtmlProps = {
  bands: FractionBand[];
  className?: string;
};

/** Night shading overlay for CSS-positioned chart strips (% axis). */
export function ChartNightBandOverlay({ bands, className = "chart-night-overlay" }: HtmlProps) {
  if (!bands.length) return null;
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
    </div>
  );
}
