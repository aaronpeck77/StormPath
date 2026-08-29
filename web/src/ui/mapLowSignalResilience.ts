/**
 * Dead-zone / low-data map rules.
 *
 * The phone supervisor sets {@link shouldHoldLastGoodMap} when the radio is
 * down or a reachability probe fails. While that hold is on, keep last-good
 * tiles, camera, and road snap — do not reload the basemap or hard-jump the
 * follow-cam. GPS can still move the puck on tiles already in memory.
 */

/** Keep hold this long after the link looks healthy again — brief cell flaps. */
export const HOLD_CLEAR_HYSTERESIS_MS = 4_500;

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
 * short dead-zone blips so day/night style reload and Jeff resync do not thrash.
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

/** Jeff auto-resync jumpTo feels like a snap after the map froze in a dead zone. */
export function allowAutomaticFollowCamResync(holdLastGoodMap: boolean): boolean {
  return !holdLastGoodMap;
}

/**
 * `jumpTo` skips the yard-line offset and flashes a different framing.
 * Only after an intentional resync (Jeff tap / layout), never a periodic tick.
 */
export function allowFollowCamJumpToFallback(input: {
  intentionalResync: boolean;
  holdLastGoodMap: boolean;
}): boolean {
  return input.intentionalResync && !input.holdLastGoodMap;
}

/** Wipe the last Map Matching snap only when GO ends or matching is off — not when the cell drops. */
export function shouldClearHeldMapMatch(input: {
  navigationStarted: boolean;
  enabled: boolean;
  disabled?: boolean;
}): boolean {
  return !input.navigationStarted || !input.enabled || Boolean(input.disabled);
}
