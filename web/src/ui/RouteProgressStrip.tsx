import type { CSSProperties } from "react";
import { useMemo } from "react";
import {
  type RouteAlert,
  corridorHighlightHex,
  ROUTE_CORRIDOR_HIGHLIGHT_HALF_SPAN_M,
} from "../nav/routeAlerts";
import { layoutStripAlerts } from "../nav/stripAlertLayout";
import { closestAlongRouteMeters, polylineLengthMeters } from "../nav/routeGeometry";
import { turnStepAlongBounds } from "../nav/turnStepAlong";
import type { LngLat, RouteTurnStep } from "../nav/types";

export type StormProgressBand = { startM: number; endM: number; lineHex: string; severity?: string };

type Props = {
  geometry: LngLat[] | undefined;
  userLngLat: LngLat | null;
  /**
   * When provided (e.g. lateral-held along from navigation), overrides raw closest-point on the polyline
   * so the strip matches turn-by-turn and ETA.
   */
  userAlongMeters?: number | null;
  alerts: RouteAlert[];
  radarIntensity: number;
  routeLineColor: string;
  turnSteps?: RouteTurnStep[] | undefined;
  /** fullBleed: full-width under guidance; side: compact vertical rail (rotated strip). */
  layout?: "fullBleed" | "side";
  /** NWS polygon overlap along the route — same spans as colored lines on the map. */
  stormBands?: StormProgressBand[];
  /** Tap colored corridor span → open details for that strip alert (same payload as the map corridor). */
  onCorridorBandClick?: (alert: RouteAlert) => void;
  /** Tap storm-colored span → NWS details for warnings overlapping that segment. */
  onStormBandClick?: (startM: number, endM: number) => void;
  /** Drive mode: flip strip direction + stronger green/red end caps (start vs destination). */
  driveEndsEmphasis?: boolean;
  /**
   * When navigating, use trip-style progress: distance already driven (GPS odometer) vs
   * driven + remaining along the **current** polyline. Avoids the bar snapping back to ~0
   * when the route geometry is replaced (reroute / refresh).
   */
  tripOdometerM?: number;
  tripRelativeProgress?: boolean;
};

