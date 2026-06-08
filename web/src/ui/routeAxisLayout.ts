/** Shared plot insets — matches RouteOutlookTimeline SVG padding (34px / 400px). */
export const ROUTE_PLOT_INSET_START = 0.085;
export const ROUTE_PLOT_INSET_END = 0.085;

const PLOT_INNER = 1 - ROUTE_PLOT_INSET_START - ROUTE_PLOT_INSET_END;

/** Map along-route fraction (0–1) to horizontal % in the synced plot column. */
export function routePlotLeftPct(fraction: number): number {
  const f = Math.max(0, Math.min(1, fraction));
  return (ROUTE_PLOT_INSET_START + f * PLOT_INNER) * 100;
}

export function routePlotWidthPct(startFraction: number, endFraction: number): number {
  return Math.max(0, routePlotLeftPct(endFraction) - routePlotLeftPct(startFraction));
}

export function showDriverMarkerAlongRoute(userAlongT: number): boolean {
  return Number.isFinite(userAlongT) && userAlongT >= 0 && userAlongT <= 1;
}

const MI = 1609.344;
export const ROUTE_AXIS_MIN_PX = 400;
export const ROUTE_AXIS_MAX_PX = 1280;
export const ROUTE_AXIS_PX_PER_STOP = 76;
export const ROUTE_AXIS_PX_PER_BAND = 56;

/**
 * Horizontal scroll width for the Along-your-route graph — short trips fit the panel;
 * longer distance or drive time expands the axis to the right (capped for sanity).
 */
export function computeRouteAxisMinWidth(input: {
  totalMeters: number;
  planEtaMinutes?: number | null;
  outlookStepCount: number;
  bandCount: number;
}): number {
  const { totalMeters, planEtaMinutes = null, outlookStepCount, bandCount } = input;
  const miles = totalMeters > 0 ? totalMeters / MI : 0;
  const etaMin = planEtaMinutes != null && Number.isFinite(planEtaMinutes) ? planEtaMinutes : 0;

  const distBoost = miles > 50 ? Math.min(1.25, (miles - 50) / 280) : 0;
  const timeBoost = etaMin > 90 ? Math.min(0.85, (etaMin - 90) / 420) : 0;
  const tripScale = 1 + Math.max(distBoost, timeBoost);

  const stops = Math.max(outlookStepCount, 5);
  const bands = Math.max(bandCount, 1);

  const scaled = Math.round(ROUTE_AXIS_MIN_PX * tripScale);
  const raw = Math.max(scaled, stops * ROUTE_AXIS_PX_PER_STOP, bands * ROUTE_AXIS_PX_PER_BAND);
  return Math.min(ROUTE_AXIS_MAX_PX, raw);
}
