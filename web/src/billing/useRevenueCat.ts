import { useCallback, useEffect, useMemo, useState } from "react";
import type { PurchasesPackage } from "@revenuecat/purchases-capacitor";
import {
  getPlusOffering,
  isRevenueCatReady,
  NATIVE_PAY_TIER_CHANGED_EVENT,
  pickDefaultPlusPackage,
  purchasePackage,
  type PurchaseOutcome,
  refreshPlusEntitlementFromStore,
  restorePlusEntitlement,
  whenRevenueCatReady,
} from "./revenueCat";

/**
 * `useRevenueCat` — React-side glue for Phase 7's IAP wiring.
 *
 * Single hook that AboutSheet uses to drive the native Subscription panel. Owns:
 *   - A snapshot of `isRevenueCatReady()` that updates when the SDK finishes configuring
 *     (re-checked on the `NATIVE_PAY_TIER_CHANGED_EVENT` from `revenueCat.ts`).
 *   - The current Plus package fetched from the offering (re-fetched on mount + on ready).
 *   - A `busy` flag so the UI can disable the buttons during purchase / restore flows.
 *   - The last error or status banner the UI should show (cancelled flows are silent).
 *   - `purchase()` and `restore()` callables that wrap the imperative SDK helpers and update
 *     local state for the spinner / message.
 *
 * The hook itself does NOT trigger `reprobePayTier()` — that lives in App.tsx, which listens
 * to the same `NATIVE_PAY_TIER_CHANGED_EVENT` window event (see Phase 7 wiring in App.tsx).
 * Keeping that responsibility one level up means the hook stays pure and a future
 * "subscription test panel" component could share it.
 */

export interface UseRevenueCatResult {
  /** True only on native + with API key + after configure resolved. */
  ready: boolean;
  /** Default package to surface in the Subscribe button. `null` while loading or unavailable. */
  defaultPackage: PurchasesPackage | null;
  /** Set during purchase / restore, drives a button spinner. */
  busy: boolean;
  /** Short user-readable message after the last action; `null` clears the banner. */
  message: string | null;
  /** Whether `message` should be styled as success (`"success"`) or error (`"error"`). */
  messageKind: "success" | "error" | null;
  /** Drive purchase flow on the loaded package. No-ops if `defaultPackage` is null. */
  purchase: () => Promise<void>;
  /** Drive restore flow. App Store review requires this exists for any IAP app. */
  restore: () => Promise<void>;
  /** Silent refresh when Basic — e.g. About opened after Apple already shows a subscription. */
  syncEntitlement: () => Promise<void>;
  /** Manually clear the banner — UI calls this when the AboutSheet closes. */
  clearMessage: () => void;
}

export function useRevenueCat(): UseRevenueCatResult {
  const [ready, setReady] = useState<boolean>(() => isRevenueCatReady());
  const [defaultPackage, setDefaultPackage] = useState<PurchasesPackage | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"success" | "error" | null>(null);

  /* Re-check ready state on the same window event RevenueCat dispatches when entitlement
   * changes — that's the soonest moment we know `configure()` finished. The first dispatch
   * happens during `initRevenueCat` after the initial `getCustomerInfo()` resolves. */
  useEffect(() => {
    const handler = () => setReady(isRevenueCatReady());
    window.addEventListener(NATIVE_PAY_TIER_CHANGED_EVENT, handler);
    queueMicrotask(handler);
    let cancelled = false;
    void whenRevenueCatReady().then((ok) => {
      if (!cancelled && ok) handler();
    });
    return () => {
      cancelled = true;
      window.removeEventListener(NATIVE_PAY_TIER_CHANGED_EVENT, handler);
    };
  }, []);

  /* Lazy-fetch the offering once we know the SDK is up. Cached locally; if the user ever
   * needs to refetch (e.g. RevenueCat dashboard changed the current offering at runtime),
   * a hook reset on remount will re-fetch — good enough for now. */
  useEffect(() => {
    if (!ready || defaultPackage) return;
    let cancelled = false;
    (async () => {
      const offering = await getPlusOffering();
      const pkg = pickDefaultPlusPackage(offering);
      if (!cancelled) setDefaultPackage(pkg);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, defaultPackage]);

  const applyOutcome = useCallback((outcome: PurchaseOutcome, successText: string, emptyText: string) => {
    if (outcome.status === "ok") {
      if (outcome.entitled) {
        setMessage(successText);
        setMessageKind("success");
      } else {
        setMessage(emptyText);
        setMessageKind("error");
      }
    } else if (outcome.status === "cancelled") {
      /* Silent — user backed out of the App Store sheet, no banner needed. */
      setMessage(null);
      setMessageKind(null);
    } else if (outcome.status === "unsupported") {
      setMessage("Subscriptions are only available in the iOS app.");
      setMessageKind("error");
    } else {
      setMessage(outcome.message);
      setMessageKind("error");
    }
  }, []);

  const purchase = useCallback(async () => {
    if (!defaultPackage) {
      setMessage("Subscription package is still loading. Try again in a moment.");
      setMessageKind("error");
      return;
    }
    setBusy(true);
    setMessage(null);
    setMessageKind(null);
    const outcome = await purchasePackage(defaultPackage);
    setBusy(false);
    applyOutcome(outcome, "Welcome to Plus! All Plus features are unlocked.", "Purchase completed with Apple, but Plus did not unlock yet. Tap Restore purchases, or try again in a minute.");
  }, [defaultPackage, applyOutcome]);

  const restore = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    setMessageKind(null);
    const outcome = await restorePlusEntitlement();
    setBusy(false);
    applyOutcome(outcome, "Plus restored. All Plus features are unlocked.", "No prior purchases found on this Apple ID.");
  }, [applyOutcome]);

  const syncEntitlement = useCallback(async () => {
    if (!ready || busy) return;
    setBusy(true);
    const outcome = await refreshPlusEntitlementFromStore();
    setBusy(false);
    if (outcome.status === "ok" && outcome.entitled) {
      setMessage("Plus restored. All Plus features are unlocked.");
      setMessageKind("success");
    } else if (outcome.status === "error") {
      setMessage(outcome.message);
      setMessageKind("error");
    }
  }, [ready, busy]);

  const clearMessage = useCallback(() => {
    setMessage(null);
    setMessageKind(null);
  }, []);

  return useMemo(
    () => ({
      ready,
      defaultPackage,
      busy,
      message,
      messageKind,
      purchase,
      restore,
      syncEntitlement,
      clearMessage,
    }),
    [ready, defaultPackage, busy, message, messageKind, purchase, restore, syncEntitlement, clearMessage]
  );
}
