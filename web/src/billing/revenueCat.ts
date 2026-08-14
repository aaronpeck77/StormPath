import { Capacitor } from "@capacitor/core";
import {
  type CustomerInfo,
  LOG_LEVEL,
  PURCHASES_ERROR_CODE,
  Purchases,
  type PurchasesOffering,
  type PurchasesPackage,
} from "@revenuecat/purchases-capacitor";
import { setNativePlusEntitlementActive, readNativePlusEntitlementActive } from "./storeEntitlement";

/**
 * RevenueCat wrapper — Phase 7.
 *
 * Single touch-point between StormPath's pay-tier code and RevenueCat's `Purchases` SDK.
 * Every method is safe to call on web (where it no-ops or returns a "not supported" result),
 * so the React UI can call `purchasePlusOffering()` / `restorePlusEntitlement()` without
 * branching on `Capacitor.isNativePlatform()` everywhere.
 *
 * **Why a wrapper instead of using `Purchases` directly:**
 *   - Centralizes the "is the SDK available right now?" check (native platform + API key set
 *     + `configure()` finished). Most of the UI just wants a yes/no on availability.
 *   - Maps RevenueCat's verbose error codes onto the small set we actually want to surface to
 *     the user ("user cancelled", "network error", "store problem", "configuration error",
 *     anything else).
 *   - Owns the bridge from `customerInfo.entitlements.active.plus` → `setNativePlusEntitlementActive`.
 *     `getPayTier()` reads `readNativePlusEntitlementActive()` synchronously off `safeStorage`,
 *     so once we mirror entitlement state into `safeStorage`, the rest of the app picks it up
 *     after a `reprobePayTier()` bump (see `App.tsx`).
 *
 * **What you need outside this file before this code does anything visible:**
 *   1. RevenueCat dashboard → create a project for the iOS bundle id, generate an iOS API key.
 *   2. App Store Connect → create one or more auto-renewable subscription products (e.g.
 *      `stormpath.plus.monthly`, `stormpath.plus.yearly`) and a subscription group.
 *   3. RevenueCat dashboard → import those products, attach them to an entitlement named
 *      exactly `"plus"` ({@link STORMPATH_PLUS_ENTITLEMENT_ID}).
 *   4. RevenueCat dashboard → create an offering and add the product packages to it. The
 *      "current" offering is what `getPlusOffering()` returns; non-current offerings are
 *      ignored.
 *   5. Drop the iOS API key into `web/.env.testflight` and `web/.env.production` as
 *      `VITE_REVENUECAT_API_KEY_IOS=appl_...`.
 *   6. (Optional) Sandbox-test on a real iPhone with a Sandbox tester account
 *      (App Store Connect → Users and Access → Sandbox Testers).
 *
 * Until step 5 lands the wrapper stays in "uninitialized" mode: `isReady()` returns false,
 * the AboutSheet shows the existing URL fallback, and no purchase UI is reachable.
 */

/**
 * Entitlement identifier in RevenueCat. **Must match exactly** what's configured in the
 * RevenueCat dashboard (Project → Entitlements). Changing this name without updating the
 * dashboard would silently disable Plus for everyone.
 */
export const STORMPATH_PLUS_ENTITLEMENT_ID = "plus";

/** Normalize RC entitlement identifiers for comparison (`StormPath Pro` → `stormpathpro`). */
function normalizeEntitlementId(id: string): string {
  return id.toLowerCase().replace(/[\s_-]+/g, "");
}

/** Known RevenueCat entitlement ids that grant Plus (dashboard slug may differ from display name). */
const PLUS_ENTITLEMENT_NORMALIZED = new Set([
  "plus",
  "pro",
  "stormpathplus",
  "stormpathpro",
]);

function entitlementKeyGrantsPlus(key: string): boolean {
  const norm = normalizeEntitlementId(key);
  if (PLUS_ENTITLEMENT_NORMALIZED.has(norm)) return true;
  return norm.includes("stormpath") && (norm.includes("plus") || norm.includes("pro"));
}

/** App Store product IDs that grant Plus — fallback when RC subscription exists but entitlement map is empty.
 *  Include both the intended ids and the RC rows already created (`storm.path.*`) so Restore still matches. */
export const PLUS_SUBSCRIPTION_PRODUCT_IDS = [
  "stormpath.plus.monthly",
  "stormpath.plus.yearly",
  "storm.path.monthly",
  "storm.path.yearly",
] as const;

