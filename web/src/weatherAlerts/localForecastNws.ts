import {
  pointInAnyPolygonGeometry,
  pointNearPolygonGeometry,
  sortWeatherAlertsBySeverity,
} from "./geometryOverlap";
import type { NormalizedWeatherAlert } from "./types";

/**
 * ~7.5 mi — tight “local” radius. GPS drift + coarse NWS vertices only;
 * not the wide route-corridor buffer used on the map.
 */
export const LOCAL_FORECAST_NWS_NEAR_M = 12_000;

function alertAffectsLocalPosition(
  lng: number,
  lat: number,
  alert: NormalizedWeatherAlert
): boolean {
  const g = alert.geometry;
  if (!g) return false;
  if (pointInAnyPolygonGeometry(lng, lat, g)) return true;
  return pointNearPolygonGeometry(lng, lat, g, LOCAL_FORECAST_NWS_NEAR_M);
}

/**
 * NWS alerts for the local forecast card — only products that actually apply
 * at the user’s position. Does not include the full regional browse box or
 * hazards far down a planned route.
 */
export function nwsAlertsForLocalForecast(opts: {
  userLngLat: [number, number] | null | undefined;
  corridorAlerts: NormalizedWeatherAlert[];
}): NormalizedWeatherAlert[] {
  const p = opts.userLngLat;
  if (!p?.length || !opts.corridorAlerts.length) return [];

  const [lng, lat] = p;
  const out: NormalizedWeatherAlert[] = [];
  for (const a of opts.corridorAlerts) {
    if (alertAffectsLocalPosition(lng, lat, a)) out.push(a);
  }
  return sortWeatherAlertsBySeverity(out);
}

export function normalizeNwsEventKey(event: string | null | undefined): string {
  return (event ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Drop duplicate zone copies and repeated event names in the local/route advisory lists. */
export function dedupeNwsAlertsForDisplay(alerts: NormalizedWeatherAlert[]): NormalizedWeatherAlert[] {
  const seenId = new Set<string>();
  const seenEvent = new Set<string>();
  const out: NormalizedWeatherAlert[] = [];
  for (const a of alerts) {
    if (seenId.has(a.id)) continue;
    const eventKey = normalizeNwsEventKey(a.event);
    if (eventKey && seenEvent.has(eventKey)) continue;
    seenId.add(a.id);
    if (eventKey) seenEvent.add(eventKey);
    out.push(a);
  }
  return out;
}

export function isHeatRelatedNwsAlert(a: NormalizedWeatherAlert): boolean {
  const t = `${a.event ?? ""} ${a.headline ?? ""}`.toLowerCase();
  return /\bheat (advisory|watch|warning|index)\b|\bexcessive heat\b/.test(t);
}
