import type { LngLat, RouteRole } from "./nav/types";
import { safeStorage } from "./storage/safeStorage";

const LS_KEY = "stormpath-preferred-area-routes-v1";

export type PreferredAreaRoute = {
  areaKey: string;
  areaLabel: string;
  preferredRole: RouteRole;
  pickCount: number;
  lastPickedMs: number;
};

export type PreferredAreaRouteMap = Record<string, PreferredAreaRoute>;

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** City-ish bucket: ~11km. Good enough for “Bloomington area” vs exact address. */
export function areaKeyFromLngLat(lngLat: LngLat): string {
  const [lng, lat] = lngLat;
  return `${round1(lat).toFixed(1)},${round1(lng).toFixed(1)}`;
}

export function areaLabelFromDestinationLabel(destinationLabel: string): string {
  const s = destinationLabel.trim();
  if (!s) return "this area";
  // Mapbox place names are often "Street, City, ST ZIP, United States"
  const firstComma = s.split(",")[0]?.trim();
  return firstComma || s;
}

export function loadPreferredAreaRouteMap(): PreferredAreaRouteMap {
  const parsed = safeStorage.getJson<unknown>(LS_KEY, {});
  if (!parsed || typeof parsed !== "object") return {};
  return parsed as PreferredAreaRouteMap;
}

export function savePreferredAreaRouteMap(map: PreferredAreaRouteMap): void {
  safeStorage.setJson(LS_KEY, map);
}

