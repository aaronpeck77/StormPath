/**
 * Dead-zone / low-data map rules.
 *
 * The phone supervisor sets {@link shouldHoldLastGoodMap} when the radio is
 * down or a reachability probe fails. While that hold is on, keep last-good
 * **tiles** and road snap — do **not** reload the basemap or refresh traffic.
 * GPS follow-cam must keep tracking the puck on those tiles (pan / jumpTo).
 */

/** Keep hold this long after the link looks healthy again — brief cell flaps. */
export const HOLD_CLEAR_HYSTERESIS_MS = 4_500;

/**
 * After pan "succeeds" but the puck is still this far from the yard-line anchor,
 * treat Mapbox `easeTo` as stalled (common under weak tiles) and hard-jump.
 */
export const FOLLOW_CAM_STALL_DRIFT_PX = 110;

/** Consecutive stalled frames before jumpTo (avoids a one-frame flash). */
export const FOLLOW_CAM_STALL_FRAMES_BEFORE_JUMP = 3;

export function shouldHoldLastGoodMap(input: {
  navigatorOnLine: boolean;
  /** iOS Network plugin. When true, ignore a stuck `navigator.onLine === false`. */
  nativeConnected?: boolean | null;
  reachable: boolean | null;
}): boolean {
  const radioUp =
    input.nativeConnected === true
      ? true
      : input.nativeConnected === false
        ? false
        : input.navigatorOnLine;
  if (!radioUp) return true;
  return input.reachable === false;
}

/**
 * Do not drop {@link holdLastGoodMap} on the first healthy probe — wait out
 * short dead-zone blips so day/night style reload does not thrash.
 */
export function shouldClearLastGoodMapHold(input: {
  holdActive: boolean;
  linkHealthy: boolean;
  healthySinceMs: number | null;
  nowMs: number;
  hysteresisMs?: number;
}): { clear: boolean; healthySinceMs: number | null } {
  if (!input.holdActive) {
    return { clear: false, healthySinceMs: null };
  }
  if (!input.linkHealthy) {
    return { clear: false, healthySinceMs: null };
  }
  const healthySinceMs = input.healthySinceMs ?? input.nowMs;
  const wait = input.hysteresisMs ?? HOLD_CLEAR_HYSTERESIS_MS;
  if (input.nowMs - healthySinceMs < wait) {
    return { clear: false, healthySinceMs };
  }
  return { clear: true, healthySinceMs: null };
}

/** Day/night `setStyle` wipes cached tiles and blocks follow-cam until the new style downloads. */
export function allowBasemapStyleReload(input: {
  navigationStarted: boolean;
  holdLastGoodMap: boolean;
}): boolean {
  return !input.navigationStarted && !input.holdLastGoodMap;
}

/**
 * GPS follow resync is always allowed — hold is about tiles/style/traffic, not freezing the camera.
 * @deprecated Prefer {@link allowFollowCamJumpToFallback} with `gpsFollowStalled`.
 */
export function allowAutomaticFollowCamResync(_holdLastGoodMap: boolean): boolean {
  return true;
}

/**
 * Hard `jumpTo` when pan fails or the transform is stalled.
 * Dead-zone hold must **not** block this — otherwise the puck drives off a frozen map.
 */
export function allowFollowCamJumpToFallback(input: {
  intentionalResync: boolean;
  holdLastGoodMap: boolean;
  /** Pan returned false, or puck still far from yard-line after pan. */
  gpsFollowStalled?: boolean;
}): boolean {
  if (input.gpsFollowStalled) return true;
  return input.intentionalResync;
}

/** Wipe the last Map Matching snap only when GO ends or matching is off — not when the cell drops. */
export function shouldClearHeldMapMatch(input: {
  navigationStarted: boolean;
  enabled: boolean;
  disabled?: boolean;
}): boolean {
  return !input.navigationStarted || !input.enabled || Boolean(input.disabled);
}