let configured = false;
let configuringPromise: Promise<boolean> | null = null;
let listenerCallbackId: string | null = null;

/**
 * Result returned by `purchasePlusOffering()` / `restorePlusEntitlement()` so the UI can
 * decide between "show success", "swallow silently" (cancellation), and "show error message".
 */
export type PurchaseOutcome =
  | { status: "ok"; entitled: boolean }
  | { status: "cancelled" }
  | { status: "unsupported" }
  | { status: "error"; message: string; code?: PURCHASES_ERROR_CODE };

export interface InitRevenueCatOptions {
  /** RevenueCat iOS API key (`appl_...`). Empty string = leave SDK uninitialized. */
  iosApiKey: string;
  /** Optional stable user id. If omitted, RevenueCat assigns an anonymous id. */
  appUserId?: string | null;
}

/**
 * Initialize the RevenueCat SDK. Idempotent — concurrent callers share the same in-flight
 * promise; subsequent calls after success are no-ops. Returns `true` once configured,
 * `false` if the platform/API key combination prevents configuration.
 *
 * Call once from `main.tsx` *before* React renders; the SDK doesn't need to block initial
 * paint, but the customer-info listener should attach early so the first `getCustomerInfo()`
 * pull on AboutSheet open doesn't race the configure call.
 */
export async function initRevenueCat(opts: InitRevenueCatOptions): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  if (!opts.iosApiKey) return false;
  if (configured) return true;
  if (configuringPromise) return configuringPromise;

  configuringPromise = (async () => {
    try {
      /* `Purchases.configure` accepts the same shape on both iOS and Android; the iOS API
       * key prefix (`appl_`) is what the SDK uses to route. We don't pass an Android key
       * here because StormPath ships iOS first; when Android lands, branch on platform. */
      await Purchases.configure({
        apiKey: opts.iosApiKey,
        appUserID: opts.appUserId ?? null,
      });
      /* Sets log level to INFO in production / DEBUG in dev — useful when debugging
       * "user can't purchase" reports. RevenueCat's logs are quite chatty at DEBUG. */
      await Purchases.setLogLevel({
        level: import.meta.env.DEV ? LOG_LEVEL.DEBUG : LOG_LEVEL.INFO,
      });

      /* Subscribe to customer info pushes (purchases, restores, refunds, family sharing).
       * Mirrors entitlement state into `safeStorage` so `getPayTier()` reflects it. */
      const callbackId = await Purchases.addCustomerInfoUpdateListener((info) => {
        applyCustomerInfo(info);
      });
      listenerCallbackId = callbackId;

      /* Pull initial state — covers the case where the user already had Plus before this
       * launch (e.g. fresh install with iCloud restore, or user reopened the app after a
       * background purchase). */
      const initial = await Purchases.getCustomerInfo();
      applyCustomerInfo(initial.customerInfo);

      configured = true;

      /* After Apple/RevenueCat credentials are fixed server-side, a silent restore on cold
       * start picks up TestFlight subs that predate valid receipt validation. */
      if (!customerHasPlusEntitlement(initial.customerInfo)) {
        void refreshPlusEntitlementFromStore();
      }

      return true;
    } catch (e) {
      /* Configuration failure is silent — it's almost always a missing/wrong API key,
       * which is something the developer needs to fix, not the user. The UI sees
       * `isReady() === false` and falls back to the existing URL flow. */
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn("[RevenueCat] configure failed:", e);
      }
      configured = false;
      return false;
    } finally {
      configuringPromise = null;
    }
  })();

  return configuringPromise;
}

/** True if running on native + `configure()` succeeded. UI uses this to gate native purchase buttons. */
export function isRevenueCatReady(): boolean {
  return configured;
}

/** Await in-flight `initRevenueCat` — App mount sync should run after configure, not before. */
export function whenRevenueCatReady(): Promise<boolean> {
  if (configured) return Promise.resolve(true);
  if (configuringPromise) return configuringPromise;
  return Promise.resolve(false);
}

/** Internal: mirror RevenueCat's entitlement state into `safeStorage`. */
function applyCustomerInfo(info: CustomerInfo): void {
  const hasPlus = customerHasPlusEntitlement(info);
  setNativePlusEntitlementActive(hasPlus);
  /* Notify React via a window event so App.tsx can `reprobePayTier()` without a prop chain
   * back into the SDK. The dispatch is best-effort — if no listener is attached the entitlement
   * is still durably saved, so the next render that reads `getPayTier()` will see it. */
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(NATIVE_PAY_TIER_CHANGED_EVENT, { detail: { hasPlus } }));
  }
}

