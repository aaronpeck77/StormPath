/**
 * App Store Guideline 3.1.2(c) — title, length, price, and legal links must appear
 * in the in-app purchase flow (About → Subscription), not only in App Store Connect.
 */

export const PLUS_SUBSCRIPTION_TITLE = "StormPath Plus";

/** Shown when StoreKit packages have not loaded yet so reviewers still see length + price. */
export const PLUS_SUBSCRIPTION_FALLBACK_PRICE_LINE =
  "Length: 1 month or 1 year. Typical U.S. prices are $4.99 per month or $39.99 per year. The App Store shows the price for your country at checkout.";

export const PLUS_AUTO_RENEW_DISCLOSURE =
  "StormPath Plus is an optional auto-renewing subscription. Payment is charged to your Apple ID at confirmation of purchase, or after any applicable free trial ends. If you accept a free trial, it automatically converts to the displayed paid subscription unless canceled at least 24 hours before the trial ends. Basic remains available after your Plus access expires. The subscription renews automatically unless you turn off auto-renew at least 24 hours before the end of the current period. Your account is charged for renewal within 24 hours prior to the end of the current period, at the then-current price. Manage or cancel anytime in Settings → Apple ID → Subscriptions, or from Manage subscription below.";

export type SubscriptionOfferLike = {
  packageType?: string | null;
  product?: {
    priceString?: string | null;
    introPrice?: {
      price: number;
      periodUnit: string;
      periodNumberOfUnits: number;
      cycles: number;
    } | null;
  } | null;
};

/** Human length for Apple’s “length of the subscription” requirement. */
export function subscriptionPeriodLabel(pkg: SubscriptionOfferLike): string {
  switch (pkg.packageType) {
    case "MONTHLY":
      return "1 month";
    case "ANNUAL":
      return "1 year";
    case "WEEKLY":
      return "1 week";
    case "TWO_MONTH":
      return "2 months";
    case "THREE_MONTH":
      return "3 months";
    case "SIX_MONTH":
      return "6 months";
    case "LIFETIME":
      return "lifetime";
    default:
      return "";
  }
}

/**
 * Purchase-button copy: title + length + localized price.
 * Example: `StormPath Plus — 1 month — $4.99`
 */
export function hasMonthlyFreeTrial(pkg: SubscriptionOfferLike, eligible: boolean): boolean {
  const intro = pkg.product?.introPrice;
  return eligible && pkg.packageType === "MONTHLY" && Boolean(pkg.product?.priceString?.trim()) &&
    intro?.price === 0 && intro.periodUnit === "MONTH" &&
    intro.periodNumberOfUnits === 1 && intro.cycles === 1;
}

export function formatPlusSubscribeButton(pkg: SubscriptionOfferLike, eligible = false): string {
  const price = pkg.product?.priceString?.trim();
  if (hasMonthlyFreeTrial(pkg, eligible)) {
    return `Start Plus free for 1 month — then ${price}/month`;
  }
  const period = subscriptionPeriodLabel(pkg);
  if (price && period) return `${PLUS_SUBSCRIPTION_TITLE} — ${period} — ${price}`;
  if (price) return `${PLUS_SUBSCRIPTION_TITLE} — ${price}`;
  if (period) return `${PLUS_SUBSCRIPTION_TITLE} — ${period}`;
  return `Subscribe to ${PLUS_SUBSCRIPTION_TITLE}`;
}
