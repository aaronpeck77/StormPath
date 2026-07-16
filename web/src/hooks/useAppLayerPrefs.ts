import { useCallback, useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { KeepAwake } from "@capacitor-community/keep-awake";
import { isLongTripRoute } from "../utils/dataSaver";
import type { LngLat } from "../nav/types";
import type { TrafficOverlay } from "../situation/fusedSnapshot";
import {
  readNwsSessionOn,
  readRadarOverlayOn,
  readRoadAdvisoryDetailOn,
  writeNwsSessionOn,
  writeRadarOverlayOn,
  writeRoadAdvisoryDetailOn,
} from "../layerStartupPrefs";

export type UseAppLayerPrefsDeps = {
  navigationStarted: boolean;
  /** Clears the live traffic overlay when the Traffic setting is turned off. */
  settingTrafficEnabled: boolean;
  settingRadarEnabled: boolean;
  setTrafficOverlay: (overlay: TrafficOverlay | undefined) => void;
};

/**
 * Consolidates the small persisted-layer toggles that used to be scattered across `App.tsx`:
 * map overlay (Rad), Storm session visibility, and the road/traffic advisory detail toggle.
 * Also owns the two "settings toggle turned off → clear the derived App state" effects and
 * keeps the screen awake while navigating on-device.
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

  const [stormSessionOn, setStormSessionOn] = useState(readNwsSessionOn);
  /** Map polygon visibility only — NWS poll + `stormMapGeoJson` cache keep running while off. */
  const onStormSessionToggle = useCallback((on: boolean) => {
    setStormSessionOn(on);
    writeNwsSessionOn(on);
  }, []);

  /** Road & traffic overlay (Hazards strip + map traffic colors). Default on until user turns off. */
  const [roadAdvisoryDetailOn, setRoadAdvisoryDetailOn] = useState(readRoadAdvisoryDetailOn);
  const onRoadAdvisoryDetailToggle = useCallback((on: boolean) => {
    setRoadAdvisoryDetailOn(on);
    writeRoadAdvisoryDetailOn(on);
  }, []);

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
    stormSessionOn,
    onStormSessionToggle,
    roadAdvisoryDetailOn,
    onRoadAdvisoryDetailToggle,
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
