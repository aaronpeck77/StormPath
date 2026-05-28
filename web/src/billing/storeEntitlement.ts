import { Capacitor } from "@capacitor/core";
import { safeStorage } from "../storage/safeStorage";

/**
 * On-device Plus unlock for **Capacitor** builds (iOS / Android).
 *
 * Today: QA can set the entitlement key and reload. **Replace** with StoreKit / Play Billing /
 * RevenueCat (or similar): after a verified purchase, call {@link setNativePlusEntitlementActive}.
 *
 * Do not use for web (browser) — `getPayTier()` ignores this unless native.
 */
export const NATIVE_PLUS_ENTITLEMENT_LS_KEY = "stormpath-native-plus-entitlement";

export function readNativePlusEntitlementActive(): boolean {
  if (!Capacitor.isNativePlatform()) return false;
  return safeStorage.get(NATIVE_PLUS_ENTITLEMENT_LS_KEY) === "active";
}

/** Called from future IAP success handler (and tests). No-op on web. */
export function setNativePlusEntitlementActive(active: boolean): void {
  if (!Capacitor.isNativePlatform()) return;
  if (active) safeStorage.set(NATIVE_PLUS_ENTITLEMENT_LS_KEY, "active");
  else safeStorage.remove(NATIVE_PLUS_ENTITLEMENT_LS_KEY);
}
