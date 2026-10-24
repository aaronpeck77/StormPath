import {
  filterAlertsForDriveMap,
  type RouteAheadStormBand,
} from "../nav/routeAheadSync";
import { mapGeoJsonFromAlerts } from "./mapGeoJsonFromAlerts";
import { filterNwsMapWarningFeatures } from "./nwsMapPolygon";
import type { NormalizedWeatherAlert } from "./types";

/**
 * NWS warning polygons for the map (Rt / Mp; hidden in Dr).
 * Watches stay in the advisory list. Plus-only; gated by life-safety + About → NWS.
 */
export function buildNwsAlertGeoJsonForMap(input: {
  isPlus: boolean;
  advisoryLifeSafetyOn: boolean;
  settingStormEnabled: boolean;
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

  // Browse mode (no route): Plus users see regional warning polygons.
  if (!input.nwsMapOverlapRouteGeom?.length) {
    const withGeom = input.stormCorridorAlerts.filter((a) => a.geometry);
    if (withGeom.length) return mapGeoJsonFromAlerts(withGeom);
    return filterNwsMapWarningFeatures(input.stormMapGeoJson);
  }

  // Route active — corridor-wide warning polygons along the trip.
  const base = filterNwsMapWarningFeatures(input.stormMapGeoJsonForMap);
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
