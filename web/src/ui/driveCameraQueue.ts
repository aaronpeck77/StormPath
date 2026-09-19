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
 * Priority: drone > radio-hold freeze > resync > follow.
 *  - Drone owns the shot (Dr/Mp/Rt must never be cut).
 *  - Radio hold keeps the last good picture instead of walking onto dead tiles.
 *  - Resync is the one snap that re-pins the puck (hold clear, Jeff, reclaim).
 *  - Follow is the normal per-frame glide.
 */

import type { FollowCamWriter } from "./driveFollowCamWrite";

export type DriveCameraFrame = {
  /** A view drone shot owns the camera until its clock expires. */
  droneActive: boolean;
  /** Post-drone settle window (`viewFlyUntilMs`) — follow must not cut the landing. */
  flyWindowOpen: boolean;
  /** Supervisor dead-zone hold or app-offline: keep the last painted frame. */
  radioHold: boolean;
  /** Consecutive failed writes — weak tiles, before the supervisor latches. */
  writeFailStreak: number;
  /** Failed writes that trip a freeze when the radio still looks up. */
  failFreezeAfter: number;
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
  /** Hold the last good picture. No Mapbox call at all. */
  | { kind: "freeze"; reason: "radio_hold" | "weak_tiles" }
  /** The one write for this frame. `resync` marks the re-pin snap. */
  | { kind: "write"; writer: FollowCamWriter; resync: boolean }
  /** Nothing worth writing. */
  | { kind: "idle"; reason: "exploring" | "parked" | "no_change" };

/**
 * Single decision point. Order matters and is the whole contract — a caller that
 * writes outside this result is the bug class this module exists to remove.
 */
export function resolveDriveCameraCommand(frame: DriveCameraFrame): DriveCameraCommand {
  if (frame.droneActive) return { kind: "yield", reason: "drone" };
  if (frame.flyWindowOpen) return { kind: "yield", reason: "fly_window" };

  /* Radio hold beats resync: letting Jeff unfreeze the picture is what walked the
   * camera onto missing tiles for a whole dead-zone trip. The snap happens after
   * the hold clears, because the clear edge is what sets `resyncRequested`. */
  if (frame.radioHold) return { kind: "freeze", reason: "radio_hold" };

  /* A resync must be able to break a weak-tile freeze, or a bad streak deadlocks
   * the camera for the rest of the trip (435: 0 applies, puck stuck at midfield). */
  if (!frame.resyncRequested && frame.writeFailStreak >= frame.failFreezeAfter) {
    return { kind: "freeze", reason: "weak_tiles" };
  }

  if (frame.resyncRequested) {
    return { kind: "write", writer: frame.writer, resync: true };
  }

  if (frame.exploring) return { kind: "idle", reason: "exploring" };
  if (frame.parkedHold) return { kind: "idle", reason: "parked" };
  if (!frame.poseChanged) return { kind: "idle", reason: "no_change" };

  return { kind: "write", writer: frame.writer, resync: false };
}

/** True when this frame performs a Mapbox camera call. */
export function driveCameraCommandWrites(cmd: DriveCameraCommand): boolean {
  return cmd.kind === "write";
}

/**
 * Freeze episodes are counted once per episode in About, not per frame — a 60 fps
 * loop reported 60x reality before diagnostics counted events.
 */
export function driveCameraCommandFreezes(cmd: DriveCameraCommand): boolean {
  return cmd.kind === "freeze";
}
