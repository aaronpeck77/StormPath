import type { NavRoute, TripPlan } from "./types";

/** Temporary overlay slot when the plan has only the locked leg (Basic / single-route Plus). */
export const REJOIN_OVERLAY_ROUTE_ID = "r-rejoin";

/**
 * Non-primary ids that can hold a temporary rejoin / dest overlay.
 * When the plan is a single locked leg, invent `r-rejoin` so recovery still has a slot.
 */
export function rejoinOverlaySlotIds(plan: TripPlan, primaryId: string): string[] {
  const alts = plan.routes.filter((r) => r.id !== primaryId).map((r) => r.id);
  return alts.length > 0 ? alts : [REJOIN_OVERLAY_ROUTE_ID];
}

/**
 * Replace B/C (non-primary) legs with freshly fetched routes; keep the active primary leg unchanged.
 * Appends overlay ids that are not already in the plan (e.g. `r-rejoin` on a 1-route trip).
 */
export function mergePlanPreservingPrimary(
  plan: TripPlan,
  primaryId: string,
  fetched: NavRoute[]
): TripPlan {
  const primary = plan.routes.find((r) => r.id === primaryId);
  const fetchedById = new Map(fetched.map((r) => [r.id, r]));
  const routes: NavRoute[] = plan.routes.map((r) => {
    if (r.id === primaryId) {
      return primary ?? r;
    }
    return fetchedById.get(r.id) ?? r;
  });
  for (const f of fetched) {
    if (f.id === primaryId) continue;
    if (!routes.some((r) => r.id === f.id)) {
      routes.push(f);
    }
  }
  return { ...plan, routes };
}

/**
 * While navigating the map shows the locked leg plus ONE forward option
 * (Bill: "two routes all along the way — the one I'm on and one other").
 * Returns ids of slot alternates beyond the first, in slot order; personal
 * forks and overlay stubs that are not in `orderedRouteIds` are untouched.
 */
export function extraNavigatingAlternateIds(
  routes: NavRoute[],
  lockedId: string | null,
  orderedRouteIds: string[]
): string[] {
  if (!lockedId) return [];
  const orderIndex = new Map(orderedRouteIds.map((id, i) => [id, i]));
  const alts = routes
    .filter((r) => r.id !== lockedId && orderIndex.has(r.id))
    .sort((a, b) => (orderIndex.get(a.id) ?? 99) - (orderIndex.get(b.id) ?? 99));
  return alts.length <= 1 ? [] : alts.slice(1).map((r) => r.id);
}