/** Pure helper — exported for tests and for callers that already have a `CustomerInfo` in hand. */
export function customerHasPlusEntitlement(info: CustomerInfo | null | undefined): boolean {
  if (!info) return false;

  const active = info.entitlements?.active ?? {};
  for (const [key, ent] of Object.entries(active)) {
    if (ent?.isActive !== false && entitlementKeyGrantsPlus(key)) {
      return true;
    }
  }

  /* StormPath has one paid tier — if RC shows any active entitlement (e.g. "StormPath Pro"), unlock Plus. */
  if (Object.values(active).some((ent) => ent?.isActive !== false)) {
    return true;
  }

  const all = info.entitlements?.all ?? {};
  for (const [key, ent] of Object.entries(all)) {
    if (ent.isActive && entitlementKeyGrantsPlus(key)) {
      return true;
    }
  }

  const subs = info.activeSubscriptions ?? [];
  if (subs.length > 0) return true;

  const byProduct = info.subscriptionsByProductIdentifier ?? {};
  return Object.values(byProduct).some((s) => s?.isActive);
}

/**
 * Window event name dispatched whenever native entitlement state changes (purchase, restore,
 * refund, family-share). App.tsx listens for it and calls `reprobePayTier()`.
 */
export const NATIVE_PAY_TIER_CHANGED_EVENT = "stormpath:native-pay-tier-changed";

/**
 * Fetch the current RevenueCat offering. Returns `null` on web, when not configured, when
 * no offerings exist, or on transient network errors. Callers should treat `null` as
 * "show the URL fallback for now."
 *
 * If the dashboard forgot to mark an offering Current, use the first offering so Subscribe
 * still appears (yearly-only is fine — {@link pickDefaultPlusPackage} prefers monthly then annual).
 */
export async function getPlusOffering(): Promise<PurchasesOffering | null> {
  if (!configured) return null;
  try {
    const offerings = await Purchases.getOfferings();
    return pickCurrentOrFirstOffering(offerings);
  } catch {
    return null;
  }
}

/** Prefer the dashboard Current offering; otherwise the first offering in `all`. */
export function pickCurrentOrFirstOffering(offerings: {
  current?: PurchasesOffering | null;
  all?: Record<string, PurchasesOffering> | null;
}): PurchasesOffering | null {
  if (offerings.current) return offerings.current;
  const all = offerings.all ? Object.values(offerings.all) : [];
  return all[0] ?? null;
}

/** Monthly if present, else yearly, else whatever package is on the offering. */
export function pickDefaultPlusPackage(offering: PurchasesOffering | null): PurchasesPackage | null {
  if (!offering) return null;
  return offering.monthly ?? offering.annual ?? offering.availablePackages[0] ?? null;
}

/**
 * Drive a purchase flow for the given package. Surfaces a small, opinionated outcome:
 * `cancelled` (user backed out, no message needed), `error` (with a short user-readable
 * string), or `ok` with `entitled: true` if the resulting `customerInfo` shows Plus active.
 */
export async function purchasePackage(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  if (!Capacitor.isNativePlatform()) return { status: "unsupported" };
  if (!configured) return { status: "error", message: "Subscriptions are not configured." };
  try {
    const result = await Purchases.purchasePackage({ aPackage: pkg });
    const entitled = customerHasPlusEntitlement(result.customerInfo);
    /* `applyCustomerInfo` runs via the listener too, but call it here so the safeStorage
     * write happens before our `await` returns — the UI's optimistic re-render is correct. */
    applyCustomerInfo(result.customerInfo);
    return { status: "ok", entitled };
  } catch (e) {
    if (e && typeof e === "object" && "code" in e) {
      const err = e as { code: PURCHASES_ERROR_CODE };
      if (err.code === PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR) {
        return restorePlusEntitlement();
      }
    }
    return mapPurchaseError(e);
  }
}

/**
 * Restore prior purchases for this Apple ID. Required by App Store review (Guideline 3.1.1
 * — Auto-Renewable Subscriptions: "Apps with subscriptions must include a Restore button").
 * Returns `entitled: true` if the user had Plus and it has now been re-unlocked.
 */
