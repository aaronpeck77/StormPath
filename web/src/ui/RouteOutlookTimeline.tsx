import { useMemo } from "react";
import type { WxSample } from "../nav/routeChunkWeather";
import type { RouteOutlookStep } from "../nav/routeForecastTimeline";
import {
  buildRouteOutlookSeries,
  outlookChartScale,
  precipPctFromStep,
  routeOutlookAriaLabel,
} from "../nav/routeForecastTimeline";
import { routePlotLeftPct } from "./routeAxisLayout";

type Props = {
  steps: RouteOutlookStep[];
  samples?: WxSample[];
  userAlongT?: number;
  stripTint?: string;
  variant?: "default" | "synced";
  /** When false, parent draws the shared driver line across outlook + hazards. */
  showDriverLine?: boolean;
  showXTicks?: boolean;
};

const W = 400;
const H = 108;
const PAD = { top: 10, right: 34, bottom: 22, left: 34 };

function xPx(fraction: number): number {
  const innerW = W - PAD.left - PAD.right;
  return PAD.left + Math.max(0, Math.min(1, fraction)) * innerW;
}

function yTemp(tempF: number, tempMin: number, tempMax: number): number {
  const innerH = H - PAD.top - PAD.bottom;
  const span = Math.max(1, tempMax - tempMin);
  const norm = (tempF - tempMin) / span;
  return PAD.top + innerH * (1 - Math.max(0, Math.min(1, norm)));
}

function yPrecip(pct: number, precipMax: number): number {
  const innerH = H - PAD.top - PAD.bottom;
  const norm = pct / Math.max(1, precipMax);
  return PAD.top + innerH * (1 - Math.max(0, Math.min(1, norm)));
}

/** Overlay positions use the same % axis as hazard rails (not stretched SVG text). */
function yPlotPct(yPx: number): number {
  return (yPx / H) * 100;
}

function linePath(
  points: { fraction: number; value: number | null }[],
  yFn: (v: number) => number
): string {
  const parts: string[] = [];
  for (const p of points) {
    if (p.value == null || !Number.isFinite(p.value)) continue;
    const cmd = parts.length === 0 ? "M" : "L";
    parts.push(`${cmd}${xPx(p.fraction).toFixed(1)},${yFn(p.value).toFixed(1)}`);
  }
  return parts.join(" ");
}

