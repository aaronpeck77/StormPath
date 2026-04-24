import type { TripPlan } from "../nav/types";
import type { FusedSituationSnapshot, RouteSituationSlice } from "./types";
import type { CongestionLevel, MapboxTrafficLeg } from "../services/mapboxDirectionsTraffic";

export type WeatherOverlay = Record<
  string,
  { headline: string; precipHint: number; samples?: { t: number; precipHint: number; headline: string }[] }
>;

export type TrafficOverlay = Record<string, MapboxTrafficLeg | null | undefined>;

/** Use Mapbox delay-vs-typical directly to avoid over-reporting routine slowdown. */
function effectiveDelayMinutes(delayVsTypical: number, _congestion: CongestionLevel): number {
  return Math.max(0, delayVsTypical);
}

/**
 * Fused view from real sources only: OpenWeather samples (optional), Mapbox driving-traffic (optional).
 * No simulated incidents, phases, or fake turn lists.
 */
export function buildFusedSnapshot(
  plan: TripPlan,
  weather?: WeatherOverlay,
  traffic?: TrafficOverlay
): FusedSituationSnapshot {
  const routes: RouteSituationSlice[] = plan.routes.map((r) => {
    const ow = weather?.[r.id];
    const leg = traffic?.[r.id];
    const hasLiveTrafficEstimate =
      leg != null && typeof leg.mapboxDurationMinutes === "number";

    const mapboxDurationMinutes = hasLiveTrafficEstimate ? leg!.mapboxDurationMinutes : null;
    const trafficDelayMinutes = hasLiveTrafficEstimate
      ? effectiveDelayMinutes(leg!.delayVsTypicalMinutes, leg!.congestionSummary)
      : 0;
    const radarIntensity = ow ? Math.min(1, Math.max(0, ow.precipHint)) : 0;
    const forecastHeadline = ow?.headline ?? "No weather data (set OpenWeather key to sample along the route).";

    const alongList = r.routeNoticeAlongMeters;
    const hazards = (r.routeNotices ?? []).map((summary, i) => {
      const lc = summary.toLowerCase();
      const kind: "closure" | "incident" | "restriction" =
        /\b(closure|closed)\b/.test(lc)
          ? "closure"
          : /\b(accident|wreck|crash|disabled vehicle)\b/.test(lc)
            ? "incident"
            : "restriction";
      const raw = alongList?.[i];
      const alongMeters =
        typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : undefined;
      return alongMeters != null ? { kind, summary, alongMeters } : { kind, summary };
    });

    return {
      routeId: r.id,
      role: r.role,
      trafficDelayMinutes,
      mapboxDurationMinutes,
      hasLiveTrafficEstimate,
      radarIntensity,
      forecastHeadline,
      hazards,
    };
  });

  const hasWx = Boolean(weather && Object.keys(weather).length > 0);
  const hasTraffic = routes.some((x) => x.hasLiveTrafficEstimate);
  const parts: string[] = [];
  if (hasWx) parts.push("Weather from OpenWeather (samples along each route).");
  else parts.push("Weather: not loaded.");
  if (hasTraffic) parts.push("Drive times use Mapbox live traffic along the route shape.");
  else parts.push("Live traffic: add a Mapbox token — static ETA has no real-time congestion.");

  return {
    updatedAt: Date.now(),
    routes,
    statusSummary: parts.join(" "),
  };
}
