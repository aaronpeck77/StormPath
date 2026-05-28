/**
 * Map layer startup defaults: radar, NWS session, road/traffic strip ON until the user
 * explicitly turns them off (persisted via *-user-pref keys).
 */

import { safeStorage } from "./storage/safeStorage";

const LAYER_STARTUP_V5_KEY = "stormpath-layer-startup-v5";

const RADAR_USER_PREF = "stormpath-radar-user-pref";
const RADAR_OVERLAY_LEGACY = "stormpath-radar-overlay-on";

const ROAD_ADVISORY_USER_PREF = "stormpath-road-advisory-user-pref";
const ROAD_ADVISORY_LEGACY = "stormpath-road-advisory-detail";

const NWS_SESSION_USER_PREF = "stormpath-nws-session-user-pref";
const NWS_SESSION_LEGACY = "storm-advisory-session";

const TRAFFIC_SETTING_USER_PREF = "stormpath-traffic-setting-user-pref";
const TRAFFIC_SETTING_LEGACY = "stormpath-setting-traffic-enabled";

const STORM_SETTING_USER_PREF = "stormpath-storm-setting-user-pref";
const STORM_SETTING_LEGACY = "stormpath-setting-storm-enabled";

const RADAR_SETTING_USER_PREF = "stormpath-radar-setting-user-pref";
const RADAR_SETTING_LEGACY = "stormpath-setting-radar-enabled";

function readUserPref(key: string): boolean | null {
  const v = safeStorage.get(key);
  if (v === "off" || v === "false" || v === "0") return false;
  if (v === "on" || v === "true" || v === "1") return true;
  return null;
}

function writeUserPref(key: string, on: boolean): void {
  safeStorage.set(key, on ? "on" : "off");
}

/** One-time: undo legacy migrations that forced layers off without an explicit user pref. */
export function applyLayerStartupMigrations(): void {
  if (typeof window === "undefined") return;
  if (safeStorage.get(LAYER_STARTUP_V5_KEY) === "1") return;

  if (readUserPref(RADAR_USER_PREF) == null) {
    safeStorage.set(RADAR_OVERLAY_LEGACY, "1");
  }
  if (readUserPref(ROAD_ADVISORY_USER_PREF) == null) {
    safeStorage.set(ROAD_ADVISORY_LEGACY, "1");
  }
  if (readUserPref(NWS_SESSION_USER_PREF) == null) {
    safeStorage.remove(NWS_SESSION_LEGACY);
  }
  if (readUserPref(TRAFFIC_SETTING_USER_PREF) == null) {
    safeStorage.set(TRAFFIC_SETTING_LEGACY, "1");
  }

  safeStorage.set(LAYER_STARTUP_V5_KEY, "1");
}

export function readRadarOverlayOn(): boolean {
  const user = readUserPref(RADAR_USER_PREF);
  if (user != null) return user;
  const o = safeStorage.get(RADAR_OVERLAY_LEGACY);
  if (o === "0" || o === "false") return false;
  if (o === "1" || o === "true") return true;
  return true;
}

export function writeRadarOverlayOn(on: boolean): void {
  writeUserPref(RADAR_USER_PREF, on);
  safeStorage.set(RADAR_OVERLAY_LEGACY, on ? "1" : "0");
}

export function readRoadAdvisoryDetailOn(): boolean {
  const user = readUserPref(ROAD_ADVISORY_USER_PREF);
  if (user != null) return user;
  const v = safeStorage.get(ROAD_ADVISORY_LEGACY);
  if (v === "0") return false;
  if (v === "1") return true;
  return true;
}

export function writeRoadAdvisoryDetailOn(on: boolean): void {
  writeUserPref(ROAD_ADVISORY_USER_PREF, on);
  safeStorage.set(ROAD_ADVISORY_LEGACY, on ? "1" : "0");
}

export function readNwsSessionOn(): boolean {
  const user = readUserPref(NWS_SESSION_USER_PREF);
  if (user != null) return user;
  const v = safeStorage.get(NWS_SESSION_LEGACY);
  if (v === "off") return false;
  return true;
}

export function writeNwsSessionOn(on: boolean): void {
  writeUserPref(NWS_SESSION_USER_PREF, on);
  safeStorage.set(NWS_SESSION_LEGACY, on ? "on" : "off");
}

export function readTrafficSettingOn(): boolean {
  const user = readUserPref(TRAFFIC_SETTING_USER_PREF);
  if (user != null) return user;
  const v = safeStorage.get(TRAFFIC_SETTING_LEGACY);
  if (v === "0" || v === "false") return false;
  if (v === "1" || v === "true") return true;
  return true;
}

export function writeTrafficSettingOn(on: boolean): void {
  writeUserPref(TRAFFIC_SETTING_USER_PREF, on);
  safeStorage.set(TRAFFIC_SETTING_LEGACY, on ? "1" : "0");
}

export function readStormSettingOn(): boolean {
  const user = readUserPref(STORM_SETTING_USER_PREF);
  if (user != null) return user;
  const v = safeStorage.get(STORM_SETTING_LEGACY);
  if (v === "0" || v === "false") return false;
  if (v === "1" || v === "true") return true;
  return true;
}

export function writeStormSettingOn(on: boolean): void {
  writeUserPref(STORM_SETTING_USER_PREF, on);
  safeStorage.set(STORM_SETTING_LEGACY, on ? "1" : "0");
}

export function readRadarSettingOn(): boolean {
  const user = readUserPref(RADAR_SETTING_USER_PREF);
  if (user != null) return user;
  const v = safeStorage.get(RADAR_SETTING_LEGACY);
  if (v === "0" || v === "false") return false;
  if (v === "1" || v === "true") return true;
  return true;
}

export function writeRadarSettingOn(on: boolean): void {
  writeUserPref(RADAR_SETTING_USER_PREF, on);
  safeStorage.set(RADAR_SETTING_LEGACY, on ? "1" : "0");
}
