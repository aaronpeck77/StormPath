import { useEffect, useRef, useState } from "react";
import { getWebEnv } from "../config/env";
import { getPayTier } from "../billing/payFeatures";
import {
  ADMOB_TEST_BANNER_UNIT_ID,
  isAdMobSupported,
  showBasicBanner,
  subscribeBasicBannerLoad,
  teardownBasicBanner,
} from "../ads/adMobClient";

type Args = {
  /** Basic tier only — Plus never shows AdMob. */
  enabled: boolean;
  /** Hide while actively navigating (Drive / Go). */
  navigationStarted: boolean;
  /** Bumped when pay tier override changes so ads tear down immediately on Plus. */
  payTierProbeKey: number;
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
 *  House promos (Plus upsell / tips) stay in StormAdvisoryBar only. */
export function useBasicAdMobBanner({
  enabled,
  navigationStarted,
  payTierProbeKey,
}: Args): {
  slotState: BasicAdBannerSlotState;
  testMode: boolean;
  /** Lift bottom chrome while Basic idle — dev web reserves layout only; device also shows native AdMob. */
  reservesBottomSpace: boolean;
} {
  const env = getWebEnv();
  const showRef = useRef(false);
  const [slotState, setSlotState] = useState<BasicAdBannerSlotState>("hidden");
  const testMode = resolveAdMobTestMode();
  const isBasicTier = getPayTier() !== "plus";

  useEffect(() => {
    if (!isAdMobSupported()) {
      setSlotState("hidden");
      return undefined;
    }

    const shouldShow = enabled && isBasicTier && !navigationStarted;
    const adUnitId = env.admobBannerUnitId || ADMOB_TEST_BANNER_UNIT_ID;

    if (!shouldShow) {
      showRef.current = false;
      setSlotState("hidden");
      void teardownBasicBanner();
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
      bottomMarginPx: 0,
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
        void teardownBasicBanner();
      }
    };
  }, [enabled, isBasicTier, navigationStarted, env.admobBannerUnitId, testMode, payTierProbeKey]);

  useEffect(() => {
    return () => {
      void teardownBasicBanner();
    };
  }, []);

  const reservesBottomSpace =
    isBasicTier &&
    enabled &&
    !navigationStarted &&
    (import.meta.env.DEV && !isAdMobSupported()
      ? true
      : isAdMobSupported() && slotState !== "hidden");

  return { slotState, testMode, reservesBottomSpace };
}
