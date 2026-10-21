import { useEffect } from "react";
import { StormpathMapboxNavigation } from "@stormpath/mapbox-navigation";
import { isNativeMapboxNavPlatform } from "./useNativeNavSession";

/** Off screen with no trip: hard-close so the next open is a fresh launch. */
export const IDLE_APP_EXIT_MS = 20_000;

/**
 * A drive stays alive in the background. Everything else quits after a short
 * wait so a locked phone is not still running the map.
 */
export function shouldArmIdleExit(input: {
  native: boolean;
  appForeground: boolean;
  navigationStarted: boolean;
}): boolean {
  return input.native && !input.appForeground && !input.navigationStarted;
}

/** Arms the iPhone quit. A browser build and an active drive do nothing. */
export function useIdleAppExit(navigationStarted: boolean, appForeground: boolean): void {
  useEffect(() => {
    if (!isNativeMapboxNavPlatform()) return;
    if (!shouldArmIdleExit({ native: true, appForeground, navigationStarted })) {
      void StormpathMapboxNavigation.cancelIdleExit().catch(() => undefined);
      return;
    }
    void StormpathMapboxNavigation.armIdleExit({ afterMs: IDLE_APP_EXIT_MS }).catch(() => undefined);
  }, [navigationStarted, appForeground]);
}
