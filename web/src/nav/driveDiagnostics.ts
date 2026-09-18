/**
 * Per-trip Drive counters for the About → Support diagnostics block.
 *
 * Why: a drive-test report of "it twitches sometimes" costs a build to chase.
 * These counters turn that into numbers (how often Core sampled, how many camera
 * writes the parked gate swallowed, whether tiles warmed) without a Mac, a
 * debugger, or anything leaving the phone — Bill copies the text and pastes it.
 *
 * Count events, never frames. The Drive loop runs at 60 fps against Core's ~1 Hz
 * sample, so a per-frame bump reports 60x reality and reads as a catastrophe.
 *
 * Deliberately no coordinates, no timestamps, no route identity. Counters only,
 * so the copied block stays as personal-data-free as the rest of that panel.
 */

export type DriveDiagKey =
  | "coreSamples"
  | "camApplied"
  | "camParkedHold"
  | "camWriteFailed"
  | "camReclaim"
  | "lowSignalHolds"
  | "tileWarmDone"
  | "tileWarmFailed"
  | "offRoute";

export type DriveDiagSnapshot = {
  coreSamples: number;
  camApplied: number;
  camParkedHold: number;
  camWriteFailed: number;
  camReclaim: number;
  lowSignalHolds: number;
  tileWarmDone: number;
  tileWarmFailed: number;
  offRoute: number;
  /** Gauge, not a counter — controls currently drawn on the focused route. */
  roadControls: number;
  startedAtMs: number | null;
};

const STORAGE_KEY = "stormpath.driveDiag.v1";

function emptySnapshot(): DriveDiagSnapshot {
  return {
    coreSamples: 0,
    camApplied: 0,
    camParkedHold: 0,
    camWriteFailed: 0,
    camReclaim: 0,
    lowSignalHolds: 0,
    tileWarmDone: 0,
    tileWarmFailed: 0,
    offRoute: 0,
    roadControls: 0,
    startedAtMs: null,
  };
}

let state = emptySnapshot();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
/** Fallback when sessionStorage is missing (Node tests / locked-down WebViews). */
let memoryStore: string | null = null;

function asCount(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function applyParsed(parsed: Partial<DriveDiagSnapshot>): void {
  state = {
    ...emptySnapshot(),
    coreSamples: asCount(parsed.coreSamples),
    camApplied: asCount(parsed.camApplied),
    camParkedHold: asCount(parsed.camParkedHold),
    camWriteFailed: asCount(parsed.camWriteFailed),
    camReclaim: asCount(parsed.camReclaim),
    lowSignalHolds: asCount(parsed.lowSignalHolds),
    tileWarmDone: asCount(parsed.tileWarmDone),
    tileWarmFailed: asCount(parsed.tileWarmFailed),
    offRoute: asCount(parsed.offRoute),
    roadControls: asCount(parsed.roadControls),
    startedAtMs:
      typeof parsed.startedAtMs === "number" && Number.isFinite(parsed.startedAtMs)
        ? parsed.startedAtMs
        : null,
  };
}

export function persistDriveDiagNow(): void {
  const json = JSON.stringify(state);
  memoryStore = json;
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(STORAGE_KEY, json);
    }
  } catch {
    /* private mode / SSR */
  }
}

function persistDriveDiagSoon(): void {
  if (persistTimer != null) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistDriveDiagNow();
  }, 800);
}

function readPersistedRaw(): string | null {
  try {
    if (typeof sessionStorage !== "undefined") {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) return raw;
    }
  } catch {
    /* ignore */
  }
  return memoryStore;
}

/** Restore a JSON snapshot (WebView remount / tests). */
export function hydrateDriveDiagFromJson(raw: string): void {
  const parsed = JSON.parse(raw) as Partial<DriveDiagSnapshot>;
  if (!parsed || typeof parsed !== "object") return;
  applyParsed(parsed);
}

/** Restore after a WebView remount so About still has the trip, not a 0.6s blank. */
export function hydrateDriveDiagFromStorage(): void {
  try {
    const raw = readPersistedRaw();
    if (!raw) return;
    hydrateDriveDiagFromJson(raw);
  } catch {
    /* ignore junk */
  }
}

hydrateDriveDiagFromStorage();

/** Call on a genuine Go so counters describe this trip, not the last one.
 *  Do not call on Core reconnect / restartNative — that wiped the long-drive dump. */
export function resetDriveDiag(nowMs: number = Date.now()): void {
  if (persistTimer != null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  state = emptySnapshot();
  state.startedAtMs = nowMs;
  persistDriveDiagNow();
}

/** Hot path: called from the Drive rAF loop, so this must stay an integer bump. */
export function bumpDriveDiag(key: DriveDiagKey, by = 1): void {
  state[key] += by;
  persistDriveDiagSoon();
}

export function setDriveDiagRoadControls(count: number): void {
  state.roadControls = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
  persistDriveDiagSoon();
}

export function driveDiagSnapshot(): DriveDiagSnapshot {
  return { ...state };
}

function formatDriveAge(startedAtMs: number | null, nowMs: number): string | null {
  if (startedAtMs == null || !Number.isFinite(startedAtMs)) return null;
  const ms = nowMs - startedAtMs;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
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

  const age = formatDriveAge(snap.startedAtMs, nowMs);
  const mins = minutesSince(snap.startedAtMs, nowMs);
  const rate =
    mins != null && mins > 0 && snap.coreSamples > 0
      ? (snap.coreSamples / (mins * 60)).toFixed(2)
      : null;

  const lines = [
    `Drive: ${age ?? "just started"}, Core ${snap.coreSamples} samples${
      rate ? ` (${rate}/s)` : ""
    }`,
    `Camera: ${snap.camApplied} applied, ${snap.camParkedHold} parked holds, ${snap.camWriteFailed} write fails, ${snap.camReclaim} reclaims`,
    `Signal: ${snap.lowSignalHolds} map holds, tiles ${snap.tileWarmDone} warm / ${snap.tileWarmFailed} failed`,
    `Route: ${snap.roadControls} road controls, ${snap.offRoute} off-route`,
  ];
  return lines;
}
