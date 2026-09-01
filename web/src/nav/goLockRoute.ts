/**
 * Go-lock identity: the highlighted A/B/C chip is the corridor Drive must follow.
 * Promoting the pick to slot A on Go relabels B as A and looks like a steal.
 */

/** Route id locked when the driver taps Go — preview chip, not always slot A. */
export function resolveGoLockRouteId(input: {
  orderedRouteIds: readonly string[];
  previewLegIndex: number;
  primaryRouteId?: string | null;
}): string | null {
  const { orderedRouteIds, previewLegIndex, primaryRouteId } = input;
  if (
    previewLegIndex >= 0 &&
    previewLegIndex < orderedRouteIds.length &&
    orderedRouteIds[previewLegIndex]
  ) {
    return orderedRouteIds[previewLegIndex]!;
  }
  return orderedRouteIds[0] ?? primaryRouteId ?? null;
}

/**
 * Go must keep stable A/B/C letters. Slot promotion is only for explicit
 * promote (hazard / bypass / off-route pick), never for pressing Go.
 */
export function shouldPromoteChosenToSlotAOnGo(): boolean {
  return false;
}
