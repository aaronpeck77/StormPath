import { create } from "zustand";
import {
  readRadarSettingOn,
  readStormSettingOn,
  readTrafficSettingOn,
  writeRadarSettingOn,
  writeStormSettingOn,
  writeTrafficSettingOn,
} from "../layerStartupPrefs";
import { safeStorage } from "../storage/safeStorage";
import {
  dismissDataSaverHint as persistDismissDataSaverHint,
  LS_DATA_SAVER,
  readDataSaverHintDismissed,
  readDataSaverSetting,
} from "../utils/dataSaver";

/**
 * Persistent user-settings store (Zustand).
 *
 * **Why a store?** Until Phase 4 the App.tsx monolith owned ~10 `useState` flags plus a
 * matching `useEffect` per flag that only existed to call `safeStorage.set(...)`. That
 * boilerplate is now centralised here so the persistence side and the React side can't
 * drift, and so other consumers (AboutSheet, hooks, sub-components in future phases)
 * can read settings without prop-drilling them through App.
 *
 * **Side-effects stay in App.tsx.** When `stormEnabled` flips off, App still has to clear
 * the storm map state; when `radarEnabled` flips off it still calls `setShowRadar(false)`.
 * Those domain-specific reactions live in the components that own the affected refs/state,
 * driven by `useEffect(..., [setting])`. The store's only job is to read/write the value.
 *
 * **Initialization:** initial values are read **synchronously** from `safeStorage` (which
 * was hydrated from Capacitor Preferences before React mounted — see `web/src/main.tsx`).
 * That keeps the React tree's first paint identical to the previous `useState(() => read())`
 * pattern.
 */

const LS_WEATHER_HINTS = "stormpath-setting-weather-hints-enabled";
const LS_AUTO_REROUTE = "stormpath-setting-auto-reroute-enabled";
const LS_VOICE = "stormpath-setting-voice-guided";
const LS_GPS_HIGH_REFRESH = "stormpath-setting-gps-high-refresh";
const LS_MAP_MATCHING = "stormpath-setting-map-matching-enabled";
const LS_LANDSCAPE_SIDE_HAND = "stormpath-setting-landscape-side-hand";
const LS_RADAR_DISPLAY_MODE = "stormpath-setting-radar-display-mode";

export type LandscapeSideHand = "right" | "left";

/** Map radar: animated loop vs latest frame with storm-motion arrows. */
export type RadarDisplayMode = "motion" | "still_arrows";

/**
 * Shape passed to / from the About sheet. Mirrors the 8 user-toggleable persisted fields. Kept
 * separate from `SettingsState` so the About sheet doesn't need to know about the underlying
 * setter names — it just exchanges a plain settings object.
 */
export interface AppSettings {
  radarEnabled: boolean;
  /** Animated radar loop or latest mosaic with storm-motion arrows. */
  radarDisplayMode: RadarDisplayMode;
  stormEnabled: boolean;
  trafficEnabled: boolean;
  weatherHintsEnabled: boolean;
  dataSaverEnabled: boolean;
  autoRerouteEnabled: boolean;
  voiceGuidanceEnabled: boolean;
  gpsHighRefreshEnabled: boolean;
  /** While navigating, snap GPS to the road network via Mapbox Map Matching (Plus). */
  mapMatchingEnabled: boolean;
  landscapeSideHand: LandscapeSideHand;
}

function readBoolFlag(key: string, defaultValue: boolean): boolean {
  const v = safeStorage.get(key);
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return defaultValue;
}

function writeBoolFlag(key: string, on: boolean): void {
  safeStorage.set(key, on ? "1" : "0");
}

function readRadarDisplayMode(): RadarDisplayMode {
  const v = safeStorage.get(LS_RADAR_DISPLAY_MODE);
  if (v === "motion") return "motion";
  if (v === "still_arrows") return "still_arrows";
  return "still_arrows";
}

function writeRadarDisplayMode(mode: RadarDisplayMode): void {
  safeStorage.set(LS_RADAR_DISPLAY_MODE, mode);
}

export interface SettingsState {
  /* Map / data toggles (each persists through `layerStartupPrefs` which carries legacy fallback keys). */
  stormEnabled: boolean;
  trafficEnabled: boolean;
  radarEnabled: boolean;
  radarDisplayMode: RadarDisplayMode;

  /* Direct safeStorage flags. */
  weatherHintsEnabled: boolean;
  autoRerouteEnabled: boolean;
  dataSaverEnabled: boolean;
  /** True after the user dismisses the inline data-saver hint banner. */
  dataSaverHintDismissed: boolean;
  voiceGuidanceEnabled: boolean;
  gpsHighRefreshEnabled: boolean;
  mapMatchingEnabled: boolean;
  /** Landscape / side view only; portrait ignores. */
  landscapeSideHand: LandscapeSideHand;

