import { useEffect, useRef, type MutableRefObject } from "react";
import { StormpathMapboxNavigation } from "@stormpath/mapbox-navigation";
import { isNativeMapboxNavPlatform } from "../nav/useNativeNavSession";
import { isTripBootSettled, subscribeTripBootSettled } from "../nav/useActiveTripCache";
import { useTripPlanStore } from "../state/tripPlanStore";

/**
 * Keep the phone and the car on one trip.
 *
 * Mirrors CarPlay presence into a ref for UI, and ends leftover car guidance
 * only when the phone has left a trip (or boots idle) — not on every CarPlay
 * connect while planning, which raced GO and killed the new Core session.
 */
export function useCarPlaySessionPair(
  carPlayConnected: boolean,
  navigationStarted: boolean,
  carPlayConnectedRef: MutableRefObject<boolean>
): void {
  carPlayConnectedRef.current = carPlayConnected;
  const wasNavigatingRef = useRef(navigationStarted);

  useEffect(() => {
    if (!isNativeMapboxNavPlatform()) return;

    const releaseOrphan = () => {
      if (!carPlayConnectedRef.current) return;
      if (useTripPlanStore.getState().navigationStarted) return;
      if (!isTripBootSettled()) return;
      void StormpathMapboxNavigation.stopOrphanedGuidance().catch(() => undefined);
    };

    const wasNav = wasNavigatingRef.current;
    wasNavigatingRef.current = navigationStarted;

    /* Phone left an active trip while the car is still attached. */
    if (wasNav && !navigationStarted && carPlayConnected) {
      releaseOrphan();
      return;
    }

    /* Cold boot / reload: trip cache settled idle, car may still be guiding. */
    if (!navigationStarted && carPlayConnected) {
      if (isTripBootSettled()) releaseOrphan();
      return subscribeTripBootSettled(releaseOrphan);
    }

    return undefined;
  }, [carPlayConnected, navigationStarted, carPlayConnectedRef]);
}
