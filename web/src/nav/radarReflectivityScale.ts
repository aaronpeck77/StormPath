/**
 * Conservative mapping from RainViewer mosaic echo (0..1) to driver-facing severity.
 * Yellow–green fringe and light showers should not read as heavy storms.
 */

import { clamp01 } from "../services/radarPolylineIntensity";
import {
  RADAR_HEAVY_THRESHOLD,
  RADAR_REROUTE_THRESHOLD,
  RADAR_SOFT_THRESHOLD,
  RADAR_VERY_HEAVY_THRESHOLD,
} from "./constants";
import type { RouteImpactAction, RouteImpactSeverity } from "./routeImpacts";

export type RadarEchoClass = {
  /** Echo strength after conservative scaling — use for thresholds. */
  display: number;
  severity: RouteImpactSeverity;
  action: RouteImpactAction;
  stripHex: string;
  stripLabel: string;
  headline: string;
  roadEffect: string;
  numericSeverity: number;
};

function headlineForEcho(display: number, longBand: boolean): string {
  const veryHeavy = display >= RADAR_VERY_HEAVY_THRESHOLD;
  const heavy = display >= RADAR_HEAVY_THRESHOLD;
  const moderate = display >= RADAR_REROUTE_THRESHOLD;
  if (veryHeavy) {
    return longBand ? "Heavy rain along much of your route" : "Heavy rain on route";
  }
  if (heavy) {
    return longBand ? "Steady rain along much of your route" : "Steady rain on route";
  }
  if (moderate) {
    return longBand ? "Showers along much of your route" : "Showers on route";
  }
  return longBand ? "Light showers possible ahead" : "Light showers possible";
}

function roadEffectForEcho(display: number): string {
  if (display >= RADAR_VERY_HEAVY_THRESHOLD) {
    return "Heavy rain — slow down and leave extra following distance.";
  }
  if (display >= RADAR_HEAVY_THRESHOLD) {
    return "Rain on pavement — extra following distance.";
  }
  if (display >= RADAR_REROUTE_THRESHOLD) {
    return "Wet pavement possible — wipers on and ease off speed.";
  }
  return "Brief showers possible — no significant impact expected.";
}

/** Slight curve so mid-range yellow–green reads lower than raw palette strength. */
export function radarDisplayIntensity(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return clamp01(Math.pow(raw, 1.34) * 0.92);
}

/**
 * Classify a mosaic peak for impacts, strip bands, and advisory copy.
 * Returns null below {@link RADAR_SOFT_THRESHOLD}.
 */
export function classifyRadarEcho(rawIntensity: number, spanFrac = 0): RadarEchoClass | null {
  const display = radarDisplayIntensity(rawIntensity);
  if (display < RADAR_SOFT_THRESHOLD) return null;

  const veryHeavy = display >= RADAR_VERY_HEAVY_THRESHOLD;
  const heavy = display >= RADAR_HEAVY_THRESHOLD;
  const moderate = display >= RADAR_REROUTE_THRESHOLD;

  const severity: RouteImpactSeverity = veryHeavy ? "serious" : heavy ? "caution" : "info";
  const action: RouteImpactAction = veryHeavy
    ? "prepare"
    : heavy
      ? "slow"
      : moderate
        ? "watch"
        : "watch";

  const stripHex = veryHeavy || heavy ? "#6366f1" : moderate ? "#38bdf8" : "#64748b";
  const stripLabel = veryHeavy ? "Heavy" : heavy ? "Moderate" : moderate ? "Light" : "Trace";

  return {
    display,
    severity,
    action,
    stripHex,
    stripLabel,
    headline: headlineForEcho(display, spanFrac >= 0.32),
    roadEffect: roadEffectForEcho(display),
    numericSeverity: Math.round(32 + display * 24),
  };
}

/** One-line radar tier for debug / callout copy. */
export function radarEchoTierLabel(rawIntensity: number): string | null {
  const c = classifyRadarEcho(rawIntensity);
  if (!c) return null;
  if (c.display >= RADAR_VERY_HEAVY_THRESHOLD) return "heavy";
  if (c.display >= RADAR_HEAVY_THRESHOLD) return "moderate";
  if (c.display >= RADAR_REROUTE_THRESHOLD) return "light";
  return "trace";
}
