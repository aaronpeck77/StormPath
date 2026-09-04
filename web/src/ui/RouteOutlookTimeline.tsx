import { useId, useMemo } from "react";
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
/** Compact per-track height in the Route info synced stack. */
const H_SYNC = 38;
const PAD = { top: 10, right: 34, bottom: 22, left: 34 };
const PAD_SYNC = { top: 5, right: 30, bottom: 5, left: 34 };

function xPx(fraction: number, padL = PAD.left, padR = PAD.right): number {
  const innerW = W - padL - padR;
  return padL + Math.max(0, Math.min(1, fraction)) * innerW;
}

function yTemp(
  tempF: number,
  tempMin: number,
  tempMax: number,
  h = H,
  padT = PAD.top,
  padB = PAD.bottom
): number {
  const innerH = h - padT - padB;
  const span = Math.max(1, tempMax - tempMin);
  const norm = (tempF - tempMin) / span;
  return padT + innerH * (1 - Math.max(0, Math.min(1, norm)));
}

function yPrecip(
  pct: number,
  precipMax: number,
  h = H,
  padT = PAD.top,
  padB = PAD.bottom
): number {
  const innerH = h - padT - padB;
  const norm = pct / Math.max(1, precipMax);
  return padT + innerH * (1 - Math.max(0, Math.min(1, norm)));
}

/** Overlay positions use the same % axis as hazard rails (not stretched SVG text). */
function yPlotPct(yPxVal: number, h = H): number {
  return (yPxVal / h) * 100;
}

/** Blue (cold) → orange → red (hot) for temp markers along the outlook line. */
function tempDotColor(tempF: number, tempMin: number, tempMax: number): string {
  const span = Math.max(1, tempMax - tempMin);
  const t = Math.max(0, Math.min(1, (tempF - tempMin) / span));
  if (t < 0.45) {
    const u = t / 0.45;
    return lerpHex("#38bdf8", "#fb923c", u);
  }
  const u = (t - 0.45) / 0.55;
  return lerpHex("#fb923c", "#ef4444", u);
}

function lerpHex(a: string, b: string, t: number): string {
  const parse = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ] as const;
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}

