/**
 * Route Info weather lanes — Temp / Precip / Radar / Wind.
 *
 * Canvas rebuild (Bill, Nov 20): the SVG stack emitted perfect markup but
 * painted nothing on iOS — three fixes landed and lanes still showed empty
 * while the dump proved data present (ol:5 tmp:5 pr:68). Canvas paints
 * pixels imperatively: no DOM children, no stylesheet, no url(), no grid
 * placement can hide a drawn line. Layout is fully inline so no external
 * CSS can zero or hide a lane.
 *
 * Self-instrumented: wxLanesDebug counts mounted lanes + painted points per
 * lane; App appends `wl:` to the Wx: dump so a blank panel explains itself.
 */
import { useEffect, useMemo, useRef } from "react";
import type { WxSample } from "../nav/routeChunkWeather";
import type { RouteOutlookStep } from "../nav/routeForecastTimeline";
import { buildRouteOutlookSeries } from "../nav/routeForecastTimeline";
import { RADAR_SOFT_THRESHOLD } from "../nav/constants";
import { radarDisplayIntensity } from "../nav/radarReflectivityScale";
import { routeWindGraphScaleMph } from "../nav/windForecastCalib";

type Pt = { t: number; v: number };
type WindPoint = { t: number; mph: number };
type RadarSample = { t: number; intensity: number };

const LANE_H = 34;
const PAD_L = 6;
const PAD_R = 6;
const PAD_V = 4;

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

/** Read by the Wx: dump in App — wl:mounts/temp/precip/radar/wind. */
export const wxLanesDebug = {
  mounts: 0,
  temp: 0,
  precip: 0,
  radar: 0,
  wind: 0,
};

function xPx(t: number, w: number): number {
  return PAD_L + Math.max(0, Math.min(1, t)) * Math.max(0, w - PAD_L - PAD_R);
}
function yPx(norm: number, h: number): number {
  const inner = h - PAD_V * 2;
  return PAD_V + inner * (1 - Math.max(0, Math.min(1, norm)));
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

function paintBaseline(ctx: CanvasRenderingContext2D, w: number) {
  ctx.strokeStyle = C.baseline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_L, LANE_H - PAD_V);
  ctx.lineTo(w - PAD_R, LANE_H - PAD_V);
  ctx.stroke();
}

function paintNodata(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.strokeStyle = C.nodata;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(PAD_L, h - PAD_V - 4);
  ctx.lineTo(w - PAD_R, h - PAD_V - 4);
  ctx.stroke();
  ctx.setLineDash([]);
}

