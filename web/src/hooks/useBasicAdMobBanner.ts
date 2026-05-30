import { useEffect, useRef } from "react";
import { getWebEnv } from "../config/env";
import {
  ADMOB_TEST_BANNER_UNIT_ID,
  hideBasicBanner,
  isAdMobSupported,
  removeBasicBanner,
  showBasicBanner,
} from "../ads/adMobClient";

type Args = {
  /** Basic tier only — Plus never shows AdMob. */
  enabled: boolean;
  /** Hide while actively navigating (Drive / Go). */
  navigationStarted: boolean;
};

/** Third-party AdMob banner for Basic — browse / route planning only, not while driving.
 *  House promos (SiteBible, Plus upsell) stay in StormAdvisoryBar only. */
export function useBasicAdMobBanner({ enabled, navigationStarted }: Args): void {
  const env = getWebEnv();
  const showRef = useRef(false);

  useEffect(() => {
    if (!isAdMobSupported()) return undefined;

    const shouldShow = enabled && !navigationStarted;
    const testMode =
      import.meta.env.DEV ||
      String(import.meta.env.VITE_ADMOB_TEST_MODE ?? "").toLowerCase() === "true";

    const adUnitId = env.admobBannerUnitId || ADMOB_TEST_BANNER_UNIT_ID;

    if (!shouldShow) {
      showRef.current = false;
      void hideBasicBanner();
      return undefined;
    }

    showRef.current = true;
    void showBasicBanner({
      adUnitId,
      testMode,
      bottomMarginPx: 118,
    });

    return () => {
      if (showRef.current) {
        showRef.current = false;
        void hideBasicBanner();
      }
    };
  }, [enabled, navigationStarted, env.admobBannerUnitId]);

  useEffect(() => {
    return () => {
      void removeBasicBanner();
    };
  }, []);
}
