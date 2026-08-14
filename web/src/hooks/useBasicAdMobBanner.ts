import { useEffect, useRef, useState } from "react";
import { getWebEnv } from "../config/env";
import { getPayTier } from "../billing/payFeatures";
import {
  ADMOB_TEST_BANNER_UNIT_ID,
  isAdMobSupported,
  recordBasicBannerUiSlot,
  showBasicBanner,
  subscribeBasicBannerLoad,
  teardownBasicBanner,
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

/** Lift chrome only while a banner is loading or on screen — not for a failed/no-fill gap. */
export function bannerShouldReserveBottomSpace(opts: {
  isBasicTier: boolean;
  enabled: boolean;
  navigationStarted: boolean;
  native: boolean;
  slotState: BasicAdBannerSlotState;
  /** Local `npm run dev` in a browser — no native AdMob, still pad so layout matches device. */
  devWebPlaceholder: boolean;
}): boolean {
  if (!opts.isBasicTier || !opts.enabled || opts.navigationStarted) return false;
  if (opts.devWebPlaceholder) return true;
  if (!opts.native) return false;
  return opts.slotState === "loading" || opts.slotState === "filled";
}

/**
 * Stale `showBasicBanner()` results must not overwrite a newer effect's slot.
 * `showBanner` resolving true only means the native request started, not that a creative filled.
 */
export function slotStateAfterShowAttempt(args: {
  cancelled: boolean;
  shown: boolean;
}): BasicAdBannerSlotState | null {
  if (args.cancelled) return null;
  if (!args.shown) return "empty";
  return null;
}

/** Third-party AdMob banner for Basic — browse / route planning only, not while driving.
 *  House promos (Plus upsell / tips) stay in StormAdvisoryBar only. */
export function useBasicAdMobBanner({
  enabled,
  navigationStarted,
}: Args): {
  slotState: BasicAdBannerSlotState;
  testMode: boolean;
  /** Lift bottom chrome while Basic idle — device shows native AdMob when filled. */
  reservesBottomSpace: boolean;
} {
  const env = getWebEnv();
  const showRef = useRef(false);
  const [slotState, setSlotState] = useState<BasicAdBannerSlotState>("hidden");
  const testMode = resolveAdMobTestMode();
  const isBasicTier = getPayTier() !== "plus";

  useEffect(() => {
    recordBasicBannerUiSlot(slotState);
  }, [slotState]);

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
      const next = slotStateAfterShowAttempt({ cancelled, shown });
      if (next) {
        window.clearTimeout(timeoutId);
        setSlotState(next);
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
  }, [enabled, isBasicTier, navigationStarted, env.admobBannerUnitId, testMode]);

  useEffect(() => {
    return () => {
      void teardownBasicBanner();
    };
  }, []);

  const reservesBottomSpace = bannerShouldReserveBottomSpace({
    isBasicTier,
    enabled,
    navigationStarted,
    native: isAdMobSupported(),
    slotState,
    devWebPlaceholder: Boolean(import.meta.env.DEV && !isAdMobSupported()),
  });

  return { slotState, testMode, reservesBottomSpace };
}
