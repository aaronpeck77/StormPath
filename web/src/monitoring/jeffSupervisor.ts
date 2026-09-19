import type { JeffSighting } from "../ui/jeffTheBot";
import type { SupervisorRecovery, SupervisorWatchId } from "./supervisorWatchList";
import { supervisorWatch } from "./supervisorWatchList";

export type JeffSupervisorDomain = JeffSighting["domain"];

export function jeffSupervisorWatchId(domain: JeffSupervisorDomain): SupervisorWatchId {
  switch (domain) {
    case "drive_camera":
      return "jeff_drive_camera";
    case "drive_puck":
      return "jeff_drive_puck";
    case "live_traffic":
      return "jeff_live_traffic";
  }
}

/**
 * Jeff is the supervisor's drive-map crew — same eyes, one decision.
 * Dead zone: freeze the last good picture. Do not yank the camera — that was
 * 434's 331 Jeff yanks in an 8 min park trip (115s radio hold). One snap
 * when the hold clears (DriveMap), not a 400ms watchdog.
 */
export function jeffShouldHoldDriveCamera(input: {
  holdLastGoodMap: boolean;
  isOnline?: boolean;
}): boolean {
  if (input.holdLastGoodMap) return true;
  return input.isOnline === false;
}

export function resolveJeffSupervisorRecovery(input: {
  holdLastGoodMap: boolean;
  domain: JeffSupervisorDomain;
  isOnline?: boolean;
}): SupervisorRecovery {
  if (jeffShouldHoldDriveCamera(input)) return "hold_last_good_map";
  return supervisorWatch(jeffSupervisorWatchId(input.domain)).recover;
}
