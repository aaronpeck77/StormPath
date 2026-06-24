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
