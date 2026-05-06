import { Capacitor } from "@capacitor/core";

/**
 * On-device Plus unlock for **Capacitor** builds (iOS / Android).
 *
 * Today: QA can set `localStorage` and reload. **Replace** with StoreKit / Play Billing /
 * RevenueCat (or similar): after a verified purchase, call {@link setNativePlusEntitlementActive}.
 *
 * Do not use for web (browser) — `getPayTier()` ignores this unless native.
 */
export const NATIVE_PLUS_ENTITLEMENT_LS_KEY = "stormpath-native-plus-entitlement";

export function readNativePlusEntitlementActive(): boolean {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    return localStorage.getItem(NATIVE_PLUS_ENTITLEMENT_LS_KEY) === "active";
  } catch {
    return false;
  }
}

/** Called from future IAP success handler (and tests). No-op on web. */
export function setNativePlusEntitlementActive(active: boolean): void {
  if (!Capacitor.isNativePlatform()) return;
  try {
    if (active) localStorage.setItem(NATIVE_PLUS_ENTITLEMENT_LS_KEY, "active");
    else localStorage.removeItem(NATIVE_PLUS_ENTITLEMENT_LS_KEY);
  } catch {
    /* ignore quota / private mode */
  }
}
