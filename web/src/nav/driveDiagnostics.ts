/**
 * Per-trip Drive counters for the About → Support diagnostics block.
 *
 * Why: a drive-test report of "it twitches sometimes" costs a build to chase.
 * These counters turn that into numbers (how often Core sampled, how many camera
 * writes the parked gate swallowed, whether tiles warmed) without a Mac, a
 * debugger, or anything leaving the phone — Bill copies the text and pastes it.
 *
 * Deliberately no coordinates, no timestamps, no route identity. Counters only,
 * so the copied block stays as personal-data-free as the rest of that panel.
 */

export type DriveDiagKey =
  | "coreSamples"
  | "camApplied"
  | "camParkedHold"
  | "camHardFallback"
  | "lowSignalHolds"
  | "tileWarmDone"
  | "tileWarmFailed"
  | "offRoute";

export type DriveDiagSnapshot = {
  coreSamples: number;
  camApplied: number;
  camParkedHold: number;
  camHardFallback: number;
  lowSignalHolds: number;
  tileWarmDone: number;
  tileWarmFailed: number;
  offRoute: number;
  /** Gauge, not a counter — controls currently drawn on the focused route. */
  roadControls: number;
  startedAtMs: number | null;
};

function emptySnapshot(): DriveDiagSnapshot {
  return {
    coreSamples: 0,
    camApplied: 0,
    camParkedHold: 0,
    camHardFallback: 0,
    lowSignalHolds: 0,
    tileWarmDone: 0,
    tileWarmFailed: 0,
    offRoute: 0,
    roadControls: 0,
    startedAtMs: null,
  };
}

let state = emptySnapshot();

/** Call on Go so counters describe this trip, not the app session. */
export function resetDriveDiag(nowMs: number = Date.now()): void {
  state = emptySnapshot();
  state.startedAtMs = nowMs;
}

/** Hot path: called from the Drive rAF loop, so this must stay an integer bump. */
export function bumpDriveDiag(key: DriveDiagKey, by = 1): void {
  state[key] += by;
}

export function setDriveDiagRoadControls(count: number): void {
  state.roadControls = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
}

export function driveDiagSnapshot(): DriveDiagSnapshot {
  return { ...state };
}

function minutesSince(startedAtMs: number | null, nowMs: number): number | null {
  if (startedAtMs == null || !Number.isFinite(startedAtMs)) return null;
  const ms = nowMs - startedAtMs;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return ms / 60_000;
}

/**
 * Support-diagnostics lines. Empty until a drive has started, so About reads the
 * same as always for anyone who never hit Go.
 */
export function formatDriveDiagLines(
  snap: DriveDiagSnapshot,
  nowMs: number = Date.now()
): string[] {
  if (snap.startedAtMs == null && snap.coreSamples === 0) return [];

  const mins = minutesSince(snap.startedAtMs, nowMs);
  const rate =
    mins != null && mins > 0 && snap.coreSamples > 0
      ? (snap.coreSamples / (mins * 60)).toFixed(2)
      : null;

  const lines = [
    `Drive: ${mins != null ? `${mins.toFixed(1)} min` : "just started"}, Core ${
      snap.coreSamples
    } samples${rate ? ` (${rate}/s)` : ""}`,
    `Camera: ${snap.camApplied} applied, ${snap.camParkedHold} parked holds, ${snap.camHardFallback} hard fallbacks`,
    `Signal: ${snap.lowSignalHolds} map holds, tiles ${snap.tileWarmDone} warm / ${snap.tileWarmFailed} failed`,
    `Route: ${snap.roadControls} road controls, ${snap.offRoute} off-route`,
  ];
  return lines;
}