function paintLine(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  w: number,
  yFor: (v: number) => number,
  stroke: string,
  width: number,
  dash?: number[]
) {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = xPx(p.t, w);
    const y = yFor(p.v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  if (dash) ctx.setLineDash([]);
}

function paintArea(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  w: number,
  h: number,
  yFor: (v: number) => number,
  fill: string
) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = xPx(p.t, w);
    const y = yFor(p.v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(xPx(pts[pts.length - 1]!.t, w), h - PAD_V);
  ctx.lineTo(xPx(pts[0]!.t, w), h - PAD_V);
  ctx.closePath();
  ctx.fill();
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

/* ── Lane: label chip + canvas. All styling inline — nothing in a stylesheet
 *   can resize, hide, or reorder these boxes. */
function Lane(props: {
  label: string;
  labelColor: string;
  boxBg: string;
  boxEdge: string;
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  readout?: React.ReactNode;
  debugKey: keyof typeof wxLanesDebug;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paintRef = useRef(props.paint);
  paintRef.current = props.paint;

  useEffect(() => {
    wxLanesDebug.mounts += 1;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 0;
      if (w < 8) return;
      const dpr = window.devicePixelRatio || 1;
      const pxW = Math.round(w * dpr);
      const pxH = Math.round(LANE_H * dpr);
      if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW;
        canvas.height = pxH;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, LANE_H);
      paintRef.current(ctx, w, LANE_H);
    };
    draw();
    const ro = new ResizeObserver(draw);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const w = canvas?.clientWidth || 0;
    if (!canvas || w < 8) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(LANE_H * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, LANE_H);
    props.paint(ctx, w, LANE_H);
  });

  return (
    <div
      style={{
        position: "relative",
        padding: "3px 4px 3px 2px",
        borderRadius: 7,
        background: props.boxBg,
        boxShadow: `inset 0 0 0 1px ${props.boxEdge}`,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: 6,
          zIndex: 3,
          padding: "1px 5px",
          borderRadius: 4,
          background: "rgba(2,6,23,0.72)",
          color: props.labelColor,
          fontSize: "0.56rem",
          fontWeight: 850,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          lineHeight: 1.3,
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        {props.label}
      </span>
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{ display: "block", width: "100%", height: LANE_H }}
      />
      {props.readout}
    </div>
  );
}

function Readout(props: { color: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        position: "absolute",
        top: 3,
        right: 6,
        zIndex: 3,
        padding: "1px 6px",
        borderRadius: 4,
        background: "rgba(2,6,23,0.78)",
        border: "1px solid rgba(148,163,184,0.25)",
        color: props.color,
        fontSize: "0.6rem",
        fontWeight: 800,
        fontVariantNumeric: "tabular-nums",
        lineHeight: 1.5,
        pointerEvents: "none",
      }}
    >
      {props.children}
    </span>
  );
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
  const series = useMemo(() => buildRouteOutlookSeries(steps, samples), [steps, samples]);

  const tempPts = useMemo(
    () => cleanPts(series.map((p) => ({ t: p.fraction, v: p.tempF ?? NaN }))),
    [series]
  );
  const tempSpan = useMemo(() => {
    const vs = tempPts.map((p) => p.v);
    const lo = vs.length ? Math.min(...vs) - 3 : 0;
    const hi = vs.length ? Math.max(...vs) + 3 : 1;
    return { lo, hi: hi <= lo ? lo + 1 : hi };
  }, [tempPts]);

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

  const radarPts = useMemo(() => {
    const ds = radarSamples.map((s) => ({ t: s.t, d: radarDisplayIntensity(s.intensity) }));
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
    () => routeWindGraphScaleMph([...windPts.map((p) => p.v), ...gustTicks.map((p) => p.v)]),
    [windPts, gustTicks]
  );

  const tempNow = valueAt(tempPts, userAlongT);
  const windNow = valueAt(windPts, userAlongT);

  wxLanesDebug.temp = tempPts.length;
  wxLanesDebug.precip = precipPts.length;
  wxLanesDebug.radar = radarTrace.length;
  wxLanesDebug.wind = windPts.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Lane
        label="Temp"
        labelColor="#fdba74"
        boxBg="rgba(251,146,60,0.07)"
        boxEdge="rgba(251,146,60,0.2)"
        debugKey="temp"
        readout={tempNow != null ? <Readout color="#fdba74">{Math.round(tempNow)}°</Readout> : undefined}
        paint={(ctx, w, h) => {
          paintBaseline(ctx, w);
          if (tempPts.length) {
            const yFor = (v: number) => yPx((v - tempSpan.lo) / (tempSpan.hi - tempSpan.lo), h);
            paintLine(ctx, tempPts, w, yFor, C.temp, 2.4);
          } else {
            paintNodata(ctx, w, h);
          }
        }}
      />

      <Lane
        label="Precip"
        labelColor="#7dd3fc"
        boxBg="rgba(56,189,248,0.07)"
        boxEdge="rgba(56,189,248,0.22)"
        debugKey="precip"
        paint={(ctx, w, h) => {
          paintBaseline(ctx, w);
          if (precipPts.length) {
            const yFor = (v: number) => yPx(v / precipMax, h);
            paintArea(ctx, precipPts, w, h, yFor, C.precipFill);
            paintLine(ctx, precipPts, w, yFor, C.precip, 2.2);
          } else {
            paintNodata(ctx, w, h);
          }
        }}
      />

      <Lane
        label="Radar"
        labelColor="#7dd3fc"
        boxBg="rgba(14,165,233,0.07)"
        boxEdge="rgba(14,165,233,0.2)"
        debugKey="radar"
        paint={(ctx, w, h) => {
          paintBaseline(ctx, w);
          if (radarTrace.length >= 2 && radarPts.some((p) => p.v >= 0.04)) {
            paintArea(ctx, radarTrace, w, h, (v) => yPx(v, h), C.radarFill);
            paintLine(ctx, radarTrace, w, (v) => yPx(v, h), C.radar, hasRadar ? 1.4 : 1.1, hasRadar ? undefined : [3, 2]);
          } else {
            paintNodata(ctx, w, h);
          }
        }}
      />

      <Lane
        label="Wind"
        labelColor="#fbbf24"
        boxBg="rgba(245,158,11,0.07)"
        boxEdge="rgba(245,158,11,0.22)"
        debugKey="wind"
        readout={windNow != null ? <Readout color="#fbbf24">{Math.round(windNow)} mph</Readout> : undefined}
        paint={(ctx, w, h) => {
          paintBaseline(ctx, w);
          if (windPts.length >= 2) {
            const yFor = (v: number) => yPx(v / windMax, h);
            paintLine(ctx, windPts, w, yFor, C.wind, 2.2, [5, 3]);
            ctx.strokeStyle = C.gust;
            ctx.lineWidth = 2;
            ctx.lineCap = "round";
            for (const p of gustTicks) {
              const x = xPx(p.t, w);
              ctx.beginPath();
              ctx.moveTo(x, h - PAD_V);
              ctx.lineTo(x, yFor(p.v));
              ctx.stroke();
            }
          } else {
            paintNodata(ctx, w, h);
          }
        }}
      />
    </div>
  );
}
