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
  /** Longest planned leg. Never shrinks when Core swaps in a short corridor. */
  liveBucket: string;
  /** Camera lead into a corner: once per corner, biggest lean, times it gave up. */
  leanApplies: number;
  leanMaxDeg: number;
  leanDrops: number;
  /** Worst Route Info split this trip, in quarters. Empty until progress exists. */
  youGps: string;
  youCore: string;
  youGap: number;
  /** Camera events during the open radio hold, copied onto the longest when it closes. */
  radioHoldAccFreeze: number;
  radioHoldAccReclaim: number;
  radioHoldAccJeff: number;
  radioHoldAccWriter: string;
  radioLongestFreeze: number;
  radioLongestReclaim: number;
  radioLongestJeff: number;
  radioLongestWriter: string;
  /** fastest | backroads, and how many times it changed after Go. */
  lockRule: string;
  lockSwitches: number;
  offRouteSec: number;
  offRouteLongestSec: number;
  offRouteOpenAtMs: number | null;
  /** Biggest upward jump in the remaining-time clock. */
  etaJumpMin: number;
  etaJumpWhere: string;
  etaJumpSource: string;
  /** New line left a point, came back, and continued. */
  doubledBack: number;
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
    liveBucket: "",
    leanApplies: 0,
    leanMaxDeg: 0,
    leanDrops: 0,
    youGps: "",
    youCore: "",
    youGap: 0,
    radioHoldAccFreeze: 0,
    radioHoldAccReclaim: 0,
    radioHoldAccJeff: 0,
    radioHoldAccWriter: "",
    radioLongestFreeze: 0,
    radioLongestReclaim: 0,
    radioLongestJeff: 0,
    radioLongestWriter: "",
    lockRule: "",
    lockSwitches: 0,
    offRouteSec: 0,
    offRouteLongestSec: 0,
    offRouteOpenAtMs: null,
    etaJumpMin: 0,
    etaJumpWhere: "",
    etaJumpSource: "",
    doubledBack: 0,
  };
}

let state = emptySnapshot();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
/** One apply per corner, not per frame. Not persisted — a remount may count one extra. */
let leanApplyOpen = false;
let leanDropOpen = false;
let lastEtaMin: number | null = null;
let lastDoubledSig = "";
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
    liveBucket: typeof parsed.liveBucket === "string" ? parsed.liveBucket.slice(0, 12) : "",
    leanApplies: asCount(parsed.leanApplies),
    leanMaxDeg: asCount(parsed.leanMaxDeg),
    leanDrops: asCount(parsed.leanDrops),
    youGps: typeof parsed.youGps === "string" ? parsed.youGps.slice(0, 8) : "",
    youCore: typeof parsed.youCore === "string" ? parsed.youCore.slice(0, 8) : "",
    youGap: asCount(parsed.youGap),
    radioHoldAccFreeze: asCount(parsed.radioHoldAccFreeze),
    radioHoldAccReclaim: asCount(parsed.radioHoldAccReclaim),
    radioHoldAccJeff: asCount(parsed.radioHoldAccJeff),
    radioHoldAccWriter:
      typeof parsed.radioHoldAccWriter === "string" ? parsed.radioHoldAccWriter.slice(0, 8) : "",
    radioLongestFreeze: asCount(parsed.radioLongestFreeze),
    radioLongestReclaim: asCount(parsed.radioLongestReclaim),
    radioLongestJeff: asCount(parsed.radioLongestJeff),
    radioLongestWriter:
      typeof parsed.radioLongestWriter === "string" ? parsed.radioLongestWriter.slice(0, 8) : "",
    lockRule: typeof parsed.lockRule === "string" ? parsed.lockRule.slice(0, 12) : "",
    lockSwitches: asCount(parsed.lockSwitches),
    offRouteSec: asCount(parsed.offRouteSec),
    offRouteLongestSec: asCount(parsed.offRouteLongestSec),
    offRouteOpenAtMs:
      typeof parsed.offRouteOpenAtMs === "number" && Number.isFinite(parsed.offRouteOpenAtMs)
        ? parsed.offRouteOpenAtMs
        : null,
    etaJumpMin: asCount(parsed.etaJumpMin),
    etaJumpWhere: typeof parsed.etaJumpWhere === "string" ? parsed.etaJumpWhere.slice(0, 8) : "",
    etaJumpSource: typeof parsed.etaJumpSource === "string" ? parsed.etaJumpSource.slice(0, 8) : "",
    doubledBack: asCount(parsed.doubledBack),
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
  leanApplyOpen = false;
  leanDropOpen = false;
  lastEtaMin = null;
  lastDoubledSig = "";
  persistDriveDiagNow();
}

