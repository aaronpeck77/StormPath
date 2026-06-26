/**
 * Wind along open routes (Midwest / plains): sustained speed drives corridor hazards;
 * gust spikes are localized add-ons. NWP gust fields are calibrated before use.
 */

/** Sustained wind — main hazard bands (mph). Light prairie breeze stays below caution. */
export const WIND_SUSTAINED_CAUTION_MPH = 32;
export const WIND_SUSTAINED_SERIOUS_MPH = 42;
export const WIND_SUSTAINED_AVOID_MPH = 52;

/** Gust spike — must exceed sustained by this much and hit min gust (localized warnings only). */
export const WIND_GUST_SPIKE_MIN_MPH = 40;
export const WIND_GUST_SPIKE_MIN_EXCESS_MPH = 14;

/** Route graph — sustained wind line (mph). */
export const WIND_GRAPH_MIN_MPH = 18;

/** Minimum sustained wind to plot on the route graph (below hazard caution). */
export const WIND_GRAPH_PLOT_MIN_MPH = 6;

export type RouteWindGraphPoint = { t: number; mph: number };

/**
 * Sustained-wind line + gust spike markers for {@link RouteRadarWindStrip}.
 * Pads sparse corridor samples so the amber line can render (needs ≥2 points).
 */
export function buildRouteWindGraphPoints(
  intervals: Array<{ etaMinutes: number; windSpeedMph: number; windGustMph: number }>,
  planEtaMinutes: number
): { windPoints: RouteWindGraphPoint[]; gustSpikePoints: RouteWindGraphPoint[] } {
  if (!intervals.length || planEtaMinutes <= 0) {
    return { windPoints: [], gustSpikePoints: [] };
  }

  const windPoints = intervals
    .filter((iv) => iv.windSpeedMph >= WIND_GRAPH_PLOT_MIN_MPH)
    .map((iv) => ({
      t: Math.min(1, Math.max(0, iv.etaMinutes / planEtaMinutes)),
      mph: Math.round(iv.windSpeedMph),
    }))
    .sort((a, b) => a.t - b.t);

  if (windPoints.length === 1) {
    const p = windPoints[0]!;
    windPoints.unshift({ t: Math.max(0, p.t - 0.04), mph: p.mph });
    windPoints.push({ t: Math.min(1, p.t + 0.04), mph: p.mph });
  }
  if (windPoints.length >= 2) {
    if (windPoints[0]!.t > 0.02) {
      windPoints.unshift({ t: 0, mph: windPoints[0]!.mph });
    }
    const last = windPoints[windPoints.length - 1]!;
    if (last.t < 0.98) {
      windPoints.push({ t: 1, mph: last.mph });
    }
  }

  const gustSpikePoints = intervals
    .filter((iv) => gustSpikeSeverity(iv.windSpeedMph, iv.windGustMph) !== null)
    .map((iv) => ({
      t: Math.min(1, Math.max(0, iv.etaMinutes / planEtaMinutes)),
      mph: Math.round(iv.windGustMph),
    }));

  return { windPoints, gustSpikePoints };
}

/** True when the radar/wind strata should render in the progress graph. */
export function routeWindGraphVisible(
  windPoints: RouteWindGraphPoint[],
  gustSpikePoints: RouteWindGraphPoint[] = []
): boolean {
  return (
    windPoints.length >= 2 ||
    windPoints.some((p) => p.mph >= WIND_GRAPH_MIN_MPH) ||
    gustSpikePoints.length > 0
  );
}

/** Max along-route span for a gust-spike band (fraction of trip). */
export const WIND_GUST_SPIKE_MAX_ROUTE_FRAC = 0.1;

const MAX_GUST_ABOVE_SUSTAINED_MPH = 15;
const MIN_GUST_MARGIN_MPH = 6;

/**
 * Clamp model gusts to a realistic margin above sustained wind.
 * When gust is missing or only slightly above speed, return sustained wind.
 */
export function calibratedWindGustMph(windSpeedMph: number, windGustMph: number): number {
  const speed = Math.max(0, windSpeedMph);
  const rawGust = Math.max(0, windGustMph);
  const gust = rawGust > 0 ? rawGust : speed;
  if (gust <= speed + 2) return speed;
  const capped = Math.min(gust, speed + MAX_GUST_ABOVE_SUSTAINED_MPH);
  if (capped < speed + MIN_GUST_MARGIN_MPH) return speed;
  return capped;
}

export function sustainedWindImpactSeverity(
  speedMph: number
): "caution" | "serious" | "avoid" | null {
  if (speedMph >= WIND_SUSTAINED_AVOID_MPH) return "avoid";
  if (speedMph >= WIND_SUSTAINED_SERIOUS_MPH) return "serious";
  if (speedMph >= WIND_SUSTAINED_CAUTION_MPH) return "caution";
  return null;
}

/** Localized gust spike — never escalates past caution (no corridor-wide red from gusts alone). */
export function gustSpikeSeverity(
  speedMph: number,
  gustMph: number
): "caution" | null {
  const excess = gustMph - speedMph;
  if (gustMph < WIND_GUST_SPIKE_MIN_MPH) return null;
  if (excess < WIND_GUST_SPIKE_MIN_EXCESS_MPH) return null;
  return "caution";
}

export function windGustExcessMph(speedMph: number, gustMph: number): number {
  return Math.max(0, gustMph - speedMph);
}

/** @deprecated Use sustainedWindImpactSeverity — kept for tests migrating off gust-only bands. */
export function windImpactSeverity(
  gustMph: number
): "caution" | "serious" | "avoid" | null {
  return sustainedWindImpactSeverity(gustMph);
}

/** @deprecated Alias — use WIND_SUSTAINED_CAUTION_MPH */
export const WIND_GUST_CAUTION_MPH = WIND_SUSTAINED_CAUTION_MPH;
