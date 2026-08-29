import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
  },
}));

import { PAY_TIER_OVERRIDE_LS_KEY, getPayTier, hasLocalForecast } from "../payFeatures";
import { NATIVE_PLUS_ENTITLEMENT_LS_KEY } from "../storeEntitlement";
import { safeStorage } from "../../storage/safeStorage";

describe("getPayTier", () => {
  afterEach(() => {
    safeStorage.remove(PAY_TIER_OVERRIDE_LS_KEY);
    safeStorage.remove(NATIVE_PLUS_ENTITLEMENT_LS_KEY);
    vi.unstubAllEnvs();
  });

  it("returns plus in Vite dev when no override", () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_PAY_TIER", "");
    expect(getPayTier()).toBe("plus");
  });

  it("returns free in production build without entitlement", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_PAY_TIER", "");
    expect(getPayTier()).toBe("free");
  });

  it("honors native entitlement in production", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_PAY_TIER", "");
    safeStorage.set(NATIVE_PLUS_ENTITLEMENT_LS_KEY, "active");
    expect(getPayTier()).toBe("plus");
  });

  it("honors local override for QA when test panel is on and no IAP entitlement", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_PAY_TIER_TEST_PANEL", "true");
    safeStorage.set(PAY_TIER_OVERRIDE_LS_KEY, "free");
    expect(getPayTier()).toBe("free");
  });

  it("IAP entitlement wins over QA Basic override when test panel is on", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_PAY_TIER_TEST_PANEL", "true");
    safeStorage.set(PAY_TIER_OVERRIDE_LS_KEY, "free");
    safeStorage.set(NATIVE_PLUS_ENTITLEMENT_LS_KEY, "active");
    expect(getPayTier()).toBe("plus");
  });

  it("ignores stale QA override on retail builds when IAP entitlement is active", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_PAY_TIER_TEST_PANEL", "");
    safeStorage.set(PAY_TIER_OVERRIDE_LS_KEY, "free");
    safeStorage.set(NATIVE_PLUS_ENTITLEMENT_LS_KEY, "active");
    expect(getPayTier()).toBe("plus");
  });
});

describe("hasLocalForecast", () => {
  afterEach(() => {
    safeStorage.remove(PAY_TIER_OVERRIDE_LS_KEY);
    safeStorage.remove(NATIVE_PLUS_ENTITLEMENT_LS_KEY);
    vi.unstubAllEnvs();
  });

  it("is available on Basic and Plus", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_PAY_TIER", "");
    vi.stubEnv("VITE_PAY_TIER_TEST_PANEL", "true");
    expect(hasLocalForecast()).toBe(true);
    safeStorage.set(PAY_TIER_OVERRIDE_LS_KEY, "plus");
    expect(hasLocalForecast()).toBe(true);
  });
});
