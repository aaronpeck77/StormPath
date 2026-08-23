/**
 * Dead-zone / low-data map rules.
 *
 * The phone supervisor sets {@link shouldHoldLastGoodMap} when the radio is
 * down or a reachability probe fails. While that hold is on, keep last-good
 * tiles, camera, and road snap — do not reload the basemap or hard-jump the
 * follow-cam. GPS can still move the puck on tiles already in memory.
 */

export function shouldHoldLastGoodMap(input: {
  navigatorOnLine: boolean;
  reachable: boolean | null;
}): boolean {
  if (!input.navigatorOnLine) return true;
  return input.reachable === false;
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
