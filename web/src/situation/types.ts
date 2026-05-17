import type { RouteRole } from "../nav/types";

export type HazardKind = "closure" | "incident" | "lowVisibility" | "restriction";

/** One normalized slice of the fused feed for a single route option */
export interface RouteSituationSlice {
  routeId: string;
  role: RouteRole;
  /** Congestion vs static baseline ETA when Mapbox traffic is available; otherwise 0 */
  trafficDelayMinutes: number;
  /** Mapbox driving-traffic duration when fetched; null if unavailable */
  mapboxDurationMinutes: number | null;
  /** True when `mapboxDurationMinutes` came from a successful Mapbox request */
  hasLiveTrafficEstimate: boolean;
  /** 0 = clear, 1 = heavy precip / adverse forecast (OpenWeather samples ± Tomorrow.io corridor stress) */
  radarIntensity: number;
  /** Corridor headline — OpenWeather samples and/or Tomorrow.io hourly summary along the route */
  forecastHeadline: string;
  /** Reserved for real incident/construction feeds — none wired yet */
  hazards: { kind: HazardKind; summary: string; alongMeters?: number }[];
}

/** Full snapshot: weather + optional Mapbox traffic; no simulated scenarios */
export interface FusedSituationSnapshot {
  updatedAt: number;
  routes: RouteSituationSlice[];
  /** What data sources are actually contributing */
  statusSummary: string;
}
