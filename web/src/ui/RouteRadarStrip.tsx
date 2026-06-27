/**
 * Thin radar echo intensity strip — sits between the climate graph (temp/rain/wind)
 * and the NWS/Road event bars. Shows actual RainViewer mosaic intensity as a filled
 * area chart so the driver can see the precipitation profile along the route.
 */
import { useMemo } from "react";
import { radarDisplayIntensity } from "../nav/radarReflectivityScale";
import { routePlotLeftPct } from "./routeAxisLayout";

type RadarSample = { t: number; intensity: number };

const W = 400;
const H = 40;
const PAD_H = 3; // vertical breathing room inside the SVG


function xPx(t: number): number {
  return Math.max(0, Math.min(1, t)) * W;
}

function yPx(display: number): number {
  const inner = H - PAD_H * 2;
  return PAD_H + inner * (1 - Math.max(0, Math.min(1, display)));
}

/** Build an SVG area path from samples, closing at the baseline. */
function buildAreaPath(pts: { t: number; display: number }[]): string {
  if (!pts.length) return "";
  const line = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${xPx(p.t).toFixed(1)},${yPx(p.display).toFixed(1)}`)
    .join(" ");
  const baseline = H - PAD_H;
  return `${line} L${xPx(pts[pts.length - 1]!.t).toFixed(1)},${baseline} L${xPx(pts[0]!.t).toFixed(1)},${baseline} Z`;
}

type Props = {
  samples: RadarSample[];
  /** 0–1 fraction of how far along the route the user currently is */
  userAlongT?: number;
  /** Tint for the YOU line */
  stripTint?: string;
};

export function RouteRadarStrip({ samples, userAlongT = 0, stripTint = "#3b82f6" }: Props) {
  const pts = useMemo(
    () =>
      [...samples]
        .sort((a, b) => a.t - b.t)
        .map((s) => ({ t: s.t, display: radarDisplayIntensity(s.intensity) })),
    [samples]
  );


  const hasAnyEcho = pts.some((p) => p.display >= 0.16);
  const youX = routePlotLeftPct(userAlongT);

  return (
    <div className="rrs" aria-label="Radar precipitation intensity along route">
      <div className="rrs__label-row">
        <span className="rrs__label">Radar · now</span>
        {!hasAnyEcho && <span className="rrs__empty">No precip detected</span>}
      </div>
      <div className="rrs__chart-wrap">
        <svg
          className="rrs__svg"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden
        >
          {/* baseline */}
          <line x1={0} y1={H - PAD_H} x2={W} y2={H - PAD_H} className="rrs__baseline" />

          {/* single smooth area — use one path with per-point color via gradient would be complex,
              so use one path filled with the dominant color tier instead */}
          {hasAnyEcho && pts.length >= 2 ? (
            <>
              {/* background fill — lightest tier covers the whole area */}
              <path
                d={buildAreaPath(pts)}
                fill="rgba(56,189,248,0.18)"
              />
              {/* stronger fills for each intensity tier, clipped to points that exceed the tier */}
              {([
                [0.16, "rgba(56,189,248,0.55)"],
                [0.38, "rgba(59,130,246,0.72)"],
                [0.55, "rgba(99,102,241,0.82)"],
                [0.75, "rgba(139,92,246,0.90)"],
              ] as [number, string][]).map(([threshold, fill]) => {
                const tierPts = pts.map((p) => ({
                  t: p.t,
                  display: Math.max(0, p.display - threshold) / (1 - threshold),
                }));
                if (!tierPts.some((p) => p.display > 0)) return null;
                return (
                  <path
                    key={`tier-${threshold}`}
                    d={buildAreaPath(tierPts)}
                    fill={fill}
                  />
                );
              })}
              {/* top stroke line */}
              <path
                d={pts
                  .map((p, i) => `${i === 0 ? "M" : "L"}${xPx(p.t).toFixed(1)},${yPx(p.display).toFixed(1)}`)
                  .join(" ")}
                fill="none"
                stroke="rgba(56,189,248,0.9)"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            </>
          ) : null}

          {/* YOU line */}
          {userAlongT > 0.01 && userAlongT < 0.995 ? (
            <line
              x1={xPx(userAlongT)}
              y1={PAD_H - 1}
              x2={xPx(userAlongT)}
              y2={H - PAD_H + 1}
              stroke={stripTint}
              strokeWidth={2}
              opacity={0.9}
            />
          ) : null}
        </svg>

        {/* YOU label overlay */}
        {userAlongT > 0.01 && userAlongT < 0.995 ? (
          <span
            className="rrs__you-flag"
            style={{ left: `${youX}%`, color: stripTint }}
          >
            YOU
          </span>
        ) : null}
      </div>
    </div>
  );
}
