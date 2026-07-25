import { safeStorage } from "../storage/safeStorage";

const LS_HOME_MAP_FRAMING = "stormpath-home-map-framing";

/** How the map frames itself on launch and whenever there is no active trip. */
export type HomeMapFraming = "auto" | "my_location" | "activity_area";

/** Wait this long for trail bounds / Plus to settle before falling back to My location. */
export const IDLE_HOME_TRAIL_BOUNDS_WAIT_MS = 1_500;

export function readHomeMapFraming(): HomeMapFraming {
  const v = safeStorage.get(LS_HOME_MAP_FRAMING);
  if (v === "my_location" || v === "activity_area" || v === "auto") return v;
  return "auto";
}

export function writeHomeMapFraming(mode: HomeMapFraming): void {
  safeStorage.set(LS_HOME_MAP_FRAMING, mode);
}

export function resolveIdleHomeFraming(
  pref: HomeMapFraming,
  trailBounds: [[number, number], [number, number]] | null | undefined
): "my_location" | "activity_area" {
  if (pref === "my_location") return "my_location";
  if (pref === "activity_area") return trailBounds ? "activity_area" : "my_location";
  return trailBounds ? "activity_area" : "my_location";
}

export function prefersIdleHomeTrailArea(pref: HomeMapFraming): boolean {
  return pref === "auto" || pref === "activity_area";
}

/**
 * Startup / idle framing decision — avoids the My-location street-zoom flash when
 * breadcrumb bounds (or Plus) are about to arrive, and holds the travel-area frame
 * if entitlement briefly flickers.
 */
export function resolveIdleHomeCameraAction(input: {
  pref: HomeMapFraming;
  trailBounds: [[number, number], [number, number]] | null | undefined;
  nowMs: number;
  waitDeadlineMs: number;
  activityAreaLatched: boolean;
}): "apply" | "defer" | "hold_latched" {
  const framing = resolveIdleHomeFraming(input.pref, input.trailBounds);
  if (input.activityAreaLatched && framing !== "activity_area") {
    return "hold_latched";
  }
  if (
    prefersIdleHomeTrailArea(input.pref) &&
    framing === "my_location" &&
    !input.trailBounds &&
    input.nowMs < input.waitDeadlineMs
  ) {
    return "defer";
  }
  return "apply";
}