function linePath(
  points: { fraction: number; value: number | null }[],
  yFn: (v: number) => number,
  padL = PAD.left,
  padR = PAD.right
): string {
  const parts: string[] = [];
  for (const p of points) {
    if (p.value == null || !Number.isFinite(p.value)) continue;
    const cmd = parts.length === 0 ? "M" : "L";
    parts.push(`${cmd}${xPx(p.fraction, padL, padR).toFixed(1)},${yFn(p.value).toFixed(1)}`);
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
  const tempGradId = useId().replace(/:/g, "");

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

  /* ── Synced Route-info stack: Temp + Rain each get their own labeled row ── */
  if (synced) {
    const pad = PAD_SYNC;
    const h = H_SYNC;
    const syncTempPath = linePath(
      series.map((p) => ({ fraction: p.fraction, value: p.tempF })),
      (v) => yTemp(v, scale.tempMin, scale.tempMax, h, pad.top, pad.bottom),
      pad.left,
      pad.right
    );
    const syncPrecipPath = linePath(
      series.map((p) => ({ fraction: p.fraction, value: p.precipPct })),
      (v) => yPrecip(v, scale.precipMax, h, pad.top, pad.bottom),
      pad.left,
      pad.right
    );
    const syncTempTicks = [
      scale.tempMax,
      Math.round((scale.tempMax + scale.tempMin) / 2),
      scale.tempMin,
    ];
    const syncPrecipTicks = [scale.precipMax, Math.round(scale.precipMax / 2), 0];

    return (
      <div className="rotl rotl--line rotl--synced" role="img" aria-label={aria}>
        <div className="rpgl__layer rpgl__layer--temp">
          <span className="rpgl__layer-label rpgl__layer-label--temp">Temp</span>
          <div className="rpgl__layer-plot">
            <svg
              className="rotl__chart rotl__chart--sync-track"
              viewBox={`0 0 ${W} ${h}`}
              preserveAspectRatio="none"
              aria-hidden
            >
              <line
                x1={pad.left}
                y1={h - pad.bottom}
                x2={W - pad.right}
                y2={h - pad.bottom}
                className="rotl__baseline"
              />
              <defs>
                <linearGradient
                  id={tempGradId}
                  gradientUnits="userSpaceOnUse"
                  x1={0}
                  y1={yTemp(scale.tempMax, scale.tempMin, scale.tempMax, h, pad.top, pad.bottom)}
                  x2={0}
                  y2={yTemp(scale.tempMin, scale.tempMin, scale.tempMax, h, pad.top, pad.bottom)}
                >
                  <stop offset="0%" stopColor="#ef4444" />
                  <stop offset="45%" stopColor="#fb923c" />
                  <stop offset="100%" stopColor="#38bdf8" />
                </linearGradient>
              </defs>
              {syncTempPath ? (
                <path
                  d={syncTempPath}
                  className="rotl__line rotl__line--temp"
                  style={{ stroke: `url(#${tempGradId})` }}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </svg>
            <div className="rotl__chart-overlay" aria-hidden>
              {syncTempTicks.map((t, i) => (
                <span
                  key={`stl-${i}`}
                  className="rotl__axis-label-html rotl__axis-label-html--right"
                  style={{
                    top: `${yPlotPct(
                      yTemp(t, scale.tempMin, scale.tempMax, h, pad.top, pad.bottom),
                      h
                    )}%`,
                  }}
                >
                  {t}°
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="rpgl__layer rpgl__layer--rain">
          <span className="rpgl__layer-label rpgl__layer-label--rain">Rain</span>
          <div className="rpgl__layer-plot">
            <svg
              className="rotl__chart rotl__chart--sync-track"
              viewBox={`0 0 ${W} ${h}`}
              preserveAspectRatio="none"
              aria-hidden
            >
              <line
                x1={pad.left}
                y1={h - pad.bottom}
                x2={W - pad.right}
                y2={h - pad.bottom}
                className="rotl__baseline"
              />
              {syncPrecipPath ? (
                <path
                  d={`${syncPrecipPath} L${xPx(series[series.length - 1]!.fraction, pad.left, pad.right).toFixed(1)},${h - pad.bottom} L${xPx(series[0]!.fraction, pad.left, pad.right).toFixed(1)},${h - pad.bottom} Z`}
                  className="rotl__precip-fill"
                />
              ) : null}
              {syncPrecipPath ? (
                <path
                  d={syncPrecipPath}
                  className="rotl__line rotl__line--precip"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </svg>
            <div className="rotl__chart-overlay" aria-hidden>
              {syncPrecipTicks.map((p, i) => (
                <span
                  key={`spl-${i}`}
                  className="rotl__axis-label-html rotl__axis-label-html--right"
                  style={{
                    top: `${yPlotPct(
                      yPrecip(p, scale.precipMax, h, pad.top, pad.bottom),
                      h
                    )}%`,
                  }}
                >
                  {p}%
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rotl rotl--line${synced ? " rotl--synced" : ""}`}
      role="img"
      aria-label={aria}
    >
      <div className="rotl__header">
        <span className="rotl__title">Route outlook</span>
        <span className="rotl__axis-hint" aria-hidden>
          Along route
        </span>
      </div>

      <p className="rotl__subtitle" aria-hidden>
        Rain chance when intensity or wording supports it — not every model POP along the corridor
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

          <line
            x1={PAD.left}
            y1={H - PAD.bottom}
            x2={W - PAD.right}
            y2={H - PAD.bottom}
            className="rotl__baseline"
          />

          {precipPath ? (
            <path
              d={`${precipPath} L${xPx(series[series.length - 1]!.fraction).toFixed(1)},${H - PAD.bottom} L${xPx(series[0]!.fraction).toFixed(1)},${H - PAD.bottom} Z`}
              className="rotl__precip-fill"
            />
          ) : null}

          <defs>
            <linearGradient
              id={tempGradId}
              gradientUnits="userSpaceOnUse"
              x1={0}
              y1={yTemp(scale.tempMax, scale.tempMin, scale.tempMax)}
              x2={0}
              y2={yTemp(scale.tempMin, scale.tempMin, scale.tempMax)}
            >
              <stop offset="0%" stopColor="#ef4444" />
              <stop offset="45%" stopColor="#fb923c" />
              <stop offset="100%" stopColor="#38bdf8" />
            </linearGradient>
          </defs>

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
              style={{ stroke: `url(#${tempGradId})` }}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}

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
                      background: tempDotColor(pt.tempF, scale.tempMin, scale.tempMax),
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
              <div
                className="rotl__you-flag"
                style={{ left: `${routePlotLeftPct(userAlongT)}%`, color: stripTint }}
              >
                YOU
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
