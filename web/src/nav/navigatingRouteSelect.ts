/**
 * While navigating, Rt/Mp route taps must adopt the chosen leg for Drive — not only
 * preview-highlight it. Preview-only left Drive on the locked corridor (often behind
 * the puck after an off-route leave) with no line for the route the driver just picked.
 *
 * On-route compare stays preview-only; adopt kicks in when off-route / rejoin choices
 * are active so Drive stays on the same page as Rt/Mp.
 */

export type NavigatingRouteSelectAction =
  | { type: "preview" }
  | { type: "adopt"; id: string }
  | { type: "return_to_lock"; lockedId: string };

/**
 * Decide what a route tap means while navigating.
 * - Off-route / rejoin choice + different from active guidance → adopt for Drive.
 * - Locked corridor while a temporary rejoin stub is guiding → drop stub, resume lock.
 * - Otherwise → preview/highlight only.
 */
export function resolveNavigatingRouteSelect(input: {
  navigationStarted: boolean;
  selectedId: string;
  lockedRouteId: string | null;
  temporaryGuidanceRouteId?: string | null;
  /** True while latched off-route, hold-preview, or similar ahead-choice UI. */
  offRouteChoiceActive?: boolean;
}): NavigatingRouteSelectAction {
  if (!input.navigationStarted) return { type: "preview" };

  const locked = input.lockedRouteId;
  const temp = input.temporaryGuidanceRouteId ?? null;
  const active = temp || locked;
  const mustSyncDrive = Boolean(input.offRouteChoiceActive || temp);

  if (!mustSyncDrive) return { type: "preview" };

  if (temp && locked && input.selectedId === locked && input.selectedId !== temp) {
    return { type: "return_to_lock", lockedId: locked };
  }

  if (active && input.selectedId !== active) {
    return { type: "adopt", id: input.selectedId };
  }

  return { type: "preview" };
}
