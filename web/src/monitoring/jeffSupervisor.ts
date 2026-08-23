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
 * In a dead zone he holds last-good. With a real link he still straightens
 * the camera / puck or kicks traffic.
 */
export function resolveJeffSupervisorRecovery(input: {
  holdLastGoodMap: boolean;
  domain: JeffSupervisorDomain;
}): SupervisorRecovery {
  if (input.holdLastGoodMap) return "hold_last_good_map";
  return supervisorWatch(jeffSupervisorWatchId(input.domain)).recover;
}
