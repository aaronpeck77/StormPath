import type { LngLat } from "../nav/types";

/**
 * Road units follow the signs, not the phone language.
 * Miles and mph: United States, and the United Kingdom (including Northern Ireland).
 * Everywhere else, including the Republic of Ireland, uses kilometers and km/h.
 * Weather is Fahrenheit only in the United States. Britain reports Celsius.
 */

export function isUnitedStates(lngLat: LngLat | null | undefined): boolean {
  if (!lngLat) return false;
  const [lng, lat] = lngLat;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  if (lat >= 51 && lat <= 71.6 && lng >= -170 && lng <= -129) return true;
  if (lat >= 18.8 && lat <= 22.3 && lng >= -160.3 && lng <= -154.7) return true;
  if (lat >= 17.8 && lat <= 18.6 && lng >= -67.3 && lng <= -65.2) return true;
  if (lat >= 24.5 && lat <= 49.4 && lng >= -125 && lng <= -66.9) {
    if (lat < 31.4 && lng < -106.2) return false;
    if (lat < 25.9 && lng < -97.2) return false;
    return true;
  }
  return false;
}

/** Great Britain and Northern Ireland. The Republic of Ireland is excluded. */
export function isUnitedKingdom(lngLat: LngLat | null | undefined): boolean {
  if (!lngLat) return false;
  const [lng, lat] = lngLat;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  if (!(lat >= 49.8 && lat <= 60.9 && lng >= -8.2 && lng <= 1.8)) return false;
  if (isRepublicOfIreland(lng, lat)) return false;
  return true;
}

function isRepublicOfIreland(lng: number, lat: number): boolean {
  if (!(lat >= 51.35 && lat <= 55.45 && lng >= -10.6 && lng <= -5.9)) return false;
  if (lat >= 54.0 && lat <= 55.4 && lng >= -8.15 && lng <= -5.9) return false;
  return true;
}

/** True until GPS arrives, so a US drive does not flash kilometers at launch. */
export function roadUsesMiles(lngLat: LngLat | null | undefined): boolean {
  if (!lngLat) return true;
  return isUnitedStates(lngLat) || isUnitedKingdom(lngLat);
}

export function weatherUsesFahrenheit(lngLat: LngLat | null | undefined): boolean {
  if (!lngLat) return true;
  return isUnitedStates(lngLat);
}

/** US road-class guesses (70 mph interstate) are wrong on an autostrada. */
export function allowUsSpeedLimitGuess(lngLat: LngLat | null | undefined): boolean {
  if (!lngLat) return true;
  return isUnitedStates(lngLat);
}

export function fahrenheitToCelsius(f: number): number {
  return Math.round(((f - 32) * 5) / 9);
}

export function mphToKmh(mph: number): number {
  return Math.round(mph * 1.60934);
}

export function displaySpeed(mph: number, miles: boolean): number {
  return miles ? Math.round(mph) : mphToKmh(mph);
}

export function speedUnitLabel(miles: boolean): string {
  return miles ? "mph" : "km/h";
}
