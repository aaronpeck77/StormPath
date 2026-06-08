import { readNativePlusEntitlementActive } from "./storeEntitlement";

/**
 * Subscription / pay tier — single place to gate Plus features.
 *
 * Tier inventory: `docs/PAY_TIERS.md` · Store checklist: `docs/MOBILE_STORE_RELEASE.md`
 *
 * All users currently receive **Plus** (test Basic override removed).
 */
export type PayTier = "free" | "plus";

/** @deprecated No longer read — kept so stale localStorage keys are harmless. */
export const PAY_TIER_OVERRIDE_LS_KEY = "stormpath-pay-tier-override";

export function getPayTier(): PayTier {
  void readNativePlusEntitlementActive();
  return "plus";
}

export function hasPlusTier(): boolean {
  return true;
}

export function hasFrequentRoutesLearning(): boolean {
  return hasPlusTier();
}

/** Preview / compare toll-free alternates when the selected route has tolls. */
export function hasTollBypass(): boolean {
  return hasPlusTier();
}
