/**
 * One Drive camera owner, one write per frame.
 *
 * Before this, GO had many writers: the rAF follow loop, Jeff's resync effect,
 * the view drone, enter-Drive snap, chrome resize + settle snap, reclaim. Each
 * one called Mapbox directly, so the field dumps showed them fighting — 435 sat
 * at `Camera: 0 applied` with `Jeff 515` because a frozen picture and a bare
 * `setCenter` kept undoing each other.
 *
 * The rule now: every source publishes an *intent*. The rAF loop asks this
 * reducer for the single command to run this frame. Jeff never touches Mapbox.
 *
 * ## A radio hold must not stop the camera (438)
 *
 * This file used to answer `freeze` while the radio was held, on the theory that
 * we should not walk the camera onto uncached tiles. Build 438 proved that wrong
 * in the worst way: 125 s of hold in a 240 s drive meant 125 s of *no camera
 * writes*, so the puck simply drove off a frozen map — the exact thing the driver
 * reported twice.
 *
 * The freeze was only ever needed because Jeff was yanking the camera during
 * holds. The queue already removed that. And the two writers are not equal:
 * `safePanToCenter` goes through `easeTo`, which requires `isStyleLoaded()` and
 * no-ops while tiles are stalled, but `safeHardFollowCamera` is a direct
 * transform write that works with no tiles at all. So a held radio now means
 * **keep following with the hard writer**. Missing tiles render as background —
 * which is what every other nav app shows — while the puck stays on its line.
 *
 * Priority: drone > resync > follow. Degrading to the hard writer is orthogonal:
 * it can happen on any of those.
 */

import type { FollowCamWriter } from "./driveFollowCamWrite";

/** Why this frame must use the direct transform write instead of a yard-line pan. */
export type DriveCameraDegrade = "radio_hold" | "write_fails";

export type DriveCameraFrame = {
  /** A view drone shot owns the camera until its clock expires. */
  droneActive: boolean;
  /** Post-drone settle window (`viewFlyUntilMs`) — follow must not cut the landing. */
  flyWindowOpen: boolean;
  /** Supervisor dead-zone hold or app-offline. Degrades the writer; never stops it. */
  radioHold: boolean;
  /**
   * Consecutive failed writes. One is enough to degrade: a failed pan means
   * `isStyleLoaded()` is false, and the next pan will fail for the same reason.
   */
  writeFailStreak: number;
  /** Someone asked for the one re-pin snap (Jeff, reclaim, hold clear, view enter). */
  resyncRequested: boolean;
  /** Driver is pinching / panning — do not fight them. */
  exploring: boolean;
  /** Parked at a light: Core wobble must not twitch the camera. */
  parkedHold: boolean;
  /** Pose actually changed enough to be worth a Mapbox call. */
  poseChanged: boolean;
  /** Latched writer (pan = yard-line easeTo, hard = setCenter + yard-line shift). */
  writer: FollowCamWriter;
};

export type DriveCameraCommand =
  /** Drone (or its landing window) owns the camera — follow yields, no write. */
  | { kind: "yield"; reason: "drone" | "fly_window" }
  /** The one write for this frame. `resync` marks the re-pin snap. */
  | {
      kind: "write";
      writer: FollowCamWriter;
      resync: boolean;
      /** Non-null when the writer was forced to `hard` by a hold or failures. */
      degraded: DriveCameraDegrade | null;
    }
  /** Nothing worth writing. */
  | { kind: "idle"; reason: "exploring" | "parked" | "no_change" };

/**
 * A held radio or a failing pan both mean the same thing for this frame: the
 * `easeTo` path is unavailable, so write the transform directly.
 */
export function driveCameraDegrade(frame: {
  radioHold: boolean;
  writeFailStreak: number;
}): DriveCameraDegrade | null {
  if (frame.radioHold) return "radio_hold";
  if (frame.writeFailStreak > 0) return "write_fails";
  return null;
}

/**
 * Single decision point. Order matters and is the whole contract — a caller that
 * writes outside this result is the bug class this module exists to remove.
 */
export function resolveDriveCameraCommand(frame: DriveCameraFrame): DriveCameraCommand {
  if (frame.droneActive) return { kind: "yield", reason: "drone" };
  if (frame.flyWindowOpen) return { kind: "yield", reason: "fly_window" };

  const degraded = driveCameraDegrade(frame);
  const writer: FollowCamWriter = degraded ? "hard" : frame.writer;

  /* A resync outranks the comfort gates: it is the frame that re-pins the puck
   * after a hold, a reclaim, or entering Drive. */
  if (frame.resyncRequested) {
    return { kind: "write", writer, resync: true, degraded };
  }

  if (frame.exploring) return { kind: "idle", reason: "exploring" };
  if (frame.parkedHold) return { kind: "idle", reason: "parked" };
  if (!frame.poseChanged) return { kind: "idle", reason: "no_change" };

  return { kind: "write", writer, resync: false, degraded };
}

/** True when this frame performs a Mapbox camera call. */
export function driveCameraCommandWrites(cmd: DriveCameraCommand): boolean {
  return cmd.kind === "write";
}

/**
 * True when the camera is following on the direct-transform path. About reports
 * this through the `writer` gauge; a real freeze is now only a *failed* hard
 * write, which means the map itself is gone.
 */
export function driveCameraCommandDegraded(cmd: DriveCameraCommand): DriveCameraDegrade | null {
  return cmd.kind === "write" ? cmd.degraded : null;
}
