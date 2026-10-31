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
        product: { priceString: "$49.99" },
      })
    ).toBe("StormPath Plus — 1 year — $49.99 — 2 months included");
  });
});

describe("monthly free-trial copy", () => {
  const monthly = {
    packageType: "MONTHLY",
    product: {
      priceString: "€5.99",
      introPrice: { price: 0, periodUnit: "MONTH", periodNumberOfUnits: 1, cycles: 1 },
    },
  };

  it("shows the verified free month and localized renewal price", () => {
    expect(formatPlusSubscribeButton(monthly, true)).toBe(
      "Start Plus free for 1 month — then €5.99/month"
    );
  });

  it("does not advertise a trial for unknown or ineligible customers", () => {
    expect(formatPlusSubscribeButton(monthly)).not.toContain("free");
    expect(formatPlusSubscribeButton(monthly, false)).not.toContain("free");
  });

  it("does not promise a trial on yearly plans or without a matching store offer", () => {
    expect(formatPlusSubscribeButton({ ...monthly, packageType: "ANNUAL" }, true)).not.toContain("free");
    expect(formatPlusSubscribeButton({ packageType: "MONTHLY", product: { priceString: "$4.99" } }, true)).not.toContain("free");
    for (const introPrice of [
      { ...monthly.product.introPrice, price: 1 },
      { ...monthly.product.introPrice, periodNumberOfUnits: 3 },
      { ...monthly.product.introPrice, periodUnit: "WEEK" },
      { ...monthly.product.introPrice, cycles: 2 },
    ]) {
      expect(formatPlusSubscribeButton({ ...monthly, product: { ...monthly.product, introPrice } }, true)).not.toContain("free");
    }
  });

  it("discloses trial conversion and continued Basic access", () => {
    expect(PLUS_AUTO_RENEW_DISCLOSURE).toContain("after any applicable free trial ends");
    expect(PLUS_AUTO_RENEW_DISCLOSURE).toContain("automatically converts");
    expect(PLUS_AUTO_RENEW_DISCLOSURE).toContain("Basic remains available");
  });
});

describe("Guideline 3.1.2(c) purchase-flow copy", () => {
  it("includes title, length, price, and auto-renew terms", () => {
    expect(PLUS_SUBSCRIPTION_TITLE).toBe("StormPath Plus");
    expect(PLUS_SUBSCRIPTION_FALLBACK_PRICE_LINE).toMatch(/1 month/);
    expect(PLUS_SUBSCRIPTION_FALLBACK_PRICE_LINE).toMatch(/1 year/);
    expect(PLUS_SUBSCRIPTION_FALLBACK_PRICE_LINE).toMatch(/\$4\.99/);
    expect(PLUS_SUBSCRIPTION_FALLBACK_PRICE_LINE).toMatch(/\$49\.99/);
    expect(PLUS_SUBSCRIPTION_FALLBACK_PRICE_LINE).toMatch(/includes two months/);
    expect(PLUS_AUTO_RENEW_DISCLOSURE).toMatch(/auto-renew/i);
    expect(PLUS_AUTO_RENEW_DISCLOSURE).toMatch(/24 hours/);
    expect(PLUS_AUTO_RENEW_DISCLOSURE).toMatch(/Apple ID/);
  });
});
