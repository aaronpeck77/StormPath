import { payTierTestPanelEnabled } from "../config/env";
import { safeStorage } from "../storage/safeStorage";
import { readNativePlusEntitlementActive } from "./storeEntitlement";

/**
 * Subscription / pay tier — single place to gate Plus features.
 *
 * Tier inventory: `docs/PAY_TIERS.md` · Store checklist: `docs/MOBILE_STORE_RELEASE.md`
 *
 * **Vite dev (`npm run dev` / `cap run` with dev server, `import.meta.env.DEV`):** defaults to **Plus** so local
 * development and on-device live reload are unblocked. Use About → Test pay tier → Basic, `VITE_PAY_TIER=free`,
 * or `localStorage` override, to test Basic.
 *
 * **Production web (e.g. Netlify):** **Basic** unless `VITE_PAY_TIER=plus` / `pro` or LS override.
 *
 * **Capacitor (iOS / Android) store-style builds:** **Basic** by default — same as production web. Plus when:
 * - build has `VITE_PAY_TIER=plus` (e.g. internal TestFlight), or
 * - {@link readNativePlusEntitlementActive} is true (RevenueCat / StoreKit — see `storeEntitlement.ts`), or
 * - `PAY_TIER_OVERRIDE_LS_KEY` is set (About test panel when enabled).
 *
 * **Plus** unlocks frequent-route learning and other Plus-gated UI (`hasPlusTier()`).
 * **Basic** is full navigation; some Plus-only toggles/features are hidden when not Plus.
 */
export type PayTier = "free" | "plus";

/** `localStorage` key — dev About toggle and manual QA use the same mechanism as production. */
export const PAY_TIER_OVERRIDE_LS_KEY = "stormpath-pay-tier-override";

export function getPayTier(): PayTier {
  /** QA override — only when the About test panel is enabled (dev or internal TF). Never on App Store retail. */
  if (payTierTestPanelEnabled()) {
    /* Verified IAP always wins — avoids "Restore worked but still Basic" after QA forced Basic. */
    if (readNativePlusEntitlementActive()) return "plus";
    const o = safeStorage.get(PAY_TIER_OVERRIDE_LS_KEY)?.toLowerCase();
    if (o === "plus" || o === "pro") return "plus";
    if (o === "free") return "free";
  }
  const v = (import.meta.env.VITE_PAY_TIER as string | undefined)?.toLowerCase();
  if (v === "plus" || v === "pro") return "plus";
  if (v === "free") return "free";
  if (readNativePlusEntitlementActive()) return "plus";
  /* `vite build` / App Store: DEV is false — customers stay Basic until IAP sets entitlement or you ship VITE_PAY_TIER=plus. */
  if (import.meta.env.DEV) return "plus";
  return "free";
}

export function hasPlusTier(): boolean {
  return getPayTier() === "plus";
}

export function hasFrequentRoutesLearning(): boolean {
  return hasPlusTier();
}

/** Preview / compare toll-free alternates when the selected route has tolls. */
export function hasTollBypass(): boolean {
  return hasPlusTier();
}

/**
 * At-your-location **nowcast** (current conditions) — Basic and Plus.
 * Hourly / 7-day / NWS location alerts on the advisory page remain Plus-only in the UI.
 */
export function hasLocalForecast(): boolean {
  return true;
}

/** Basic tier saved-item caps (Plus = unlimited). */
export const BASIC_MAX_SAVED_PLACES = 2;
export const BASIC_MAX_SAVED_ROUTES = 1;

export function maxSavedPlaces(): number | null {
  return hasPlusTier() ? null : BASIC_MAX_SAVED_PLACES;
}

export function maxSavedRoutes(): number | null {
  return hasPlusTier() ? null : BASIC_MAX_SAVED_ROUTES;
}