  setStormEnabled: (on: boolean) => void;
  setTrafficEnabled: (on: boolean) => void;
  setRadarEnabled: (on: boolean) => void;
  setRadarDisplayMode: (mode: RadarDisplayMode) => void;
  setWeatherHintsEnabled: (on: boolean) => void;
  setAutoRerouteEnabled: (on: boolean) => void;
  setDataSaverEnabled: (on: boolean) => void;
  /** Persist + flag the inline hint as dismissed (no-arg form: it can't be re-opened from UI). */
  dismissDataSaverHint: () => void;
  setVoiceGuidanceEnabled: (on: boolean) => void;
  setGpsHighRefreshEnabled: (on: boolean) => void;
  setMapMatchingEnabled: (on: boolean) => void;
  setLandscapeSideHand: (hand: LandscapeSideHand) => void;
  /**
   * Bulk-apply all 8 persisted toggles from the About sheet in a single store update.
   *
   * - Each per-field persistence side-effect (`safeStorage.set`, `writeXSettingOn`) fires once.
   * - Only one React re-render fires (vs. 8 if the caller looped over individual setters).
   * - Caller-side side-effects (e.g. clearing the radar overlay when `radarEnabled` flips off)
   *   are owned by the `useEffect`s in App.tsx that already watch the corresponding setting —
   *   `applySettings` deliberately doesn't re-implement them.
   */
  applySettings: (next: AppSettings) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  stormEnabled: readStormSettingOn(),
  trafficEnabled: readTrafficSettingOn(),
  radarEnabled: readRadarSettingOn(),
  radarDisplayMode: readRadarDisplayMode(),
  weatherHintsEnabled: readBoolFlag(LS_WEATHER_HINTS, true),
  autoRerouteEnabled: readBoolFlag(LS_AUTO_REROUTE, true),
  dataSaverEnabled: readDataSaverSetting(),
  dataSaverHintDismissed: readDataSaverHintDismissed(),
  voiceGuidanceEnabled: readBoolFlag(LS_VOICE, false),
  gpsHighRefreshEnabled: readBoolFlag(LS_GPS_HIGH_REFRESH, false),
  /* Default off — DIY route-snap + iOS native nav cover guidance; Matching is a paid Plus burn. */
  mapMatchingEnabled: readBoolFlag(LS_MAP_MATCHING, false),
  landscapeSideHand: safeStorage.get(LS_LANDSCAPE_SIDE_HAND) === "left" ? "left" : "right",

  setStormEnabled: (on) => {
    writeStormSettingOn(on);
    set({ stormEnabled: on });
  },
  setTrafficEnabled: (on) => {
    writeTrafficSettingOn(on);
    set({ trafficEnabled: on });
  },
  setRadarEnabled: (on) => {
    writeRadarSettingOn(on);
    set({ radarEnabled: on });
  },
  setRadarDisplayMode: (mode) => {
    writeRadarDisplayMode(mode);
    set({ radarDisplayMode: mode });
  },
  setWeatherHintsEnabled: (on) => {
    writeBoolFlag(LS_WEATHER_HINTS, on);
    set({ weatherHintsEnabled: on });
  },
  setAutoRerouteEnabled: (on) => {
    writeBoolFlag(LS_AUTO_REROUTE, on);
    set({ autoRerouteEnabled: on });
  },
  setDataSaverEnabled: (on) => {
    writeBoolFlag(LS_DATA_SAVER, on);
    set({ dataSaverEnabled: on });
  },
  dismissDataSaverHint: () => {
    persistDismissDataSaverHint();
    set({ dataSaverHintDismissed: true });
  },
  setVoiceGuidanceEnabled: (on) => {
    writeBoolFlag(LS_VOICE, on);
    set({ voiceGuidanceEnabled: on });
  },
  setGpsHighRefreshEnabled: (on) => {
    writeBoolFlag(LS_GPS_HIGH_REFRESH, on);
    set({ gpsHighRefreshEnabled: on });
  },
  setMapMatchingEnabled: (on) => {
    writeBoolFlag(LS_MAP_MATCHING, on);
    set({ mapMatchingEnabled: on });
  },
  setLandscapeSideHand: (hand) => {
    safeStorage.set(LS_LANDSCAPE_SIDE_HAND, hand);
    set({ landscapeSideHand: hand });
  },
  applySettings: (next) => {
    /* Persist each field through its existing helper so the storage shape stays identical to
     * the individual setters (legacy fallback keys in `layerStartupPrefs`, `safeStorage` for
     * the rest). Then push a single state update at the end so React schedules one re-render
     * instead of nine. */
    writeStormSettingOn(next.stormEnabled);
    writeTrafficSettingOn(next.trafficEnabled);
    writeRadarSettingOn(next.radarEnabled);
    writeRadarDisplayMode(next.radarDisplayMode);
    writeBoolFlag(LS_WEATHER_HINTS, next.weatherHintsEnabled);
    writeBoolFlag(LS_AUTO_REROUTE, next.autoRerouteEnabled);
    writeBoolFlag(LS_DATA_SAVER, next.dataSaverEnabled);
    writeBoolFlag(LS_VOICE, next.voiceGuidanceEnabled);
    writeBoolFlag(LS_GPS_HIGH_REFRESH, next.gpsHighRefreshEnabled);
    writeBoolFlag(LS_MAP_MATCHING, next.mapMatchingEnabled);
    safeStorage.set(LS_LANDSCAPE_SIDE_HAND, next.landscapeSideHand);
    set({
      stormEnabled: next.stormEnabled,
      trafficEnabled: next.trafficEnabled,
      radarEnabled: next.radarEnabled,
      radarDisplayMode: next.radarDisplayMode,
      weatherHintsEnabled: next.weatherHintsEnabled,
      autoRerouteEnabled: next.autoRerouteEnabled,
      dataSaverEnabled: next.dataSaverEnabled,
      voiceGuidanceEnabled: next.voiceGuidanceEnabled,
      gpsHighRefreshEnabled: next.gpsHighRefreshEnabled,
      mapMatchingEnabled: next.mapMatchingEnabled,
      landscapeSideHand: next.landscapeSideHand,
    });
  },
}));
