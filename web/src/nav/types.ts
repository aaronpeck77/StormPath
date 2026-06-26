export type LngLat = [number, number];

export type RouteRole = "fastest" | "balanced" | "hazardSmart";

/** Mapbox maxspeed sample — meters from route start where a posted limit begins. */
export type PostedSpeedSample = { alongMeters: number; mph: number };

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
  /** Freeway / ramp exit number when Mapbox supplies it (optional). */
  exitNumber?: string;
}

/** Mapbox Directions leg incident (traffic / construction / closure). */
export type MapboxRouteIncident = {
  type: string;
  /** Mapbox impact: unknown | minor | moderate | major | severe */
  impact?: string;
  description: string;
  alongMeters?: number;
  affectedRoadNames?: string[];
  numLanesBlocked?: number;
  lanesBlocked?: string[];
};

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
  /** Structured Mapbox incidents — preferred for severity / lane-block copy. */
  mapboxIncidents?: MapboxRouteIncident[];
  /** Mapbox flagged toll roads or collection points along this leg. */
  hasTolls?: boolean;
  /** Distinct toll road refs/names or booth labels (when known). */
  tollLabels?: string[];
  /** Posted speed limits from Mapbox Directions maxspeed annotation (follow road signs when in doubt). */
  postedSpeedSamples?: PostedSpeedSample[];
}

export interface TripPlan {
  originLabel: string;
  destinationLabel: string;
  routes: NavRoute[];
}
