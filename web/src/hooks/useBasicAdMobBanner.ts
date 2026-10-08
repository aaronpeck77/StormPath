import { useEffect, useRef, useState } from "react";
import { getWebEnv } from "../config/env";
import { getPayTier } from "../billing/payFeatures";
import {
  ADMOB_TEST_BANNER_UNIT_ID,
  getBasicBannerHeightPx,
  isAdMobSupported,
  recordBasicBannerUiSlot,
  showBasicBanner,
  subscribeBasicBannerHeight,
  subscribeBasicBannerLoad,
  teardownBasicBanner,
} from "../ads/adMobClient";

type Args = {
  /** Basic tier only — Plus never shows AdMob. */
  enabled: boolean;
  /** Hide for the whole trip. Ads return on the home screen, before Go. */
  navigationStarted: boolean;
  /** Kept for callers. Opening Status during a trip does not bring ads back. */
  stormBarExpanded?: boolean;
};

export type BasicAdBannerSlotState = "hidden" | "loading" | "filled" | "empty";

const LOAD_TIMEOUT_MS = 12_000;

function resolveAdMobTestMode(): boolean {
  return (
    import.meta.env.DEV ||
    String(import.meta.env.VITE_ADMOB_TEST_MODE ?? "").toLowerCase() === "true"
  );
}

/** Standard 320×50 banner, used until AdMob reports a real height. */
export const BASIC_AD_BANNER_FALLBACK_PX = 50;

/**
 * Lift chrome while a banner is on screen or still loading.
 * A measured height wins even if the slot timed out, so the buttons stay above the ad.
 * A failed/no-fill gap (height 0) does not leave a hole.
 */
export function bannerShouldReserveBottomSpace(opts: {
  isBasicTier: boolean;
  enabled: boolean;
  navigationStarted: boolean;
  stormBarExpanded?: boolean;
  native: boolean;
  slotState: BasicAdBannerSlotState;
  /** Last SizeChanged height. 0 when the banner is gone. */
  bannerHeightPx?: number;
  /** Local `npm run dev` in a browser — no native AdMob, still pad so layout matches device. */
  devWebPlaceholder: boolean;
}): boolean {
  const height =
    opts.bannerHeightPx != null && Number.isFinite(opts.bannerHeightPx) ? opts.bannerHeightPx : 0;
  if (height > 0) return true;
  if (!opts.isBasicTier || !opts.enabled) return false;
  if (opts.navigationStarted) return false;
  if (opts.devWebPlaceholder) return true;
  if (!opts.native) return false;
  return opts.slotState === "loading" || opts.slotState === "filled";
}

/** Pixels the bottom controls move up. 0 puts them back on the bottom edge. */
export function basicAdChromeLiftPx(opts: {
  reservesBottomSpace: boolean;
  bannerHeightPx: number;
}): number {
  if (!opts.reservesBottomSpace) return 0;
  if (opts.bannerHeightPx > 0) return Math.round(opts.bannerHeightPx);
  return BASIC_AD_BANNER_FALLBACK_PX;
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

/** Third-party AdMob for Basic on the home screen. Hidden for the whole trip. */
export function useBasicAdMobBanner({
  enabled,
  navigationStarted,
  stormBarExpanded = false,
}: Args): {
  slotState: BasicAdBannerSlotState;
  testMode: boolean;
  /** Lift bottom chrome while Basic idle — device shows native AdMob when filled. */
  reservesBottomSpace: boolean;
  /** How far the bottom controls move up, in CSS pixels. 0 when the ad is gone. */
  bannerLiftPx: number;
} {
  const env = getWebEnv();
  const showRef = useRef(false);
  const [slotState, setSlotState] = useState<BasicAdBannerSlotState>("hidden");
  const [bannerHeightPx, setBannerHeightPx] = useState(0);
  const testMode = resolveAdMobTestMode();
  const isBasicTier = getPayTier() !== "plus";

  useEffect(() => {
    recordBasicBannerUiSlot(slotState);
  }, [slotState]);

  useEffect(() => subscribeBasicBannerHeight(setBannerHeightPx), []);

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
      setSlotState((prev) => {
        if (prev !== "loading") return prev;
        /* The creative is already on screen — keep the buttons up. */
        return getBasicBannerHeightPx() > 0 ? "filled" : "empty";
      });
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
  }, [
    enabled,
    isBasicTier,
    navigationStarted,
    stormBarExpanded,
    env.admobBannerUnitId,
    testMode,
  ]);

  useEffect(() => {
    return () => {
      void teardownBasicBanner();
    };
  }, []);

  const reservesBottomSpace = bannerShouldReserveBottomSpace({
    isBasicTier,
    enabled,
    navigationStarted,
    stormBarExpanded,
    native: isAdMobSupported(),
    slotState,
    bannerHeightPx,
    devWebPlaceholder: Boolean(import.meta.env.DEV && !isAdMobSupported()),
  });
  const bannerLiftPx = basicAdChromeLiftPx({ reservesBottomSpace, bannerHeightPx });

  return { slotState, testMode, reservesBottomSpace, bannerLiftPx };
}