export async function restorePlusEntitlement(): Promise<PurchaseOutcome> {
  if (!Capacitor.isNativePlatform()) return { status: "unsupported" };
  if (!configured) return { status: "error", message: "Subscriptions are not configured." };
  try {
    const result = await Purchases.restorePurchases();
    const entitled = customerHasPlusEntitlement(result.customerInfo);
    applyCustomerInfo(result.customerInfo);
    return { status: "ok", entitled };
  } catch (e) {
    return mapPurchaseError(e);
  }
}

/**
 * Re-read StoreKit / RevenueCat when Apple already shows an active subscription but the app
 * is still on Basic (common after metadata fixes or a purchase before entitlement wiring).
 */
export async function refreshPlusEntitlementFromStore(): Promise<PurchaseOutcome> {
  if (!Capacitor.isNativePlatform()) return { status: "unsupported" };
  if (!configured) return { status: "error", message: "Subscriptions are not configured." };
  try {
    const cached = await Purchases.getCustomerInfo();
    if (customerHasPlusEntitlement(cached.customerInfo)) {
      applyCustomerInfo(cached.customerInfo);
      return { status: "ok", entitled: true };
    }
    return restorePlusEntitlement();
  } catch (e) {
    return mapPurchaseError(e);
  }
}

/** Support diagnostics — active RevenueCat entitlements vs local Plus mirror. */
export async function getPlusEntitlementDebugSnapshot(): Promise<string> {
  if (!Capacitor.isNativePlatform()) return "iap: web (n/a)";
  if (!configured) return "iap: sdk not configured";
  try {
    const info = (await Purchases.getCustomerInfo()).customerInfo;
    const activeEnt =
      Object.keys(info.entitlements?.active ?? {})
        .filter(Boolean)
        .join(", ") || "none";
    const subs = (info.activeSubscriptions ?? []).join(", ") || "none";
    const native = readNativePlusEntitlementActive() ? "yes" : "no";
    return `iap: sdk=ok, nativePlus=${native}, rcEntitlements=[${activeEnt}], rcSubs=[${subs}]`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `iap: sdk error (${msg})`;
  }
}

/** Translate the RevenueCat error shape into the small union surfaced to UI. */
function mapPurchaseError(e: unknown): PurchaseOutcome {
  if (e && typeof e === "object" && "code" in e) {
    const err = e as { code: PURCHASES_ERROR_CODE; message?: string };
    if (err.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
      return { status: "cancelled" };
    }
    return {
      status: "error",
      code: err.code,
      message: friendlyPurchaseErrorMessage(err.code, err.message),
    };
  }
  const fallback = e instanceof Error ? e.message : String(e);
  return { status: "error", message: fallback };
}

/** Maps RevenueCat error codes to short, non-technical messages we'd be willing to put on screen. */
function friendlyPurchaseErrorMessage(
  code: PURCHASES_ERROR_CODE,
  rawMessage?: string
): string {
  switch (code) {
    case PURCHASES_ERROR_CODE.NETWORK_ERROR:
    case PURCHASES_ERROR_CODE.OFFLINE_CONNECTION_ERROR:
      return "Network unavailable. Try again when you have a signal.";
    case PURCHASES_ERROR_CODE.STORE_PROBLEM_ERROR:
      return "The App Store is having trouble right now. Try again in a minute.";
    case PURCHASES_ERROR_CODE.PURCHASE_NOT_ALLOWED_ERROR:
      return "Purchases are restricted on this device. Check Screen Time / Family Sharing settings.";
    case PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR:
      return "Your purchase is pending — Apple will notify you when it completes.";
    case PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR:
      return "You already own this subscription. Try Restore Purchases instead.";
    case PURCHASES_ERROR_CODE.PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR:
      return "This subscription is not available right now. Try again later.";
    case PURCHASES_ERROR_CODE.CONFIGURATION_ERROR:
    case PURCHASES_ERROR_CODE.INVALID_CREDENTIALS_ERROR:
    case PURCHASES_ERROR_CODE.INVALID_APPLE_SUBSCRIPTION_KEY_ERROR:
      return "Subscriptions are misconfigured. Please report this to support.";
    default:
      return rawMessage || "Something went wrong. Try again, or contact support.";
  }
}

/** Tear down listener — currently only used in tests. */
export async function shutdownRevenueCat(): Promise<void> {
  if (listenerCallbackId) {
    await Purchases.removeCustomerInfoUpdateListener({
      listenerToRemove: listenerCallbackId,
    }).catch(() => undefined);
    listenerCallbackId = null;
  }
  configured = false;
}