function hexToRgba(hex: string, alpha: number, blackMix = 0): string {
  const h = hex.replace("#", "");
  const k = 1 - Math.min(0.95, Math.max(0, blackMix));
  if (h.length !== 6) {
    return `rgba(${Math.round(74 * k)},${Math.round(222 * k)},${Math.round(128 * k)},${alpha})`;
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)},${alpha})`;
}

export function RouteProgressStrip({
  geometry,
  userLngLat,
  userAlongMeters = null,
  alerts,
  radarIntensity,
  routeLineColor,
  turnSteps,
  layout = "fullBleed",
  stormBands = [],
  onCorridorBandClick,
  onStormBandClick,
  driveEndsEmphasis = false,
  tripOdometerM = 0,
  tripRelativeProgress = false,
}: Props) {
  const totalM = geometry?.length ? polylineLengthMeters(geometry) : 0;
  const internalAlong =
    geometry?.length && userLngLat ? closestAlongRouteMeters(userLngLat, geometry).alongMeters : 0;
  const userAlong =
    userAlongMeters != null && Number.isFinite(userAlongMeters) ? userAlongMeters : internalAlong;
  const remainingM = totalM > 0 ? Math.max(0, totalM - userAlong) : 0;
  const polylineProgress = totalM > 0 ? Math.min(1, Math.max(0, userAlong / totalM)) : 0;
  const denom = tripOdometerM + remainingM;
  const tripProgress =
    tripRelativeProgress && denom > 1 ? Math.min(1, Math.max(0, tripOdometerM / denom)) : polylineProgress;
  const progress = tripProgress;

  const laidOut = useMemo(() => {
    if (!geometry?.length || totalM <= 0) return [];
    return layoutStripAlerts(alerts, geometry, userAlong, totalM);
  }, [alerts, geometry, userAlong, totalM]);

  /** Maneuver ends along the line (skip final “arrive” tick). */
  const turnMarkTs = useMemo(() => {
    if (!geometry?.length || !turnSteps?.length || totalM <= 0) return [];
    const { end } = turnStepAlongBounds(turnSteps, totalM);
    const n = end.length;
    if (n < 2) return [];
    const out: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const t = end[i]! / totalM;
      out.push(Math.min(1, Math.max(0, t)));
    }
    return out;
  }, [geometry, turnSteps, totalM]);

  const corridorHalf = ROUTE_CORRIDOR_HIGHLIGHT_HALF_SPAN_M;

  const corridorSegments = useMemo(() => {
    if (totalM <= 0) return [];
    return laidOut.map((a, i) => {
      const centerT = Math.min(1, Math.max(0, a.alongMeters / totalM));
      const spanM = 2 * corridorHalf;
      const widthT = Math.min(0.16, Math.max(0.022, spanM / totalM));
      let leftT = centerT - widthT / 2;
      if (leftT < 0) leftT = 0;
      if (leftT + widthT > 1) leftT = Math.max(0, 1 - widthT);
      const label =
        a.corridorKind === "weather"
          ? "Weather along route — details"
          : a.corridorKind === "hazard"
            ? "Road or construction along route — details"
            : a.corridorKind === "traffic"
              ? "Traffic along route — details"
              : "Route notice — details";
      return {
        key: `${a.id}-${i}`,
        alert: a,
        leftT,
        widthT,
        hex: corridorHighlightHex(a.corridorKind, a.severity),
        alongMeters: a.alongMeters,
        lngLat: a.lngLat,
        label,
      };
    });
  }, [laidOut, totalM, corridorHalf]);

  const stormSegments = useMemo(() => {
    if (totalM <= 0) return [];
    return stormBands.map((b, i) => {
      const w = Math.max(0.008, (b.endM - b.startM) / totalM);
      const leftT = Math.min(1 - w, Math.max(0, b.startM / totalM));
      return {
        key: `storm-${i}`,
        leftT,
        widthT: w,
        hex: b.lineHex,
        startM: b.startM,
        endM: b.endM,
      };
    });
  }, [stormBands, totalM]);

  /* Side rail: keep chroma close to the map line (A=blue #3b82f6); edge strip stays slightly muted for contrast on map */
  const trackBg =
    layout === "side"
      ? hexToRgba(routeLineColor, 0.62, 0.12)
      : hexToRgba(routeLineColor, 0.78, 0.52);
  const doneBg =
    layout === "side"
      ? hexToRgba(routeLineColor, 0.92, 0.04)
      : hexToRgba(routeLineColor, 0.94, 0.22);

  const PAST_SLACK_M = 120;

  const layoutClass =
    layout === "side" ? "route-progress-strip--side" : "route-progress-strip--edge";
  const driveEndsClass =
    layout === "side" && driveEndsEmphasis ? " route-progress-strip--drive-ends" : "";

  return (
    <div
      className={`route-progress-strip ${layoutClass}${driveEndsClass}${radarIntensity >= 0.72 ? " route-progress-strip--radar" : ""}`}
      role="region"
      aria-label={
        tripRelativeProgress
          ? "Trip progress (odometer vs remaining on current route), turns, and corridor marks"
          : "Progress along the current route line, turns, and corridor marks"
      }
      style={{ "--route-strip-line": routeLineColor } as CSSProperties}
    >
      <div className="route-progress-strip__track-wrap">
        <div className="route-progress-strip__track" style={{ backgroundColor: trackBg }}>
          <div className="route-progress-strip__end-cap route-progress-strip__end-cap--start" aria-hidden />
          <div className="route-progress-strip__end-cap route-progress-strip__end-cap--end" aria-hidden />
          <div
            className="route-progress-strip__track-done"
            style={{ width: `${progress * 100}%`, backgroundColor: doneBg }}
          />
          {stormSegments.map((s) =>
            onStormBandClick ? (
              <button
                key={s.key}
                type="button"
                className="route-progress-strip__corridor-band route-progress-strip__corridor-band--storm route-progress-strip__corridor-band--btn"
                style={{
                  left: `${s.leftT * 100}%`,
                  width: `${s.widthT * 100}%`,
                  backgroundColor: s.hex,
                }}
                aria-label="Storm advisory on route — open details"
                onClick={() => onStormBandClick(s.startM, s.endM)}
              />
            ) : (
              <div
                key={s.key}
                className="route-progress-strip__corridor-band route-progress-strip__corridor-band--storm"
                style={{
                  left: `${s.leftT * 100}%`,
                  width: `${s.widthT * 100}%`,
                  backgroundColor: s.hex,
                }}
              />
            )
          )}
          {corridorSegments.map((s) =>
            onCorridorBandClick ? (
              <button
                key={s.key}
                type="button"
                className="route-progress-strip__corridor-band route-progress-strip__corridor-band--btn"
                style={{
                  left: `${s.leftT * 100}%`,
                  width: `${s.widthT * 100}%`,
                  backgroundColor: s.hex,
                }}
                aria-label={s.label}
                onClick={() => onCorridorBandClick(s.alert)}
              />
            ) : (
              <div
                key={s.key}
                className="route-progress-strip__corridor-band"
                style={{
                  left: `${s.leftT * 100}%`,
                  width: `${s.widthT * 100}%`,
                  backgroundColor: s.hex,
                }}
              />
            )
          )}
          {turnMarkTs.map((t, i) => {
            const past = t * totalM < userAlong - PAST_SLACK_M;
            return (
              <div
                key={`turn-${i}`}
                className={`route-progress-strip__turn-mark${past ? " route-progress-strip__turn-mark--past" : ""}`}
                style={{ left: `${t * 100}%` }}
                title="Turn"
              />
            );
          })}
          <div
            className="route-progress-strip__cursor"
            style={{
              left: `${progress * 100}%`,
              boxShadow: `0 0 0 1px ${routeLineColor}, 0 1px 4px rgba(0,0,0,0.5)`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
