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
  viewTaps: number;
  droneStarts: number;
  droneDone: number;
  droneAbort: number;
  /** A new view tap replaced a shot already in the air. Not a failure. */
  droneRetarget: number;
  droneSkipFirst: number;
  droneSkipSame: number;
  droneSkipHold: number;
  droneSkipCompare: number;
  droneSkipNotReady: number;
  droneFailNoTo: number;
  droneFailNoFrom: number;
  droneWriteFail: number;
  /** Last attempted pair, e.g. Rt>Dr — no coordinates. */
  droneLast: string;
  /** Last few outcomes, e.g. Mp>Rt done · Rt>Dr fail47 */
  droneTrail: string;
  radioHolds: number;
  radioHoldSec: number;
  radioHoldLongestSec: number;
  /** Set while a hold is open so About can include the live stretch. */
  radioHoldOpenAtMs: number | null;
  camFreeze: number;
  camFailStreakMax: number;
  jeffResync: number;
  /** Bucket only — never exact miles or a place name. */
  routeBucket: string;
  camWriter: string;
  /** Which pipeline the puck is reading: Core's matched pose, or raw GPS + JS snap. */
  poseSource: string;
};

export type ViewDroneSkip =
  | "first"
  | "same"
  | "hold"
  | "compare"
  | "not_ready"
  | "no_to"
  | "no_from";

export type ViewDroneEnd = "done" | "abort" | "retarget";

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
    viewTaps: 0,
    droneStarts: 0,
    droneDone: 0,
    droneAbort: 0,
    droneRetarget: 0,
    droneSkipFirst: 0,
    droneSkipSame: 0,
    droneSkipHold: 0,
    droneSkipCompare: 0,
    droneSkipNotReady: 0,
    droneFailNoTo: 0,
    droneFailNoFrom: 0,
    droneWriteFail: 0,
    droneLast: "",
    droneTrail: "",
    radioHolds: 0,
    radioHoldSec: 0,
    radioHoldLongestSec: 0,
    radioHoldOpenAtMs: null,
    camFreeze: 0,
    camFailStreakMax: 0,
    jeffResync: 0,
    routeBucket: "",
    camWriter: "",
    poseSource: "",
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
    viewTaps: asCount(parsed.viewTaps),
    droneStarts: asCount(parsed.droneStarts),
    droneDone: asCount(parsed.droneDone),
    droneAbort: asCount(parsed.droneAbort),
    droneRetarget: asCount(parsed.droneRetarget),
    droneSkipFirst: asCount(parsed.droneSkipFirst),
    droneSkipSame: asCount(parsed.droneSkipSame),
    droneSkipHold: asCount(parsed.droneSkipHold),
    droneSkipCompare: asCount(parsed.droneSkipCompare),
    droneSkipNotReady: asCount(parsed.droneSkipNotReady),
    droneFailNoTo: asCount(parsed.droneFailNoTo),
    droneFailNoFrom: asCount(parsed.droneFailNoFrom),
    droneWriteFail: asCount(parsed.droneWriteFail),
    droneLast: typeof parsed.droneLast === "string" ? parsed.droneLast.slice(0, 24) : "",
    droneTrail: typeof parsed.droneTrail === "string" ? parsed.droneTrail.slice(0, 160) : "",
    radioHolds: asCount(parsed.radioHolds),
    radioHoldSec: asCount(parsed.radioHoldSec),
    radioHoldLongestSec: asCount(parsed.radioHoldLongestSec),
    radioHoldOpenAtMs:
      typeof parsed.radioHoldOpenAtMs === "number" && Number.isFinite(parsed.radioHoldOpenAtMs)
        ? parsed.radioHoldOpenAtMs
        : null,
    camFreeze: asCount(parsed.camFreeze),
    camFailStreakMax: asCount(parsed.camFailStreakMax),
    jeffResync: asCount(parsed.jeffResync),
    routeBucket: typeof parsed.routeBucket === "string" ? parsed.routeBucket.slice(0, 12) : "",
    camWriter: typeof parsed.camWriter === "string" ? parsed.camWriter.slice(0, 8) : "",
    poseSource: typeof parsed.poseSource === "string" ? parsed.poseSource.slice(0, 8) : "",
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

