/**
 * Combined radar echo + wind gust strata.
 *
 * Radar intensity (RainViewer mosaic) rises from the baseline as a layered
 * area fill (light-blue → indigo → violet by severity). Wind gusts are
 * overlaid as an amber dashed line on the same 0→1 y-scale so you can see
 * at a glance: both elevated = thunderstorm, wind only = dry gust event,
 * radar only = steady rain without significant wind.
 *
 * X-axis uses the same 34px (8.5%) inset as RouteOutlookTimeline so all
 * three strata share one aligned route axis.
 */
import { useMemo } from "react";
import { radarDisplayIntensity } from "../nav/radarReflectivityScale";

type RadarSample = { t: number; intensity: number };
type WindPoint = { t: number; mph: number };

const W = 400;
const H = 60;
const PAD_L = 34;   // matches RouteOutlookTimeline PAD.left
const PAD_R = 34;   // matches RouteOutlookTimeline PAD.right
const PAD_V = 4;

const INNER_W = W - PAD_L - PAD_R;
const INNER_H = H - PAD_V * 2;
const BASELINE_Y = H - PAD_V;

function xPx(t: number): number {
  return PAD_L + Math.max(0, Math.min(1, t)) * INNER_W;
}

function yPx(norm: number): number {
  return PAD_V + INNER_H * (1 - Math.max(0, Math.min(1, norm)));
}

function areaPath(pts: { t: number; norm: number }[]): string {
  if (pts.length < 2) return "";
  const line = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${xPx(p.t).toFixed(1)},${yPx(p.norm).toFixed(1)}`)
    .join(" ");
  return `${line} L${xPx(pts[pts.length - 1]!.t).toFixed(1)},${BASELINE_Y} L${xPx(pts[0]!.t).toFixed(1)},${BASELINE_Y} Z`;
}

function linePath(pts: { t: number; norm: number }[]): string {
  return pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${xPx(p.t).toFixed(1)},${yPx(p.norm).toFixed(1)}`)
    .join(" ");
}


type Props = {
  radarSamples: RadarSample[];
  /** Wind gust points from TIO forecast (t=0–1 along route). */
  windPoints: WindPoint[];
};

export function RouteRadarWindStrip({ radarSamples, windPoints }: Props) {
  /* ── Radar ── */
  const radarPts = useMemo(() => {
    const sorted = [...radarSamples]
      .sort((a, b) => a.t - b.t)
      .map((s) => ({ t: s.t, norm: radarDisplayIntensity(s.intensity) }));
    // Anchor to t=0 and t=1 so the fill spans the full route axis
    if (sorted.length > 0) {
      if (sorted[0]!.t > 0.01) sorted.unshift({ t: 0, norm: sorted[0]!.norm });
      if (sorted[sorted.length - 1]!.t < 0.99) sorted.push({ t: 1, norm: sorted[sorted.length - 1]!.norm });
    }
    return sorted;
  }, [radarSamples]);

  /* ── Wind ── */
  const sortedWind = useMemo(
    () => [...windPoints].filter((p) => p.mph > 0).sort((a, b) => a.t - b.t),
    [windPoints]
  );

  const windMax = useMemo(
    () =>
      sortedWind.length
        ? Math.max(30, Math.ceil(Math.max(...sortedWind.map((p) => p.mph)) / 10) * 10)
        : 30,
    [sortedWind]
  );

  const windPts = useMemo(
    () => sortedWind.map((p) => ({ t: p.t, norm: p.mph / windMax, mph: p.mph })),
    [sortedWind, windMax]
  );

  const hasRadarEcho = radarPts.some((p) => p.norm >= 0.16);
  const hasRadarTrace =
    radarPts.length >= 2 && radarPts.some((p) => p.norm >= 0.04);
  const hasWind = windPts.length >= 2;
  const isEmpty = !hasRadarTrace && !hasWind;

  const windTicks = hasWind
    ? [windMax, Math.round(windMax / 2), 0].map((mph) => ({
        mph,
        topPct: (yPx(mph / windMax) / H) * 100,
      }))
    : [];

  return (
    <div className="rrws" aria-label="Radar precipitation and wind gusts along route">
      {/* Wind key stays in the top row; Radar label moves into the chart's left pad */}
      <div className="rrws__label-row">
        <span className="rrws__legend-item">
          <span className="rrws__swatch rrws__swatch--wind" aria-hidden />
          <span className="rrws__label rrws__label--wind">
            Wind gusts{hasWind ? ` (${windMax} mph max)` : ""}
          </span>
        </span>
        {isEmpty && <span className="rrws__empty">No data</span>}
      </div>

      <div className="rrws__chart-wrap">
        <svg
          className="rrws__svg"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden
        >
          <line x1={PAD_L} y1={BASELINE_Y} x2={W - PAD_R} y2={BASELINE_Y} className="rrws__baseline" />

          {/* ── Radar echo — layered area fills ── */}
          {hasRadarEcho && radarPts.length >= 2 && (
            <>
              <path d={areaPath(radarPts)} fill="rgba(56,189,248,0.15)" />
              {([
                [0.16, "rgba(56,189,248,0.50)"],
                [0.38, "rgba(59,130,246,0.68)"],
                [0.55, "rgba(99,102,241,0.80)"],
                [0.75, "rgba(139,92,246,0.88)"],
              ] as [number, string][]).map(([thr, fill]) => {
                const pts = radarPts.map((p) => ({
                  t: p.t,
                  norm: Math.max(0, p.norm - thr) / (1 - thr),
                }));
                if (!pts.some((p) => p.norm > 0)) return null;
                return <path key={`r${thr}`} d={areaPath(pts)} fill={fill} />;
              })}
              <path
                d={linePath(radarPts)}
                fill="none"
                stroke="rgba(56,189,248,0.85)"
                strokeWidth={1.2}
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
          {hasRadarTrace && !hasRadarEcho && (
            <>
              <path d={areaPath(radarPts)} fill="rgba(56,189,248,0.08)" />
              <path
                d={linePath(radarPts)}
                fill="none"
                stroke="rgba(56,189,248,0.45)"
                strokeWidth={1.1}
                strokeDasharray="3 2"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}

          {/* ── Wind gust line — solid, no fill ── */}
          {hasWind && (
            <path
              d={linePath(windPts)}
              fill="none"
              stroke="#f59e0b"
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* Radar label — sits in the left pad area, vertically centred */}
        <span className="rrws__radar-side-label">Radar</span>

        {/* Wind mph axis labels — right pad */}
        {windTicks.map(({ mph, topPct }) => (
          <span key={`wa${mph}`} className="rrws__axis-label" style={{ top: `${topPct.toFixed(1)}%` }}>
            {mph}
          </span>
        ))}
      </div>
    </div>
  );
}
