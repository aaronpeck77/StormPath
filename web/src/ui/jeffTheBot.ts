/**
 * "Jeff the Fix-It Bot" is the friendly, user-facing name for the app's background watchdog
 * checks — drive-camera heading, drive-puck yard-line placement, and live-traffic staleness
 * (see `useDriveCameraHealth` and `useLiveTrafficHealth`). This module is just a tiny pub/sub
 * so those hooks can announce "I just fixed something" without importing any UI, and a small
 * badge component (`JeffBadge`) can light up to show it happened.
 */

import { recordJeffFix } from "../monitoring/jeffFixLog";

export type JeffSighting = {
  /** Which watchdog caught the issue. */
  domain: "drive_camera" | "drive_puck" | "live_traffic";
  /** Short, human phrase for what Jeff noticed — shown in the badge's tooltip/detail. */
  note: string;
  atMs: number;
  /** True when the driver tapped Jeff to force the fix themselves, rather than the watchdog
   *  catching it automatically. */
  manual?: boolean;
};

type Listener = (sighting: JeffSighting) => void;

const listeners = new Set<Listener>();

/** Called by a health watchdog (or a manual Jeff tap) right after a fix happens. Every
 *  sighting is logged for the Control Room via `recordJeffFix` regardless of how it fired,
 *  so "what Jeff fixed and when" stays accurate whether it was automatic or manual. */
export function reportJeffSighting(
  domain: JeffSighting["domain"],
  note: string,
  manual = false
): void {
  const sighting: JeffSighting = { domain, note, atMs: Date.now(), manual };
  recordJeffFix(sighting);
  for (const listen of listeners) listen(sighting);
}

/** Subscribe to Jeff sightings; returns an unsubscribe function. */
export function subscribeJeffSightings(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const DOMAIN_NOTES: Record<JeffSighting["domain"], string> = {
  drive_camera: "Straightened out the map view",
  drive_puck: "Pinned the drive puck back in place",
  live_traffic: "Kicked live traffic to refresh",
};

export function noteForJeffDomain(domain: JeffSighting["domain"]): string {
  return DOMAIN_NOTES[domain];
}
