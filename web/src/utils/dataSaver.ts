import { safeStorage } from "../storage/safeStorage";
import { isSaveDataPreferred } from "./fetchResilient";

export const LS_DATA_SAVER = "stormpath-setting-data-saver-enabled";
export const LS_DATA_SAVER_HINT_DISMISSED = "stormpath-data-saver-hint-dismissed";

/**
 * Default for new installs when the user has never toggled Data saver in About.
 * Keep false while onboarding — best first-run experience. If API cost dominates at
 * hundreds of users, flip to true so background polling starts conservative.
 */
export const DATA_SAVER_DEFAULT_ENABLED = false;

/** Collapsed advisory rotator — short; expanded panel uses {@link DATA_SAVER_ADVISORY_DETAIL}. */
export const DATA_SAVER_ADVISORY_TIP =
  "Tip: Data saver in About — less cellular data on long drives.";

export const DATA_SAVER_ADVISORY_DETAIL =
  "Long trip on cellular? Turn on Data saver in About to slow background refreshes and use less data.";

export function readDataSaverSetting(): boolean {
  const v = safeStorage.get(LS_DATA_SAVER);
  if (v === "1") return true;
  if (v === "0") return false;
  return DATA_SAVER_DEFAULT_ENABLED;
}

export function readDataSaverHintDismissed(): boolean {
  return safeStorage.get(LS_DATA_SAVER_HINT_DISMISSED) === "1";
}

export function dismissDataSaverHint(): void {
  safeStorage.set(LS_DATA_SAVER_HINT_DISMISSED, "1");
}

/** User toggle or OS “use less data” / Low Data Mode (where exposed). */
export function isDataSaverMode(userEnabled: boolean): boolean {
  return userEnabled || isSaveDataPreferred();
}

export const NWS_POLL_MS_NORMAL = 120_000;
/** Long trips (100+ mi) — fewer national pulls without requiring Data saver. */
export const NWS_POLL_MS_LONG_TRIP = 240_000;
/** Planning / browse — fewer national pulls. */
export const NWS_POLL_MS_DATA_SAVER = 300_000;
/** While navigating with data saver. */
export const NWS_POLL_MS_DATA_SAVER_DRIVE = 480_000;

/** ~100 miles — cross-country routes trigger lean NWS + geometry budgets automatically. */
export const LONG_TRIP_ROUTE_M = 160_934;

export function isLongTripRoute(routeLengthM: number): boolean {
  return routeLengthM >= LONG_TRIP_ROUTE_M;
}

/** Snap along-route distance so timeline/impact recompute does not run every GPS tick on long legs. */
export function quantizeRouteAlongForHeavyUi(
  alongM: number,
  routeLengthM: number,
  navigationActive: boolean
): number {
  if (!navigationActive || !Number.isFinite(alongM) || alongM < 0) return alongM;
  const stepM = isLongTripRoute(routeLengthM) ? 10_000 : 2_500;
  return Math.floor(alongM / stepM) * stepM;
}

/** ~2 km grid — NWS puck-inside scans do not need sub-block precision while driving. */
export function quantizeLngLatForHeavyUi(
  lngLat: [number, number] | null,
  navigationActive: boolean
): [number, number] | null {
  if (!lngLat || !navigationActive) return lngLat;
  const step = 0.018;
  return [
    Math.round(lngLat[0] / step) * step,
    Math.round(lngLat[1] / step) * step,
  ];
}

export const TRAFFIC_POLL_MS_NORMAL = 90_000;
export const TRAFFIC_POLL_MS_DATA_SAVER = 300_000;
/** Long-trip active navigation — fewer Mapbox traffic pulls. */
export const TRAFFIC_POLL_MS_LONG_TRIP_NAV = 180_000;

export const RADAR_ROUTE_SAMPLE_MS_NORMAL = 300_000;
export const RADAR_ROUTE_SAMPLE_MS_LONG_TRIP = 480_000;
export const RADAR_ROUTE_SAMPLE_MS_DATA_SAVER = 600_000;

export const NAV_ROUTE_ALT_REFRESH_MS_NORMAL = 26_000;

export function getNwsPollIntervalMs(
  dataSaver: boolean,
  navigationStarted: boolean,
  routeLengthM = 0
): number {
  if (dataSaver) {
    return navigationStarted ? NWS_POLL_MS_DATA_SAVER_DRIVE : NWS_POLL_MS_DATA_SAVER;
  }
  if (isLongTripRoute(routeLengthM)) return NWS_POLL_MS_LONG_TRIP;
  return NWS_POLL_MS_NORMAL;
}

export function getTrafficPollIntervalMs(
  dataSaver: boolean,
  navigationStarted = false,
  routeLengthM = 0
): number {
  if (dataSaver) return TRAFFIC_POLL_MS_DATA_SAVER;
  if (navigationStarted && isLongTripRoute(routeLengthM)) return TRAFFIC_POLL_MS_LONG_TRIP_NAV;
  return TRAFFIC_POLL_MS_NORMAL;
}

export function getRadarRouteSampleIntervalMs(
  dataSaver: boolean,
  navigationStarted = false,
  routeLengthM = 0
): number {
  if (dataSaver) return RADAR_ROUTE_SAMPLE_MS_DATA_SAVER;
  if (navigationStarted && isLongTripRoute(routeLengthM)) return RADAR_ROUTE_SAMPLE_MS_LONG_TRIP;
  return RADAR_ROUTE_SAMPLE_MS_NORMAL;
}

/** Long-trip or data-saver navigation — lean map + background refresh profile. */
export function isNavMapLiteMode(
  navigationStarted: boolean,
  dataSaver: boolean,
  routeLengthM: number
): boolean {
  return navigationStarted && (dataSaver || isLongTripRoute(routeLengthM));
}

/** `null` = do not poll alternate legs automatically. */
export function getNavAltRefreshMs(dataSaver: boolean): number | null {
  return dataSaver ? null : NAV_ROUTE_ALT_REFRESH_MS_NORMAL;
}
