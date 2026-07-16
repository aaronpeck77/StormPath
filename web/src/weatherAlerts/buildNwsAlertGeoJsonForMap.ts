import {
  filterAlertsForDriveMap,
  type RouteAheadStormBand,
} from "../nav/routeAheadSync";
import { mapGeoJsonFromAlerts } from "./mapGeoJsonFromAlerts";
import type { NormalizedWeatherAlert } from "./types";

/**
 * NWS warning polygons for the map (Rt / Mp; hidden in Dr).
 * Plus-only; gated by life-safety + storm settings + session checkbox.
 */
export function buildNwsAlertGeoJsonForMap(input: {
  isPlus: boolean;
  advisoryLifeSafetyOn: boolean;
  settingStormEnabled: boolean;
  stormSessionOn: boolean;
  nwsMapOverlapRouteGeom: unknown[] | null | undefined;
  stormCorridorAlerts: NormalizedWeatherAlert[];
  stormMapGeoJson: GeoJSON.FeatureCollection | null | undefined;
  stormMapGeoJsonForMap: GeoJSON.FeatureCollection | null | undefined;
  nwsAlertsAffectingActiveRoute: NormalizedWeatherAlert[];
  advisoryStormStripBands: RouteAheadStormBand[];
  guidanceRouteLengthM: number;
  heavyAdvisoryAlongM: number;
  planEtaMinutes: number | null;
  driveEtaMinutes: number | null;
}): GeoJSON.FeatureCollection | null {
  if (!input.isPlus) return null;
  if (!input.advisoryLifeSafetyOn || !input.settingStormEnabled) return null;
  if (!input.stormSessionOn) return null;

  // Browse mode (no route): Plus users see regional alert polygons.
  if (!input.nwsMapOverlapRouteGeom?.length) {
    const withGeom = input.stormCorridorAlerts.filter((a) => a.geometry);
    if (withGeom.length) return mapGeoJsonFromAlerts(withGeom);
    if (input.stormMapGeoJson?.features?.length) return input.stormMapGeoJson;
    return null;
  }

  // Route active — corridor-wide polygons along the trip.
  const base = input.stormMapGeoJsonForMap;
  if (base?.features.length) return base;

  const timingCtx = {
    routeTotalMeters: input.guidanceRouteLengthM,
    userAlongMeters: input.heavyAdvisoryAlongM,
    planEtaMinutes: input.planEtaMinutes,
    driveEtaMinutes: input.driveEtaMinutes,
  };

  const corridorGeom = filterAlertsForDriveMap(
    input.stormCorridorAlerts.filter((a) => a.geometry),
    input.advisoryStormStripBands,
    timingCtx
  );
  if (corridorGeom.length) return mapGeoJsonFromAlerts(corridorGeom);

  const onRouteGeom = filterAlertsForDriveMap(
    input.nwsAlertsAffectingActiveRoute.filter((a) => a.geometry),
    input.advisoryStormStripBands,
    timingCtx
  );
  if (onRouteGeom.length) return mapGeoJsonFromAlerts(onRouteGeom);

  return null;
}
