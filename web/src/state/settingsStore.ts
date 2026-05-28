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
const LS_LANDSCAPE_SIDE_HAND = "stormpath-setting-landscape-side-hand";
/** Phase 8 — haptic feedback toggle. Default ON: first-time users feel the polish; opt-out
 * lives in About → Feedback. Stored as `1`/`0` like every other bool setting. */
const LS_HAPTICS = "stormpath-setting-haptics-enabled";

export type LandscapeSideHand = "right" | "left";

/**
 * Shape passed to / from the About sheet. Mirrors the 9 user-toggleable persisted fields. Kept
 * separate from `SettingsState` so the About sheet doesn't need to know about the underlying
 * setter names — it just exchanges a plain settings object.
 */
export interface AppSettings {
  radarEnabled: boolean;
  stormEnabled: boolean;
  trafficEnabled: boolean;
  weatherHintsEnabled: boolean;
  dataSaverEnabled: boolean;
  autoRerouteEnabled: boolean;
  voiceGuidanceEnabled: boolean;
  gpsHighRefreshEnabled: boolean;
  landscapeSideHand: LandscapeSideHand;
  /** Phase 8 — included in the bulk-apply payload from About → Feedback toggle. */
  hapticsEnabled: boolean;
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

export interface SettingsState {
  /* Map / data toggles (each persists through `layerStartupPrefs` which carries legacy fallback keys). */
  stormEnabled: boolean;
  trafficEnabled: boolean;
  radarEnabled: boolean;

  /* Direct safeStorage flags. */
  weatherHintsEnabled: boolean;
  autoRerouteEnabled: boolean;
  dataSaverEnabled: boolean;
  /** True after the user dismisses the inline data-saver hint banner. */
  dataSaverHintDismissed: boolean;
  voiceGuidanceEnabled: boolean;
  gpsHighRefreshEnabled: boolean;
  /** Landscape / side view only; portrait ignores. */
  landscapeSideHand: LandscapeSideHand;
  /** Phase 8 — drives `feedback/haptics.ts`. Default ON; user opt-out in About → Feedback. */
  hapticsEnabled: boolean;

  setStormEnabled: (on: boolean) => void;
  setTrafficEnabled: (on: boolean) => void;
  setRadarEnabled: (on: boolean) => void;
  setWeatherHintsEnabled: (on: boolean) => void;
  setAutoRerouteEnabled: (on: boolean) => void;
  setDataSaverEnabled: (on: boolean) => void;
  /** Persist + flag the inline hint as dismissed (no-arg form: it can't be re-opened from UI). */
  dismissDataSaverHint: () => void;
  setVoiceGuidanceEnabled: (on: boolean) => void;
  setGpsHighRefreshEnabled: (on: boolean) => void;
  setLandscapeSideHand: (hand: LandscapeSideHand) => void;
  setHapticsEnabled: (on: boolean) => void;
  /**
   * Bulk-apply all 9 persisted toggles from the About sheet in a single store update.
   *
   * - Each per-field persistence side-effect (`safeStorage.set`, `writeXSettingOn`) fires once.
   * - Only one React re-render fires (vs. 9 if the caller looped over individual setters).
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
  weatherHintsEnabled: readBoolFlag(LS_WEATHER_HINTS, false),
  autoRerouteEnabled: readBoolFlag(LS_AUTO_REROUTE, true),
  dataSaverEnabled: readDataSaverSetting(),
  dataSaverHintDismissed: readDataSaverHintDismissed(),
  voiceGuidanceEnabled: readBoolFlag(LS_VOICE, false),
  gpsHighRefreshEnabled: readBoolFlag(LS_GPS_HIGH_REFRESH, false),
  landscapeSideHand: safeStorage.get(LS_LANDSCAPE_SIDE_HAND) === "left" ? "left" : "right",
  hapticsEnabled: readBoolFlag(LS_HAPTICS, true),

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
  setLandscapeSideHand: (hand) => {
    safeStorage.set(LS_LANDSCAPE_SIDE_HAND, hand);
    set({ landscapeSideHand: hand });
  },
  setHapticsEnabled: (on) => {
    writeBoolFlag(LS_HAPTICS, on);
    set({ hapticsEnabled: on });
  },
  applySettings: (next) => {
    /* Persist each field through its existing helper so the storage shape stays identical to
     * the individual setters (legacy fallback keys in `layerStartupPrefs`, `safeStorage` for
     * the rest). Then push a single state update at the end so React schedules one re-render
     * instead of nine. */
    writeStormSettingOn(next.stormEnabled);
    writeTrafficSettingOn(next.trafficEnabled);
    writeRadarSettingOn(next.radarEnabled);
    writeBoolFlag(LS_WEATHER_HINTS, next.weatherHintsEnabled);
    writeBoolFlag(LS_AUTO_REROUTE, next.autoRerouteEnabled);
    writeBoolFlag(LS_DATA_SAVER, next.dataSaverEnabled);
    writeBoolFlag(LS_VOICE, next.voiceGuidanceEnabled);
    writeBoolFlag(LS_GPS_HIGH_REFRESH, next.gpsHighRefreshEnabled);
    safeStorage.set(LS_LANDSCAPE_SIDE_HAND, next.landscapeSideHand);
    writeBoolFlag(LS_HAPTICS, next.hapticsEnabled);
    set({
      stormEnabled: next.stormEnabled,
      trafficEnabled: next.trafficEnabled,
      radarEnabled: next.radarEnabled,
      weatherHintsEnabled: next.weatherHintsEnabled,
      autoRerouteEnabled: next.autoRerouteEnabled,
      dataSaverEnabled: next.dataSaverEnabled,
      voiceGuidanceEnabled: next.voiceGuidanceEnabled,
      gpsHighRefreshEnabled: next.gpsHighRefreshEnabled,
      landscapeSideHand: next.landscapeSideHand,
      hapticsEnabled: next.hapticsEnabled,
    });
  },
}));
