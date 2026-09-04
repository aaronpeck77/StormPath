/**
 * Drive follow-cam writes. Mixing yard-line `easeTo` (padding+offset) with
 * `setCenter` (no offset) makes the map leap up and down the road every few frames.
 */

export const FOLLOW_CAM_JUMP_REPAIR_COOLDOWN_MS = 1_200;
export const FOLLOW_CAM_STALL_FRAMES_BEFORE_REPAIR = 8;

/** Stay on hard follow until style is loaded this many frames in a row. */
export const FOLLOW_CAM_STYLE_OK_FRAMES_TO_PAN = 12;
/** Only leave yard-line pan after this many consecutive pan failures. */
export const FOLLOW_CAM_PAN_FAIL_FRAMES_TO_HARD = 8;

export type DriveFollowCamWrite = "skip" | "jump_with_offset";

/**
 * One camera writer at a time. Pan (yard-line offset), hard setCenter (no
 * offset), and jumpTo (padding, no offset) are three different framings —
 * switching them every frame is the Drive "three-angle blur".
 */
export type FollowCamWriter = "pan" | "hard";

export function advanceFollowCamWriter(input: {
  holdTiles: boolean;
  styleLoaded: boolean;
  writer: FollowCamWriter;
  styleOkStreak: number;
  panFailStreak: number;
  styleOkToPan?: number;
  panFailsToHard?: number;
}): { writer: FollowCamWriter; styleOkStreak: number; panFailStreak: number } {
  const styleOkToPan = input.styleOkToPan ?? FOLLOW_CAM_STYLE_OK_FRAMES_TO_PAN;
  const panFailsToHard = input.panFailsToHard ?? FOLLOW_CAM_PAN_FAIL_FRAMES_TO_HARD;

  if (input.holdTiles) {
    return { writer: "hard", styleOkStreak: 0, panFailStreak: 0 };
  }

  if (input.writer === "hard") {
    const styleOkStreak = input.styleLoaded ? input.styleOkStreak + 1 : 0;
    if (styleOkStreak >= styleOkToPan) {
      return { writer: "pan", styleOkStreak: 0, panFailStreak: 0 };
    }
    return { writer: "hard", styleOkStreak, panFailStreak: 0 };
  }

  if (input.panFailStreak >= panFailsToHard) {
    return { writer: "hard", styleOkStreak: 0, panFailStreak: 0 };
  }
  return { writer: "pan", styleOkStreak: 0, panFailStreak: input.panFailStreak };
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