export function routeLengthBucketMi(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return "";
  const mi = meters / 1609.344;
  if (mi < 20) return "<20mi";
  if (mi < 50) return "20-50mi";
  if (mi < 100) return "50-100mi";
  return "100+mi";
}

function routeBucketRank(bucket: string): number {
  if (bucket === "100+mi") return 4;
  if (bucket === "50-100mi") return 3;
  if (bucket === "20-50mi") return 2;
  if (bucket === "<20mi") return 1;
  return 0;
}

export function setDriveDiagRouteLengthM(meters: number): void {
  const bucket = routeLengthBucketMi(meters);
  if (!bucket) return;
  /* A short Core corridor must not erase the trip they actually planned.
   * 446 commutes were 50+ mi and both dumps still said <20mi. */
  if (routeBucketRank(bucket) <= routeBucketRank(state.routeBucket)) return;
  state.routeBucket = bucket;
  persistDriveDiagSoon();
}

export function noteDriveDiagRadioHold(active: boolean, nowMs: number = Date.now()): void {
  if (active) {
    if (state.radioHoldOpenAtMs != null) return;
    state.radioHolds += 1;
    state.radioHoldOpenAtMs = nowMs;
    persistDriveDiagSoon();
    return;
  }
  if (state.radioHoldOpenAtMs == null) return;
  const sec = Math.max(0, Math.round((nowMs - state.radioHoldOpenAtMs) / 1000));
  state.radioHoldOpenAtMs = null;
  state.radioHoldSec += sec;
  if (sec > state.radioHoldLongestSec) state.radioHoldLongestSec = sec;
  persistDriveDiagSoon();
}

export function noteDriveDiagCamFailStreak(streak: number): void {
  if (!Number.isFinite(streak) || streak <= state.camFailStreakMax) return;
  state.camFailStreakMax = Math.round(streak);
  persistDriveDiagSoon();
}

export function noteDriveDiagCamFreeze(): void {
  state.camFreeze += 1;
  persistDriveDiagSoon();
}

export function noteDriveDiagJeffResync(): void {
  state.jeffResync += 1;
  persistDriveDiagSoon();
}

export function setDriveDiagCamWriter(writer: string): void {
  if (writer !== "pan" && writer !== "hard") return;
  if (state.camWriter === writer) return;
  state.camWriter = writer;
  persistDriveDiagSoon();
}

/**
 * Called from the 60 fps loop, so it must stay a cheap no-op until the pipeline
 * actually changes — a persist per frame would thrash sessionStorage.
 */
export function setDriveDiagPoseSource(source: string): void {
  if (source !== "core" && source !== "gps") return;
  if (state.poseSource === source) return;
  state.poseSource = source;
  persistDriveDiagSoon();
}

export function driveDiagSnapshot(): DriveDiagSnapshot {
  return { ...state };
}

function viewToken(mode: string): string {
  if (mode === "drive") return "Dr";
  if (mode === "topdown") return "Mp";
  if (mode === "route") return "Rt";
  return mode.slice(0, 2) || "?";
}

function pushDroneTrail(entry: string): void {
  const parts = state.droneTrail ? state.droneTrail.split(" · ") : [];
  parts.push(entry);
  state.droneTrail = parts.slice(-6).join(" · ");
}

function touchTripClock(): void {
  if (state.startedAtMs == null) state.startedAtMs = Date.now();
}

/** A Dr/Mp/Rt tap we intended to fly. */
export function noteViewDroneTap(fromMode: string, toMode: string): void {
  touchTripClock();
  state.viewTaps += 1;
  state.droneLast = `${viewToken(fromMode)}>${viewToken(toMode)}`;
  persistDriveDiagSoon();
}

export function noteViewDroneSkip(reason: ViewDroneSkip): void {
  /* First paint is DriveMap mount, not a trip — keep About quiet. */
  if (reason !== "first") touchTripClock();
  if (reason === "first") state.droneSkipFirst += 1;
  else if (reason === "same") state.droneSkipSame += 1;
  else if (reason === "hold") state.droneSkipHold += 1;
  else if (reason === "compare") state.droneSkipCompare += 1;
  else if (reason === "not_ready") state.droneSkipNotReady += 1;
  else if (reason === "no_to") state.droneFailNoTo += 1;
  else state.droneFailNoFrom += 1;
  if (reason === "no_to" || reason === "no_from") {
    pushDroneTrail(`${state.droneLast || "??"} ${reason === "no_to" ? "noTo" : "noFrom"}`);
  }
  persistDriveDiagSoon();
}

