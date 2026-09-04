/**
 * Drive follow-cam writes. Mixing yard-line `easeTo` (padding+offset) with
 * `setCenter` (no offset) makes the map leap up and down the road every few frames.
 */

export const FOLLOW_CAM_JUMP_REPAIR_COOLDOWN_MS = 1_200;
export const FOLLOW_CAM_STALL_FRAMES_BEFORE_REPAIR = 8;

/**
 * After tile-hold clears, keep hard follow this long so a flapping radio /
 * `isStyleLoaded()` does not snap yard-line pan ↔ centered setCenter
 * (puck looks like it is leaping forward and back along the road).
 */
export const FOLLOW_CAM_HOLD_CLEAR_MS = 3_000;

export type DriveFollowCamWrite = "skip" | "jump_with_offset";

/**
 * One camera writer at a time. Pan (yard-line offset) vs hard setCenter
 * (no offset) are two road framings — do not switch them from tile-load flaps.
 * Hard only while tiles are held, plus a short clear delay.
 */
export type FollowCamWriter = "pan" | "hard";

export function advanceFollowCamWriter(input: {
  holdTiles: boolean;
  writer: FollowCamWriter;
  holdFalseSinceMs: number | null;
  nowMs: number;
  holdClearMs?: number;
}): { writer: FollowCamWriter; holdFalseSinceMs: number | null } {
  if (input.holdTiles) {
    return { writer: "hard", holdFalseSinceMs: null };
  }
  const since = input.holdFalseSinceMs ?? input.nowMs;
  if (input.writer === "hard") {
    const wait = input.holdClearMs ?? FOLLOW_CAM_HOLD_CLEAR_MS;
    if (input.nowMs - since < wait) {
      return { writer: "hard", holdFalseSinceMs: since };
    }
  }
  return { writer: "pan", holdFalseSinceMs: since };
}

export function pickDriveFollowCamWrite(input: {
  camMoved: boolean;
  bearingMoved: boolean;
  applyLayoutOrEntry: boolean;
}): DriveFollowCamWrite {
  if (input.camMoved || input.bearingMoved || input.applyLayoutOrEntry) {
    return "jump_with_offset";
  }
  return "skip";
}

/**
 * Last-resort repair after jumpTo with offset still leaves the puck far from the
 * yard-line. Cooldown prevents a 20 Hz setCenter ↔ offset fight.
 */
export function shouldRepairFollowCamStall(input: {
  stalledFrames: number;
  lastRepairAtMs: number;
  nowMs: number;
  stallFramesNeeded?: number;
  cooldownMs?: number;
}): boolean {
  const need = input.stallFramesNeeded ?? FOLLOW_CAM_STALL_FRAMES_BEFORE_REPAIR;
  if (input.stalledFrames < need) return false;
  const cool = input.cooldownMs ?? FOLLOW_CAM_JUMP_REPAIR_COOLDOWN_MS;
  if (input.nowMs - input.lastRepairAtMs < cool) return false;
  return true;
}

/** Hard setCenter/setBearing must not be used on the 60fps Drive loop. */
export function driveFollowCamAllowsSetCenterHotLoop(): boolean {
  return false;
}