/** Hot path: called from the Drive rAF loop, so this must stay an integer bump. */
export function bumpDriveDiag(key: DriveDiagKey, by = 1): void {
  state[key] += by;
  if (key === "camReclaim" && state.radioHoldOpenAtMs != null) {
    state.radioHoldAccReclaim += by;
  }
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

/** Guidance corridor right now. Allowed to shrink so a short Core line stays visible. */
export function setDriveDiagLiveLengthM(meters: number): void {
  const bucket = routeLengthBucketMi(meters);
  if (!bucket || bucket === state.liveBucket) return;
  state.liveBucket = bucket;
  persistDriveDiagSoon();
}

function copyLongestHoldCam(): void {
  state.radioLongestFreeze = state.radioHoldAccFreeze;
  state.radioLongestReclaim = state.radioHoldAccReclaim;
  state.radioLongestJeff = state.radioHoldAccJeff;
  state.radioLongestWriter = state.radioHoldAccWriter;
}

export function noteDriveDiagRadioHold(active: boolean, nowMs: number = Date.now()): void {
  if (active) {
    if (state.radioHoldOpenAtMs != null) return;
    state.radioHolds += 1;
    state.radioHoldOpenAtMs = nowMs;
    state.radioHoldAccFreeze = 0;
    state.radioHoldAccReclaim = 0;
    state.radioHoldAccJeff = 0;
    state.radioHoldAccWriter = state.camWriter;
    persistDriveDiagSoon();
    return;
  }
  if (state.radioHoldOpenAtMs == null) return;
  const sec = Math.max(0, Math.round((nowMs - state.radioHoldOpenAtMs) / 1000));
  state.radioHoldOpenAtMs = null;
  state.radioHoldSec += sec;
  if (sec >= state.radioHoldLongestSec) {
    state.radioHoldLongestSec = sec;
    copyLongestHoldCam();
  }
  persistDriveDiagSoon();
}

export function noteDriveDiagCamFailStreak(streak: number): void {
  if (!Number.isFinite(streak) || streak <= state.camFailStreakMax) return;
  state.camFailStreakMax = Math.round(streak);
  persistDriveDiagSoon();
}

export function noteDriveDiagCamFreeze(): void {
  state.camFreeze += 1;
  if (state.radioHoldOpenAtMs != null) state.radioHoldAccFreeze += 1;
  persistDriveDiagSoon();
}

export function noteDriveDiagJeffResync(): void {
  state.jeffResync += 1;
  if (state.radioHoldOpenAtMs != null) state.radioHoldAccJeff += 1;
  persistDriveDiagSoon();
}

export function setDriveDiagCamWriter(writer: string): void {
  if (writer !== "pan" && writer !== "hard") return;
  let dirty = false;
  if (state.radioHoldOpenAtMs != null && state.radioHoldAccWriter !== writer) {
    state.radioHoldAccWriter = writer;
    dirty = true;
  }
  if (state.camWriter !== writer) {
    state.camWriter = writer;
    dirty = true;
  }
  if (dirty) persistDriveDiagSoon();
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

const YOU_LABELS = ["", "start", "1/4", "mid", "3/4", "end"] as const;

function youQuarter(alongM: number, totalM: number): { label: string; rank: number } {
  if (!Number.isFinite(alongM) || !Number.isFinite(totalM) || totalM <= 1) {
    return { label: "", rank: 0 };
  }
  const t = Math.max(0, alongM) / totalM;
  const rank = t < 0.12 ? 1 : t < 0.37 ? 2 : t < 0.62 ? 3 : t < 0.87 ? 4 : 5;
  return { label: YOU_LABELS[rank] ?? "", rank };
}

/** Once per corner that actually leads, plus the biggest lean and each time it drops to Core. */
export function noteDriveDiagCamLean(leanDeg: number, dropped: boolean): void {
  const lean = Number.isFinite(leanDeg) ? Math.abs(leanDeg) : 0;
  let dirty = false;
  if (dropped) {
    if (!leanDropOpen) {
      state.leanDrops += 1;
      leanDropOpen = true;
      dirty = true;
    }
  } else {
    leanDropOpen = false;
  }
  if (lean >= 8) {
    const rounded = Math.round(lean);
    if (rounded > state.leanMaxDeg) {
      state.leanMaxDeg = rounded;
      dirty = true;
    }
    if (!leanApplyOpen) {
      state.leanApplies += 1;
      leanApplyOpen = true;
      dirty = true;
    }
  } else if (lean < 4) {
    leanApplyOpen = false;
  }
  if (dirty) persistDriveDiagSoon();
}

/**
 * Route Info YOU. Keeps the worst split (GPS far ahead of Core) and, when they
 * agree, the farthest quarter reached.
 */
export function noteDriveDiagYou(coreAlongM: number, gpsAlongM: number, totalM: number): void {
  const gps = youQuarter(gpsAlongM, totalM);
  if (gps.rank <= 0) return;
  const core = youQuarter(coreAlongM, totalM);
  const gap = Math.max(0, gps.rank - core.rank);
  const prevGps = YOU_LABELS.indexOf(state.youGps as (typeof YOU_LABELS)[number]);
  if (gap > state.youGap || (gap === state.youGap && gps.rank > prevGps)) {
    state.youGap = gap;
    state.youGps = gps.label;
    state.youCore = core.label;
    persistDriveDiagSoon();
  }
}

export function noteDriveDiagRouteLock(backroads: boolean, navigating: boolean): void {
  if (!navigating) return;
  const next = backroads ? "backroads" : "fastest";
  if (!state.lockRule) {
    state.lockRule = next;
    persistDriveDiagSoon();
    return;
  }
  if (state.lockRule === next) return;
  state.lockRule = next;
  state.lockSwitches += 1;
  persistDriveDiagSoon();
}

export function noteDriveDiagOffRoute(active: boolean, nowMs: number = Date.now()): void {
  if (active) {
    if (state.offRouteOpenAtMs != null) return;
    state.offRouteOpenAtMs = nowMs;
    persistDriveDiagSoon();
    return;
  }
  if (state.offRouteOpenAtMs == null) return;
  const sec = Math.max(0, Math.round((nowMs - state.offRouteOpenAtMs) / 1000));
  state.offRouteOpenAtMs = null;
  state.offRouteSec += sec;
  if (sec > state.offRouteLongestSec) state.offRouteLongestSec = sec;
  persistDriveDiagSoon();
}

function etaDistanceBucket(distanceLeftM: number | null): string {
  if (distanceLeftM == null || !Number.isFinite(distanceLeftM)) return "?";
  const mi = distanceLeftM / 1609.344;
  if (mi < 1) return "<1mi";
  if (mi < 5) return "1-5mi";
  return "5+mi";
}

/** Remaining minutes on the toolbar. A jump of 3+ minutes is the late-trip lie. */
export function noteDriveDiagEta(
  remainingMin: number,
  distanceLeftM: number | null,
  source: "live" | "line"
): void {
  if (!Number.isFinite(remainingMin) || remainingMin <= 0) return;
  const next = Math.round(remainingMin);
  if (lastEtaMin == null) {
    lastEtaMin = next;
    return;
  }
  const jump = next - lastEtaMin;
  lastEtaMin = next;
  if (jump < 3 || jump <= state.etaJumpMin) return;
  state.etaJumpMin = jump;
  state.etaJumpWhere = etaDistanceBucket(distanceLeftM);
  state.etaJumpSource = source;
  persistDriveDiagSoon();
}

/** Caller already decided this line doubles back. Signature keeps one count per line. */
export function noteDriveDiagDoubledBack(signature: string): void {
  if (!signature || signature === lastDoubledSig) return;
  lastDoubledSig = signature;
  state.doubledBack += 1;
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
  let holdFreeze = snap.radioLongestFreeze;
  let holdReclaim = snap.radioLongestReclaim;
  let holdJeff = snap.radioLongestJeff;
  let holdWriter = snap.radioLongestWriter;
  if (snap.radioHoldOpenAtMs != null) {
    const live = Math.max(0, Math.round((nowMs - snap.radioHoldOpenAtMs) / 1000));
    holdSec += live;
    if (live >= holdLongest) {
      holdLongest = live;
      holdFreeze = snap.radioHoldAccFreeze;
      holdReclaim = snap.radioHoldAccReclaim;
      holdJeff = snap.radioHoldAccJeff;
      holdWriter = snap.radioHoldAccWriter || snap.camWriter;
    }
  }

  let offSec = snap.offRouteSec;
  let offLongest = snap.offRouteLongestSec;
  if (snap.offRouteOpenAtMs != null) {
    const live = Math.max(0, Math.round((nowMs - snap.offRouteOpenAtMs) / 1000));
    offSec += live;
    if (live > offLongest) offLongest = live;
  }
  const offSpan = offSec > 0 ? ` (${offSec}s, longest ${offLongest}s)` : "";
  const lock = snap.lockRule
    ? `, lock ${snap.lockRule}${snap.lockSwitches ? `, switched ${snap.lockSwitches}` : ""}`
    : "";
  const doubled = snap.doubledBack ? `, doubled back ${snap.doubledBack}` : "";
  const holdCam =
    holdLongest > 0 && (holdWriter || holdFreeze || holdReclaim || holdJeff)
      ? `, ${holdWriter || "?"} freeze ${holdFreeze} reclaim ${holdReclaim} Jeff ${holdJeff}`
      : "";
  const miles = [
    snap.routeBucket ? `plan ${snap.routeBucket}` : "",
    snap.liveBucket ? `live ${snap.liveBucket}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  const lines = [
    `Drive: ${age ?? "just started"}, Core ${snap.coreSamples} samples${
      rate ? ` (${rate}/s)` : ""
    }${miles ? `, ${miles}` : ""}${snap.poseSource ? `, puck ${snap.poseSource}` : ""}`,
    `Camera: ${snap.camApplied} applied, ${snap.camParkedHold} parked holds, ${snap.camWriteFailed} write fails, ${snap.camReclaim} reclaims`,
    `Cam health: freeze ${snap.camFreeze}, max fail streak ${snap.camFailStreakMax}, Jeff ${snap.jeffResync}${
      snap.camWriter ? `, writer ${snap.camWriter}` : ""
    }`,
    `Signal: ${snap.lowSignalHolds} map holds, tiles ${snap.tileWarmDone} warm / ${snap.tileWarmFailed} failed`,
    `Radio: ${snap.radioHolds} holds (${holdSec}s, longest ${holdLongest}s${holdCam})`,
    `Route: ${snap.roadControls} road controls, ${snap.offRoute} off-route${offSpan}${lock}${doubled}`,
    `Views: ${snap.viewTaps} taps, drone ${snap.droneStarts} start / ${snap.droneDone} done / ${snap.droneAbort} abort / ${snap.droneRetarget} retarget`,
    `Skip: first ${snap.droneSkipFirst}, same ${snap.droneSkipSame}, hold ${snap.droneSkipHold}, cmp ${snap.droneSkipCompare}, wait ${snap.droneSkipNotReady}, no-to ${snap.droneFailNoTo}, no-from ${snap.droneFailNoFrom}`,
    `Drone writes: ${snap.droneWriteFail} fails${
      snap.droneLast ? `, last ${snap.droneLast}` : ""
    }`,
    `Trail: ${snap.droneTrail || "none"}`,
    `Lean: ${snap.leanApplies} applies, max ${snap.leanMaxDeg}°, ${snap.leanDrops} drops`,
    `YOU: gps ${snap.youGps || "-"}, core ${snap.youCore || "-"}`,
    `ETA: ${
      snap.etaJumpMin > 0
        ? `jump ${snap.etaJumpMin}min at ${snap.etaJumpWhere || "?"} (${snap.etaJumpSource || "?"})`
        : "steady"
    }`,
  ];
  return lines;
}
