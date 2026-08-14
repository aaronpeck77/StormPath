import { VERIFICATION_RESULT, type CustomerInfo } from "@revenuecat/purchases-capacitor";
import { describe, expect, it } from "vitest";
import {
  PLUS_SUBSCRIPTION_PRODUCT_IDS,
  STORMPATH_PLUS_ENTITLEMENT_ID,
  customerHasPlusEntitlement,
  pickCurrentOrFirstOffering,
  pickDefaultPlusPackage,
} from "../revenueCat";

function stubEntitlements(
  partial: Partial<Omit<CustomerInfo["entitlements"], "verification">> = {}
): CustomerInfo["entitlements"] {
  return {
    active: {},
    all: {},
    verification: VERIFICATION_RESULT.NOT_REQUESTED,
    ...partial,
  };
}

function stubCustomerInfo(partial: Partial<CustomerInfo>): CustomerInfo {
  return {
    entitlements: stubEntitlements(),
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
      entitlements: stubEntitlements({
        active: {
          "StormPath Pro": {
            identifier: "StormPath Pro",
            isActive: true,
          } as CustomerInfo["entitlements"]["active"][string],
        },
      }),
    });
    expect(customerHasPlusEntitlement(info)).toBe(true);
  });

  it("detects active plus entitlement (case-insensitive key)", () => {
    const info = stubCustomerInfo({
      entitlements: stubEntitlements({
        active: {
          Plus: {
            identifier: STORMPATH_PLUS_ENTITLEMENT_ID,
            isActive: true,
          } as CustomerInfo["entitlements"]["active"][string],
        },
      }),
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
      entitlements: stubEntitlements({
        all: {
          plus: {
            identifier: STORMPATH_PLUS_ENTITLEMENT_ID,
            isActive: false,
          } as CustomerInfo["entitlements"]["all"][string],
        },
      }),
    });
    expect(customerHasPlusEntitlement(info)).toBe(false);
  });
});

describe("pickCurrentOrFirstOffering", () => {
  const monthlyOffering = { identifier: "default", availablePackages: [] } as never;
  const otherOffering = { identifier: "backup", availablePackages: [] } as never;

  it("uses the Current offering when set", () => {
    expect(
      pickCurrentOrFirstOffering({
        current: monthlyOffering,
        all: { backup: otherOffering },
      })
    ).toBe(monthlyOffering);
  });

  it("falls back to the first offering if Current is missing", () => {
    expect(
      pickCurrentOrFirstOffering({
        current: null,
        all: { backup: otherOffering },
      })
    ).toBe(otherOffering);
  });
});

describe("pickDefaultPlusPackage", () => {
  const monthly = { identifier: "$rc_monthly" } as never;
  const annual = { identifier: "$rc_annual" } as never;
  const other = { identifier: "custom" } as never;

  it("prefers monthly, then annual, then any package", () => {
    expect(
      pickDefaultPlusPackage({
        monthly,
        annual,
        availablePackages: [other],
      } as never)
    ).toBe(monthly);
    expect(
      pickDefaultPlusPackage({
        monthly: null,
        annual,
        availablePackages: [other],
      } as never)
    ).toBe(annual);
    expect(
      pickDefaultPlusPackage({
        monthly: null,
        annual: null,
        availablePackages: [other],
      } as never)
    ).toBe(other);
  });

  it("returns null with no offering or packages", () => {
    expect(pickDefaultPlusPackage(null)).toBeNull();
    expect(
      pickDefaultPlusPackage({
        monthly: null,
        annual: null,
        availablePackages: [],
      } as never)
    ).toBeNull();
  });
});
