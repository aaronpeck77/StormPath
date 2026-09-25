/**
 * While navigating, Rt/Mp route taps must adopt the chosen leg for Drive — not only
 * preview-highlight it. Preview-only left Drive on the locked corridor (often behind
 * the puck after an off-route leave) with no line for the route the driver just picked.
 *
 * A different A/B tap while navigating adopts that leg — including on-route.
 * Preview-only left Drive on A after the driver had already chosen B.
 */

export type NavigatingRouteSelectAction =
  | { type: "preview" }
  | { type: "adopt"; id: string }
  | { type: "return_to_lock"; lockedId: string };

/**
 * Decide what a route tap means while navigating.
 * - A different A/B leg → adopt it for Drive and for later replans.
 * - The original lock while a rejoin stub is guiding → drop the stub.
 * - The leg already being followed → highlight only.
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
  void input.offRouteChoiceActive;

  const locked = input.lockedRouteId;
  const temp = input.temporaryGuidanceRouteId ?? null;
  const active = temp || locked;

  if (temp && locked && input.selectedId === locked && input.selectedId !== temp) {
    return { type: "return_to_lock", lockedId: locked };
  }

  if (active && input.selectedId !== active) {
    return { type: "adopt", id: input.selectedId };
  }

  return { type: "preview" };
}
