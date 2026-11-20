/**
 * Route Info weather lanes — Temp / Precip / Radar / Wind.
 *
 * Ground-up replacement for the RouteOutlookTimeline + RouteRadarWindStrip
 * stack (Bill, Nov 20): the old stack's Temp lane stroked via
 * `style="stroke:url(#gradient)"` — url() inside a CSS style attribute fails
 * to resolve in the iOS WebView, so the lane emitted markup but painted
 * nothing while wind/radar (plain presentation attributes) drew fine.
 *
 * Rules this component lives by:
 *  - Presentation attributes only (stroke=/fill=/strokeWidth on elements).
 *    No `style`, no `url(#id)`, no class-dependent data strokes — nothing in
 *    a stylesheet can kill a lane.
 *  - Non-finite values are filtered before pathing; a single finite point is
 *    expanded to a short segment; an empty lane gets a flat "no data" trace.
 *    A lane can never be silently blank.
 */
import { useMemo } from "react";
import type { WxSample } from "../nav/routeChunkWeather";
import type { RouteOutlookStep } from "../nav/routeForecastTimeline";
import { buildRouteOutlookSeries } from "../nav/routeForecastTimeline";
import { RADAR_SOFT_THRESHOLD } from "../nav/constants";
import { radarDisplayIntensity } from "../nav/radarReflectivityScale";
import { routeWindGraphScaleMph } from "../nav/windForecastCalib";

type Pt = { t: number; v: number };
type WindPoint = { t: number; mph: number };
type RadarSample = { t: number; intensity: number };

const W = 400;
const H = 36;
const PAD_L = 6;
const PAD_R = 6;
const PAD_V = 4;
const INNER_W = W - PAD_L - PAD_R;
const INNER_H = H - PAD_V * 2;
const BASE_Y = H - PAD_V;

const C = {
  baseline: "rgba(148,163,184,0.35)",
  nodata: "rgba(148,163,184,0.55)",
  temp: "#fb923c",
  precip: "#38bdf8",
  precipFill: "rgba(56,189,248,0.16)",
  radar: "rgba(56,189,248,0.62)",
  radarFill: "rgba(56,189,248,0.12)",
  wind: "#f59e0b",
  gust: "#fb923c",
};

function xPx(t: number): number {
  return PAD_L + Math.max(0, Math.min(1, t)) * INNER_W;
}
function yPx(norm: number): number {
  return PAD_V + INNER_H * (1 - Math.max(0, Math.min(1, norm)));
}

