import { safeStorage } from "../storage/safeStorage";
import type { LngLat } from "../nav/types";

const LS_HOME_PUCK_FOLLOW = "stormpath-home-puck-follow";

/** Map follow behavior on the home screen before a destination is set. */
export type HomePuckFollowMode = "follow" | "explore";

export function readHomePuckFollow(): HomePuckFollowMode {
  const v = safeStorage.get(LS_HOME_PUCK_FOLLOW);
  if (v === "explore" || v === "follow") return v;
  /** First launch: lock the puck in the middle of the page. Pan still switches to explore. */
  return "follow";
}

export function writeHomePuckFollow(mode: HomePuckFollowMode): void {
  safeStorage.set(LS_HOME_PUCK_FOLLOW, mode);
}

/**
 * Home is only “no trip yet”. A map-tapped destination with routes still loading
 * is planning — if we keep home puck-follow on, the camera yanks back to GPS
 * while dest-fit framed the pin. The pin looks unplaced; the map and puck fight.
 */
export function isIdleHomeScreen(input: {
  routesLength: number;
  navigationStarted: boolean;
  destLngLat: LngLat | null | undefined;
}): boolean {
  return input.routesLength === 0 && !input.navigationStarted && !input.destLngLat;
}
