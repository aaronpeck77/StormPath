import { useMemo } from "react";
import type { TripPlan } from "./types";
import type { ScoredRoute } from "../scoring/scoreRoutes";
import { formatRouteDistanceMi, routeConsiderationSummary } from "./routeSummary";
import { routePickSlotHex } from "../ui/mapRouteStyle";
import type { RoutePickItem } from "../ui/RoutePickBar";

export interface UseRoutePickItemsDeps {
  plan: TripPlan;
  scored: ScoredRoute[];
  suggestedRouteId: string | null;
  lineFocusId: string;
  orderedRouteIds: string[];
}

export interface UseRoutePickItemsResult {
  /** Other leg to try when avoiding worst conditions (suggested, else lowest stress). */
  alternateBypassRouteId: string | null;
  routePickItems: RoutePickItem[];
  routeDockDetail: string | undefined;
}

/** A/B/C route-pick chips + the focused leg's dock summary line. */
export function useRoutePickItems(deps: UseRoutePickItemsDeps): UseRoutePickItemsResult {
  const { plan, scored, suggestedRouteId, lineFocusId, orderedRouteIds } = deps;

  const alternateBypassRouteId = useMemo(() => {
    if (plan.routes.length < 2) return null;
    if (suggestedRouteId && suggestedRouteId !== lineFocusId) return suggestedRouteId;
    const sorted = [...scored].sort((a, b) => a.stressScore - b.stressScore);
    return sorted.find((s) => s.route.id !== lineFocusId)?.route.id ?? null;
  }, [plan.routes.length, scored, suggestedRouteId, lineFocusId]);

  const routePickItems: RoutePickItem[] = useMemo(() => {
    return orderedRouteIds
      .map((routeId, slot) => {
        const route = plan.routes.find((r) => r.id === routeId);
        if (!route) return null;
        const s = scored.find((x) => x.route.id === routeId);
        const eta = s
          ? Math.round(s.effectiveEtaMinutes)
          : Math.max(1, Math.round(route.baseEtaMinutes));
        const letter = String.fromCharCode(65 + Math.min(slot, 25));
        const routeLabel = route.label.trim() || `Route ${letter}`;
        const item: RoutePickItem = {
          id: route.id,
          letter,
          routeLabel,
          etaMinutes: eta,
          suggested: routeId === suggestedRouteId,
          softPath: route.role === "hazardSmart",
          color: routePickSlotHex(slot),
        };
        if (route.hasTolls) item.hasTolls = true;
        return item;
      })
      .filter((x): x is RoutePickItem => x != null);
  }, [scored, suggestedRouteId, orderedRouteIds, plan.routes]);

  const routeDockDetail = useMemo(() => {
    const r = plan.routes.find((x) => x.id === lineFocusId) ?? plan.routes[0];
    if (!r?.geometry?.length) return undefined;
    const dist = formatRouteDistanceMi(r.geometry);
    const blurb = routeConsiderationSummary(r);
    const tollNote = r.hasTolls ? "Tolls" : "";
    return [dist, blurb, tollNote].filter(Boolean).join(" · ");
  }, [plan.routes, lineFocusId]);

  return { alternateBypassRouteId, routePickItems, routeDockDetail };
}
