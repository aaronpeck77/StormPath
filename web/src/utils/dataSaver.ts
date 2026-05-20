import { isSaveDataPreferred } from "./fetchResilient";

export const LS_DATA_SAVER = "stormpath-setting-data-saver-enabled";

export function readDataSaverSetting(): boolean {
  try {
    return localStorage.getItem(LS_DATA_SAVER) === "1";
  } catch {
    return false;
  }
}

/** User toggle or OS “use less data” / Low Data Mode (where exposed). */
export function isDataSaverMode(userEnabled: boolean): boolean {
  return userEnabled || isSaveDataPreferred();
}

export const NWS_POLL_MS_NORMAL = 120_000;
/** Planning / browse — fewer national pulls. */
export const NWS_POLL_MS_DATA_SAVER = 300_000;
/** While navigating with data saver. */
export const NWS_POLL_MS_DATA_SAVER_DRIVE = 480_000;

export const TRAFFIC_POLL_MS_NORMAL = 90_000;
export const TRAFFIC_POLL_MS_DATA_SAVER = 300_000;

export const NAV_ROUTE_ALT_REFRESH_MS_NORMAL = 26_000;

export function getNwsPollIntervalMs(dataSaver: boolean, navigationStarted: boolean): number {
  if (!dataSaver) return NWS_POLL_MS_NORMAL;
  return navigationStarted ? NWS_POLL_MS_DATA_SAVER_DRIVE : NWS_POLL_MS_DATA_SAVER;
}

export function getTrafficPollIntervalMs(dataSaver: boolean): number {
  return dataSaver ? TRAFFIC_POLL_MS_DATA_SAVER : TRAFFIC_POLL_MS_NORMAL;
}

/** `null` = do not poll alternate legs automatically. */
export function getNavAltRefreshMs(dataSaver: boolean): number | null {
  return dataSaver ? null : NAV_ROUTE_ALT_REFRESH_MS_NORMAL;
}
