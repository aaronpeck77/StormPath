import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import type { getWebEnv } from "../config/env";
import {
  buildAdvisoryPromoLines,
  buildBasicNavAdvisoryPromoLines,
  buildBasicNavStatusPanelPromos,
  type AdvisoryPromoLine,
  type BasicStatusPanelPromos,
} from "../config/basicAds";
import { getPayTier, hasTollBypass, maxSavedPlaces, maxSavedRoutes } from "../billing/payFeatures";
import {
  NATIVE_PAY_TIER_CHANGED_EVENT,
  refreshPlusEntitlementFromStore,
  whenRevenueCatReady,
} from "../billing/revenueCat";

type WebEnv = ReturnType<typeof getWebEnv>;

export type UsePayTierSessionDeps = {
  env: WebEnv;
};

/**
 * Pay-tier probe + RevenueCat sync, plus the Plus-vs-Basic derived flags and promo copy that
 * key off it. Also owns the small `navigator.onLine` mirror (unrelated to billing, but was
 * declared right beside these flags and has no other App-owned dependencies).
 */
export function usePayTierSession(deps: UsePayTierSessionDeps) {
  const { env } = deps;

  /** Demo tools (mock banner, mock close hazard, mock compare) are dev-only. The `?demo=bypass`
   *  URL flag still has to be present, but we additionally hard-gate on `import.meta.env.DEV` so
   *  TestFlight / production builds can never surface the demo strip even if the flag leaks in. */
  const demoBypassTrafficJam = useMemo(() => {
    if (!import.meta.env.DEV) return false;
    if (typeof window === "undefined") return false;
    try {
      return new URLSearchParams(window.location.search).get("demo") === "bypass";
    } catch {
      return false;
    }
  }, []);
  /** Bumped when dev About changes `PAY_TIER_OVERRIDE_LS_KEY` or RevenueCat entitlement updates. */
  const [payTierProbeKey, setPayTierProbeKey] = useState(0);
  const reprobePayTier = useCallback(() => setPayTierProbeKey((n) => n + 1), []);
  useEffect(() => {
    const handler = () => reprobePayTier();
    window.addEventListener(NATIVE_PAY_TIER_CHANGED_EVENT, handler);
    /* Re-read tier after async RevenueCat init may have written entitlement before listener mounted. */
    queueMicrotask(reprobePayTier);
    return () => window.removeEventListener(NATIVE_PAY_TIER_CHANGED_EVENT, handler);
  }, [reprobePayTier]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    void whenRevenueCatReady().then(async (ready) => {
      if (cancelled || !ready) return;
      const outcome = await refreshPlusEntitlementFromStore();
      if (!cancelled) reprobePayTier();
      if (import.meta.env.DEV && outcome.status === "error") {
        console.warn("[RevenueCat] launch entitlement sync:", outcome.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [reprobePayTier]);
  /** Plus vs Basic from `getPayTier()` (build env + native entitlement + optional LS override). */
  const isPlus = useMemo(() => getPayTier() === "plus", [payTierProbeKey]);
  const savedPlacesMax = useMemo(() => maxSavedPlaces(), [payTierProbeKey]);
  const savedRoutesMax = useMemo(() => maxSavedRoutes(), [payTierProbeKey]);
  const tollBypassEnabled = useMemo(() => hasTollBypass(), [payTierProbeKey]);
  const advisoryPromoLines = useMemo<AdvisoryPromoLine[]>(
    () => (isPlus ? buildAdvisoryPromoLines(env, isPlus) : buildBasicNavAdvisoryPromoLines(env)),
    [env, isPlus]
  );
  const basicStatusPanelPromos = useMemo<BasicStatusPanelPromos | null>(
    () => (isPlus ? null : buildBasicNavStatusPanelPromos(env)),
    [env, isPlus]
  );
  /** `?demo=bypass` replay / simulated delay — Plus only (matches Traffic bypass). */
  const demoBypassTrafficJamPlus = demoBypassTrafficJam && isPlus;
  const demoBypassTrafficJamPlusRef = useRef(false);
  demoBypassTrafficJamPlusRef.current = demoBypassTrafficJamPlus;
  const payFrequentRoutes = isPlus;
  const tierLabel = isPlus ? "Plus" : "Basic";
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return {
    payTierProbeKey,
    reprobePayTier,
    isPlus,
    savedPlacesMax,
    savedRoutesMax,
    tollBypassEnabled,
    advisoryPromoLines,
    basicStatusPanelPromos,
    demoBypassTrafficJamPlus,
    demoBypassTrafficJamPlusRef,
    payFrequentRoutes,
    tierLabel,
    isOnline,
  };
}
