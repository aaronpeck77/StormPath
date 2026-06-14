import type { CustomerInfo } from "@revenuecat/purchases-capacitor";
import { describe, expect, it } from "vitest";
import {
  PLUS_SUBSCRIPTION_PRODUCT_IDS,
  STORMPATH_PLUS_ENTITLEMENT_ID,
  customerHasPlusEntitlement,
} from "../revenueCat";

function stubCustomerInfo(partial: Partial<CustomerInfo>): CustomerInfo {
  return {
    entitlements: { active: {}, all: {}, verification: 0 },
    activeSubscriptions: [],
    allPurchasedProductIdentifiers: [],
    latestExpirationDate: null,
    firstSeen: "",
    originalAppUserId: "",
    requestDate: "",
    allExpirationDates: {},
    allPurchaseDates: {},
    originalApplicationVersion: null,
    originalPurchaseDate: null,
    managementURL: null,
    nonSubscriptionTransactions: [],
    subscriptionsByProductIdentifier: {},
    ...partial,
  } as CustomerInfo;
}

describe("customerHasPlusEntitlement", () => {
  it("returns false for null/empty", () => {
    expect(customerHasPlusEntitlement(null)).toBe(false);
    expect(customerHasPlusEntitlement(undefined)).toBe(false);
    expect(customerHasPlusEntitlement(stubCustomerInfo({}))).toBe(false);
  });

  it("detects StormPath Pro entitlement from RevenueCat dashboard", () => {
    const info = stubCustomerInfo({
      entitlements: {
        active: {
          "StormPath Pro": {
            identifier: "StormPath Pro",
            isActive: true,
          } as CustomerInfo["entitlements"]["active"][string],
        },
        all: {},
        verification: 0,
      },
    });
    expect(customerHasPlusEntitlement(info)).toBe(true);
  });

  it("detects active plus entitlement (case-insensitive key)", () => {
    const info = stubCustomerInfo({
      entitlements: {
        active: {
          Plus: {
            identifier: STORMPATH_PLUS_ENTITLEMENT_ID,
            isActive: true,
          } as CustomerInfo["entitlements"]["active"][string],
        },
        all: {},
        verification: 0,
      },
    });
    expect(customerHasPlusEntitlement(info)).toBe(true);
  });

  it("falls back to activeSubscriptions when entitlement map is empty", () => {
    const info = stubCustomerInfo({
      activeSubscriptions: [PLUS_SUBSCRIPTION_PRODUCT_IDS[0]],
    });
    expect(customerHasPlusEntitlement(info)).toBe(true);
  });

  it("ignores inactive plus in all entitlements", () => {
    const info = stubCustomerInfo({
      entitlements: {
        active: {},
        all: {
          plus: {
            identifier: STORMPATH_PLUS_ENTITLEMENT_ID,
            isActive: false,
          } as CustomerInfo["entitlements"]["all"][string],
        },
        verification: 0,
      },
    });
    expect(customerHasPlusEntitlement(info)).toBe(false);
  });
});
