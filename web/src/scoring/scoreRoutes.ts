import type { NavRoute, TripPlan } from "../nav/types";
import type { FusedSituationSnapshot } from "../situation/types";
import { formatDelayVersusBaseline, formatEtaDuration } from "../ui/formatEta";
import type { PresetId } from "./presets";

export interface ScoredRoute {
  route: NavRoute;
  /** Minutes: Mapbox live traffic when available, else static baseline ETA */
  effectiveEtaMinutes: number;
  /** Static baseline ETA from the route (minutes) */
  baselineEtaMinutes: number;
  /** Mapbox live traffic succeeded for this route */
  hasLiveTrafficEstimate: boolean;
  /** Minutes of delay vs static baseline when live traffic is available */
  trafficDelayMinutes: number;
  /** 0–1 fused “stress” for coloring inactive legs */
  stressScore: number;
  /** One-line fuse summary for the driver */
  fuseSummary: string;
  /** Whether preset + thresholds say this is worth surfacing prominently */
  notable: boolean;
}

function stressFromSlice(
  trafficDelay: number,
  radar: number,
  hazardCount: number,
  preset: PresetId
): number {
  const w =
    preset === "protective"
      ? { t: 0.25, r: 0.45, h: 0.3 }
      : preset === "quiet"
        ? { t: 0.55, r: 0.2, h: 0.25 }
        : { t: 0.35, r: 0.35, h: 0.3 };
  const normDelay = Math.min(1, trafficDelay / 20);
  const normH = Math.min(1, hazardCount / 3);
  return w.t * normDelay + w.r * radar + w.h * normH;
}

export function scoreTrip(
  plan: TripPlan,
  snap: FusedSituationSnapshot,
  preset: PresetId
): ScoredRoute[] {
  return plan.routes.map((route) => {
    const slice = snap.routes.find((s) => s.routeId === route.id);
    const trafficDelay = slice?.trafficDelayMinutes ?? 0;
    const radar = slice?.radarIntensity ?? 0;
    const hazards = slice?.hazards ?? [];
    const hasLiveTrafficEstimate = Boolean(
      slice?.hasLiveTrafficEstimate && slice.mapboxDurationMinutes != null
    );
    const effectiveEtaMinutes = hasLiveTrafficEstimate
      ? Math.max(1, Math.round(slice!.mapboxDurationMinutes!))
      : route.baseEtaMinutes + trafficDelay;
    const stress = stressFromSlice(trafficDelay, radar, hazards.length, preset);

    const parts: string[] = [];
    if (hasLiveTrafficEstimate) {
      parts.push(`~${formatEtaDuration(effectiveEtaMinutes)} drive (Mapbox traffic)`);
      if (trafficDelay >= 10) {
        const d = formatDelayVersusBaseline(trafficDelay);
        if (d) parts.push(`${d} vs static route`);
      }
    } else {
      parts.push(`~${formatEtaDuration(route.baseEtaMinutes)} static ETA (no live traffic)`);
    }
    if (radar > 0.2) parts.push(`precip weight ${Math.round(radar * 100)}%`);
    if (hazards.length) parts.push(`${hazards.length} road note(s)`);

    const fuseSummary = slice
      ? [slice.forecastHeadline.split("—")[0]?.trim() ?? "", parts.join(" · ")]
          .filter(Boolean)
          .join(" — ")
      : "No fused data";

    const notable =
      preset === "protective"
        ? stress > 0.25 || radar > 0.25 || hazards.length > 0
        : preset === "quiet"
          ? trafficDelay > 6 || hazards.some((h) => h.kind === "closure")
          : stress > 0.2 || radar > 0.2;

    return {
      route,
      effectiveEtaMinutes,
      baselineEtaMinutes: route.baseEtaMinutes,
      hasLiveTrafficEstimate,
      trafficDelayMinutes: trafficDelay,
      stressScore: stress,
      fuseSummary,
      notable,
    };
  });
}

export function pickSuggestedActive(scored: ScoredRoute[]): string {
  if (!scored.length) return "";
  const sorted = [...scored].sort((a, b) => {
    if (a.stressScore !== b.stressScore) return a.stressScore - b.stressScore;
    return a.effectiveEtaMinutes - b.effectiveEtaMinutes;
  });
  return sorted[0].route.id;
}
