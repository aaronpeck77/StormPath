import type { NavRoute, TripPlan } from "./types";

/**
 * Replace B/C (non-primary) legs with freshly fetched routes; keep the active primary leg unchanged.
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
  return { ...plan, routes };
}