/** Finite points only, sorted; a lone point is widened into a short stub. */
function cleanPts(pts: Pt[]): Pt[] {
  const out = pts
    .map((p) => ({ t: Number(p.t), v: Number(p.v) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
  if (out.length === 1) {
    const p = out[0]!;
    return [
      { t: Math.max(0, p.t - 0.02), v: p.v },
      { t: Math.min(1, p.t + 0.02), v: p.v },
    ];
  }
  return out;
}

function linePath(pts: Pt[], yFor: (v: number) => number): string {
  return pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${xPx(p.t).toFixed(1)},${yFor(p.v).toFixed(1)}`)
    .join(" ");
}
function areaPath(pts: Pt[], yFor: (v: number) => number): string {
  const line = linePath(pts, yFor);
  if (!line) return "";
  return `${line} L${xPx(pts[pts.length - 1]!.t).toFixed(1)},${BASE_Y} L${xPx(pts[0]!.t).toFixed(1)},${BASE_Y} Z`;
}

function Lane(props: {
  label: string;
  labelClass: string;
  layerClass: string;
  children: React.ReactNode;
  readout?: React.ReactNode;
}) {
  return (
    <div className={`rpgl__layer ${props.layerClass}`}>
      <span className={`rpgl__layer-label ${props.labelClass}`}>{props.label}</span>
      <div className="rpgl__layer-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden
          style={{ display: "block", width: "100%", height: 34 }}
        >
          <line
            x1={PAD_L}
            y1={BASE_Y}
            x2={W - PAD_R}
            y2={BASE_Y}
            stroke={C.baseline}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {props.children}
        </svg>
        {props.readout}
      </div>
    </div>
  );
}

function NodataTrace({ y = BASE_Y - 4 }: { y?: number }) {
  return (
    <line
      x1={PAD_L}
      y1={y}
      x2={W - PAD_R}
      y2={y}
      stroke={C.nodata}
      strokeWidth={2}
      strokeDasharray="6 4"
      vectorEffect="non-scaling-stroke"
    />
  );
}

function valueAt(pts: Pt[], t: number): number | null {
  const p = cleanPts(pts);
  if (!p.length) return null;
  const c = Math.max(0, Math.min(1, t));
  if (c <= p[0]!.t) return p[0]!.v;
  for (let i = 1; i < p.length; i++) {
    if (p[i]!.t >= c) {
      const a = p[i - 1]!;
      const b = p[i]!;
      const span = b.t - a.t;
      const u = span > 0 ? (c - a.t) / span : 0;
      return a.v + (b.v - a.v) * u;
    }
  }
  return p[p.length - 1]!.v;
}

export type RouteWxLanesProps = {
  steps: RouteOutlookStep[];
  samples?: WxSample[];
  radarSamples?: RadarSample[];
  windPoints?: WindPoint[];
  gustLinePoints?: WindPoint[];
  gustSpikePoints?: WindPoint[];
  userAlongT?: number;
};

export function RouteWxLanes({
  steps,
  samples,
  radarSamples = [],
  windPoints = [],
  gustLinePoints = [],
  gustSpikePoints = [],
  userAlongT = 0,
}: RouteWxLanesProps) {
  const series = useMemo(
    () => buildRouteOutlookSeries(steps, samples),
    [steps, samples]
  );

  const tempPts = useMemo(
    () => cleanPts(series.map((p) => ({ t: p.fraction, v: p.tempF ?? NaN }))),
    [series]
  );
  const tempSpan = useMemo(() => {
    const vs = tempPts.map((p) => p.v);
    const lo = Math.min(...vs) - 3;
    const hi = Math.max(...vs) + 3;
    return { lo, hi: hi <= lo ? lo + 1 : hi };
  }, [tempPts]);
  const tempY = (v: number) => yPx((v - tempSpan.lo) / (tempSpan.hi - tempSpan.lo));

  const precipPts = useMemo(
    () =>
      cleanPts(
        series
          .filter((p) => Number.isFinite(p.precipPct))
          .map((p) => ({ t: p.fraction, v: p.precipPct }))
      ),
    [series]
  );
  const precipMax = Math.max(40, ...precipPts.map((p) => p.v));
  const precipY = (v: number) => yPx(v / precipMax);

  const radarPts = useMemo(() => {
    const ds = radarSamples.map((s) => ({
      t: s.t,
      d: radarDisplayIntensity(s.intensity),
    }));
    const max = Math.max(0, ...ds.map((x) => x.d));
    const ceil = Math.max(max * 1.08, RADAR_SOFT_THRESHOLD * 0.85, 0.12);
    const sorted = ds
      .sort((a, b) => a.t - b.t)
      .map((x) => ({ t: x.t, v: Math.min(1, x.d / ceil), d: x.d }));
    if (sorted.length) {
      if (sorted[0]!.t > 0.01) sorted.unshift({ ...sorted[0]!, t: 0 });
      if (sorted[sorted.length - 1]!.t < 0.99) sorted.push({ ...sorted[sorted.length - 1]!, t: 1 });
    }
    return sorted;
  }, [radarSamples]);
  const hasRadar = radarPts.some((p) => p.d >= RADAR_SOFT_THRESHOLD);
  const radarTrace = cleanPts(radarPts.map((p) => ({ t: p.t, v: p.v })));

  const windPts = useMemo(() => {
    const primary = gustLinePoints.length >= 2 ? gustLinePoints : windPoints;
    return cleanPts(
      primary.filter((p) => Number(p.mph) > 0).map((p) => ({ t: p.t, v: p.mph }))
    );
  }, [gustLinePoints, windPoints]);
  const gustTicks = useMemo(
    () =>
      cleanPts(
        gustSpikePoints
          .filter((p) => Number(p.mph) > 0)
          .map((p) => ({ t: p.t, v: p.mph }))
      ),
    [gustSpikePoints]
  );
  const windMax = useMemo(
    () =>
      routeWindGraphScaleMph([
        ...windPts.map((p) => p.v),
        ...gustTicks.map((p) => p.v),
      ]),
    [windPts, gustTicks]
  );
  const windY = (v: number) => yPx(v / windMax);

  const tempNow = valueAt(tempPts, userAlongT);
  const windNow = valueAt(windPts, userAlongT);

  return (
    <div>
      <Lane
        label="Temp"
        labelClass="rpgl__layer-label--temp"
        layerClass="rpgl__layer--temp"
        readout={
          tempNow != null ? (
            <span className="rpgl__readout rpgl__readout--temp">
              {Math.round(tempNow)}°
            </span>
          ) : undefined
        }
      >
        {tempPts.length ? (
          <path
            d={linePath(tempPts, tempY)}
            fill="none"
            stroke={C.temp}
            strokeWidth={2.4}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <NodataTrace y={PAD_V + INNER_H / 2} />
        )}
      </Lane>

      <Lane label="Precip" labelClass="rpgl__layer-label--rain" layerClass="rpgl__layer--rain">
        {precipPts.length ? (
          <>
            <path d={areaPath(precipPts, precipY)} fill={C.precipFill} stroke="none" />
            <path
              d={linePath(precipPts, precipY)}
              fill="none"
              stroke={C.precip}
              strokeWidth={2.2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </>
        ) : (
          <NodataTrace />
        )}
      </Lane>

      <Lane label="Radar" labelClass="rpgl__layer-label--radar" layerClass="rpgl__layer--radar">
        {radarTrace.length >= 2 && radarPts.some((p) => p.v >= 0.04) ? (
          <>
            <path d={areaPath(radarTrace, yPx)} fill={C.radarFill} stroke="none" />
            <path
              d={linePath(radarTrace, yPx)}
              fill="none"
              stroke={C.radar}
              strokeWidth={hasRadar ? 1.4 : 1.1}
              strokeDasharray={hasRadar ? undefined : "3 2"}
              vectorEffect="non-scaling-stroke"
            />
          </>
        ) : (
          <NodataTrace />
        )}
      </Lane>

      <Lane label="Wind" labelClass="rpgl__layer-label--wind" layerClass="rpgl__layer--wind"
        readout={
          windNow != null ? (
            <span className="rpgl__readout rpgl__readout--wind">
              {Math.round(windNow)} mph
            </span>
          ) : undefined
        }
      >
        {windPts.length >= 2 ? (
          <>
            <path
              d={linePath(windPts, windY)}
              fill="none"
              stroke={C.wind}
              strokeWidth={2.2}
              strokeDasharray="5 3"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {gustTicks.map((p, i) => (
              <line
                key={`g${i}`}
                x1={xPx(p.t)}
                y1={BASE_Y}
                x2={xPx(p.t)}
                y2={windY(p.v)}
                stroke={C.gust}
                strokeWidth={2}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </>
        ) : (
          <NodataTrace />
        )}
      </Lane>
    </div>
  );
}