/**
 * Label captured when the shot left the pad. A later tap overwrites `droneLast`,
 * and Go's `resetDriveDiag` clears it, so the landing must not read the live field
 * or the trail opens with `??`.
 */
let activeShotLabel = "";

export function noteViewDroneStart(): void {
  touchTripClock();
  state.droneStarts += 1;
  activeShotLabel = state.droneLast || "??";
  persistDriveDiagSoon();
}

export function noteViewDroneWriteFail(): void {
  state.droneWriteFail += 1;
  persistDriveDiagSoon();
}

export function noteViewDroneEnd(
  end: ViewDroneEnd,
  writeFails = 0,
  ms?: number,
  waitMs?: number
): void {
  if (end === "done") state.droneDone += 1;
  else if (end === "retarget") state.droneRetarget += 1;
  else state.droneAbort += 1;
  const tag =
    end === "done"
      ? writeFails > 0
        ? `fail${writeFails}`
        : "ok"
      : end;
  const dur = typeof ms === "number" && Number.isFinite(ms) ? ` ${Math.round(ms)}ms` : "";
  const wait =
    typeof waitMs === "number" && Number.isFinite(waitMs) && waitMs >= 80
      ? ` wait${Math.round(waitMs)}`
      : "";
  const label = activeShotLabel || state.droneLast || "??";
  pushDroneTrail(`${label} ${tag}${dur}${wait}`);
  persistDriveDiagSoon();
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
  if (
    snap.startedAtMs == null &&
    snap.coreSamples === 0 &&
    snap.viewTaps === 0 &&
    snap.droneStarts === 0
  ) {
    return [];
  }

  const age = formatDriveAge(snap.startedAtMs, nowMs);
  const mins = minutesSince(snap.startedAtMs, nowMs);
  const rate =
    mins != null && mins > 0 && snap.coreSamples > 0
      ? (snap.coreSamples / (mins * 60)).toFixed(2)
      : null;

  let holdSec = snap.radioHoldSec;
  let holdLongest = snap.radioHoldLongestSec;
  if (snap.radioHoldOpenAtMs != null) {
    const live = Math.max(0, Math.round((nowMs - snap.radioHoldOpenAtMs) / 1000));
    holdSec += live;
    if (live > holdLongest) holdLongest = live;
  }

  const lines = [
    `Drive: ${age ?? "just started"}, Core ${snap.coreSamples} samples${
      rate ? ` (${rate}/s)` : ""
    }${snap.routeBucket ? `, ${snap.routeBucket}` : ""}${
      snap.poseSource ? `, puck ${snap.poseSource}` : ""
    }`,
    `Camera: ${snap.camApplied} applied, ${snap.camParkedHold} parked holds, ${snap.camWriteFailed} write fails, ${snap.camReclaim} reclaims`,
    `Cam health: freeze ${snap.camFreeze}, max fail streak ${snap.camFailStreakMax}, Jeff ${snap.jeffResync}${
      snap.camWriter ? `, writer ${snap.camWriter}` : ""
    }`,
    `Signal: ${snap.lowSignalHolds} map holds, tiles ${snap.tileWarmDone} warm / ${snap.tileWarmFailed} failed`,
    `Radio: ${snap.radioHolds} holds (${holdSec}s, longest ${holdLongest}s)`,
    `Route: ${snap.roadControls} road controls, ${snap.offRoute} off-route`,
    `Views: ${snap.viewTaps} taps, drone ${snap.droneStarts} start / ${snap.droneDone} done / ${snap.droneAbort} abort / ${snap.droneRetarget} retarget`,
    `Skip: first ${snap.droneSkipFirst}, same ${snap.droneSkipSame}, hold ${snap.droneSkipHold}, cmp ${snap.droneSkipCompare}, wait ${snap.droneSkipNotReady}, no-to ${snap.droneFailNoTo}, no-from ${snap.droneFailNoFrom}`,
    `Drone writes: ${snap.droneWriteFail} fails${
      snap.droneLast ? `, last ${snap.droneLast}` : ""
    }`,
    `Trail: ${snap.droneTrail || "none"}`,
  ];
  return lines;
}
