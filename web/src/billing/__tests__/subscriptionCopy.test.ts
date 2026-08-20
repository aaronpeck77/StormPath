import { describe, expect, it } from "vitest";
import {
  formatPlusSubscribeButton,
  PLUS_AUTO_RENEW_DISCLOSURE,
  PLUS_SUBSCRIPTION_FALLBACK_PRICE_LINE,
  PLUS_SUBSCRIPTION_TITLE,
  subscriptionPeriodLabel,
} from "../subscriptionCopy";

describe("subscriptionPeriodLabel", () => {
  it("names monthly and yearly lengths for App Review", () => {
    expect(subscriptionPeriodLabel({ packageType: "MONTHLY" })).toBe("1 month");
    expect(subscriptionPeriodLabel({ packageType: "ANNUAL" })).toBe("1 year");
  });
});

describe("formatPlusSubscribeButton", () => {
  it("puts title, length, and price on the purchase button", () => {
    expect(
      formatPlusSubscribeButton({
        packageType: "MONTHLY",
        product: { priceString: "$4.99" },
      })
    ).toBe("StormPath Plus — 1 month — $4.99");
    expect(
      formatPlusSubscribeButton({
        packageType: "ANNUAL",
        product: { priceString: "$39.99" },
      })
    ).toBe("StormPath Plus — 1 year — $39.99");
  });
});

describe("Guideline 3.1.2(c) purchase-flow copy", () => {
  it("includes title, length, price, and auto-renew terms", () => {
    expect(PLUS_SUBSCRIPTION_TITLE).toBe("StormPath Plus");
    expect(PLUS_SUBSCRIPTION_FALLBACK_PRICE_LINE).toMatch(/1 month/);
    expect(PLUS_SUBSCRIPTION_FALLBACK_PRICE_LINE).toMatch(/1 year/);
    expect(PLUS_SUBSCRIPTION_FALLBACK_PRICE_LINE).toMatch(/\$4\.99/);
    expect(PLUS_SUBSCRIPTION_FALLBACK_PRICE_LINE).toMatch(/\$39\.99/);
    expect(PLUS_AUTO_RENEW_DISCLOSURE).toMatch(/auto-renew/i);
    expect(PLUS_AUTO_RENEW_DISCLOSURE).toMatch(/24 hours/);
    expect(PLUS_AUTO_RENEW_DISCLOSURE).toMatch(/Apple ID/);
  });
});