export function RouteOutlookTimeline({
  steps,
  samples,
  userAlongT = 0,
  stripTint = "#3b82f6",
  variant = "default",
  showDriverLine = true,
  showXTicks = true,
}: Props) {
  const synced = variant === "synced";

  const series = useMemo(() => buildRouteOutlookSeries(steps, samples), [steps, samples]);
  const scale = useMemo(() => outlookChartScale(series), [series]);
  const tickSteps = useMemo(
    () => [...steps].sort((a, b) => a.fraction - b.fraction),
    [steps]
  );

  if (!series.length) return null;

  const youX = xPx(userAlongT);
  const aria = routeOutlookAriaLabel(steps);

  const tempPath = linePath(
    series.map((p) => ({ fraction: p.fraction, value: p.tempF })),
    (v) => yTemp(v, scale.tempMin, scale.tempMax)
  );
  const precipPath = linePath(
    series.map((p) => ({ fraction: p.fraction, value: p.precipPct })),
    (v) => yPrecip(v, scale.precipMax)
  );
  const tempTicks = [scale.tempMax, Math.round((scale.tempMax + scale.tempMin) / 2), scale.tempMin];
  const precipTicks = [scale.precipMax, Math.round(scale.precipMax / 2), 0];

  return (
    <div
      className={`rotl rotl--line${synced ? " rotl--synced" : ""}`}
      role="img"
      aria-label={aria}
    >
      <div className="rotl__header">
        <span className="rotl__title">Route outlook</span>
        <span className="rotl__axis-hint" aria-hidden>
          {synced ? "Along your drive · YOU → DEST" : "Along route"}
        </span>
      </div>

      <p className="rotl__subtitle" aria-hidden>
        Weather you&apos;ll drive through — changes as you move
      </p>

      <div className="rotl__legend" aria-hidden>
        <span className="rotl__legend-item rotl__legend-item--temp">
          <span className="rotl__legend-swatch" /> Temp °F
        </span>
        <span className="rotl__legend-item rotl__legend-item--precip">
          <span className="rotl__legend-swatch" /> Rain %
        </span>
      </div>

      <div className="rotl__chart-wrap">
        <svg
          className="rotl__chart"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden
        >
          {/* grid */}
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={`g-${f}`}
              x1={xPx(f)}
              y1={PAD.top}
              x2={xPx(f)}
              y2={H - PAD.bottom}
              className="rotl__grid"
            />
          ))}

          {/* baseline */}
          <line
            x1={PAD.left}
            y1={H - PAD.bottom}
            x2={W - PAD.right}
            y2={H - PAD.bottom}
            className="rotl__baseline"
          />

          {/* precip area fill */}
          {precipPath ? (
            <path
              d={`${precipPath} L${xPx(series[series.length - 1]!.fraction).toFixed(1)},${H - PAD.bottom} L${xPx(series[0]!.fraction).toFixed(1)},${H - PAD.bottom} Z`}
              className="rotl__precip-fill"
            />
          ) : null}

          {precipPath ? (
            <path
              d={precipPath}
              className="rotl__line rotl__line--precip"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {tempPath ? (
            <path
              d={tempPath}
              className="rotl__line rotl__line--temp"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}

          {/* YOU — only when not using the shared parent driver line */}
          {showDriverLine && userAlongT > 0.01 && userAlongT < 0.995 ? (
            <line
              x1={youX}
              y1={PAD.top - 2}
              x2={youX}
              y2={H - PAD.bottom + 2}
              className="rotl__you-line"
              style={{ stroke: stripTint }}
            />
          ) : null}
        </svg>

        <div className="rotl__chart-overlay" aria-hidden>
          {tempTicks.map((t, i) => (
            <span
              key={`tl-${i}`}
              className="rotl__axis-label-html rotl__axis-label-html--left"
              style={{ top: `${yPlotPct(yTemp(t, scale.tempMin, scale.tempMax))}%` }}
            >
              {t}°
            </span>
          ))}
          {precipTicks.map((p, i) => (
            <span
              key={`pl-${i}`}
              className="rotl__axis-label-html rotl__axis-label-html--right"
              style={{ top: `${yPlotPct(yPrecip(p, scale.precipMax))}%` }}
            >
              {p}%
            </span>
          ))}
          {tickSteps.map((step) => {
            const precipVal = precipPctFromStep(step);
            const pt = series.find((p) => Math.abs(p.fraction - step.fraction) < 0.03) ?? {
              fraction: step.fraction,
              tempF: step.tempF,
              precipPct: precipVal,
            };
            const title = [
              step.shortLabel,
              step.etaLabel ? `~${step.etaLabel}` : null,
              step.tempF != null ? `${step.tempF}°F` : null,
              step.conditions,
              step.precipPct != null && precipVal > 0 ? `${precipVal}% rain` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            const leftPct = routePlotLeftPct(step.fraction);
            return (
              <span key={step.key} className="rotl__marker-html" title={title}>
                {pt.tempF != null ? (
                  <span
                    className="rotl__dot-html rotl__dot-html--temp"
                    style={{
                      left: `${leftPct}%`,
                      top: `${yPlotPct(yTemp(pt.tempF, scale.tempMin, scale.tempMax))}%`,
                    }}
                  />
                ) : null}
                <span
                  className="rotl__dot-html rotl__dot-html--precip"
                  style={{
                    left: `${leftPct}%`,
                    top: `${yPlotPct(yPrecip(pt.precipPct, scale.precipMax))}%`,
                  }}
                />
              </span>
            );
          })}
        </div>

        {showXTicks ? (
        <div className="rotl__x-ticks" aria-hidden>
          {tickSteps.map((step) => (
            <div
              key={`tick-${step.key}`}
              className="rotl__x-tick"
              style={{ left: `${routePlotLeftPct(step.fraction)}%` }}
              title={step.etaLabel ? `~${step.etaLabel} into trip` : undefined}
            >
              <span className="rotl__x-label">{step.shortLabel}</span>
              {step.etaLabel ? (
                <span className="rotl__x-eta">{step.etaLabel}</span>
              ) : step.fraction <= 0.001 ? (
                <span className="rotl__x-eta">Now</span>
              ) : null}
            </div>
          ))}
          {showDriverLine && userAlongT > 0.01 && userAlongT < 0.995 ? (
            <div className="rotl__you-flag" style={{ left: `${routePlotLeftPct(userAlongT)}%`, color: stripTint }}>
              YOU
            </div>
          ) : null}
        </div>
        ) : null}
      </div>
    </div>
  );
}
