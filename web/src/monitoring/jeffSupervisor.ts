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
 * Dead zone: hold last-good **tiles** / skip doomed traffic fetches, but still
 * straighten the camera when the puck has drifted off the yard-line (GPS follow
 * must keep working while Mapbox easeTo stalls under weak tiles).
 */
export function resolveJeffSupervisorRecovery(input: {
  holdLastGoodMap: boolean;
  domain: JeffSupervisorDomain;
}): SupervisorRecovery {
  if (input.holdLastGoodMap) {
    if (input.domain === "live_traffic") return "hold_last_good_map";
    return "resync_camera";
  }
  return supervisorWatch(jeffSupervisorWatchId(input.domain)).recover;
}
