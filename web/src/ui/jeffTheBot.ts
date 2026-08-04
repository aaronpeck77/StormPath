/**
 * "Jeff the Fix-It Bot" is the friendly name for the app's background watchdog checks —
 * drive-camera heading, drive-puck yard-line placement, and live-traffic staleness
 * (see `useDriveCameraHealth` and `useLiveTrafficHealth`). Watchdogs still announce fixes
 * here so any subscriber can react; the corner badge and Control Room fix log are off.
 */

export type JeffSighting = {
  /** Which watchdog caught the issue. */
  domain: "drive_camera" | "drive_puck" | "live_traffic";
  /** Short, human phrase for what Jeff noticed. */
  note: string;
  atMs: number;
  /** True when a manual camera fix was forced (legacy badge path). */
  manual?: boolean;
};

type Listener = (sighting: JeffSighting) => void;

const listeners = new Set<Listener>();

/** Called by a health watchdog right after a fix. Does not log to Control Room. */
export function reportJeffSighting(
  domain: JeffSighting["domain"],
  note: string,
  manual = false
): void {
  const sighting: JeffSighting = { domain, note, atMs: Date.now(), manual };
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
