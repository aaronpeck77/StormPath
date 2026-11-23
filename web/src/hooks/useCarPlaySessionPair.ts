import { useEffect, type MutableRefObject } from "react";
import { StormpathMapboxNavigation } from "@stormpath/mapbox-navigation";
import { isNativeMapboxNavPlatform } from "../nav/useNativeNavSession";
import { isTripBootSettled, subscribeTripBootSettled } from "../nav/useActiveTripCache";
import { useTripPlanStore } from "../state/tripPlanStore";

/**
 * Keep the phone and the car on one trip.
 *
 * While CarPlay is connected, the off-route poll reads `carPlayConnectedRef`
 * and plans the forward line itself. If the phone reloads out of the trip
 * and the car is still guiding, end that native session.
 */
export function useCarPlaySessionPair(
  carPlayActive: boolean,
  navigationStarted: boolean,
  carPlayConnectedRef: MutableRefObject<boolean>
): void {
  carPlayConnectedRef.current = carPlayActive;

  useEffect(() => {
    if (!isNativeMapboxNavPlatform()) return;

    const releaseOrphan = () => {
      if (!carPlayConnectedRef.current) return;
      if (useTripPlanStore.getState().navigationStarted) return;
      if (!isTripBootSettled()) return;
      void StormpathMapboxNavigation.stopOrphanedGuidance().catch(() => undefined);
    };

    releaseOrphan();
    return subscribeTripBootSettled(releaseOrphan);
  }, [carPlayActive, navigationStarted, carPlayConnectedRef]);
}
