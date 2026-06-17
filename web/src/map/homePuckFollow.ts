import { safeStorage } from "../storage/safeStorage";

const LS_HOME_PUCK_FOLLOW = "stormpath-home-puck-follow";

/** Map follow behavior on the home screen before a destination is set. */
export type HomePuckFollowMode = "follow" | "explore";

export function readHomePuckFollow(): HomePuckFollowMode {
  const v = safeStorage.get(LS_HOME_PUCK_FOLLOW);
  if (v === "explore" || v === "follow") return v;
  /** Free map exploration until the user taps My location (About can opt into follow). */
  return "explore";
}

export function writeHomePuckFollow(mode: HomePuckFollowMode): void {
  safeStorage.set(LS_HOME_PUCK_FOLLOW, mode);
}
