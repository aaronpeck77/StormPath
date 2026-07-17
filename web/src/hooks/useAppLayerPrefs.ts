import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { KeepAwake } from "@capacitor-community/keep-awake";
import { isLongTripRoute } from "../utils/dataSaver";
import type { LngLat } from "../nav/types";
import type { TrafficOverlay } from "../situation/fusedSnapshot";
import { readRadarOverlayOn, writeRadarOverlayOn } from "../layerStartupPrefs";

export type UseAppLayerPrefsDeps = {
  navigationStarted: boolean;
  /** Clears the live traffic overlay when the Traffic setting is turned off. */
  settingTrafficEnabled: boolean;
  settingRadarEnabled: boolean;
  setTrafficOverlay: (overlay: TrafficOverlay | undefined) => void;
};

/**
 * Persisted map-layer toggles that used to be scattered across `App.tsx`:
 * map radar overlay (Rad), plus settings-off cleanup and keep-awake while navigating.
 * NWS and road/traffic display follow About settings only (no advisory-bar session toggles).
 */
export function useAppLayerPrefs(deps: UseAppLayerPrefsDeps) {
  const { navigationStarted, settingTrafficEnabled, settingRadarEnabled, setTrafficOverlay } = deps;

  /** Keep the screen on while navigating on device; allow sleep when done. */
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (navigationStarted) {
      void KeepAwake.keepAwake();
    } else {
      void KeepAwake.allowSleep();
    }
  }, [navigationStarted]);

  /** Map overlay (toolbar Rad). Default ON — weather-first app design. */
  const [showRadar, setShowRadar] = useState(readRadarOverlayOn);
  useEffect(() => {
    writeRadarOverlayOn(showRadar);
  }, [showRadar]);

  useEffect(() => {
    if (!settingTrafficEnabled) setTrafficOverlay(undefined);
  }, [settingTrafficEnabled, setTrafficOverlay]);

  useEffect(() => {
    if (!settingRadarEnabled) {
      setShowRadar(false);
      writeRadarOverlayOn(false);
    }
  }, [settingRadarEnabled]);

  return {
    showRadar,
    setShowRadar,
  };
}

/** Plus, on a long trip, without an active data-saver mode and not yet dismissed this session. */
export function shouldShowDataSaverHint(opts: {
  isPlus: boolean;
  dataSaverMode: boolean;
  dataSaverHintDismissed: boolean;
  guidanceRouteGeometry: LngLat[] | null | undefined;
  maxPlanRouteLengthM: number;
}): boolean {
  const { isPlus, dataSaverMode, dataSaverHintDismissed, guidanceRouteGeometry, maxPlanRouteLengthM } = opts;
  return (
    isPlus &&
    !dataSaverMode &&
    !dataSaverHintDismissed &&
    Boolean(guidanceRouteGeometry && guidanceRouteGeometry.length >= 2) &&
    isLongTripRoute(maxPlanRouteLengthM)
  );
}
