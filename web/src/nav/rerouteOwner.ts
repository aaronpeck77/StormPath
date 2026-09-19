/**
 * Who reroutes when the driver leaves the line.
 *
 * Both halves could fire: Mapbox Core reroutes on its own and emits `routeChanged`,
 * *and* the DIY off-route poll could call Directions for a fresh corridor and then
 * `restartNative()` — a full Core stop/start mid-drive. Two answers, two network
 * requests, and the restart throws away the session Core was happily running.
 *
 * Core owns the on-road reroute. DIY is the fallback, and only when Core cannot do
 * the job: no native session, Core abandoned this trip, Core went quiet, or Core
 * was given a fair window after a confirmed off-route and produced nothing (the
 * offline case — Core cannot reroute without a network either).
 */

export type RerouteOwner = "core" | "diy";

/** Core reports ~1/s. Quiet this long means it is not going to reroute for us. */
export const CORE_NAV_STALE_MS = 6_000;
/**
 * How long Core gets to deliver its own `routeChanged` after a confirmed off-route
 * before DIY is allowed to plan. Mapbox usually reroutes in a couple of seconds;
 * this is the escape hatch for the trip where it never comes.
 */
export const CORE_REROUTE_GRACE_MS = 12_000;

export type CoreRerouteHealth = {
  /** A native Core session is running and feeding the UI. */
  active: boolean;
  /** Core picked a corridor we refused to adopt — DIY owns this trip. */
  abandoned: boolean;
  /** Last Core progress event (ms, `Date.now()` clock). */
  lastProgressAtMs: number | null;
  /** Last adopted Core `routeChanged` (ms) — proof Core actually rerouted. */
  lastRouteChangedAtMs: number | null;
};

export function resolveRerouteOwner(input: {
  health: CoreRerouteHealth | null | undefined;
  /** When the poll first confirmed this off-route episode, or null when on route. */
  offRouteSinceMs: number | null;
  nowMs: number;
  staleMs?: number;
  graceMs?: number;
}): RerouteOwner {
  const h = input.health;
  if (!h || !h.active || h.abandoned) return "diy";

  const last = h.lastProgressAtMs;
  if (last == null || !Number.isFinite(last)) return "diy";
  if (input.nowMs - last > (input.staleMs ?? CORE_NAV_STALE_MS)) return "diy";

  const since = input.offRouteSinceMs;
  if (since != null && Number.isFinite(since)) {
    const grace = input.graceMs ?? CORE_REROUTE_GRACE_MS;
    const delivered =
      h.lastRouteChangedAtMs != null &&
      Number.isFinite(h.lastRouteChangedAtMs) &&
      h.lastRouteChangedAtMs >= since;
    if (!delivered && input.nowMs - since > grace) return "diy";
  }

  return "core";
}

/**
 * Detection, the banner, and diagnostics all keep running while Core owns — only
 * the Directions call plus Core restart is suppressed.
 */
export function diyMayPlanReroute(owner: RerouteOwner): boolean {
  return owner === "diy";
}
