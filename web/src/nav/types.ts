export type LngLat = [number, number];

export type RouteRole = "fastest" | "balanced" | "hazardSmart";

/** Turn-by-turn step from the directions engine (Mapbox when configured). */
export interface RouteTurnStep {
  /** Plain-text maneuver line */
  instruction: string;
  /** Step length in meters; used for “in X mi” */
  distanceM?: number;
  /** Legacy maneuver type code (when present) */
  type?: number;
  /** Mapbox Directions maneuver.type (when from Mapbox) */
  maneuverType?: string;
  /** Mapbox Directions maneuver.modifier */
  maneuverModifier?: string;
}

export interface NavRoute {
  id: string;
  role: RouteRole;
  label: string;
  /** Ordered coordinates [lng, lat] for MapLibre */
  geometry: LngLat[];
  /** Base ETA minutes from the router; Mapbox live traffic may refine the fused ETA */
  baseEtaMinutes: number;
  /** Populated when directions are fetched with instructions */
  turnSteps?: RouteTurnStep[];
  /** Router warnings (e.g. unknown way type) — shown as notices */
  routeNotices?: string[];
  /** Same length as `routeNotices` when set — meters from route start for strip/map alignment (Mapbox incidents). */
  routeNoticeAlongMeters?: (number | undefined)[];
}

export interface TripPlan {
  originLabel: string;
  destinationLabel: string;
  routes: NavRoute[];
}
