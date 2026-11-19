/**
 * True vertical route timeline — the route axis runs bottom (start) to top
 * (destination) instead of squeezing the whole trip into a few hundred px of
 * phone width. A central spine carries progress (YOU marker, driven/ahead
 * split); hazard bands flank it on NWS (left) and Road (right) lanes; the
 * right column overlays temp, precip, radar echo and wind profiles on the
 * SAME fraction axis (y = route fraction), so everything lines up vertically.
 */
import { useMemo } from "react";
import {
  buildRouteOutlookSeries,
  outlookChartScale,
  type RouteOutlookStep,
} from "../nav/routeForecastTimeline";
import type { WxSample } from "../nav/routeChunkWeather";
import { radarDisplayIntensity } from "../nav/radarReflectivityScale";
import { radarGraphNorm } from "./RouteRadarWindStrip";
import { routeWindGraphScaleMph } from "../nav/windForecastCalib";
import {
  timelineItemBandColor,
  timelineItemShowsOnRouteGraph,
} from "../nav/routeAheadSync";
import type { TimelineItem } from "./RouteHazardTimeline";

type Props = {
  timeline: TimelineItem[];
  outlookSteps: RouteOutlookStep[];
  outlookSamples?: WxSample[];
  radarSamples?: { t: number; intensity: number }[];
  windPoints?: { t: number; mph: number }[];
  gustLinePoints?: { t: number; mph: number }[];
  gustSpikePoints?: { t: number; mph: number }[];
  totalMeters: number;
  userAlongMeters: number;
  userAlongT: number;
  arrivalTempF: number | null;
  stripTint: string;
  selectedId?: string | null;
  nextHazardId?: string | null;
  /** Ids that have a detail card — bands without one render disabled. */
  linkableIds?: Set<string>;
  cardId?: (id: string) => string;
  onBandSelect?: (id: string) => void;
};

const MIN_BAND_PCT = 1.2;
const METERS_PER_MILE = 1609.34;

