/** No successful Mapbox traffic leg this long while actively driving — likely an API/param bug. */
export const LIVE_TRAFFIC_STALE_MS = 5 * 60 * 1000;
/** Require real motion (not stopped at a light) before treating "no data" as suspicious. */
export const LIVE_TRAFFIC_MIN_SPEED_MPS = 2;

export type LiveTrafficHealthIssue = "traffic_overlay_missing_while_active";

/**
 * Watchdog for the live traffic / construction data pipeline. This can silently break in ways
 * that don't throw (e.g. a wrong Mapbox query param returning empty annotations) — ETA and the
 * turn banner keep working, so nothing visibly errors, but closures/construction stop showing up.
 * Flags when traffic is enabled + reachable but hasn't produced a single usable leg in a while.
 */
export function auditLiveTrafficHealth(input: {
  navigationStarted: boolean;
  /** Plus tier + online + setting on + Mapbox token present. */
  trafficEligible: boolean;
  hasEverSucceeded: boolean;
  msSinceLastSuccess: number | null;
  speedMps: number | null;
}): { ok: boolean; issues: LiveTrafficHealthIssue[] } {
  const issues: LiveTrafficHealthIssue[] = [];
  const moving =
    input.speedMps != null && Number.isFinite(input.speedMps) && input.speedMps >= LIVE_TRAFFIC_MIN_SPEED_MPS;

  if (input.navigationStarted && input.trafficEligible && moving) {
    const stale =
      !input.hasEverSucceeded ||
      (input.msSinceLastSuccess != null && input.msSinceLastSuccess >= LIVE_TRAFFIC_STALE_MS);
    if (stale) issues.push("traffic_overlay_missing_while_active");
  }
  return { ok: issues.length === 0, issues };
}

export type LiveTrafficRepairAction = "refresh_traffic";

export function repairActionsForLiveTrafficIssues(
  issues: readonly LiveTrafficHealthIssue[]
): LiveTrafficRepairAction[] {
  return issues.length ? ["refresh_traffic"] : [];
}
