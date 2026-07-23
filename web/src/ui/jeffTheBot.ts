/**
 * "Jeff the Fix-It Bot" is the friendly, user-facing name for the app's background watchdog
 * checks — the drive-camera heading audit and the live-traffic staleness audit (see
 * `useDriveCameraHealth` and `useLiveTrafficHealth`). This module is just a tiny pub/sub so
 * those hooks can announce "I just fixed something" without importing any UI, and a small
 * badge component (`JeffBadge`) can light up to show it happened.
 */

export type JeffSighting = {
  /** Which watchdog caught the issue. */
  domain: "drive_camera" | "live_traffic";
  /** Short, human phrase for what Jeff noticed — shown in the badge's tooltip/detail. */
  note: string;
  atMs: number;
};

type Listener = (sighting: JeffSighting) => void;

const listeners = new Set<Listener>();

/** Called by a health watchdog right after it performs an automatic repair. */
export function reportJeffSighting(domain: JeffSighting["domain"], note: string): void {
  const sighting: JeffSighting = { domain, note, atMs: Date.now() };
  for (const listen of listeners) listen(sighting);
}

/** Subscribe to Jeff sightings; returns an unsubscribe function. */
export function subscribeJeffSightings(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const DOMAIN_NOTES: Record<JeffSighting["domain"], string> = {
  drive_camera: "Straightened out the map view",
  live_traffic: "Kicked live traffic to refresh",
};

export function noteForJeffDomain(domain: JeffSighting["domain"]): string {
  return DOMAIN_NOTES[domain];
}