/** y position (0–100, top=dest) for a route fraction. */
function yOf(f: number): number {
  return (1 - Math.max(0, Math.min(1, f))) * 100;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

type VBand = {
  id: string;
  track: "nws" | "road";
  label: string;
  startF: number;
  endF: number;
  color: string;
  severity: TimelineItem["severity"];
  muted: boolean;
  nearby: boolean;
};

function bandClassModifiers(band: VBand, selectedId: string | null, nextHazardId: string | null) {
  return [
    `rvtl__band--${band.severity}`,
    band.id === nextHazardId ? "rvtl__band--next" : "",
    band.id === selectedId ? "rvtl__band--selected" : "",
    band.nearby ? "rvtl__band--nearby" : "",
    band.muted ? "rvtl__band--muted" : "",
  ].filter(Boolean).join(" ");
}

function HazardLane({
  side,
  label,
  bands,
  selectedId,
  nextHazardId,
  linkableIds,
  cardId,
  onBandSelect,
}: {
  side: "left" | "right";
  label: string;
  bands: VBand[];
  selectedId: string | null;
  nextHazardId: string | null;
  linkableIds?: Set<string>;
  cardId?: (id: string) => string;
  onBandSelect?: (id: string) => void;
}) {
  return (
    <div className={`rvtl__lane rvtl__lane--${side}`}>
      <span className="rvtl__lane-label">{label}</span>
      <div className="rvtl__lane-plot">
        {bands.map((band) => {
          const bottom = band.startF * 100;
          const height = Math.max(MIN_BAND_PCT, (band.endF - band.startF) * 100);
          return (
            <button
              key={band.id}
              type="button"
              className={`rvtl__band ${bandClassModifiers(band, selectedId, nextHazardId)}`}
              style={{
                bottom: `${bottom}%`,
                height: `${height}%`,
                backgroundColor: band.color,
              }}
              title={band.label}
              aria-label={`Show details: ${band.label}`}
              aria-controls={linkableIds?.has(band.id) && cardId ? cardId(band.id) : undefined}
              aria-pressed={selectedId === band.id}
              disabled={linkableIds ? !linkableIds.has(band.id) : false}
              onClick={() => onBandSelect?.(band.id)}
            />
          );
        })}
      </div>
    </div>
  );
}

export function RouteVerticalTimeline({
  timeline,
  outlookSteps,
  outlookSamples,
  radarSamples = [],
  windPoints = [],
  gustLinePoints = [],
  gustSpikePoints = [],
  totalMeters,
  userAlongMeters,
  userAlongT,
  arrivalTempF,
  stripTint,
  selectedId = null,
  nextHazardId = null,
  linkableIds,
  cardId,
  onBandSelect,
}: Props) {
  const userT = clamp01(userAlongT);

  const bands = useMemo<VBand[]>(() => {
    if (totalMeters <= 0) return [];
    return timeline
      .filter(
        (item) =>
          (item.track === "nws" || item.track === "road") &&
          timelineItemShowsOnRouteGraph(item)
      )
      .map((item) => {
        const startF = clamp01(item.startMeters / totalMeters);
        const endF = clamp01(item.endMeters / totalMeters);
        const passed = item.endMeters <= userAlongMeters;
        return {
          id: item.id,
          track: item.track === "road" ? "road" : "nws",
          label: item.label,
          startF,
          endF: Math.max(endF, startF + 0.002),
          color: timelineItemBandColor(item),
          severity: item.severity,
          muted: Boolean(item.stripMuted) || passed,
          nearby: item.crossesRoute === false,
        };
      });
  }, [timeline, totalMeters, userAlongMeters]);

  const nwsBands = useMemo(() => bands.filter((b) => b.track === "nws"), [bands]);
  const roadBands = useMemo(() => bands.filter((b) => b.track === "road"), [bands]);

  /* Weather series on the same 0–1 route axis. */
  const series = useMemo(
    () => buildRouteOutlookSeries(outlookSteps, outlookSamples),
    [outlookSteps, outlookSamples]
  );
  const chartScale = useMemo(() => outlookChartScale(series), [series]);

  /* Radar silhouette — same normalization as RouteRadarWindStrip. */
  const radarPath = useMemo(() => {
    if (radarSamples.length < 2) return "";
    const displays = radarSamples.map((s) => ({
      t: clamp01(s.t),
      display: radarDisplayIntensity(s.intensity),
    }));
    const routeMax = Math.max(0, ...displays.map((d) => d.display));
    const pts = [...displays]
      .sort((a, b) => a.t - b.t)
      .map((s) => ({ f: s.t, norm: radarGraphNorm(s.display, routeMax) }));
    if (pts[0]!.f > 0.01) pts.unshift({ ...pts[0]!, f: 0 });
    if (pts[pts.length - 1]!.f < 0.99) pts.push({ ...pts[pts.length - 1]!, f: 1 });
    if (!pts.some((p) => p.norm >= 0.04)) return "";
    // y = route fraction (dest top), x = echo strength 0–62 units.
    // Anchor at x=0 (left edge of weather column), silhouette grows rightward.
    const top = pts.map((p) => `${(p.norm * 62).toFixed(1)},${yOf(p.f).toFixed(1)}`).join(" L");
    return `M0,${yOf(pts[0]!.f).toFixed(1)} L${top} L0,${yOf(pts[pts.length - 1]!.f).toFixed(1)} Z`;
  }, [radarSamples]);

  /* Wind envelope — gust line preferred, else sustained points. */
  const windPath = useMemo(() => {
    const primary = gustLinePoints.length >= 2 ? gustLinePoints : windPoints;
    const pts = primary.filter((p) => p.mph > 0).sort((a, b) => a.t - b.t);
    if (pts.length < 2) return "";
    const mphs = [
      ...pts.map((p) => p.mph),
      ...gustSpikePoints.filter((p) => p.mph > 0).map((p) => p.mph),
    ];
    const windMax = routeWindGraphScaleMph(mphs) || 1;
    return pts
      .map((p, i) => {
        const x = 6 + (p.mph / windMax) * 88;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${(78 - (p.mph / windMax) * 26).toFixed(1)}`;
      })
      .join(" ");
  }, [gustLinePoints, windPoints, gustSpikePoints]);

  /* Temperature line — mapped into the top band of the weather column. */
  const tempPath = useMemo(() => {
    const pts = series.filter((p) => p.tempF != null);
    if (pts.length < 2) return "";
    const { tempMin, tempMax } = chartScale;
    const span = Math.max(1, tempMax - tempMin);
    return pts
      .map((p, i) => {
        const x = 6 + ((p.tempF! - tempMin) / span) * 88;
        const y = 46 - ((p.tempF! - tempMin) / span) * 34;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [series, chartScale]);

  /* Precip ticks along a baseline in the mid band. */
  const precipTicks = useMemo(() => {
    return series
      .filter((p) => (p.precipPct ?? 0) >= 10)
      .map((p) => {
        const h = Math.min(9, ((p.precipPct ?? 0) / Math.max(10, chartScale.precipMax)) * 9);
        const y = yOf(p.fraction);
        return { y, h, key: `${p.fraction}-${p.precipPct}` };
      });
  }, [series, chartScale]);

  const hasWeather = Boolean(tempPath || windPath || radarPath || precipTicks.length);
  const remainingMi = totalMeters > 0 ? ((1 - userT) * totalMeters) / METERS_PER_MILE : null;
  const totalMi = totalMeters > 0 ? totalMeters / METERS_PER_MILE : null;

  return (
    <div
      className="rvtl"
      role="group"
      aria-label="Vertical route timeline: hazards and weather along your trip, destination at top"
    >
      <div className="rvtl__plot">
        {/* Hazard lanes flanking the spine */}
        <HazardLane side="left" label="NWS" bands={nwsBands} selectedId={selectedId} nextHazardId={nextHazardId} linkableIds={linkableIds} cardId={cardId} onBandSelect={onBandSelect} />

        {/* Route spine: driven portion bright, ahead dimmed */}
        <div className="rvtl__spine-col">
          <div
            className="rvtl__spine rvtl__spine--done"
            style={{ height: `${userT * 100}%`, backgroundColor: stripTint }}
          />
          <div className="rvtl__spine rvtl__spine--ahead" style={{ bottom: `${userT * 100}%` }} />
          <div className="rvtl__you" style={{ bottom: `${userT * 100}%` }}>
            <span className="rvtl__you-tag" style={{ backgroundColor: stripTint }}>
              YOU{remainingMi != null ? ` · ${Math.round(remainingMi)} mi` : ""}
            </span>
          </div>
        </div>

        <HazardLane side="right" label="RD" bands={roadBands} selectedId={selectedId} nextHazardId={nextHazardId} linkableIds={linkableIds} cardId={cardId} onBandSelect={onBandSelect} />

        {/* Weather column — profiles share the vertical route axis */}
        <div className="rvtl__weather">
          {hasWeather ? (
            <svg
              className="rvtl__weather-svg"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden
            >
              {radarPath ? (
                <path className="rvtl__radar-fill" d={radarPath} />
              ) : null}
              {precipTicks.map((t) => (
                <line
                  key={t.key}
                  className="rvtl__precip-tick"
                  x1="2"
                  x2={2 + t.h}
                  y1={t.y}
                  y2={t.y}
                />
              ))}
              {tempPath ? <path className="rvtl__temp-line" d={tempPath} /> : null}
              {windPath ? <path className="rvtl__wind-line" d={windPath} /> : null}
              {/* Driver alignment tick across the weather column */}
              <line
                className="rvtl__you-tick"
                x1="0"
                x2="100"
                y1={yOf(userT)}
                y2={yOf(userT)}
                style={{ stroke: stripTint }}
              />
            </svg>
          ) : (
            <div className="rvtl__weather-empty">
              <span className="rvtl__weather-empty-title">Weather along route</span>
              <span className="rvtl__weather-empty-hint">
                Forecast and radar still loading — pull down to refresh.
              </span>
            </div>
          )}
        </div>

        {/* Axis captions */}
        <div className="rvtl__caption rvtl__caption--dest" style={{ top: 0 }}>
          DEST{arrivalTempF != null ? ` · ${Math.round(arrivalTempF)}°` : ""}
          {totalMi != null ? ` · ${Math.round(totalMi)} mi` : ""}
        </div>
        <div className="rvtl__caption rvtl__caption--start" style={{ bottom: 0 }}>
          START{totalMi != null ? ` · ${Math.round(totalMi)} mi` : ""}
        </div>
      </div>
    </div>
  );
}
