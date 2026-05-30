import { useEffect, useRef, useState } from "react";
import { getWebEnv } from "../config/env";
import {
  ADMOB_TEST_BANNER_UNIT_ID,
  hideBasicBanner,
  isAdMobSupported,
  removeBasicBanner,
  showBasicBanner,
  subscribeBasicBannerLoad,
} from "../ads/adMobClient";

type Args = {
  /** Basic tier only — Plus never shows AdMob. */
  enabled: boolean;
  /** Hide while actively navigating (Drive / Go). */
  navigationStarted: boolean;
};

export type BasicAdBannerSlotState = "hidden" | "loading" | "filled" | "empty";

const LOAD_TIMEOUT_MS = 12_000;

function resolveAdMobTestMode(): boolean {
  return (
    import.meta.env.DEV ||
    String(import.meta.env.VITE_ADMOB_TEST_MODE ?? "").toLowerCase() === "true"
  );
}

/** Third-party AdMob banner for Basic — browse / route planning only, not while driving.
 *  House promos (SiteBible, Plus upsell) stay in StormAdvisoryBar only. */
export function useBasicAdMobBanner({ enabled, navigationStarted }: Args): {
  slotState: BasicAdBannerSlotState;
  testMode: boolean;
} {
  const env = getWebEnv();
  const showRef = useRef(false);
  const [slotState, setSlotState] = useState<BasicAdBannerSlotState>("hidden");
  const testMode = resolveAdMobTestMode();

  useEffect(() => {
    if (!isAdMobSupported()) {
      setSlotState(
        import.meta.env.DEV && enabled && !navigationStarted ? "empty" : "hidden"
      );
      return undefined;
    }

    const shouldShow = enabled && !navigationStarted;
    const adUnitId = env.admobBannerUnitId || ADMOB_TEST_BANNER_UNIT_ID;

    if (!shouldShow) {
      showRef.current = false;
      setSlotState("hidden");
      void hideBasicBanner();
      return undefined;
    }

    showRef.current = true;
    setSlotState("loading");

    let cancelled = false;
    let timeoutId = 0;

    const unsubLoad = subscribeBasicBannerLoad((outcome) => {
      if (cancelled) return;
      window.clearTimeout(timeoutId);
      setSlotState(outcome === "loaded" ? "filled" : "empty");
    });

    timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      setSlotState((prev) => (prev === "loading" ? "empty" : prev));
    }, LOAD_TIMEOUT_MS);

    void showBasicBanner({
      adUnitId,
      testMode,
      bottomMarginPx: 106,
    }).then((shown) => {
      if (cancelled || !shown) {
        window.clearTimeout(timeoutId);
        setSlotState("empty");
      }
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      unsubLoad();
      if (showRef.current) {
        showRef.current = false;
        void hideBasicBanner();
      }
    };
  }, [enabled, navigationStarted, env.admobBannerUnitId, testMode]);

  useEffect(() => {
    return () => {
      void removeBasicBanner();
    };
  }, []);

  return { slotState, testMode };
}
