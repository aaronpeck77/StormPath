/**
 * Hourly NWP gust fields (Tomorrow.io, WeatherKit) often run hotter than what drivers
 * feel on the road. Calibrate before hazards, graphs, and advisory copy.
 */

/** Minimum calibrated gust (mph) before surfacing a wind hazard band. */
export const WIND_GUST_CAUTION_MPH = 35;
export const WIND_GUST_SERIOUS_MPH = 48;
export const WIND_GUST_AVOID_MPH = 60;

/** Graph / strata — hide noise below this calibrated gust. */
export const WIND_GRAPH_MIN_MPH = 22;

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

export function windImpactSeverity(
  gustMph: number
): "caution" | "serious" | "avoid" | null {
  if (gustMph >= WIND_GUST_AVOID_MPH) return "avoid";
  if (gustMph >= WIND_GUST_SERIOUS_MPH) return "serious";
  if (gustMph >= WIND_GUST_CAUTION_MPH) return "caution";
  return null;
}
