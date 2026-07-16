import type { ScoredRoute } from "../scoring/scoreRoutes";
import type { TrafficBypassCompareState } from "../state/routeCompareStore";
import { withTrafficBypassCompareKind } from "./trafficBypassFlow";
import { defaultRouteCompareSelection } from "./routeCompareSelection";
import type { LngLat, TripPlan } from "./types";

export type BuildRouteCompareFromPlanOpts = {
  headline: string;
  hazardLngLat: LngLat | null;
  hazardAlongMeters: number | null;
  confidence?: "low" | "medium" | "high";
  etaOverrides?: {
    etaB?: number | null;
    etaC?: number | null;
    hasB?: boolean;
    hasC?: boolean;
  };
};

/** Build A/B(/C) compare state from the current plan + scored ETAs (no network). */
export function buildRouteCompareFromPlan(input: {
  opts: BuildRouteCompareFromPlanOpts;
  guidanceRoute: { geometry?: LngLat[] | null; baseEtaMinutes?: number | null } | null | undefined;
  guidanceRouteId: string;
  plan: TripPlan;
  scored: ScoredRoute[];
  driveEtaMinutes: number | null;
  navigationStarted: boolean;
}): TrafficBypassCompareState | null {
  const { opts, guidanceRoute, guidanceRouteId, plan, scored, driveEtaMinutes, navigationStarted } =
    input;
  if (!guidanceRoute?.geometry?.length) return null;

  const etaForSlot = (id: "r-a" | "r-b" | "r-c"): number | null => {
    if (id === "r-a" && navigationStarted && driveEtaMinutes != null) {
      return Math.max(1, Math.round(driveEtaMinutes));
    }
    const s = scored.find((x) => x.route.id === id);
    if (s) return Math.max(1, Math.round(s.effectiveEtaMinutes));
    const r = plan.routes.find((x) => x.id === id);
    return r ? Math.max(1, Math.round(r.baseEtaMinutes)) : null;
  };

  const rB = plan.routes.find((r) => r.id === "r-b");
  const rC = plan.routes.find((r) => r.id === "r-c");
  const hasB = opts.etaOverrides?.hasB ?? Boolean(rB?.geometry && rB.geometry.length >= 2);
  const hasC = opts.etaOverrides?.hasC ?? Boolean(rC?.geometry && rC.geometry.length >= 2);
  const etaA = etaForSlot("r-a");
  if (etaA == null) return null;

  const altWithGeom = plan.routes.some(
    (r) => r.id !== guidanceRouteId && (r.geometry?.length ?? 0) >= 2
  );
  if (!hasB && !hasC && !altWithGeom) return null;

  return withTrafficBypassCompareKind({
    headline: opts.headline,
    etaA,
    etaB: opts.etaOverrides?.etaB ?? (hasB ? etaForSlot("r-b") : null),
    etaC: opts.etaOverrides?.etaC ?? (hasC ? etaForSlot("r-c") : null),
    hasB,
    hasC,
    confidence: opts.confidence ?? "medium",
    selectedLeg: defaultRouteCompareSelection(guidanceRouteId),
    hazardLngLat: opts.hazardLngLat,
    hazardAlongMeters: opts.hazardAlongMeters,
  });
}
