/**
 * Map layer startup defaults: radar, NWS session, road/traffic strip ON until the user
 * explicitly turns them off (persisted via *-user-pref keys).
 */

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
  try {
    const v = localStorage.getItem(key);
    if (v === "off" || v === "false" || v === "0") return false;
    if (v === "on" || v === "true" || v === "1") return true;
  } catch {
    /* ignore */
  }
  return null;
}

function writeUserPref(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? "on" : "off");
  } catch {
    /* ignore */
  }
}

/** One-time: undo legacy migrations that forced layers off without an explicit user pref. */
export function applyLayerStartupMigrations(): void {
  if (typeof window === "undefined") return;
  try {
    if (localStorage.getItem(LAYER_STARTUP_V5_KEY) === "1") return;

    if (readUserPref(RADAR_USER_PREF) == null) {
      localStorage.setItem(RADAR_OVERLAY_LEGACY, "1");
    }
    if (readUserPref(ROAD_ADVISORY_USER_PREF) == null) {
      localStorage.setItem(ROAD_ADVISORY_LEGACY, "1");
    }
    if (readUserPref(NWS_SESSION_USER_PREF) == null) {
      localStorage.removeItem(NWS_SESSION_LEGACY);
    }
    if (readUserPref(TRAFFIC_SETTING_USER_PREF) == null) {
      localStorage.setItem(TRAFFIC_SETTING_LEGACY, "1");
    }

    localStorage.setItem(LAYER_STARTUP_V5_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function readRadarOverlayOn(): boolean {
  const user = readUserPref(RADAR_USER_PREF);
  if (user != null) return user;
  try {
    const o = localStorage.getItem(RADAR_OVERLAY_LEGACY);
    if (o === "0" || o === "false") return false;
    if (o === "1" || o === "true") return true;
  } catch {
    /* ignore */
  }
  return true;
}

export function writeRadarOverlayOn(on: boolean): void {
  writeUserPref(RADAR_USER_PREF, on);
  try {
    localStorage.setItem(RADAR_OVERLAY_LEGACY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function readRoadAdvisoryDetailOn(): boolean {
  const user = readUserPref(ROAD_ADVISORY_USER_PREF);
  if (user != null) return user;
  try {
    const v = localStorage.getItem(ROAD_ADVISORY_LEGACY);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {
    /* ignore */
  }
  return true;
}

export function writeRoadAdvisoryDetailOn(on: boolean): void {
  writeUserPref(ROAD_ADVISORY_USER_PREF, on);
  try {
    localStorage.setItem(ROAD_ADVISORY_LEGACY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function readNwsSessionOn(): boolean {
  const user = readUserPref(NWS_SESSION_USER_PREF);
  if (user != null) return user;
  try {
    const v = localStorage.getItem(NWS_SESSION_LEGACY);
    if (v === "off") return false;
  } catch {
    /* ignore */
  }
  return true;
}

export function writeNwsSessionOn(on: boolean): void {
  writeUserPref(NWS_SESSION_USER_PREF, on);
  try {
    localStorage.setItem(NWS_SESSION_LEGACY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
}

export function readTrafficSettingOn(): boolean {
  const user = readUserPref(TRAFFIC_SETTING_USER_PREF);
  if (user != null) return user;
  try {
    const v = localStorage.getItem(TRAFFIC_SETTING_LEGACY);
    if (v === "0" || v === "false") return false;
    if (v === "1" || v === "true") return true;
  } catch {
    /* ignore */
  }
  return true;
}

export function writeTrafficSettingOn(on: boolean): void {
  writeUserPref(TRAFFIC_SETTING_USER_PREF, on);
  try {
    localStorage.setItem(TRAFFIC_SETTING_LEGACY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function readStormSettingOn(): boolean {
  const user = readUserPref(STORM_SETTING_USER_PREF);
  if (user != null) return user;
  try {
    const v = localStorage.getItem(STORM_SETTING_LEGACY);
    if (v === "0" || v === "false") return false;
    if (v === "1" || v === "true") return true;
  } catch {
    /* ignore */
  }
  return true;
}

export function writeStormSettingOn(on: boolean): void {
  writeUserPref(STORM_SETTING_USER_PREF, on);
  try {
    localStorage.setItem(STORM_SETTING_LEGACY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function readRadarSettingOn(): boolean {
  const user = readUserPref(RADAR_SETTING_USER_PREF);
  if (user != null) return user;
  try {
    const v = localStorage.getItem(RADAR_SETTING_LEGACY);
    if (v === "0" || v === "false") return false;
    if (v === "1" || v === "true") return true;
  } catch {
    /* ignore */
  }
  return true;
}

export function writeRadarSettingOn(on: boolean): void {
  writeUserPref(RADAR_SETTING_USER_PREF, on);
  try {
    localStorage.setItem(RADAR_SETTING_LEGACY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}
