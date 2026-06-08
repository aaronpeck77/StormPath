/**
 * Watchdog for the unified route-hazard pipeline — progress strip bands, map highlights,
 * and progress info outlook graph should stay in sync.
 */

export const ROUTE_AHEAD_HEALTH_POLL_MS = 30_000;
export const ROUTE_AHEAD_HEALTH_REPAIR_COOLDOWN_MS = 45_000;

export type RouteAheadHealthIssue =
  /** Plus trip with weather hints on but no corridor overlay headline or samples. */
  | "weather_overlay_missing"
  /** Corridor weather copy exists but the progress outlook graph has no steps. */
  | "forecast_detail_without_outlook"
  /** Timeline has hazard rows but progress strip bands are empty (desync). */
  | "timeline_bands_desync"
  /** Weather is expected on this leg but outlook steps are still empty. */
  | "outlook_empty_weather_expected";

export type RouteAheadHealthRepairAction = "refresh_weather_overlay" | "refresh_traffic";

export type RouteAheadHealthAudit = {
  ok: boolean;
  issues: RouteAheadHealthIssue[];
};

export function auditRouteAheadSync(input: {
  hasRouteGeometry: boolean;
  isPlus: boolean;
  weatherHintsEnabled: boolean;
  hasPlannedRoute: boolean;
  navigationStarted: boolean;
  outlookStepCount: number;
  timelineItemCount: number;
  progressBandCount: number;
  corridorWeatherDetail: string;
  weatherOverlayHeadline: string;
  hasWeatherSamples: boolean;
}): RouteAheadHealthAudit {
  const issues: RouteAheadHealthIssue[] = [];
  const {
    hasRouteGeometry,
    isPlus,
    weatherHintsEnabled,
    hasPlannedRoute,
    navigationStarted,
    outlookStepCount,
    timelineItemCount,
    progressBandCount,
    corridorWeatherDetail,
    weatherOverlayHeadline,
    hasWeatherSamples,
  } = input;

  if (!hasRouteGeometry || !isPlus) {
    return { ok: true, issues };
  }

  const tripActive = navigationStarted || hasPlannedRoute;
  const weatherExpected = weatherHintsEnabled && tripActive;
  const hasCorridorWxCopy =
    corridorWeatherDetail.trim().length > 0 || weatherOverlayHeadline.trim().length > 0;

  if (weatherExpected && !weatherOverlayHeadline.trim() && !hasWeatherSamples) {
    issues.push("weather_overlay_missing");
  }

  if (weatherExpected && outlookStepCount === 0 && hasCorridorWxCopy) {
    issues.push("forecast_detail_without_outlook");
  }

  if (weatherExpected && outlookStepCount === 0 && !hasCorridorWxCopy) {
    issues.push("outlook_empty_weather_expected");
  }

  if (timelineItemCount > 0 && progressBandCount === 0) {
    issues.push("timeline_bands_desync");
  }

  return { ok: issues.length === 0, issues };
}

export function repairActionsForRouteAheadIssues(
  issues: RouteAheadHealthIssue[]
): RouteAheadHealthRepairAction[] {
  const actions = new Set<RouteAheadHealthRepairAction>();
  for (const issue of issues) {
    if (
      issue === "weather_overlay_missing" ||
      issue === "forecast_detail_without_outlook" ||
      issue === "outlook_empty_weather_expected"
    ) {
      actions.add("refresh_weather_overlay");
    }
    if (issue === "timeline_bands_desync") {
      actions.add("refresh_traffic");
    }
  }
  return [...actions];
}
